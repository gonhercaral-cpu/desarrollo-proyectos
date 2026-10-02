const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { Readable, Writable } = require("node:stream");
const { createHash } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createUnitHandlers, contentHash } = require("../drive/activeClassroomUnit");
const { createPublicationFiles } = require("../drive/activeClassroomFiles");
const { createDesktopHandlers } = require("../drive/activeClassroomDesktop");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Requiere emuladores Firestore y Storage.");
const app = admin.initializeApp({ projectId: "security-rules-audit", storageBucket: "security-rules-audit.appspot.com" }, "unit-mvp-tests");
const db = app.firestore();
const bucket = app.storage().bucket();
const unitId = "mvp-unit";
const profile = { role: "admin", active: true };
let source = { id: "original", name: "Clase.pdf", mimeType: "application/pdf", version: "1", modifiedTime: "2026-09-28T00:00:00Z" };
let bytes = Buffer.from("contenido original PDF simulado");
let opens = 0;
let denySource = false;
let changeDuringRead = false;
const resolveFile = async () => { if (denySource) { const error = new Error("Acceso privado revocado"); error.code = "permission-denied"; throw error; } return { ...source }; };
const files = createPublicationFiles({ db, bucket, resolveFile, openDrive: async () => {
  opens++;
  if (changeDuringRead) source = { ...source, version: "999" };
  return Readable.from(bytes);
} });
const getProfile = async (uid) => uid === "admin" ? profile : { role: "requester", active: uid !== "inactive" };
const handlers = createUnitHandlers({ db, getProfile, resolveFile, prepareResource: files.prepareResource, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
const desktop = createDesktopHandlers({ db, getProfile, resolveFile, bucket, getRequestProfile: async (request) => {
  if (request.headers.authorization !== "Bearer test-token") { const error = new Error("Debes iniciar sesión."); error.code = "unauthenticated"; throw error; }
  return { active: true };
} });
const request = (data, uid = "admin") => ({ auth: { uid }, data: { unitId, ...data } });
const draft = { name: "Unit 1", description: "Prueba", levelId: "mvp-level", status: "active", metadata: { tags: [] }, mainPresentationId: "mvp-main", generalResourceIds: ["mvp-audio"], slides: [{ slideId: "slide-1", title: "Inicio", resourceIds: ["mvp-audio"], metadata: { pageNumber: 1 } }] };
let versionOne;
before(async () => {
  await db.doc(`activeClassroomUnits/${unitId}`).delete();
  await db.recursiveDelete(db.doc(`activeClassroomUnits/${unitId}`));
  await bucket.deleteFiles({ prefix: "active-classroom/publications/" });
  await db.recursiveDelete(db.collection("activeClassroomFileSnapshots"));
  await db.doc("activeClassroomFolders/mvp-level").set({ kind: "level", active: true });
  await db.doc(`activeClassroomFolders/${unitId}`).set({ kind: "unit", active: true, parentId: "mvp-level" });
  await db.doc("activeClassroomResources/mvp-main").set({ folderId: unitId, source: "drive", name: source.name, mimeType: source.mimeType, kind: "document", driveFileId: source.id, driveVersion: source.version, driveModifiedTime: source.modifiedTime, version: 1 });
  await bucket.file("active-classroom/resources/mvp-audio/audio.mp3").save("audio de ejemplo", { contentType: "audio/mpeg" });
  await db.doc("activeClassroomResources/mvp-audio").set({ folderId: unitId, name: "audio.mp3", mimeType: "audio/mpeg", kind: "audio", storagePath: "active-classroom/resources/mvp-audio/audio.mp3" });
});
after(async () => app.delete());

test("guardar requiere administrador activo y revisión vigente", async () => {
  await assert.rejects(handlers.save({ data: { unitId, draft } }), { code: "unauthenticated" });
  await assert.rejects(handlers.save(request({ draft, expectedRevision: 0 }, "reader")), { code: "permission-denied" });
  await assert.rejects(handlers.save(request({ draft, expectedRevision: 0 }, "inactive")), { code: "permission-denied" });
  assert.equal((await handlers.save(request({ draft, expectedRevision: 0 }))).draftRevision, 1);
  await assert.rejects(handlers.save(request({ draft, expectedRevision: 0 })), { code: "aborted" });
  await assert.rejects(handlers.save(request({ draft: { ...draft, generalResourceIds: ["foreign"] }, expectedRevision: 1 })), { code: "failed-precondition" });
});
test("publicaciones concurrentes congelan bytes una sola versión y retienen originales", async () => {
  const published = await Promise.all([handlers.publish(request({ expectedRevision: 1 })), handlers.publish(request({ expectedRevision: 1 }))]);
  assert.deepEqual(published.map((item) => item.version), [1, 1]);
  assert.equal(published.filter((item) => !item.unchanged).length, 1);
  versionOne = (await desktop.get(request({ version: 1 }, "reader"))).manifest;
  assert.equal(versionOne.schemaVersion, 2);
  assert.equal(JSON.parse(JSON.stringify(versionOne)).slides[0].index, 0);
  const { version, publishedAt, integrity, ...content } = versionOne;
  assert.equal(version, 1); assert.ok(publishedAt);
  assert.equal(integrity.contentHash, contentHash(content));
  const downloaded = await desktop.resolveDownload({ active: true }, { unitId, version: 1, resourceId: "mvp-main" });
  const [actual] = await bucket.file(downloaded.path, { generation: downloaded.generation }).download();
  assert.deepEqual(actual, bytes);
  assert.equal(downloaded.checksums.sha256, createHash("sha256").update(actual).digest("hex"));
  assert.equal((await db.doc("activeClassroomResources/mvp-main").get()).data().retainedByPublication, true);
  const previousOpens = opens;
  assert.equal((await handlers.publish(request({ expectedRevision: 1 }))).unchanged, true);
  assert.equal(opens, previousOpens, "snapshot se reutiliza sin descargar Drive otra vez");
});
test("actualizar Drive solo cambia borrador; versión anterior conserva manifest y bytes", async () => {
  source = { ...source, version: "2", modifiedTime: "2026-09-28T01:00:00Z" };
  bytes = Buffer.from("nuevo PDF simulado");
  assert.equal((await handlers.checkDrive(request({ resourceIds: ["mvp-main"] }))).results[0].status, "changed");
  await assert.rejects(handlers.publish(request({ expectedRevision: 1 })), { code: "failed-precondition" });
  assert.equal((await handlers.refreshDrive(request({ resourceId: "mvp-main", expectedRevision: 1 }))).draftRevision, 2);
  assert.equal((await handlers.publish(request({ expectedRevision: 2 }))).version, 2);
  assert.deepEqual((await desktop.get(request({ version: 1 }, "reader"))).manifest, versionOne);
  const old = await desktop.resolveDownload({ active: true }, { unitId, version: 1, resourceId: "mvp-main" });
  const [actual] = await bucket.file(old.path, { generation: old.generation }).download();
  assert.equal(actual.toString(), "contenido original PDF simulado");
  assert.equal((await desktop.get(request({}, "reader"))).manifest.version, 2);
});
test("Desktop no expone borradores, exige perfil activo, pertenencia a publicación y ACL Drive", async () => {
  await assert.rejects(desktop.get({ data: { unitId } }), { code: "unauthenticated" });
  await assert.rejects(desktop.list(request({}, "inactive")), { code: "permission-denied" });
  await assert.rejects(desktop.get(request({ version: 99 }, "reader")), { code: "not-found" });
  await assert.rejects(desktop.resolveDownload({ active: true }, { unitId, version: 1, resourceId: "foreign" }), { code: "not-found" });
  await assert.rejects(desktop.resolveDownload({ active: true }, { unitId, version: 1, resourceId: "../secrets" }), { code: "invalid-argument" });
  denySource = true;
  await assert.rejects(desktop.resolveDownload({ active: true }, { unitId, version: 1, resourceId: "mvp-main" }), { code: "permission-denied" });
  denySource = false;
  await db.doc("activeClassroomUnits/aaa-draft-only").set({ draft: { name: "Secreto" } });
  const first = await desktop.list(request({ limit: 1 }, "reader"));
  assert.deepEqual(first.publications, []);
  assert.equal(first.nextCursor, "aaa-draft-only");
  const next = await desktop.list(request({ cursor: first.nextCursor }, "reader"));
  assert.equal(next.publications.find((item) => item.unitId === unitId).version, 2);
  assert.equal(JSON.stringify(next).includes("Secreto"), false);
  await db.doc("activeClassroomUnits/aaa-draft-only").delete();
});
test("si Drive cambia durante descarga no publica ni conserva snapshot incompleto", async () => {
  const [beforeFiles] = await bucket.getFiles({ prefix: "active-classroom/publications/files/" });
  source = { ...source, version: "3" };
  await handlers.refreshDrive(request({ resourceId: "mvp-main", expectedRevision: 2 }));
  changeDuringRead = true;
  await assert.rejects(handlers.publish(request({ expectedRevision: 3 })), { code: "failed-precondition" });
  changeDuringRead = false;
  assert.equal((await desktop.get(request({}, "reader"))).manifest.version, 2);
  const [afterFiles] = await bucket.getFiles({ prefix: "active-classroom/publications/files/" });
  assert.equal(afterFiles.length, beforeFiles.length);
});

test("HTTP entrega bytes exactos y checksum, rechaza sesión ausente y métodos de escritura", async () => {
  function response() {
    const chunks = [];
    const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    stream.headers = {};
    stream.statusCode = 200;
    stream.set = (key, value) => { Object.assign(stream.headers, typeof key === "object" ? key : { [key]: value }); return stream; };
    stream.status = (value) => { stream.statusCode = value; return stream; };
    stream.removeHeader = (key) => { delete stream.headers[key]; };
    stream.json = (value) => { stream.body = value; stream.end(); return stream; };
    stream.bytes = () => Buffer.concat(chunks);
    return stream;
  }
  const query = { unitId, version: "1", resourceId: "mvp-main", path: "secrets", fileId: "another-original" };
  const result = response();
  await desktop.file({ method: "GET", headers: { authorization: "Bearer test-token" }, query }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.bytes().toString(), "contenido original PDF simulado");
  assert.equal(result.headers["X-Content-SHA256"], createHash("sha256").update(result.bytes()).digest("hex"));
  assert.equal(Number(result.headers["Content-Length"]), result.bytes().length);
  const unauthenticated = response();
  await desktop.file({ method: "GET", headers: {}, query }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
  const wrongMethod = response();
  await desktop.file({ method: "POST", headers: {}, query }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test("publicación antigua exige nueva versión; publicar nunca modifica un borrador concurrente", async () => {
  await db.doc(`activeClassroomUnits/${unitId}/publications/99`).set({ manifest: { ...versionOne, schemaVersion: 1, version: 99 } });
  await assert.rejects(desktop.resolveDownload({ active: true }, { unitId, version: 99, resourceId: "mvp-main" }), { code: "failed-precondition" });
  await db.doc(`activeClassroomUnits/${unitId}/publications/99`).delete();
  let edited = false;
  const concurrent = createUnitHandlers({ db, getProfile, resolveFile, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), prepareResource: async () => {
    if (!edited) { edited = true; await handlers.save(request({ draft: { ...draft, name: "Editado durante publicación" }, expectedRevision: 3 })); }
    return versionOne.resources[0].download;
  } });
  await assert.rejects(concurrent.publish(request({ expectedRevision: 3 })), { code: "aborted" });
  assert.equal((await db.doc(`activeClassroomUnits/${unitId}`).get()).data().draft.name, "Editado durante publicación");
  assert.equal((await desktop.get(request({}, "reader"))).manifest.version, 2);
});

test("Google Slides reutiliza exportación PPTX existente y calcula hash de bytes entregados", async () => {
  const native = { id: "google-slides", name: "Clase nativa", mimeType: "application/vnd.google-apps.presentation", version: "1" };
  const nativeFiles = createPublicationFiles({ db, bucket, resolveFile: async () => native, openDrive: async (_file, delivery) => {
    assert.equal(delivery.exported, true);
    assert.equal(delivery.deliveredName, "Clase nativa.pptx");
    return Readable.from("exportación PPTX simulada");
  } });
  const download = await nativeFiles.prepareResource(profile, { id: "native", source: "drive", name: native.name, mimeType: native.mimeType, driveFileId: native.id, driveVersion: "1" });
  assert.equal(download.mimeType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const [actual] = await bucket.file(download.path, { generation: download.generation }).download();
  assert.equal(download.checksums.sha256, createHash("sha256").update(actual).digest("hex"));
});

test("publicación rechaza bytes que no corresponden al MD5 del original Drive", async () => {
  const original = { id: "checksum-original", name: "audio.mp3", mimeType: "audio/mpeg", version: "1", md5Checksum: createHash("md5").update("original").digest("hex") };
  const checksumFiles = createPublicationFiles({ db, bucket, resolveFile: async () => original, openDrive: async () => Readable.from("truncado") });
  await assert.rejects(checksumFiles.prepareResource(profile, { id: "checksum", source: "drive", name: original.name, mimeType: original.mimeType, driveFileId: original.id, driveVersion: "1", driveMd5Checksum: original.md5Checksum }), { code: "data-loss" });
});
