import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createServer } from "vite";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "../active-classroom-desktop/node_modules/jsdom/lib/api.js";
import {
  ANIMATION_FALLBACK_NOTICE, createSingleFlightGuard, guardedSubscription, importProgressLabel, pageWarningNotices,
  processingProgressMessage, processingResourceFromSnapshot, processingStageLabel, usableAnimation,
} from "../src/active-classroom/utils/processingProgress.js";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SLIDES = "application/vnd.google-apps.presentation";
const processing = (stage, mimeType = PPTX, name = "Clase.pptx") => ({ name, mimeType, processing: { state: "processing", stage } });

describe("processingProgress", () => {
  test("etapas reales por tipo y sin inventar etapas", () => {
    assert.match(processingStageLabel(processing("planning")), /Descargando y analizando/);
    assert.match(processingStageLabel(processing("converting")), /convirtiendo y guardando/i);
    assert.match(processingStageLabel(processing("converting", SLIDES, "Deck")), /Descargando, convirtiendo y almacenando diapositivas/);
    assert.match(processingStageLabel(processing("verifying")), /Verificando archivos/);
    assert.equal(processingStageLabel(processing("ready")), "");
    assert.equal(processingStageLabel(processing("inventada")), "");
    assert.equal(processingStageLabel(processing(undefined)), "");
    assert.equal(processingStageLabel({ ...processing("converting"), processing: { state: "failed", stage: "converting" } }), "");
    assert.equal(processingProgressMessage(processing(undefined)), "Procesando Clase.pptx…");
    assert.match(processingProgressMessage(processing("verifying")), /^Procesando Clase\.pptx… · Verificando archivos$/);
    assert.doesNotMatch(processingProgressMessage(processing("converting")), /\d+\s?%/);
  });

  test("importación cuenta archivos terminados, no porcentaje, y cede a la conversión", () => {
    const file = { name: "b.pdf" };
    assert.equal(importProgressLabel({ completed: 1, total: 3, file }), "Importando archivo 2 de 3: b.pdf");
    assert.equal(importProgressLabel({ completed: 3, total: 3, file }), "Importando archivo 3 de 3: b.pdf");
    assert.equal(importProgressLabel({ completed: 1, total: 3, file }, "Procesando b.pdf…"), "Procesando b.pdf…");
    assert.equal(importProgressLabel(null), "");
  });

  test("avisos de GIF no prometen animación universal y se deduplican", () => {
    const notices = pageWarningNotices(["gif-fallback", { code: "gif-fallback" }, "gif-unsupported", "otra"]);
    assert.equal(notices.length, 3);
    assert.ok(notices.some(text => /respaldo/.test(text) && /no está garantizada/.test(text)));
    assert.ok(notices.some(text => /no es compatible/.test(text)));
    assert.deepEqual(pageWarningNotices([]), []);
    assert.deepEqual(pageWarningNotices(undefined), []);
  });

  test("guarda sincrónica rechaza el segundo acceso hasta liberar", () => {
    const guard = createSingleFlightGuard();
    assert.equal(guard.tryAcquire(), true);
    assert.equal(guard.tryAcquire(), false);
    guard.release();
    assert.equal(guard.held, false);
    assert.equal(guard.tryAcquire(), true);
  });

  test("snapshot solo se acepta si folderId coincide con la Unit", () => {
    const snap = data => ({ exists: () => !!data, data: () => data });
    assert.deepEqual(processingResourceFromSnapshot("u1", "r1", snap({ folderId: "u1", name: "A" })), { id: "r1", folderId: "u1", name: "A" });
    assert.equal(processingResourceFromSnapshot("u1", "r1", snap({ folderId: "u2" })), null);
    assert.equal(processingResourceFromSnapshot("u1", "r1", snap(null)), null);
    assert.equal(processingResourceFromSnapshot("u1", "r1", undefined), null);
  });

  test("suscripción ignora callbacks posteriores a unsubscribe", () => {
    let push, fail, unsubscribed = 0;
    const seen = [], errors = [];
    const stop = guardedSubscription((next, error) => { push = next; fail = error; return () => { unsubscribed++; }; }, value => seen.push(value), error => errors.push(error));
    push(1); stop(); push(2); fail(new Error("tarde"));
    assert.deepEqual(seen, [1]); assert.equal(errors.length, 0); assert.equal(unsubscribed, 1);
  });

  test("animación solo se usa con descriptor completo y geometría válida", () => {
    const good = { background: { url: "https://a/bg.png", mimeType: "image/png" }, images: [{ url: "https://a/g.gif", mimeType: "image/gif", x: 10, y: 20, width: 30, height: 40 }] };
    assert.ok(usableAnimation(good));
    assert.equal(usableAnimation(undefined), null);
    assert.equal(usableAnimation({ ...good, images: [] }), null);
    assert.equal(usableAnimation({ ...good, background: { url: "https://a/bg.png", mimeType: "image/jpeg" } }), null);
    assert.equal(usableAnimation({ ...good, images: [{ ...good.images[0], x: 80 }] }), null);
    assert.equal(usableAnimation({ ...good, images: [{ ...good.images[0], mimeType: "image/png" }] }), null);
    assert.equal(usableAnimation({ ...good, images: [{ ...good.images[0], width: 0 }] }), null);
  });
});

