const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createPublicationFiles } = require("../drive/activeClassroomFiles");
const { createPublicationJobs } = require("../drive/activeClassroomPublicationJobs");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { maxFileBytes } = require("../drive/activeClassroomPublicationLimits.json");
const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
const { processingFingerprint, PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Requiere emuladores Firestore y Storage.");
const MiB = 1024 * 1024;
const block = Buffer.alloc(64 * 1024, 0x5a);
function streamBytes(size, failAfter = Infinity, onChunk = () => {}) {
  return Readable.from((async function* () {
    for (let offset = 0; offset < size; offset += block.length) {
      if (offset >= failAfter) throw new Error("Transferencia interrumpida");
      const chunk = block.subarray(0, Math.min(block.length, size - offset));
      onChunk(chunk); yield chunk;
    }
  })());
}
function expectedHash(size) {
  const hash = createHash("sha256");
  for (let offset = 0; offset < size; offset += block.length) hash.update(block.subarray(0, Math.min(block.length, size - offset)));
  return hash.digest("hex");
}
test("publicación 300 MiB: streaming, copia server-side, integridad, atomicidad y reintento", { timeout: 120000 }, async (t) => {
  const app = admin.initializeApp({ projectId: "security-rules-audit", storageBucket: "large-publication-tests.appspot.com" }, "large-publication-tests");
  const db = app.firestore(); const bucket = app.storage().bucket();
  const profile = { active: true, role: "admin" };
  const getProfile = async () => profile;
  let failure = false; let opens = 0; let largestChunk = 0;
  const baselineExternal = process.memoryUsage().external;
  let peakExternal = baselineExternal;
  const source = { id: "large-drive", name: "video.mp4", mimeType: "video/mp4", version: "1", size: String(300 * MiB) };
  const sources = { "large-drive": source, "small-drive": { id: "small-drive", name: "Clase.pdf", mimeType: "application/pdf", version: "1", size: "65536" } };
  const resolveFile = async (_profile, fileId) => ({ ...sources[fileId] });
  const files = createPublicationFiles({ db, bucket, resolveFile, openDrive: async (file) => {
    opens++;
    const input = streamBytes(Number(file.size), failure && file.id === "large-drive" ? 151 * MiB : Infinity, (chunk) => { largestChunk = Math.max(largestChunk, chunk.length); peakExternal = Math.max(peakExternal, process.memoryUsage().external); });
    return input;
  } });
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const units = createUnitHandlers({ db, getProfile, resolveFile, prepareResource: files.prepareResource, timestamp });
  const queue = [];
  const jobs = createPublicationJobs({ db, units, getProfile, prepareResource: (profile, resource, options) => files.prepareResource(profile, resource, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) }), verifyDownload: files.verifyDownload, enqueue: async (data) => { queue.push(data); } });
  const unitId = "large-unit"; const unitRef = db.doc(`activeClassroomUnits/${unitId}`);
  const request = { auth: { uid: "admin" }, data: { unitId, expectedRevision: 1 } };
  try {
    await db.doc("activeClassroomFolders/large-level").set({ kind: "level", active: true });
    await db.doc(`activeClassroomFolders/${unitId}`).set({ kind: "unit", active: true });
    for (const [resourceId, fileId] of [["large-main", "small-drive"], ["large-video", "large-drive"]]) {
      const file = sources[fileId];
      await db.doc(`activeClassroomResources/${resourceId}`).set({ folderId: unitId, source: "drive", name: file.name, mimeType: file.mimeType, kind: fileId === "small-drive" ? "document" : "video", driveFileId: fileId, driveVersion: "1", sizeBytes: Number(file.size) });
    }
    const draft = { name: "Unit grande", levelId: "large-level", status: "active", mainPresentationId: "large-main", generalResourceIds: ["large-video"], slides: [{ slideId: "s1", resourceIds: [] }] };
    await units.save({ ...request, data: { unitId, expectedRevision: 0, draft } });
    await t.test("archivo menor de 250 MiB disponible, sin activar versión parcial", async () => {
      failure = true;
      const result = await jobs.start(request);
      assert.equal(result.state, "pending");
      await jobs.work({ data: queue.shift() });
      const unit = (await unitRef.get()).data();
      assert.equal(unit.publicationJob.state, "publishing");
      assert.equal(unit.publicationJob.completedResources, 1);
      assert.equal(unit.publishedVersion, 0);
    });
    await t.test("fallo a mitad limpia objeto incompleto y conserva borrador", async () => {
      await jobs.work({ data: queue.shift() });
      const unit = (await unitRef.get()).data();
      assert.equal(unit.publicationJob.state, "failed");
      assert.equal(unit.publishedVersion, 0);
      assert.equal(unit.draft.name, draft.name);
      assert.equal((await unitRef.collection("publications").get()).size, 0);
      const [objects] = await bucket.getFiles({ prefix: "active-classroom/publications/files/" });
      assert.equal(objects.length, 1, "solo queda snapshot pequeño completo y reutilizable");
    });
    await t.test("reintento entrega 300 MiB, hash correcto, ready solo al terminar todos", async () => {
      failure = false;
      await jobs.start(request);
      await jobs.work({ data: queue.shift() });
      assert.equal(opens, 2, "snapshot pequeño se reutiliza sin volver a leer Drive");
      await jobs.work({ data: queue.shift() });
      assert.equal((await unitRef.get()).data().publishedVersion, 0);
      assert.equal((await unitRef.get()).data().publicationJob.completedResources, 2);
      await jobs.work({ data: queue.shift() });
      const unit = (await unitRef.get()).data();
      assert.equal(unit.publicationJob.state, "ready");
      assert.equal(unit.publishedVersion, 1);
      const manifest = (await unitRef.collection("publications").doc("1").get()).data().manifest;
      const download = manifest.resources.find((resource) => resource.resourceId === "large-video").download;
      assert.equal(download.sizeBytes, 300 * MiB);
      assert.equal(download.checksums.sha256, expectedHash(300 * MiB));
      let size = 0; const hash = createHash("sha256");
      for await (const chunk of bucket.file(download.path, { generation: download.generation }).createReadStream()) { size += chunk.length; hash.update(chunk); }
      assert.equal(size, 300 * MiB); assert.equal(hash.digest("hex"), download.checksums.sha256);
      assert.equal(largestChunk, 65536, "fuente genera bloques de 64 KiB; no Buffer de 300 MiB");
      t.diagnostic(`300 MiB verificados, SHA-256 ${download.checksums.sha256}`);
      t.diagnostic(`Crecimiento máximo de memoria externa: ${((peakExternal - baselineExternal) / MiB).toFixed(1)} MiB`);
      assert.ok(peakExternal - baselineExternal < 128 * MiB, "memoria de buffers del proceso no crece al tamaño del archivo de 300 MiB");
    });
    await t.test("Storage copia generación exacta server-side; nunca abre stream del original", async () => {
      const originalPath = "active-classroom/resources/copied/large.mp4";
      await bucket.file(originalPath).save(streamBytes(251 * MiB), { resumable: true, metadata: { contentType: "video/mp4", metadata: { firebaseStorageDownloadTokens: "must-not-copy" } } });
      let copies = 0; let originalReads = 0;
      const wrappedBucket = { file(path, options) {
        const file = bucket.file(path, options);
        if (path === originalPath) {
          const copy = file.copy.bind(file);
          file.copy = async (...args) => { copies++; assert.ok(file.generation); return copy(...args); };
          file.createReadStream = () => { originalReads++; throw new Error("No debe descargar el original"); };
        }
        return file;
      } };
      const copying = createPublicationFiles({ db, bucket: wrappedBucket });
      const download = await copying.prepareResource(profile, { id: "copied", name: "large.mp4", mimeType: "video/mp4", storagePath: originalPath });
      assert.equal(copies, 1); assert.equal(originalReads, 0);
      assert.equal(download.sizeBytes, 251 * MiB); assert.equal(download.checksums.sha256, expectedHash(251 * MiB));
      const [metadata] = await bucket.file(download.path).getMetadata();
      assert.equal(metadata.metadata.firebaseStorageDownloadTokens, undefined);
    });
    await t.test("derivado grande conserva bytes y generación exactos sin volver a convertir", async () => {
      const manifest = (await unitRef.collection("publications").doc("1").get()).data().manifest;
      const original = manifest.resources.find((resource) => resource.resourceId === "large-main").download;
      const source = manifest.resources.find((resource) => resource.resourceId === "large-video").download;
      const path = `active-classroom/publications/files/${"d".repeat(64)}`;
      await bucket.file(source.path, { generation: source.generation }).copy(bucket.file(path), { contentType: "application/pdf", metadata: { sha256: source.checksums.sha256, deliveredName: "Procesado.pdf", capturedAt: source.capturedAt } });
      const [metadata] = await bucket.file(path).getMetadata();
      const derivative = { ...source, path, generation: String(metadata.generation), mimeType: "application/pdf", name: "Procesado.pdf" };
      const resource = { id: "processed", source: "drive", name: "Clase.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", driveFileId: "processed-original", driveVersion: "1" };
      resource.processing = { state: "ready", processorVersion: PROCESSOR_VERSION, sourceFingerprint: processingFingerprint(resource), original, download: derivative, revision: "processed-revision", pageCount: 1 };
      const processing = createDocumentProcessing({ db, bucket, getProfile, timestamp, prepareResource: async () => original, convert: () => { throw new Error("No debe convertir al publicar"); } });
      assert.deepEqual(await processing.prepareDelivery(profile, resource), derivative);
      await files.verifyDownload(derivative);
      let size = 0; const hash = createHash("sha256");
      for await (const chunk of bucket.file(path, { generation: derivative.generation }).createReadStream()) { size += chunk.length; hash.update(chunk); }
      assert.equal(size, 300 * MiB); assert.equal(hash.digest("hex"), source.checksums.sha256);
    });
    await t.test("tamaño declarado, MD5, límite operativo y disponibilidad bloquean integridad falsa", async () => {
      const resource = { id: "bad-size", source: "drive", name: "bad.mp4", mimeType: "video/mp4", driveFileId: "bad", driveVersion: "1" };
      let declared = "100";
      const bad = createPublicationFiles({ db, bucket, resolveFile: async () => ({ id: "bad", name: resource.name, mimeType: resource.mimeType, version: "1", size: declared }), openDrive: async () => streamBytes(99) });
      await assert.rejects(bad.prepareResource(profile, resource), { code: "data-loss" });
      declared = String(maxFileBytes + 1);
      await assert.rejects(bad.prepareResource(profile, resource), { code: "resource-exhausted" });
      const checksum = createPublicationFiles({ db, bucket, resolveFile: async () => ({ id: "bad", name: resource.name, mimeType: resource.mimeType, version: "1", size: "99", md5Checksum: "abcd" }), openDrive: async () => streamBytes(99) });
      await assert.rejects(checksum.prepareResource(profile, { ...resource, driveMd5Checksum: "abcd" }), { code: "data-loss" });
    });
    await t.test("tasks duplicados no publican otra versión; edición concurrente aborta", async () => {
      const started = await jobs.start(request);
      const duplicate = { ...queue[0] };
      await jobs.work({ data: queue.shift() });
      await jobs.work({ data: duplicate });
      while (queue.length) await jobs.work({ data: queue.shift() });
      assert.equal((await unitRef.get()).data().publishedVersion, 1);
      assert.equal((await db.doc(`activeClassroomPublicationJobs/${started.jobId}`).get()).data().unchanged, true);
      await jobs.start(request);
      await units.save({ ...request, data: { unitId, expectedRevision: 1, draft: { ...draft, name: "Editado" } } });
      while (queue.length) await jobs.work({ data: queue.shift() });
      assert.equal((await unitRef.get()).data().publicationJob.state, "failed");
      assert.equal((await unitRef.get()).data().publishedVersion, 1);
    });
    await t.test("enqueue inicial fallido deja estado reintentable; entrega perdida retoma paso durable", async () => {
      const request2 = { ...request, data: { unitId, expectedRevision: 2 } };
      const blockedQueue = createPublicationJobs({ db, units, getProfile, prepareResource: files.prepareResource, verifyDownload: files.verifyDownload, enqueue: async () => { throw new Error("Cola no disponible"); } });
      await assert.rejects(blockedQueue.start(request2), { code: "unavailable" });
      assert.equal((await unitRef.get()).data().publicationJob.state, "failed");
      await jobs.start(request2);
      const first = queue.shift();
      await assert.rejects(blockedQueue.work({ data: first }), /Cola no disponible/);
      assert.equal((await unitRef.get()).data().publicationJob.completedResources, 1);
      await jobs.work({ data: first });
      while (queue.length) await jobs.work({ data: queue.shift() });
      assert.equal((await unitRef.get()).data().publicationJob.state, "ready");
      assert.equal((await unitRef.get()).data().publishedVersion, 2);
    });
  } finally { await db.terminate(); await app.delete(); }
});
