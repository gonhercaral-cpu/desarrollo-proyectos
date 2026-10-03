const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { createPublicationFiles } = require("../drive/activeClassroomFiles");
const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
const { PROCESSOR_VERSION, processingTargetPath } = require("../drive/activeClassroomProcessingModel");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Solo emuladores Firestore/Storage.");

test("PPTX y DOCX procesados, bloqueo, fallo/reintento, v2 PDF y v1 intacta", async () => {
  const app = admin.initializeApp({ projectId: "office-processing-tests", storageBucket: "office-processing-tests.appspot.com" }, "office-processing");
  const db = app.firestore(); const bucket = app.storage().bucket();
  const profile = { uid: "admin", active: true, role: "admin" };
  const getProfile = async(uid) => uid === "admin" ? profile : { active: true, role: "requester" };
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const unitId = "unit-office"; const unitRef = db.doc(`activeClassroomUnits/${unitId}`);
  const source = { id: "drive-main", name: "Songs.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", version: "1", modifiedTime: "2026-10-02" };
  const mainRef = db.doc("activeClassroomResources/main-office"); const docRef = db.doc("activeClassroomResources/doc-office");
  const files = createPublicationFiles({ db, bucket, resolveFile: async()=>({...source}), openDrive: async()=>Readable.from(`original-${source.version}`) });
  let calls = 0; let failDoc = true; let unlock; const hold = new Promise(resolve=>{unlock=resolve;});
  const processing = createDocumentProcessing({ db, bucket, getProfile, prepareResource: files.prepareResource, timestamp,
    convert: async(data) => {
      calls++;
      if(data.extension === "pptx" && calls === 1) await hold;
      if(data.extension === "docx" && failDoc) throw new Error("private-upstream-error");
      const bytes = Buffer.from(`%PDF-1.4\nconversion-${data.revision}\n%%EOF`);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const path = processingTargetPath(data.revision);
      const file = bucket.file(path); const pageCount = data.extension === "pptx" ? 3 : 1;
      await file.save(bytes, { resumable:false, preconditionOpts:{ifGenerationMatch:0}, metadata:{contentType:"application/pdf",metadata:{sha256:hash,processingRevision:data.revision,pageCount:String(pageCount)}} });
      const [metadata] = await file.getMetadata();
      return { processorVersion:PROCESSOR_VERSION, revision:data.revision, pageCount, download:{endpoint:"activeClassroomPublicationFile",provider:"storage",path,generation:String(metadata.generation),mimeType:"application/pdf",name:"Songs.pdf",sizeBytes:bytes.length,checksums:{sha256:hash},capturedAt:new Date().toISOString()} };
    } });
  const units = createUnitHandlers({ db,getProfile,resolveFile:async()=>({...source}),prepareResource:processing.prepareDelivery,timestamp });
  const request = (resourceId,expectedRevision,uid="admin")=>({auth:{uid},data:{unitId,resourceId,expectedRevision}});
  try {
    await db.doc("activeClassroomFolders/level-office").set({kind:"level",active:true});
    await db.doc(`activeClassroomFolders/${unitId}`).set({kind:"unit",parentId:"level-office",active:true});
    await mainRef.set({folderId:unitId,source:"drive",kind:"presentation",name:source.name,mimeType:source.mimeType,driveFileId:source.id,driveVersion:source.version,driveModifiedTime:source.modifiedTime});
    const storagePath="active-classroom/resources/doc-office/guide.docx";
    await bucket.file(storagePath).save("original docx",{contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
    await docRef.set({folderId:unitId,source:"storage",kind:"document",name:"Guide.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",storagePath});
    const draft={name:"Unit",levelId:"level-office",status:"active",metadata:{tags:[]},mainPresentationId:"main-office",generalResourceIds:[],slides:Array.from({length:4},(_,index)=>({slideId:`old-${index}`,index,title:"",metadata:{pageNumber:index+1},resourceIds:index===3?["doc-office"]:[]}))};
    await units.save({auth:{uid:"admin"},data:{unitId,draft,expectedRevision:0}});
    const v1={version:1,manifest:{immutable:"legacy Office"},contentHash:"old"};
    await unitRef.update({publishedVersion:1}); await unitRef.collection("publications").doc("1").set(v1);
    await assert.rejects(processing.process(request("main-office",1,"teacher")),{code:"permission-denied"});
    const running=processing.process(request("main-office",1));
    for(let i=0;i<200 && (await mainRef.get()).data().processing?.state!=="processing";i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal((await mainRef.get()).data().processing.state,"processing");
    await assert.rejects(units.publish(request(undefined,1)),{code:"failed-precondition"});
    assert.equal((await processing.process(request("main-office",1))).state,"processing");
    unlock(); const result=await running;
    assert.equal(result.draftRevision,2); assert.equal(result.draft.slides.length,3);
    assert.deepEqual(result.draft.generalResourceIds,["doc-office"]); assert.equal(result.draft.slides[0].slideId,"old-0");
    await assert.rejects(units.publish(request(undefined,2)),{code:"failed-precondition"});
    await assert.rejects(processing.process(request("doc-office",2)),{code:"failed-precondition"});
    assert.equal((await docRef.get()).data().processing.state,"failed");
    failDoc=false; const document=await processing.process(request("doc-office",2)); assert.equal(document.draftRevision,3);
    assert.equal((await units.publish(request(undefined,3))).version,2);
    const published=(await unitRef.collection("publications").doc("2").get()).data().manifest;
    assert.deepEqual((await unitRef.collection("publications").doc("1").get()).data(),v1);
    assert.equal(published.slides.length,3);
    for(const resource of published.resources) {
      assert.equal(resource.deliveryMime,"application/pdf"); assert.equal(resource.download.mimeType,"application/pdf");
      assert.ok(resource.originalMime.includes("officedocument")); assert.notEqual(resource.original.snapshot.path,resource.download.path);
      assert.equal(resource.derivative.file.generation,resource.download.generation);
    }
    assert.deepEqual(published.slides.map(s=>s.metadata.pageNumber),[1,2,3]);
    assert.equal(published.slides[0].metadata.delivery.checksum,published.resources.find(r=>r.resourceId==="main-office").download.checksums.sha256);
    const oldFile=published.resources.find(r=>r.resourceId==="main-office").download;
    const [oldBytes]=await bucket.file(oldFile.path,{generation:oldFile.generation}).download();
    source.version="2";
    const updated=await units.refreshDrive(request("main-office",3)); assert.equal(updated.draftRevision,4);
    await assert.rejects(units.publish(request(undefined,4)),{code:"failed-precondition"});
    await processing.process(request("main-office",4));
    assert.equal((await units.publish(request(undefined,5))).version,3);
    assert.deepEqual((await unitRef.collection("publications").doc("2").get()).data().manifest,published);
    assert.deepEqual((await bucket.file(oldFile.path,{generation:oldFile.generation}).download())[0],oldBytes);
    assert.equal((await unitRef.collection("publications").doc("1").get()).data().manifest.immutable,"legacy Office");
  } finally { unlock(); await app.delete(); }
});