async function harness(t, mock, stubs = /ResourceInspector\.jsx$/) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document, Image: globalThis.Image, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.confirm = () => true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  globalThis.__multimediaMock = mock;
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{ name: "multimedia-test-services", enforce: "pre", load(id) {
    if (/unitEditorService\.js$|services\/driveService\.js$/.test(id.replaceAll("\\", "/"))) return Object.keys(mock).map(name => `export const ${name} = (...args) => globalThis.__multimediaMock.${name}(...args);`).join("\n");
    if (stubs.test(id)) return "export default function Stub() { return null; }";
  } }] });
  const root = createRoot(dom.window.document.querySelector("#root"));
  t.after(async () => { await act(async () => root.unmount()); await server.close(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.__multimediaMock; });
  const text = () => dom.window.document.body.textContent;
  const button = label => [...dom.window.document.querySelectorAll("button")].find(item => item.textContent.trim() === label);
  const tick = (ms = 10) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  return { dom, server, root, text, button, tick };
}

test("processInto: etapa real vía onSnapshot, una sola ejecución por doble clic y guardas liberadas", async t => {
  const resource = { id: "main", folderId: "unit", name: "Clase.pptx", source: "drive", mimeType: PPTX, kind: "presentation" };
  const draft = { name: "Unit", levelId: "level-1", status: "active", metadata: {}, mainPresentationId: "main", generalResourceIds: [], slides: [] };
  let calls = 0, release;
  const subscriptions = [];
  let unsubscribed = 0;
  const mock = {
    subscribeUnitPublication: () => () => {}, loadUnitPublications: async () => [], loadUnitEditor: async () => null, loadUnitResources: async () => [resource],
    saveUnitDraft: async () => { throw new Error("no debe guardar"); }, refreshUnitDriveResource: async () => {}, checkUnitDriveChanges: async () => ({ results: [] }),
    validateUnitPublication: async () => ({ ready: true, results: [], issues: [] }), publishUnit: async () => {},
    processUnitDocument: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    subscribeUnitProcessing: (unitId, resourceId, onChange, onError) => { subscriptions.push({ unitId, resourceId, onChange, onError }); return () => { unsubscribed++; }; },
    getDriveRootSettings: async () => ({ rootFolderId: "root" }), listDriveFolder: async () => ({ files: [] }),
  };
  const module = await harnessModule(t, "/src/active-classroom/components/UnitEditor.jsx", mock);
  await act(async () => module.root.render(React.createElement(module.exports.UnitEditorForm, { unit: { id: "unit", name: "Unit" }, folders: [{ id: "level-1", kind: "level", name: "N", active: true }], resources: [resource], initial: { editor: { draft, draftRevision: 1 }, publications: [] }, onDirtyChange() {}, onBack() {}, onUpload: async () => [], onImport: async () => ({ imported: [], failed: [] }) })));
  const target = () => module.button("Procesar presentación");
  // Two clicks inside the same act: React busy state has not re-rendered, only the ref guard can stop the second.
  await act(async () => { target().click(); target().click(); });
  assert.equal(calls, 1);
  assert.equal(subscriptions.length, 1);
  assert.deepEqual([subscriptions[0].unitId, subscriptions[0].resourceId], ["unit", "main"]);
  assert.match(module.text(), /Procesando Clase\.pptx…/);
  assert.doesNotMatch(module.text(), /Convirtiendo/);
  await act(async () => subscriptions[0].onChange({ ...resource, processing: { state: "processing", stage: "converting" } }));
  assert.match(module.text(), /Procesando Clase\.pptx… · Convirtiendo y guardando en el servicio/);
  assert.doesNotMatch(module.text(), /\d+\s?%/);
  assert.ok(module.dom.window.document.querySelector(".ac-unit-feedback progress:not([value])"), "progreso indeterminado");
  // Callable reports another process is still running: inform, do not fail silently or start another conversion.
  release({ state: "processing" });
  await module.tick();
  assert.match(module.text(), /Clase\.pptx sigue procesándose en otro proceso\. No se inició otra conversión/);
  assert.equal(unsubscribed, 1);
  await act(async () => subscriptions[0].onChange({ ...resource, processing: { state: "processing", stage: "verifying" } }));
  assert.doesNotMatch(module.text(), /Verificando archivos/);
  // Guards released after the exception: a new attempt reaches the callable.
  await act(async () => target().click());
  assert.equal(calls, 2);
  assert.equal(subscriptions.length, 2);
  release({ state: "processing" });
  await module.tick();
  assert.equal(unsubscribed, 2);
});

