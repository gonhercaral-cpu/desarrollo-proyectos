import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "../active-classroom-desktop/node_modules/jsdom/lib/api.js";

test("editor real: campos simples, actualizar todos antes de publicar y quitar/reemplazar presentación", async t => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.confirm = () => true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  let draft = { name: "Unit real", levelId: "level-1", status: "active", description: "Legado", metadata: { code: "OLD", language: "es", estimatedMinutes: 10, tags: ["tag"] }, mainPresentationId: "main", generalResourceIds: ["audio"], slides: [{ slideId: "slide", index: 0, title: "Slide anterior", metadata: { pageNumber: 1, notes: "" }, resourceIds: [] }] };
  const resources = [{ id: "main", folderId: "unit", name: "Clase.pdf", source: "drive", mimeType: "application/pdf", kind: "document" }, { id: "audio", folderId: "unit", name: "Audio.mp3", source: "drive", mimeType: "audio/mpeg", kind: "audio" }];
  let revision = 1;
  let changed = new Set(["main", "audio"]);
  const refreshes = [], published = [];
  const mock = {
    subscribeUnitPublication: () => () => {}, loadUnitPublications: async () => [],
    loadUnitEditor: async () => ({ draft, draftRevision: revision }), loadUnitResources: async () => resources,
    saveUnitDraft: async (_id, next, expected) => { assert.equal(expected, revision); draft = structuredClone(next); return { draft, draftRevision: ++revision }; },
    refreshUnitDriveResource: async (_id, id, expected) => { assert.equal(expected, revision); refreshes.push(id); changed.delete(id); return { draftRevision: ++revision, resource: resources.find(resource => resource.id === id) }; },
    checkUnitDriveChanges: async (_id, ids) => ({ results: ids.map(resourceId => ({ resourceId, status: changed.has(resourceId) ? "changed" : "current" })) }),
    validateUnitPublication: async (_id, expected) => { assert.equal(expected, revision); return { ready: !changed.size && !!draft.mainPresentationId, results: [...changed].map(resourceId => ({ resourceId, status: "changed" })), issues: draft.mainPresentationId ? [] : ["Selecciona una presentación principal."] }; },
    publishUnit: async (_id, expected) => { assert.equal(expected, revision); published.push(structuredClone(draft)); },
    processUnitDocument: async () => { throw new Error("PDF/audio no requieren procesamiento Office"); },
    getDriveRootSettings: async () => ({ rootFolderId: "drive-root" }), listDriveFolder: async () => ({ files: [{ id: "replacement", name: "Nueva.pdf", mimeType: "application/pdf" }] }),
  };
  globalThis.__classroomAdminMock = mock;
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, plugins: [{ name: "admin-test-services", enforce: "pre", load(id) {
    if (/unitEditorService\.js$|services\/driveService\.js$/.test(id.replaceAll("\\", "/"))) return Object.keys(mock).map(name => `export const ${name} = (...args) => globalThis.__classroomAdminMock.${name}(...args);`).join("\n");
    if (/ResourceInspector\.jsx$|SlideInteractionEditor\.jsx$/.test(id)) return "export default function UnchangedPlayerComponent() { return null; }";
  } }] });
  const root = createRoot(dom.window.document.querySelector("#root"));
  t.after(async () => { await act(async () => root.unmount()); await server.close(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.__classroomAdminMock; });
  const { UnitEditorForm } = await server.ssrLoadModule("/src/active-classroom/components/UnitEditor.jsx");
  await act(async () => root.render(React.createElement(UnitEditorForm, { unit: { id: "unit", name: draft.name }, folders: [{ id: "level-1", kind: "level", name: "Nivel actual", active: true }], resources, initial: { editor: { draft, draftRevision: revision }, publications: [] }, onDirtyChange() {}, onBack() {}, onUpload: async () => [], onImport: async () => { resources.push({ id: "replacement", folderId: "unit", source: "drive", name: "Nueva.pdf", mimeType: "application/pdf", kind: "document" }); return { imported: [{ id: "replacement" }], failed: [] }; } })));
  const button = text => [...dom.window.document.querySelectorAll("button")].find(item => item.textContent.trim() === text);
  const click = async text => { assert.ok(button(text), text); await act(async () => button(text).click()); };
  const fields = dom.window.document.querySelector(".ac-unit-fields").textContent;
  for (const field of ["Código", "Idioma", "Duración", "Descripción", "Etiquetas"]) assert.equal(fields.includes(field), false);
  await click("Publicar versión");
  assert.match(dom.window.document.body.textContent, /Hay 2 archivos con una versión más reciente/);
  assert.equal(published.length, 0);
  await click("Actualizar y continuar");
  assert.deepEqual(refreshes, ["main", "audio"]); assert.equal(published.length, 1); assert.equal(published[0].metadata.code, "OLD");
  await click("Quitar presentación");
  assert.equal(draft.mainPresentationId, null); assert.deepEqual(draft.slides, []);
  await click("Importar presentación desde Nube AES");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const choice = dom.window.document.querySelector(".ac-drive-choice input");
  assert.ok(choice);
  await act(async () => choice.click());
  await click("Importar (1)");
  assert.equal(draft.mainPresentationId, "replacement");
  assert.equal(published[0].mainPresentationId, "main");
});
