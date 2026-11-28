const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID, createHash } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createStudioHandlers, studioRef } = require("../drive/activeClassroomStudio");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { createPublicationJobs } = require("../drive/activeClassroomPublicationJobs");
const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
const { PPTX_PROCESSOR_VERSION, processingFingerprint, rasterTargetPath, pdfSlides } = require("../drive/activeClassroomProcessingModel");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Requiere emuladores Firestore y Storage.");

test("Studio guarda correcciones con CAS, publica solo la revisión aprobada y restaura una versión", async t => {
  const projectId = "security-rules-audit";
  const app = admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, "studio-emulator");
  t.after(() => app.delete());
  const db = app.firestore();
  const bucket = app.storage().bucket();
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const getProfile = async uid => uid === "admin" ? { role: "admin", active: true } : {
    role: "collaborator", active: true, activeClassroomPermissions: { access: true, orderMaterial: uid === "editor", processMaterial: uid === "editor" },
  };
  const id = randomUUID();
  const unitId = `unit-${id}`, resourceId = `resource-${id}`, levelId = `level-${id}`;
  const query = (data, uid = "admin") => ({ auth: { uid }, data: { unitId, resourceId, ...data } });
  const resourceRef = db.collection("activeClassroomResources").doc(resourceId);
  const unitRef = db.collection("activeClassroomUnits").doc(unitId);
  const resource = { id: resourceId, storagePath: `active-classroom/resources/${resourceId}/fixture.pptx`, folderId: unitId, kind: "presentation", name: "Presentación de prueba.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  const original = { path: "active-classroom/publications/files/" + "0".repeat(64), generation: "100", mimeType: resource.mimeType, sizeBytes: 100, name: resource.name, checksums: { sha256: "0".repeat(64) } };
  let renderFails = false;
  async function render(revision, shade) {
    // Stable PNG header, enough to exercise descriptor/path/generation/hash verification.
    // The Python converter regression exercises actual decoding and rendering.
    const bytes = Buffer.from("89504e470d0a1a0a0000000d494844520000064000000384", "hex");
    const png = Buffer.concat([bytes, Buffer.from([shade])]);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const path = rasterTargetPath(revision, 0);
    const file = bucket.file(path);
    await file.save(png, { metadata: { contentType: "image/png", metadata: { sha256, processingRevision: revision } } });
    const [metadata] = await file.getMetadata();
    const download = { provider: "storage", endpoint: "activeClassroomPublicationFile", path, generation: String(metadata.generation), mimeType: "image/png", name: "prueba.png", sizeBytes: png.length, checksums: { sha256 } };
    return { processorVersion: PPTX_PROCESSOR_VERSION, revision, state: "ready", completedAt: "2026-11-27T00:00:00.000Z", sourceType: "pptx", original, sourceFingerprint: processingFingerprint(resource), pageCount: 1, download, pages: [{ index: 0, pageObjectId: "pptx-0", width: 1600, height: 900, warnings: [], builds: [], download }] };
  }
  const initial = await render(randomUUID(), 0);
  const prepareResource = async () => original;
  const processing = createDocumentProcessing({
    db, bucket, getProfile, prepareResource, timestamp,
    convert: async payload => {
      if (renderFails) throw new Error("Conversión interrumpida");
      assert.equal(payload.studioEdits[0].text, "Respuesta corregida");
      return render(payload.revision, 1);
    },
  });
  async function verifyDownload(download) {
    const [stored] = await bucket.file(download.path, { generation: download.generation }).download();
    assert.equal(createHash("sha256").update(stored).digest("hex"), download.checksums.sha256);
    return download;
  }
  const units = createUnitHandlers({ db, getProfile, timestamp, prepareResource: processing.prepareDelivery, verifyDownload });
  const studio = createStudioHandlers({
    db, getProfile, prepareResource, timestamp,
    inspect: async (_original, index) => ({ width: 9144000, height: 5143500, elements: [{ id: "1", index, editable: true }] }),
  });
  await db.collection("activeClassroomFolders").doc(levelId).set({ kind: "level", active: true });
  await db.collection("activeClassroomFolders").doc(unitId).set({ kind: "unit", active: true, parentId: levelId });
  await resourceRef.set({ ...resource, processing: initial });
  await units.save(query({ expectedRevision: 0, draft: { name: "Unidad aislada", levelId, status: "active", mainPresentationId: resourceId, generalResourceIds: [], slides: pdfSlides({ ...resource, processing: initial }) } }));
  const first = await units.publish(query({ expectedRevision: 1 }));
  assert.equal(first.version, 1);

  await assert.rejects(studio.inspect(query({ slideIndex: 0 }, "reader")), { code: "permission-denied" });
  await assert.rejects(studio.get(query({ resourceId: "another-unit" })), { code: "not-found" });
  const shape = await studio.inspect(query({ slideIndex: 0 }, "editor"));
  assert.equal(shape.elements[0].id, "1");
  const edits = [{ slideIndex: 0, id: "1", width: 2500000, text: "Respuesta corregida" }];
  const results = await Promise.allSettled([studio.save(query({ expectedRevision: 0, edits }, "editor")), studio.save(query({ expectedRevision: 0, edits: [{ ...edits[0], width: 3000000 }] }, "editor"))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "aborted");
  const draft = await studio.get(query({}));
  assert.equal(draft.revision, 1);
  await assert.rejects(studio.review(query({ status: "approved", notes: "", expectedRevision: 1, expectedReviewRevision: 1 })), { code: "failed-precondition" });
  await assert.rejects(studio.review(query({ status: "approved", notes: "", expectedRevision: 1, expectedReviewRevision: 1 }, "editor")), { code: "permission-denied" });

  renderFails = true;
  await assert.rejects(processing.process(query({ expectedRevision: 1, studioRevision: 1 }, "editor")));
  assert.equal((await resourceRef.get()).data().processing.revision, initial.revision);
  assert.equal((await unitRef.get()).data().publishedVersion, 1);
  renderFails = false;
  const result = await processing.process(query({ expectedRevision: 1, studioRevision: 1 }, "editor"));
  assert.equal(result.draftRevision, 2);
  assert.equal(result.processing.studioRevision, 1);
  assert.equal((await studioRef(db, resourceId).get()).data().baseline[0].download.path, initial.download.path);
  assert.equal((await unitRef.get()).data().publishedVersion, 1);
  assert.equal((await units.validatePublication(query({ expectedRevision: 2 }))).ready, false);
  await assert.rejects(units.publish(query({ expectedRevision: 2 })), { code: "failed-precondition" });
  const toReview = await studio.get(query({}));
  await studio.review(query({ status: "approved", notes: "Validada", expectedRevision: 1, expectedReviewRevision: toReview.reviewRevision }));
  const second = await units.publish(query({ expectedRevision: 2 }));
  assert.equal(second.version, 2);
  const restored = await units.restore(query({ sourceVersion: 1, expectedVersion: 2, expectedRevision: 2 }));
  assert.equal(restored.version, 3);
  const history = version => unitRef.collection("publications").doc(String(version)).get();
  assert.deepEqual((await history(3)).data().manifest.resources, (await history(1)).data().manifest.resources);
  assert.notEqual((await history(2)).data().contentHash, (await history(3)).data().contentHash);

  const queued = [];
  const currentTime = Date.now();
  const jobs = createPublicationJobs({
    db, units, getProfile, prepareResource: processing.prepareDelivery, verifyDownload, clock: () => currentTime,
    enqueue: async (data, at) => queued.push({ data, at }),
  });
  const when = new Date(currentTime + 120000);
  const scheduled = await jobs.start(query({ expectedRevision: 3, publishAt: when.toISOString() }));
  assert.equal(queued[0].at.valueOf(), when.valueOf());
  await assert.rejects(jobs.work(queued[0]), { code: "unavailable" });
  await assert.rejects(jobs.cancel(query({ jobId: scheduled.jobId }, "editor")), { code: "permission-denied" });
  await jobs.cancel(query({ jobId: scheduled.jobId }));
  await jobs.work(queued[0]);
  assert.equal((await unitRef.get()).data().publishedVersion, 3);
});
