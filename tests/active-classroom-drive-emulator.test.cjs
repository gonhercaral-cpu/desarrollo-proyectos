const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const admin = require("../drive/node_modules/firebase-admin");
const { createImportDriveReference } = require("../drive/activeClassroom");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Esta prueba requiere Firestore Emulator.");
const app = admin.initializeApp({ projectId: "security-rules-audit" }, "active-classroom-import-test");
const db = app.firestore();
const folderId = "ac-integration-unit";
const levelId = "ac-integration-level";
const handler = createImportDriveReference({
  db,
  timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  getProfile: async () => ({ role: "admin", active: true, name: "Prueba" }),
  resolveFile: async (_profile, id) => ({ id, name: "Clase.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", version: "3" }),
});
const request = { auth: { uid: "test-admin" }, data: { folderId, driveFileId: "ac-integration-original" } };

before(async () => {
  await db.collection("activeClassroomFolders").doc(levelId).set({ kind: "level", active: true });
  await db.collection("activeClassroomFolders").doc(folderId).set({ kind: "unit", active: true, parentId: levelId });
});
after(async () => app.delete());

test("importaciones concurrentes crean una sola referencia con timestamps reales", async () => {
  const results = await Promise.all([handler(request), handler(request), handler(request)]);
  assert.equal(new Set(results.map(({ id }) => id)).size, 1);
  assert.equal(results.filter(({ alreadyImported }) => !alreadyImported).length, 1);
  const stored = (await db.collection("activeClassroomResources").doc(results[0].id).get()).data();
  assert.ok(stored.createdAt.toMillis() > 0);
  assert.equal(stored.sourceCheckedAt.toMillis(), stored.createdAt.toMillis());
  assert.equal(stored.storagePath, "");
  assert.equal(stored.published, false);
  assert.equal(stored.driveFileId, "ac-integration-original");
});

test("no importa a una Unit cuyo Nivel fue eliminado", async () => {
  await db.collection("activeClassroomFolders").doc(levelId).delete();
  await assert.rejects(handler({ ...request, data: { folderId, driveFileId: "another-original" } }), { code: "failed-precondition" });
});
