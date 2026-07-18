import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeFirestoreData } from "../src/editorial/utils/editorialFirestore.js";
import { buildEditorialCommands, findExecutableViolations, flattenCommands } from "../src/editorial/utils/editorialCommands.js";
import {
  driveFolderLabel,
  driveFolderSubLabel,
  exportDisplayName,
  exportSubLabel,
  userDisplayName,
  userSubLabel,
} from "../src/editorial/utils/editorialLabels.js";

// --- sanitizeFirestoreData -------------------------------------------------

test("sanitizer elimina undefined y conserva null/false/0/\"\"", () => {
  const input = { a: undefined, b: null, c: false, d: 0, e: "", f: "x" };
  assert.deepEqual(sanitizeFirestoreData(input), { b: null, c: false, d: 0, e: "", f: "x" });
});

test("sanitizer procesa objetos anidados y arrays sin undefined", () => {
  const input = { nested: { keep: 1, drop: undefined }, list: [1, undefined, { x: undefined, y: 2 }] };
  assert.deepEqual(sanitizeFirestoreData(input), { nested: { keep: 1 }, list: [1, { y: 2 }] });
});

test("sanitizer no muta el original", () => {
  const input = { a: undefined, b: { c: undefined, d: 1 } };
  const copy = JSON.parse(JSON.stringify({ a: null, b: { c: null, d: 1 } }));
  sanitizeFirestoreData(input);
  assert.equal("a" in input, true); // sigue presente en el original
  assert.equal(input.b.d, 1);
  assert.ok(copy);
});

test("sanitizer preserva tipos especiales (Date y objetos con prototipo propio)", () => {
  const date = new Date("2020-01-02T00:00:00Z");
  class FieldValueLike { constructor() { this._method = "serverTimestamp"; } }
  const special = new FieldValueLike();
  const out = sanitizeFirestoreData({ date, special, drop: undefined });
  assert.equal(out.date, date); // misma referencia, no aplanado
  assert.equal(out.special, special); // objeto especial intacto
  assert.equal("drop" in out, false);
});

test("payload de asset de imagen queda sin undefined (masterPageId ausente)", () => {
  // Simula el asset de una imagen en página normal (sin maestra ni componente).
  const asset = {
    id: "a1", projectId: "p1", documentId: "d1", type: "image",
    pageId: "pg1",
    masterPageId: undefined, componentId: undefined,
    storagePath: "editorial/p1/images/u/a1.png", url: "https://x/a1.png",
  };
  const clean = sanitizeFirestoreData(asset);
  assert.equal("masterPageId" in clean, false);
  assert.equal("componentId" in clean, false);
  assert.equal(clean.pageId, "pg1");
  assert.equal(clean.url, "https://x/a1.png");
});

// --- comandos de toolbar ---------------------------------------------------

const baseEditor = { actions: { undo() {}, redo() {}, addText() {}, addShape() {}, duplicate() {}, remove() {} }, canUndo: true, canRedo: false };
const editCaps = { view: true, edit_content: true };
const viewerCaps = { view: true, edit_content: false };
const handlers = { openConfig() {}, openExport() {}, openReadView() {}, back() {}, pickImage() {}, openIndex() {}, zoomBy() {}, fit() {}, toggleSpread() {}, toggleRulers() {} };

test("comandos: sin controles visibles+habilitados sin execute", () => {
  const groups = buildEditorialCommands({ editor: baseEditor, caps: editCaps, hasSelection: true, handlers });
  assert.deepEqual(findExecutableViolations(groups), []);
});

test("comandos: handler faltante o deshabilitado no ejecuta", () => {
  const groups = buildEditorialCommands({ editor: baseEditor, caps: editCaps, hasSelection: false, handlers });
  const flat = flattenCommands(groups);
  const redo = flat.find((cmd) => cmd.id === "redo");
  assert.equal(redo.enabled, false); // canRedo false
  const del = flat.find((cmd) => cmd.id === "delete");
  assert.equal(del.enabled, false); // sin selección
});

test("comandos: permiso bloquea inserción/edición para viewer", () => {
  const groups = buildEditorialCommands({ editor: baseEditor, caps: viewerCaps, hasSelection: true, handlers });
  const flat = flattenCommands(groups);
  assert.equal(flat.find((cmd) => cmd.id === "insert-text").enabled, false);
  assert.equal(flat.find((cmd) => cmd.id === "duplicate").enabled, false);
  // Ver/zoom siguen disponibles.
  assert.equal(flat.find((cmd) => cmd.id === "zoom-in").enabled, true);
  // Ningún violador aunque haya deshabilitados.
  assert.deepEqual(findExecutableViolations(groups), []);
});

test("comandos: contexto inválido y estado activo", () => {
  const inComponent = buildEditorialCommands({ editor: baseEditor, caps: editCaps, editorMode: { kind: "component" }, viewMode: "single", handlers });
  const spread = flattenCommands(inComponent).find((cmd) => cmd.id === "toggle-spread");
  assert.equal(spread.enabled, false); // sólo en página
  const facing = buildEditorialCommands({ editor: baseEditor, caps: editCaps, viewMode: "facing", handlers });
  assert.equal(flattenCommands(facing).find((cmd) => cmd.id === "toggle-spread").active, true);
});

// --- labels ----------------------------------------------------------------

test("labels de usuario con fallbacks y sin ids/objetos", () => {
  assert.equal(userDisplayName({ displayName: "Ana Ruiz" }), "Ana Ruiz");
  assert.equal(userDisplayName({ email: "x@y.com" }), "x@y.com");
  assert.equal(userDisplayName({ id: "uid123" }), "Usuario sin nombre"); // nunca el id
  assert.equal(userDisplayName({}), "Usuario sin nombre");
  assert.equal(userDisplayName(null), "Usuario sin nombre");
  assert.equal(userSubLabel({ role: "Editor" }), "Editor");
});

test("labels de exportación con tipo/variante y fallback", () => {
  assert.equal(exportDisplayName({ type: "print", variant: "student" }), "Imprenta Alumno");
  assert.equal(exportDisplayName({ fileName: "libro.pdf" }), "libro.pdf");
  assert.equal(exportDisplayName({}), "Exportación sin nombre");
  assert.match(exportSubLabel({ type: "review", variant: "teacher" }), /Revisión · Maestro/);
});

test("labels de carpeta Drive sin usar el objeto completo", () => {
  assert.equal(driveFolderLabel({ name: "Publicados" }), "Publicados");
  assert.equal(driveFolderLabel({ departmentName: "Material" }), "Material");
  assert.equal(driveFolderLabel({ id: "f1" }), "Carpeta sin nombre");
  assert.equal(driveFolderLabel({}), "Carpeta sin nombre");
  assert.equal(driveFolderSubLabel({ path: "/AES/Material" }), "/AES/Material");
});
