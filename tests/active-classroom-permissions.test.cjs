const assert = require("node:assert/strict");
const { test } = require("node:test");
const { canClassroom, requireClassroom, createPermissionHandlers, permissions } = require("../drive/activeClassroomPermissions");
const { createLevelHandler } = require("../drive/activeClassroomLevels");
const { createImportDriveReference } = require("../drive/activeClassroom");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { createBuildPreview } = require("../drive/activeClassroomBuildPreview");
const grant = actions => ({ uid: "collaborator", active: true, role: "collaborator", activeClassroomPermissions: Object.fromEntries(["access", ...actions].map(key => [key, true])) });
test("admin completo; colaborador sin acceso y perfiles inactivos denegados", () => {
  for (const key of Object.keys(permissions)) assert.equal(canClassroom({ role: "admin", active: true }, key), true);
  for (const profile of [{ role: "admin", active: false }, { role: "collaborator", active: true }, { ...grant(["uploadMaterial"]), active: false }]) assert.throws(() => requireClassroom(profile, "uploadMaterial"), { code: "permission-denied" });
});
test("subir, importar, ordenar y publicar se conceden independientemente", () => {
  for (const key of Object.keys(permissions).filter(key => key !== "access")) { const profile = grant([key]); assert.equal(canClassroom(profile, key), true); for (const other of Object.keys(permissions).filter(other => ![key, "access"].includes(other))) assert.equal(canClassroom(profile, other), false); }
});
test("Functions rechazan operaciones directas sin el permiso específico", async () => {
  const profile = grant(["uploadMaterial"]); const getProfile = async () => profile; const request = { auth: { uid: profile.uid }, data: {} };
  const levels = createLevelHandler({ db: {}, getProfile });
  const units = createUnitHandlers({ db: { collection: () => ({}) }, getProfile });
  const importer = createImportDriveReference({ db: {}, getProfile });
  await assert.rejects(levels(request), { code: "permission-denied" });
  await assert.rejects(importer(request), { code: "permission-denied" });
  for (const operation of [units.save, units.preparePublish, units.publish, units.validatePublication, units.refreshDrive]) await assert.rejects(operation(request), { code: "permission-denied" });
  const preview = createBuildPreview({ db: {}, getProfile: async () => ({ active: true, role: "collaborator" }) });
  await assert.rejects(preview(request), { code: "permission-denied" });
});
test("gestionar permisos no concede administración global y escritura valida campos", async () => {
  const saved = []; const db = { collection: name => ({ doc: uid => ({ get: async () => ({ exists: true, data: () => ({ role: "collaborator" }) }), set: async value => saved.push([name, uid, value]) }) }) };
  const handlers = createPermissionHandlers({ db, getProfile: async () => grant(["managePermissions"]), timestamp: () => "now" });
  await handlers.save({ auth: { uid: "manager" }, data: { uid: "editor", permissions: { access: true, uploadMaterial: true } } });
  assert.equal(saved[0][0], "activeClassroomPermissions"); assert.equal(saved[0][2].permissions.publishVersions, false);
  await assert.rejects(handlers.save({ auth: { uid: "manager" }, data: { uid: "editor", permissions: { role: "admin" } } }), { code: "invalid-argument" });
  const denied = createPermissionHandlers({ db, getProfile: async () => grant(["editUnits"]) });
  await assert.rejects(denied.save({ auth: { uid: "editor" }, data: {} }), { code: "permission-denied" });
});

test("rollback de subida valida dueño, impide borrar asociados e invalida reutilización del ID", async () => {
  const { createUploadCleanup } = require("../drive/activeClassroomUploadCleanup");
  let associated = false, deleted = 0; const markers = [];
  const db = { collection: name => ({ doc: id => ({ name, id }) }), runTransaction: operation => operation({ get: async () => ({ exists: associated }), set: (ref, value) => markers.push([ref, value]) }) };
  const file = { getMetadata: async () => [{ generation: "12", metadata: { uploadedByUid: "collaborator" } }], delete: async options => { assert.equal(options.ifGenerationMatch, "12"); deleted++; } };
  const cleanup = createUploadCleanup({ db, bucket: { file: path => { assert.match(path, /^active-classroom\/resources\/upload\/a.pdf$/); return file; } }, getProfile: async () => grant(["uploadMaterial"]), timestamp: () => "now" });
  const request = { auth: { uid: "collaborator" }, data: { resourceId: "upload", fileName: "a.pdf" } };
  associated = true; await assert.rejects(cleanup(request), { code: "failed-precondition" }); assert.equal(deleted, 0);
  associated = false; await cleanup(request); assert.equal(deleted, 1); assert.equal(markers[0][0].name, "activeClassroomDiscardedUploads");
  await assert.rejects(cleanup({ ...request, auth: { uid: "other" } }), { code: "permission-denied" });
});
