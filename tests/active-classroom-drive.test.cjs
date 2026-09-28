const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createImportDriveReference, resourceKind } = require("../drive/activeClassroom");

function fixture({ profile = { role: "admin", active: true, name: "Admin" }, file = {}, unit = {}, denied = false } = {}) {
  const documents = new Map([
    ["activeClassroomFolders/unit-1", { kind: "unit", active: true, parentId: "level-1", ...unit }],
    ["activeClassroomFolders/level-1", { kind: "level", active: true }],
  ]);
  let resolved = 0;
  const db = {
    collection: (collection) => ({ doc: (id) => `${collection}/${id}` }),
    runTransaction: (callback) => callback({
      get: async (path) => ({ exists: documents.has(path), data: () => documents.get(path) }),
      create: (path, data) => { assert.ok(!documents.has(path)); documents.set(path, data); },
    }),
  };
  const handler = createImportDriveReference({
    db, getProfile: async () => profile, timestamp: () => "SERVER_TIME",
    resolveFile: async () => {
      resolved += 1;
      if (denied) throw Object.assign(new Error("Archivo privado"), { code: "permission-denied" });
      return { id: "file-1", name: "Clase.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", modifiedTime: "2026-09-14T00:00:00Z", version: "42", size: "2048", ...file };
    },
  });
  return { handler, documents, resolved: () => resolved };
}
const request = { auth: { uid: "admin" }, data: { folderId: "unit-1", driveFileId: "file-1", name: "FALSIFICADO", published: true } };

test("importa metadata del servidor como referencia borrador sin binario", async () => {
  const { handler, documents } = fixture();
  const result = await handler(request);
  const resource = documents.get(`activeClassroomResources/${result.id}`);
  assert.equal(resource.name, "Clase.pptx");
  assert.equal(resource.source, "drive");
  assert.equal(resource.storagePath, "");
  assert.equal(resource.published, false);
  assert.equal(resource.levelId, "level-1");
  assert.equal(resource.version, 1);
  assert.equal(resource.driveVersion, "42");
  assert.equal(resource.publishedVersion, null);
  assert.deepEqual(resource.association, { scope: "unit", slideId: null, presentationResourceId: null });
  assert.equal(resource.updatedAt, "SERVER_TIME");
});

test("reintento idempotente conserva publicación y metadata previa", async () => {
  const { handler, documents } = fixture();
  const first = await handler(request);
  documents.get(`activeClassroomResources/${first.id}`).published = true;
  assert.deepEqual(await handler(request), { id: first.id, alreadyImported: true });
  assert.equal(documents.get(`activeClassroomResources/${first.id}`).published, true);
});

test("mismo original puede asociarse a otra Unit sin duplicar binario", async () => {
  const { handler, documents } = fixture();
  documents.set("activeClassroomFolders/unit-2", { kind: "unit", active: true, parentId: "level-1" });
  const first = await handler(request);
  const second = await handler({ ...request, data: { ...request.data, folderId: "unit-2" } });
  assert.notEqual(first.id, second.id);
});

test("rechaza sesión ausente, admin inactivo y colaborador antes de Drive", async () => {
  for (const profile of [{ role: "admin", active: false }, { role: "collaborator", active: true }]) {
    const f = fixture({ profile });
    await assert.rejects(f.handler(request), { code: "permission-denied" });
    assert.equal(f.resolved(), 0);
  }
  await assert.rejects(fixture().handler({ data: request.data }), { code: "unauthenticated" });
});

test("respeta denegación Drive y rechaza carpetas, eliminados y descargas prohibidas", async () => {
  await assert.rejects(fixture({ denied: true }).handler(request), { code: "permission-denied" });
  for (const [file, code] of [
    [{ trashed: true }, "not-found"],
    [{ mimeType: "application/vnd.google-apps.folder" }, "invalid-argument"],
    [{ capabilities: { canDownload: false } }, "permission-denied"],
    [{ name: "script.exe" }, "invalid-argument"],
  ]) await assert.rejects(fixture({ file }).handler(request), { code });
});

test("valida destino e identificadores", async () => {
  await assert.rejects(fixture({ unit: { active: false } }).handler(request), { code: "failed-precondition" });
  await assert.rejects(fixture({ unit: { kind: "level" } }).handler(request), { code: "failed-precondition" });
  await assert.rejects(fixture().handler({ ...request, data: { folderId: "../users/admin", driveFileId: "file-1" } }), { code: "invalid-argument" });
});

test("Google Slides/Docs conservan MIME nativo y tamaño desconocido", async () => {
  for (const [mimeType, kind] of [["application/vnd.google-apps.presentation", "presentation"], ["application/vnd.google-apps.document", "document"]]) {
    const { handler, documents } = fixture({ file: { mimeType, name: "Nativo", size: undefined } });
    const { id } = await handler(request);
    const resource = documents.get(`activeClassroomResources/${id}`);
    assert.equal(resource.kind, kind);
    assert.equal(resource.mimeType, mimeType);
    assert.equal(resource.sizeBytes, null);
  }
});

test("selector y backend coinciden para formatos soportados y rechazados", async () => {
  const { getDriveResourceKind } = await import("../src/active-classroom/utils/driveResources.js");
  for (const extension of ["ppt", "pptx", "pdf", "doc", "docx", "txt", "mp3", "wav", "m4a", "mp4", "webm", "jpg", "jpeg", "png", "webp"]) {
    const file = { name: `archivo.${extension.toUpperCase()}`, mimeType: "application/octet-stream" };
    assert.ok(resourceKind(file));
    assert.equal(resourceKind(file), getDriveResourceKind(file));
  }
  for (const mimeType of ["application/vnd.google-apps.document", "application/vnd.google-apps.presentation", "application/vnd.google-apps.folder", "application/vnd.google-apps.shortcut"]) {
    const file = { name: "archivo.pptx", mimeType };
    assert.equal(resourceKind(file), getDriveResourceKind(file));
  }
});
