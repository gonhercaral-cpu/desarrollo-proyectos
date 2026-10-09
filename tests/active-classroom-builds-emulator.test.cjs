const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const admin = require("../drive/node_modules/firebase-admin");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { createPublicationFiles, descriptor } = require("../drive/activeClassroomFiles");
const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
const { PPTX_PROCESSOR_VERSION, rasterTargetPath } = require("../drive/activeClassroomProcessingModel");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Solo emuladores Firestore/Storage.");

test("PPTX revela offline: congelado de estados/assets, fallo, reintento e inmutabilidad real", async () => {
  const app = admin.initializeApp({ projectId: "builds-tests", storageBucket: "builds-tests.appspot.com" }, "builds-tests");
  const db = app.firestore(), bucket = app.storage().bucket();
  const unitId = "unit-builds", resourceId = "main-builds";
  const unitRef = db.doc(`activeClassroomUnits/${unitId}`), mainRef = db.doc(`activeClassroomResources/${resourceId}`);
  const profile = { active: true, role: "admin" }; const getProfile = async () => profile;
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const source = { id: "pptx", name: "Revelados.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", version: "1", modifiedTime: "2026-10-09" };
  const files = createPublicationFiles({ db, bucket, resolveFile: async () => ({ ...source }), openDrive: async () => Readable.from(`pptx-${source.version}`) });
  let corrupt = true; const attemptedPaths = [];
  const processing = createDocumentProcessing({ db, bucket, getProfile, prepareResource: files.prepareResource, timestamp, async convert(data) {
    assert.equal(data.processorVersion, PPTX_PROCESSOR_VERSION);
    const states = [];
    for (let index = 0; index < 3; index++) {
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=", "base64");
      const bytes = Buffer.concat([png, Buffer.from(`${source.version}-${index}`)]);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const path = rasterTargetPath(data.revision, index); attemptedPaths.push(path);
      const file = bucket.file(path);
      await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "image/png", metadata: { sha256, processingRevision: data.revision, deliveredName: `state-${index}.png` } } });
      const [metadata] = await file.getMetadata(); const download = descriptor(path, metadata);
      if (corrupt && index === 1) download.checksums.sha256 = "0".repeat(64);
      states.push({ download, width: 1, height: 1 });
    }
    const pages = [{ pageObjectId: "pptx-0", index: 0, ...states[0], builds: states.slice(1).map((state, index) => ({ order: index + 1, ...state })), warnings: [] }];
    return { processorVersion: PPTX_PROCESSOR_VERSION, revision: data.revision, pageCount: 1, pages, download: pages[0].download };
  } });
  const units = createUnitHandlers({ db, getProfile, resolveFile: async () => ({ ...source }), prepareResource: processing.prepareDelivery, timestamp });
  const request = expectedRevision => ({ auth: { uid: "admin" }, data: { unitId, resourceId, expectedRevision } });
  try {
    await db.doc("activeClassroomFolders/level-builds").set({ kind: "level", active: true });
    await db.doc(`activeClassroomFolders/${unitId}`).set({ kind: "unit", active: true });
    await mainRef.set({ folderId: unitId, source: "drive", kind: "presentation", name: source.name, mimeType: source.mimeType, driveFileId: source.id, driveVersion: "1", driveModifiedTime: source.modifiedTime });
    await units.save({ ...request(0), data: { ...request(0).data, draft: { name: "Interactive", levelId: "level-builds", status: "active", mainPresentationId: resourceId, generalResourceIds: [], slides: [{ slideId: "slide", index: 0, resourceIds: [], metadata: { pageNumber: 1 } }] } } });
    await assert.rejects(processing.process(request(1)), { code: "data-loss" });
    assert.equal((await unitRef.get()).data().publishedVersion, 0);
    assert.equal((await unitRef.get()).data().draftRevision, 1);
    for (const path of attemptedPaths) assert.equal((await bucket.file(path).exists())[0], false);
    corrupt = false;
    const ready = await processing.process(request(1)); assert.equal(ready.draft.slides[0].buildCount, 2);
    const buildDownload = ready.processing.pages[0].builds[1].download;
    const [buildBytes] = await bucket.file(buildDownload.path).download();
    await bucket.file(buildDownload.path).delete();
    await assert.rejects(units.publish(request(2)));
    assert.equal((await unitRef.get()).data().publishedVersion, 0);
    await bucket.file(buildDownload.path).save(buildBytes, { resumable: false, metadata: { contentType: "image/png", metadata: { sha256: buildDownload.checksums.sha256, processingRevision: ready.processing.revision } } });
    // Recreated object has a different generation: force a new immutable attempt.
    await mainRef.update({ "processing.state": "failed" });
    await processing.process(request(2));
    assert.equal((await units.publish(request(3))).version, 1);
    const frozen = (await unitRef.collection("publications").doc("1").get()).data().manifest;
    assert.equal(frozen.resources.length, 3); assert.equal(frozen.slides[0].builds.length, 2);
    for (const step of frozen.slides[0].builds) assert.ok(frozen.resources.find(resource => resource.resourceId === step.resourceId)?.download.checksums.sha256);
    const assetPath = "active-classroom/resources/reveal-image/answer.png";
    await bucket.file(assetPath).save(buildBytes, { contentType: "image/png" });
    await db.doc("activeClassroomResources/reveal-image").set({ folderId: unitId, source: "storage", kind: "image", name: "answer.png", mimeType: "image/png", storagePath: assetPath });
    const draft = structuredClone((await unitRef.get()).data().draft);
    Object.assign(draft.slides[0], { interactionMode: "builds", buildCount: 1, interaction: { mode: "builds", source: "manual", buildCount: 1 }, builds: [{ order: 1, layers: [{ type: "image", resourceId: "reveal-image", x: 10, y: 10, width: 20, height: 20 }] }] });
    await units.save({ ...request(3), data: { ...request(3).data, draft } });
    assert.equal((await units.publish(request(4))).version, 2);
    const manual = (await unitRef.collection("publications").doc("2").get()).data().manifest;
    assert.ok(manual.resources.find(resource => resource.resourceId === "reveal-image").download.checksums.sha256);
    assert.deepEqual((await unitRef.collection("publications").doc("1").get()).data().manifest, frozen);
    source.version = "2";
    await units.refreshDrive(request(4)); await processing.process(request(5));
    assert.deepEqual((await unitRef.collection("publications").doc("1").get()).data().manifest, frozen);
    const published = frozen.resources[1].download;
    assert.equal(createHash("sha256").update((await bucket.file(published.path, { generation: published.generation }).download())[0]).digest("hex"), published.checksums.sha256);
  } finally { await app.delete(); }
});