async function harnessModule(t, path, mock) {
  const base = await harness(t, mock, /ResourceInspector\.jsx$|SlideInteractionEditor\.jsx$/);
  return { ...base, exports: await base.server.ssrLoadModule(path) };
}

test("diálogo de importación: doble envío bloqueado, progreso por archivo y guarda liberada tras error", async t => {
  const file = { id: "f1", name: "Clase.pdf", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z" };
  const mock = { getDriveRootSettings: async () => ({ rootFolderId: "root" }), listDriveFolder: async () => ({ files: [file] }), subscribeUnitProcessing: () => () => {} };
  const h = await harness(t, mock);
  const { default: Dialog } = await h.server.ssrLoadModule("/src/active-classroom/components/DriveResourceImportDialog.jsx");
  let calls = 0, report, rejectFirst;
  const onImport = (_files, _folder, progress) => { calls++; report = progress; return calls === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve({ imported: [], failed: [] }); };
  const props = { unit: { id: "unit", name: "Unit" }, resources: [], onImport, onClose() {}, allowExisting: true };
  await act(async () => h.root.render(React.createElement(Dialog, props)));
  await h.tick(30);
  await act(async () => h.dom.window.document.querySelector(".ac-drive-choice input").click());
  const submit = () => h.button("Importar (1)");
  await act(async () => { const target = submit(); target.click(); target.click(); });
  assert.equal(calls, 1);
  await act(async () => report({ completed: 1, total: 3, file }));
  assert.match(h.text(), /Importando archivo 2 de 3: Clase\.pdf/);
  await act(async () => h.root.render(React.createElement(Dialog, { ...props, processingMessage: "Procesando Clase.pdf… · Verificando archivos" })));
  assert.match(h.text(), /Procesando Clase\.pdf… · Verificando archivos/);
  assert.doesNotMatch(h.text(), /Importando archivo 2 de 3/);
  assert.ok(h.dom.window.document.querySelector("dialog form progress:not([value])"));
  const failure = Object.assign(new Error("fallo controlado"), { code: "x" });
  await act(async () => { rejectFirst(failure); });
  await h.tick();
  assert.match(h.text(), /fallo controlado/);
  await act(async () => submit().click());
  assert.equal(calls, 2, "la guarda se libera tras la excepción");
});

describe("SlideInteractionEditor vista previa híbrida", () => {
  const animated = (gifUrl = "https://cdn.test/a.gif") => ({ url: "https://cdn.test/full.png", mimeType: "image/png", animation: { background: { url: "https://cdn.test/bg.png", mimeType: "image/png" }, images: [{ url: gifUrl, mimeType: "image/gif", x: 10, y: 20, width: 30, height: 40 }] } });
  async function mount(t, preview, page = { pageObjectId: "p", builds: [], warnings: [] }, holdImages = false) {
    const mock = { getBuildPreview: async () => preview };
    const h = await harness(t, mock, /^$/);
    const pending = [];
    globalThis.Image = class { constructor() { this.naturalWidth = 1600; this.naturalHeight = 900; } set src(value) { const ready = () => /bad/.test(value) ? this.onerror?.() : this.onload?.(); if (holdImages) pending.push(ready); else setTimeout(ready, 0); } };
    const { default: Editor } = await h.server.ssrLoadModule("/src/active-classroom/components/SlideInteractionEditor.jsx");
    const srcs = () => [...h.dom.window.document.querySelectorAll(".ac-build-preview img")].map(image => image.getAttribute("src"));
    await act(async () => h.root.render(React.createElement(Editor, { unitId: "unit", slide: { slideId: "s", index: 0, metadata: { pageNumber: 1, pageObjectId: "p" } }, main: { id: "main", processing: { pages: [page] } }, resources: [], onChange() {} })));
    return { ...h, srcs, async releaseImages() { await act(async () => { for (const ready of pending.splice(0)) ready(); }); } };
  }

  test("conserva el PNG completo hasta cargar y luego sustituye por fondo y overlay GIF sin duplicar", async t => {
    const h = await mount(t, animated(), undefined, true);
    assert.deepEqual(h.srcs(), ["https://cdn.test/full.png"]);
    await h.releaseImages();
    await h.tick(20);
    assert.deepEqual(h.srcs(), ["https://cdn.test/bg.png", "https://cdn.test/a.gif"]);
    const overlay = h.dom.window.document.querySelectorAll(".ac-build-animation img")[1];
    assert.equal(overlay.style.left, "10%"); assert.equal(overlay.style.top, "20%");
    assert.equal(overlay.style.width, "30%"); assert.equal(overlay.style.height, "40%");
    assert.equal(overlay.style.objectFit, "fill");
    assert.equal(h.srcs().filter(src => /\.gif$/.test(src)).length, 1);
    assert.doesNotMatch(h.text(), /Animación no disponible/);
  });

  test("si falla la carga del GIF mantiene el PNG completo e informa sin romper", async t => {
    const h = await mount(t, animated("https://cdn.test/bad.gif"));
    await h.tick(20);
    assert.deepEqual(h.srcs(), ["https://cdn.test/full.png"]);
    assert.ok(h.text().includes(ANIMATION_FALLBACK_NOTICE));
  });

  test("descriptor inválido cae al PNG completo con aviso", async t => {
    const preview = animated(); preview.animation.images[0].x = 90;
    const h = await mount(t, preview);
    await h.tick(20);
    assert.deepEqual(h.srcs(), ["https://cdn.test/full.png"]);
    assert.ok(h.text().includes(ANIMATION_FALLBACK_NOTICE));
  });

  test("sin animación no hay aviso y se muestran advertencias de GIF de la página", async t => {
    const h = await mount(t, { url: "https://cdn.test/full.png", mimeType: "image/png" }, { pageObjectId: "p", builds: [], warnings: ["gif-fallback"] });
    await h.tick(20);
    assert.deepEqual(h.srcs(), ["https://cdn.test/full.png"]);
    assert.doesNotMatch(h.text(), /Animación no disponible/);
    assert.match(h.text(), /imagen estática de respaldo; la animación no está garantizada/);
  });
});
