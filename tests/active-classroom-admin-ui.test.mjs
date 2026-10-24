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
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let draft = { name: "Unit real", levelId: "level-1", status: "active", description: "Legado", metadata: { code: "OLD", language: "es", estimatedMinutes: 10, tags: ["tag"] }, mainPresentationId: "main", generalResourceIds: ["audio"], slides: [{ slideId: "slide", index: 0, title: "Slide anterior", metadata: { pageNumber: 1, notes: "" }, resourceIds: [] }] };
  const resources = [{ id: "main", folderId: "unit", name: "Clase.pdf", source: "drive", mimeType: "application/pdf", kind: "document" }, { id: "audio", folderId: "unit", name: "Audio.mp3", source: "drive", mimeType: "audio/mpeg", kind: "audio" }];
  let revision = 1;
  let changed = new Set(["main", "audio"]);
  const refreshes = [], published = [];
  const mock = {
    getCloudFileContent: async () => { throw new Error("Descarga explícita no solicitada por esta prueba"); },
    getActiveClassroomResourceUrl: async () => "",
    loadMusicCatalog: async () => ({ ambientCatalogVersion: 1, playlists: [], tracks: [{ id: "a".repeat(64), title: "Calma", active: true, size: 12 }] }),
    previewMusicTrack: async () => ({ url: "data:audio/mpeg;base64," }),
    subscribeUnitPublication: () => () => {}, loadUnitPublications: async () => [],
    loadUnitEditor: async () => ({ draft, draftRevision: revision }), loadUnitResources: async () => resources,
    saveUnitDraft: async (_id, next, expected) => { assert.equal(expected, revision); draft = structuredClone(next); return { draft, draftRevision: ++revision }; },
    refreshUnitDriveResource: async (_id, id, expected) => { assert.equal(expected, revision); refreshes.push(id); changed.delete(id); return { draftRevision: ++revision, resource: resources.find(resource => resource.id === id) }; },
    checkUnitDriveChanges: async (_id, ids) => ({ results: ids.map(resourceId => ({ resourceId, status: changed.has(resourceId) ? "changed" : "current" })) }),
    validateUnitPublication: async (_id, expected) => { assert.equal(expected, revision); return { ready: !changed.size && !!draft.mainPresentationId, results: [...changed].map(resourceId => ({ resourceId, status: "changed" })), issues: draft.mainPresentationId ? [] : ["Selecciona una presentación principal."] }; },
    publishUnit: async (_id, expected) => { assert.equal(expected, revision); published.push(structuredClone(draft)); },
    processUnitDocument: async () => { throw new Error("PDF/audio no requieren procesamiento Office"); },
    listClassroomDriveFiles: async () => ({ rootFolderId: "drive-root", files: [{ id: "replacement", name: "Nueva.pdf", mimeType: "application/pdf" }] }),
    getDriveRootSettings: async () => ({ rootFolderId: "drive-root" }), listDriveFolder: async () => ({ files: [{ id: "replacement", name: "Nueva.pdf", mimeType: "application/pdf" }] }),
  };
  globalThis.__classroomAdminMock = mock;
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, plugins: [{ name: "admin-test-services", enforce: "pre", load(id) {
    if (/musicService\.js$|unitEditorService\.js$|services\/driveService\.js$|activeClassroomService\.js$/.test(id.replaceAll("\\", "/"))) return Object.keys(mock).map(name => `export const ${name} = (...args) => globalThis.__classroomAdminMock.${name}(...args);`).join("\n");
    if (/ResourceInspector\.jsx$|SlideInteractionEditor\.jsx$/.test(id)) return "export default function UnchangedPlayerComponent() { return null; }";
  } }] });
  const root = createRoot(dom.window.document.querySelector("#root"));
  t.after(async () => { await act(async () => root.unmount()); await server.close(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.__classroomAdminMock; });
  const { UnitEditorForm } = await server.ssrLoadModule("/src/active-classroom/components/UnitEditor.jsx");
  await act(async () => root.render(React.createElement(UnitEditorForm, { profile: { uid: "admin", active: true, role: "admin" }, unit: { id: "unit", name: draft.name }, folders: [{ id: "level-1", kind: "level", name: "Nivel actual", active: true }], resources, initial: { editor: { draft, draftRevision: revision }, publications: [] }, onDirtyChange() {}, onBack() {}, onUpload: async () => [], onImport: async () => { resources.push({ id: "replacement", folderId: "unit", source: "drive", name: "Nueva.pdf", mimeType: "application/pdf", kind: "document" }); return { imported: [{ id: "replacement" }], failed: [] }; } })));
  const button = text => [...dom.window.document.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === text || item.textContent.trim() === text);
  const click = async text => { assert.ok(button(text), text); await act(async () => button(text).click()); };
  const fields = dom.window.document.querySelector(".ac-unit-fields").textContent;
  for (const field of ["Código", "Idioma", "Duración", "Descripción", "Etiquetas"]) assert.equal(fields.includes(field), false);
  const workspace = dom.window.document.querySelector(".ac-unit-workspace");
  const resourcesBelow = dom.window.document.querySelector(".ac-unit-resources-full");
  assert.equal(workspace.contains(resourcesBelow), false, "recursos fuera de columnas de diapositivas y preview");
  assert.ok(workspace.compareDocumentPosition(resourcesBelow) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "recursos después del preview");
  assert.equal(Boolean(dom.window.document.querySelector(".ac-unit-side")), false);
  await click("Gestionar recursos");
  assert.equal(Boolean(dom.window.document.querySelector(".ac-unit-workspace")), false);
  const audioRow = [...dom.window.document.querySelectorAll('.ac-unit-resource')].find(row => row.textContent.includes("Audio.mp3"));
  await act(async () => audioRow.querySelector('.ac-rm-menu summary').click());
  await act(async () => audioRow.querySelectorAll('.ac-rm-menu-content input[type="checkbox"]')[1].click());
  await click("Resumen");
  assert.match(dom.window.document.querySelector('.ac-unit-slide-resources').textContent, /1 recurso\(s\) asociado/);
  await click("Publicar versión");
  assert.match(dom.window.document.body.textContent, /Hay 2 archivos con una versión más reciente/);
  assert.equal(published.length, 0);
  await click("Actualizar y continuar");
  assert.deepEqual(refreshes, ["main", "audio"]); assert.equal(published.length, 1); assert.equal(published[0].metadata.code, "OLD");
  assert.deepEqual(published[0].slides[0].resourceIds, ["audio"], "asociación desde recursos se conserva al publicar");
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
  assert.equal(dom.window.document.querySelectorAll('[role="tab"]').length, 6);
  const inspectButton = button("Audio.mp3");
  inspectButton.focus();
  await act(async () => inspectButton.click());
  assert.ok(dom.window.document.querySelector('.ac-rm-inspector'));
  assert.equal(Boolean(dom.window.document.querySelector('.ac-unit-resource-dialog')), false, "inspector integrado en Recursos sin modal");
  await click("Cerrar detalles");
  assert.equal(Boolean(dom.window.document.querySelector('.ac-rm-inspector')), false);
  assert.ok(dom.window.document.activeElement === inspectButton, "cerrar detalles devuelve foco al recurso");
  await click("Música");
  assert.equal(Boolean(dom.window.document.querySelector('.ac-unit-workspace')), false);
  assert.ok(button("Guardar borrador")); assert.ok(button("Publicar versión"));
  await act(async () => dom.window.document.querySelectorAll('.ac-music-options input[type="radio"]')[2].click());
  await click("Guardar borrador");
  assert.deepEqual(draft.unitMusic, { mode: "custom", trackId: "a".repeat(64) });
  await act(async () => dom.window.document.querySelectorAll('.ac-music-options input[type="radio"]')[0].click());
  await click("Guardar borrador");
  assert.deepEqual(draft.unitMusic, { mode: "inherit", trackId: null });
  const selectedTab = dom.window.document.querySelector('[role="tab"][aria-selected="true"]');
  await act(async () => selectedTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  assert.equal(dom.window.document.activeElement.textContent, "Publicaciones");
  assert.match(dom.window.document.querySelector('[role="tabpanel"]').textContent, /Publicaciones inmutables/);
});

