import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let writes;
let uploads;
let updates;
let commit;
let upload;
let update;
let listener;
const stored = new Map();

mock.module("firebase/firestore", { namedExports: {
  getFirestore: () => ({}),
  collection: (_db, path) => ({ path }),
  doc: (_db, path, id) => ({ path: `${path}/${id}`, id }),
  addDoc: async (ref, data) => {
    writes.push({ ref, data });
    await commit();
    stored.set("idea-1", data);
    return { id: "idea-1" };
  },
  updateDoc: async (ref, data) => { updates.push({ ref, data }); await update(); },
  deleteDoc: async () => {},
  serverTimestamp: () => "server-timestamp",
  arrayUnion: (...values) => values,
  increment: (value) => value,
  where: (...args) => args,
  query: (...args) => args,
  onSnapshot: (query, options, onChange) => {
    listener = { query, options, onChange };
    return () => {};
  },
} });
mock.module("firebase/storage", { namedExports: {
  getStorage: () => ({}),
  ref: (_storage, path) => ({ path }),
  uploadBytes: async (ref, file) => { uploads.push({ ref, file }); await upload(file); },
  getDownloadURL: async (ref) => `https://example.test/${ref.path}`,
} });

const { createIdea, subscribeIdeas } = await import("../src/services/ideasService.js");
const form = {
  title: "  Mejor flujo  ", area: "General", currentProblem: "Trabajo repetido",
  proposedIdea: "Automatizar", expectedBenefit: "Menos errores",
  implementationSuggestion: "Un piloto", priority: "media", impact: "medio",
};
const firebaseUser = { uid: "collab", email: "collab@test.local" };
const profile = { active: true, role: "collaborator", uid: "legacy-id", name: "Colaborador" };
const args = { form, firebaseUser, profile };

beforeEach(() => {
  writes = []; uploads = []; updates = []; stored.clear();
  commit = async () => {};
  upload = async () => {};
  update = async () => {};
});

test("espera confirmación del backend y usa UID autenticado, no ID del perfil", async () => {
  const pending = Promise.withResolvers();
  commit = () => pending.promise;
  let done = false;
  const result = createIdea(args).then((id) => { done = true; return id; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(stored.size, 0);
  pending.resolve();
  assert.equal(await result, "idea-1");
  assert.equal(writes[0].ref.path, "ideas");
  assert.equal(stored.get("idea-1").createdByUid, "collab");
  assert.equal(stored.get("idea-1").updatedByUid, "collab");
  assert.equal(stored.get("idea-1").title, "Mejor flujo");
});

test("propaga rechazo de permisos sin producir un ID ni alterar formulario", async () => {
  const failure = Object.assign(new Error("denied"), { code: "permission-denied" });
  commit = async () => { throw failure; };
  const submission = {};
  const original = structuredClone(form);
  await assert.rejects(createIdea({ ...args, submission }), (error) => error === failure);
  assert.equal(submission.ideaId, undefined);
  assert.equal(stored.size, 0);
  assert.deepEqual(form, original);
});

test("valida campos, perfil, sesión, opciones y tamaño antes de escribir", async () => {
  for (const field of ["title", "currentProblem", "proposedIdea", "expectedBenefit"]) {
    await assert.rejects(createIdea({ ...args, form: { ...form, [field]: "  " } }), /Completa/);
  }
  await assert.rejects(createIdea({ ...args, firebaseUser: null }), /autenticado/);
  await assert.rejects(createIdea({ ...args, profile: { active: false } }), /activo/);
  await assert.rejects(createIdea({ ...args, form: { ...form, priority: "invalid" } }), /válidos/);
  await assert.rejects(createIdea({ ...args, form: { ...form, impact: "invalid" } }), /válidos/);
  await assert.rejects(createIdea({ ...args, files: [{ name: "grande.pdf", size: 25 * 1024 * 1024 }] }), /25 MB/);
  assert.equal(writes.length, 0);
});

test("reintenta evidencia sin repetir documento ni archivos ya subidos", async () => {
  const files = [{ name: "a.pdf", size: 10 }, { name: "b.pdf", size: 20 }];
  const submission = {};
  upload = async (file) => { if (file === files[1]) throw new Error("storage unavailable"); };
  await assert.rejects(createIdea({ ...args, files, submission }), /storage unavailable/);
  assert.equal(submission.ideaId, "idea-1");
  assert.equal(updates.length, 0);
  upload = async () => {};
  assert.equal(await createIdea({ ...args, files, submission }), "idea-1");
  assert.equal(writes.length, 1);
  assert.equal(uploads.filter(({ file }) => file === files[0]).length, 1);
  assert.equal(updates[0].data.evidenceCount, 2);
});

test("espera escritura de metadata y conserva progreso ante rechazo de Firestore", async () => {
  const files = [{ name: "a.pdf", size: 10 }];
  const submission = {};
  update = async () => { throw new Error("metadata denied"); };
  await assert.rejects(createIdea({ ...args, files, submission }), /metadata denied/);
  update = async () => {};
  await createIdea({ ...args, files, submission });
  assert.equal(writes.length, 1);
  assert.equal(uploads.length, 1);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].data.evidenceFiles, updates[1].data.evidenceFiles);
});

test("no continúa una creación parcial con otra sesión", async () => {
  await assert.rejects(createIdea({ ...args, submission: { ideaId: "saved", uid: "other" } }), /sesión cambió/);
  assert.equal(writes.length, 0);
});

test("lista solo creaciones confirmadas y conserva versiones previas durante actualizaciones", () => {
  const seen = [];
  subscribeIdeas({ ...args, isAdmin: false, onChange: (rows) => seen.push(rows) });
  assert.deepEqual(listener.query[1], ["createdByUid", "==", "collab"]);
  assert.equal(listener.options.includeMetadataChanges, true);
  const snapshot = (pending, title) => ({ docs: [{
    id: "idea-1", metadata: { hasPendingWrites: pending },
    data: () => ({ title, createdByUid: "collab" }),
  }] });
  listener.onChange(snapshot(true, "local"));
  assert.deepEqual(seen.at(-1), []);
  listener.onChange(snapshot(false, "confirmed"));
  assert.equal(seen.at(-1)[0].title, "confirmed");
  listener.onChange(snapshot(true, "updating"));
  assert.equal(seen.at(-1)[0].title, "confirmed");
  listener.onChange({ docs: [] });
  assert.deepEqual(seen.at(-1), []);
});
