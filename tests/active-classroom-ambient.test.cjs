const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAmbientHandlers, emptyCatalog, trackFromDownload } = require("../drive/activeClassroomAmbient");
const { contentHash } = require("../drive/activeClassroomUnit");
const frozen = hash => ({ name: "Música.mp3", mimeType: "audio/mpeg", sizeBytes: 12, checksums: { sha256: hash.repeat(64) }, path: `active-classroom/publications/files/${hash.repeat(64)}`, generation: "12" });
const request = data => ({ auth: { uid: "admin" }, data });
function setup(profile = { active: true, role: "admin" }) {
  const documents = new Map(); let tail = Promise.resolve();
  const ref = path => ({ path, id: path.split("/").at(-1), collection: name => collection(`${path}/${name}`), get: async () => ({ exists: documents.has(path), id: path.split("/").at(-1), ref: ref(path), data: () => structuredClone(documents.get(path)) }), create: async value => { assert.equal(documents.has(path), false); documents.set(path, structuredClone(value)); }, update: async value => documents.set(path, { ...documents.get(path), ...value }) });
  const collection = path => ({ doc: id => ref(`${path}/${id}`), get: async () => ({ docs: await Promise.all([...documents.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")).map(key => ref(key).get())) }) });
  const db = { collection, runTransaction(operation) { const result = tail.then(() => operation({ get: target => target.get(), create: (target, value) => { assert.equal(documents.has(target.path), false); documents.set(target.path, structuredClone(value)); }, set: (target, value) => documents.set(target.path, structuredClone(value)) })); tail = result.catch(() => {}); return result; } };
  const signatures = []; const bucket = { file(path, options) { return { getSignedUrl: async config => { signatures.push({ path, options, config }); return ["https://storage.googleapis.com/private/preview"]; } }; } };
  const handlers = createAmbientHandlers({ db, bucket, getProfile: async () => profile, authorize: async () => { if (!profile.active) throw Object.assign(new Error("denied"), { code: "permission-denied" }); }, resolveFile: async (_profile, id) => ({ id, name: "Música.mp3", mimeType: "audio/mpeg", version: "1", modifiedTime: "2026-10-13" }), prepareResource: async (_profile, resource) => frozen(resource.driveFileId === "second" ? "b" : "a"), verifyDownload: async download => download });
  return { documents, handlers, signatures };
}
test("catálogo global deduplica SHA, versiona y conserva snapshots al renombrar/ordenar/eliminar", async () => {
  const { documents, handlers } = setup(); assert.equal((await handlers.list(request({}))).catalog.ambientCatalogVersion, 0);
  const first = (await handlers.imported(request({ driveFileId: "first" }))).catalog; assert.equal(first.ambientCatalogVersion, 1);
  await Promise.all(Array.from({ length: 20 }, () => handlers.imported(request({ driveFileId: "first" }))));
  assert.equal((await handlers.list(request({}))).catalog.tracks.length, 1);
  assert.equal((await handlers.list(request({}))).catalog.ambientCatalogVersion, 1);
  const second = (await handlers.imported(request({ driveFileId: "second" }))).catalog;
  const renamed = (await handlers.edit(request({ action: "rename", id: "a".repeat(64), title: "Writing" }))).catalog;
  assert.equal(renamed.tracks[0].title, "Writing");
  const reordered = (await handlers.edit(request({ action: "order", ids: second.tracks.map(track => track.id).reverse() }))).catalog;
  assert.deepEqual(reordered.tracks.map(track => track.order), [0, 1]);
  await handlers.edit(request({ action: "remove", id: "a".repeat(64) }));
  assert.deepEqual(documents.get("activeClassroomAmbientMusic/catalog/versions/1"), first);
  assert.equal(first.integrity.contentHash, contentHash({ schemaVersion: 1, tracks: first.tracks, playlists: [] }));
});
test("migración reutiliza publicaciones y borradores, sin escribir Units ni versiones históricas", async () => {
  const { documents, handlers } = setup();
  for (let index = 0; index < 20; index++) {
    documents.set(`activeClassroomUnits/unit-${index}`, { draft: { backgroundMusic: [{ resourceId: "old", title: "Original" }] } });
    documents.set(`activeClassroomUnits/unit-${index}/publications/1`, { manifest: { backgroundMusic: [{ resourceId: "old", title: "Original" }], resources: [{ resourceId: "old", download: frozen("a") }] } });
  }
  documents.set("activeClassroomResources/old", { name: "Música.mp3", source: "drive", driveFileId: "first" });
  const before = [...documents].map(([path, data]) => [path, JSON.stringify(data)]);
  const result = await handlers.migrate(request({})); assert.equal(result.catalog.migrated, true); assert.equal(result.catalog.tracks.length, 1); assert.deepEqual(result.failures, []);
  for (const [path, value] of before) assert.equal(JSON.stringify(documents.get(path)), value);
  assert.equal((await handlers.migrate(request({}))).migrated, 0);
});
test("migración parcial conserva referencias y permite reintentar; valida frozen bytes", async () => {
  const { documents, handlers } = setup(); documents.set("activeClassroomUnits/unit", { draft: { backgroundMusic: [{ resourceId: "missing", title: "Pendiente" }] } });
  const result = await handlers.migrate(request({})); assert.equal(result.catalog.migrated, false); assert.equal(result.failures.length, 1);
  documents.set("activeClassroomResources/missing", { source: "drive", driveFileId: "first" });
  assert.equal((await handlers.migrate(request({}))).catalog.migrated, true);
  assert.throws(() => trackFromDownload({ ...frozen("a"), path: "public/audio" }, "Audio"), { code: "data-loss" });
  assert.throws(() => trackFromDownload({ ...frozen("a"), mimeType: "video/mp4" }, "Video"));
  assert.deepEqual(emptyCatalog().tracks, []);
});
test("permisos reales: importar, subir y ordenar independientes; sin acceso denegado", async () => {
  const profile = { active: true, role: "collaborator", activeClassroomPermissions: { access: true, uploadMaterial: true } };
  const { handlers } = setup(profile);
  for (const action of [handlers.imported, handlers.edit, handlers.migrate]) await assert.rejects(action(request({})), { code: "permission-denied" });
  const denied = setup({ active: false, role: "admin" }).handlers;
  await assert.rejects(denied.list(request({})), { code: "permission-denied" });
  await assert.rejects(handlers.upload({ data: {} }), { code: "unauthenticated" });
});
test("preview autorizado conserva generación exacta, URL v4 breve y rechaza otra pista", async () => {
  const { handlers,signatures } = setup(); const result = await handlers.imported(request({driveFileId:"first"}));
  await handlers.preview(request({version:result.catalog.ambientCatalogVersion,trackId:"a".repeat(64)}));
  assert.equal(signatures[0].config.version,"v4"); assert.deepEqual(signatures[0].config.queryParams,{generation:"12"}); assert.equal(signatures[0].options.generation,"12");
  assert.ok(signatures[0].config.expires > Date.now() && signatures[0].config.expires <= Date.now()+300000);
  await assert.rejects(handlers.preview(request({version:1,trackId:"b".repeat(64)})),{code:"not-found"}); assert.equal(signatures.length,1);
});