test("panel de niveles permite cambiar y quitar ícono mediante servicio existente", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  globalThis.__levelIconMock = async (...args) => { calls.push(args); };
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, plugins: [{ name: "level-icon-services", enforce: "pre", load(id) {
    if (/activeClassroomService\.js$/.test(id)) return "export const manageActiveClassroomLevel = (...args) => globalThis.__levelIconMock(...args); export const setActiveClassroomLevelCover = (...args) => globalThis.__levelIconMock('cover', ...args); export const getActiveClassroomResourceUrl = async () => '';";
  } }] });
  const root = createRoot(dom.window.document.querySelector("#root"));
  t.after(async () => { await act(async () => root.unmount()); await server.close(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.__levelIconMock; });
  const { default: LevelsPanel } = await server.ssrLoadModule("/src/active-classroom/components/LevelsPanel.jsx");
  const profile = { uid: "admin", role: "admin", active: true };
  const level = { id: "level-1", kind: "level", name: "Principiantes", active: true, icon: "📚" };
  await act(async () => root.render(React.createElement(LevelsPanel, { folders: [level], profile, onOpen() {} })));
  assert.match(dom.window.document.querySelector("h3").textContent, /📚.*Principiantes/);
  const button = [...dom.window.document.querySelectorAll("button")].find(item => item.textContent === "Cambiar ícono");
  for (const icon of ["🎓", "", null]) {
    dom.window.prompt = () => icon;
    await act(async () => button.click());
  }
  assert.deepEqual(calls, [[{ action: "update", levelId: "level-1", icon: "🎓" }, profile], [{ action: "update", levelId: "level-1", icon: "" }, profile]]);
  assert.ok(dom.window.document.querySelector('input[maxlength="32"]'));
  assert.ok([...dom.window.document.querySelectorAll("button")].some(item => item.textContent === "Abrir nivel"));
  let opened = "";
  await act(async () => root.render(React.createElement(LevelsPanel, { folders: [level], profile, onOpen(id) { opened = id; } })));
  await act(async () => dom.window.document.querySelector('[aria-label="Abrir Principiantes"]').click());
  assert.equal(opened, level.id);
  const coverInput = dom.window.document.querySelector('input[type="file"]');
  const file = new dom.window.File(["png"], "cover.png", { type: "image/png" });
  Object.defineProperty(coverInput, "files", { configurable: true, value: [file] });
  const imageButton = [...dom.window.document.querySelectorAll("button")].find(item => item.textContent === "Cambiar imagen");
  await act(async () => imageButton.click());
  await act(async () => coverInput.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
  assert.equal(calls.at(-1)[0], "cover"); assert.equal(calls.at(-1)[1].id, level.id); assert.equal(calls.at(-1)[2], file);
});
