import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { rendererKind, initialRendererState } from "../src/player/types.ts";
import { PlayerController } from "../src/player/controller.ts";
import { shortcutFor } from "../src/player/shortcuts.ts";
import { assertLocalUrl, localSource } from "../src/player/local-source.ts";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { ImageRenderer } from "../src/player/renderers/ImageRenderer.ts";
import { AudioRenderer } from "../src/player/renderers/AudioRenderer.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";
import { PdfRenderer } from "../src/player/renderers/Presentation/PdfRenderer.ts";
import { createRenderer } from "../src/player/renderers/factory.ts";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { openLocalClass } from "../src/offline/sync.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
const fixture = () => {
  const manifest = structuredClone(example);
  manifest.resources[0].download.mimeType = "application/pdf";
  return manifest;
};
async function waitFor(condition) {
  const end = Date.now() + 2000;
  while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(condition(), "Estado esperado no llegó");
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function dom(t) {
  const instance = new JSDOM("<!doctype html><div id='app'></div>", { url: "http://tauri.localhost" });
  const previous = new Map(); const cleanups = [];
  for (const name of ["window", "document", "HTMLVideoElement", "ResizeObserver"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "ResizeObserver" ? class { observe() {} disconnect() {} } : instance.window[name] });
  }
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    instance.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { root: document.querySelector("#app"), window: instance.window, cleanup: (callback) => cleanups.push(callback) };
}
function localClass(manifest = fixture()) {
  return { manifest, resolveResource(id) {
    const resource = manifest.resources.find((item) => item.resourceId === id);
    if (!resource) throw new Error("ausente");
    return { path: `/cache/${resource.download.checksums.sha256}`, name: resource.name, mimeType: resource.download.mimeType, kind: resource.kind };
  } };
}
const toUrl = (path) => `asset://localhost${path}`;
function rendererDouble(kind = "pdf") {
  return { kind, destroyed: false, pages: [], commands: [],
    async mount(host, source, options) { this.options = options; this.source = source; host.textContent = source.name; options.onState({ ...initialRendererState(), page: options.page, pages: 5 }); },
    setPage(page) { this.pages.push(page); }, command(command) { this.commands.push(command); }, seek() {}, setVolume() {}, destroy() { this.destroyed = true; } };
}

test("renderer usa MIME descargado; formatos permitidos y Office desconocido seguro", () => {
  const cases = { "application/pdf": "pdf", "IMAGE/PNG; charset=utf-8": "image", "image/jpeg": "image", "image/webp": "image", "audio/mpeg": "audio", "audio/x-wav": "audio", "audio/mp4": "audio", "audio/ogg": "audio", "video/mp4": "video", "video/webm": "video", "text/html": "unsupported", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "unsupported", "application/octet-stream": "unsupported" };
  for (const [mime, kind] of Object.entries(cases)) assert.equal(rendererKind(mime), kind);
  const local = localClass();
  assert.equal(localSource(local, local.manifest.mainPresentationId, toUrl).mimeType, "application/pdf");
});

test("orden del manifest y asociaciones siguen slide seleccionada, incluida página explícita", () => {
  const manifest = fixture(); manifest.slides[1].metadata.pageNumber = 4;
  const controller = new PlayerController(manifest);
  assert.equal(controller.presentationPage, 1);
  controller.moveSlide(1);
  assert.equal(controller.presentationPage, 4);
  assert.deepEqual(controller.associatedIds, manifest.slides[1].resourceIds);
  controller.moveSlide(1); assert.equal(controller.slideIndex, 1);
  controller.moveSlide(-1); assert.equal(controller.slideIndex, 0);
  controller.pageChanged(3); assert.equal(controller.slideIndex, null); assert.deepEqual(controller.associatedIds, []);
  controller.pageChanged(4); assert.equal(controller.slideIndex, 1);
  assert.deepEqual(manifest.generalResourceIds, ["uploaded-guide"]);
});

test("abrir PDF asociado y volver conserva posición de clase y del recurso", () => {
  const controller = new PlayerController(fixture()); controller.goSlide(1);
  controller.selectResource("uploaded-guide"); controller.pageChanged(7);
  controller.returnToPresentation(); assert.equal(controller.page, 2); assert.equal(controller.slideIndex, 1);
  controller.selectResource("uploaded-guide"); assert.equal(controller.page, 7);
});

test("manifest inconsistente falla antes de montar Player", () => {
  for (const change of [m => { m.slides = []; }, m => { m.slides[1].index = 0; }, m => { m.slides[0].metadata.pageNumber = -1; }, m => { m.mainPresentationId = "missing"; }, m => { m.slides[0].resourceIds.push("missing"); }]) {
    const manifest = fixture(); change(manifest); assert.throws(() => new PlayerController(manifest), /Manifest inconsistente/);
  }
});

test("shortcuts ignoran campos editables, notas, composición, modificadores y espacio en botón", (t) => {
  const { window } = dom(t);
  const command = (key, target = document.body, extra = {}) => shortcutFor({ key, target, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, isComposing: false, ...extra });
  for (const [key, expected] of Object.entries({ ArrowLeft: "PREVIOUS", ArrowRight: "NEXT", " ": "PLAY_PAUSE", J: "SEEK_BACKWARD", l: "SEEK_FORWARD", ArrowUp: "VOLUME_UP", ArrowDown: "VOLUME_DOWN", m: "MUTE", F: "FULLSCREEN", Escape: "ESCAPE" })) assert.equal(command(key), expected);
  for (const html of ["<input>", "<textarea></textarea>", "<select></select>", "<div contenteditable><span>notas</span></div>", "<div role='textbox'></div>"]) {
    document.body.innerHTML = html; assert.equal(command("ArrowRight", document.body.lastChild.lastChild || document.body.lastChild), null);
  }
  assert.equal(command("m", document.body, { ctrlKey: true }), null);
  assert.equal(command("m", document.body, { isComposing: true }), null);
  assert.equal(command(" ", window.document.createElement("button")), null);
});

test("resolvedor rechaza Internet, ruta remota y MIME inconsistente", () => {
  for (const url of ["https://drive.google.com/file.pdf", "https://asset.localhost.evil/file", "file:///cache/a", "data:application/pdf,anything", "javascript:alert(1)"]) assert.throws(() => assertLocalUrl(url));
  assert.doesNotThrow(() => assertLocalUrl("asset://localhost/cache/hash"));
  assert.doesNotThrow(() => assertLocalUrl("http://asset.localhost/cache/hash"));
  const local = localClass(); const resolve = local.resolveResource;
  local.resolveResource = (id) => ({ ...resolve(id), mimeType: "text/html" });
  assert.throws(() => localSource(local, local.manifest.mainPresentationId, toUrl), /MIME/);
  assert.throws(() => localSource(localClass(), "missing", toUrl), /ausente/);
});

test("Player opera offline, navega, conserva presentación y libera renderer al cerrar", async (t) => {
  const { root, window, cleanup } = dom(t); const renderers = [];
  t.mock.method(globalThis, "fetch", () => { throw new Error("Internet prohibido"); });
  const player = new ClassroomPlayer(root, localClass(), () => {}, { verifyResource: async () => true, toUrl, createRenderer: async (kind) => { const renderer = rendererDouble(kind); renderers.push(renderer); return renderer; } });
  cleanup(() => player.destroy()); await tick();
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true })); await tick();
  assert.equal(player.controller.slideIndex, 1); assert.deepEqual(renderers[0].pages, [2]);
  assert.equal(root.querySelectorAll("[data-associated] button").length, 2);
  root.querySelector("[data-general] button").click(); await tick();
  assert.equal(renderers[0].destroyed, true);
  await player.dispatch("NEXT"); assert.deepEqual(renderers[1].commands, ["NEXT"]);
  renderers[1].options.onPage(4);
  root.querySelector("[data-presentation]").click(); await tick();
  assert.equal(player.controller.page, 2); assert.equal(renderers[2].options.page, 2);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  player.destroy(); assert.equal(renderers[2].destroyed, true); assert.equal(root.childElementCount, 0);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" })); assert.equal(player.controller.slideIndex, 1);
});

test("cambio rápido y cierre durante verificación no montan recursos obsoletos", async (t) => {
  const { root } = dom(t); const gate = deferred(); const renderers = [];
  const player = new ClassroomPlayer(root, localClass(), () => {}, { verifyResource: async (id) => id === "drive-presentation" ? gate.promise : true, toUrl, createRenderer: async (kind) => { const renderer = rendererDouble(kind); renderers.push(renderer); return renderer; } });
  root.querySelector("[data-general] button").click(); await tick();
  assert.equal(renderers.length, 1); assert.equal(renderers[0].source.name, "Guide.pdf");
  player.destroy(); gate.resolve(true); await tick();
  assert.equal(renderers.length, 1); assert.equal(renderers[0].destroyed, true);
});

test("archivo faltante/corrupto no cierra Unit; otro recurso continúa disponible", async (t) => {
  const { root, cleanup } = dom(t);
  const player = new ClassroomPlayer(root, localClass(), () => {}, { verifyResource: async (id) => id !== "drive-presentation", toUrl, createRenderer: async (kind) => rendererDouble(kind) });
  cleanup(() => player.destroy()); await tick();
  assert.match(root.querySelector("[role='alert']").textContent, /ausente o corrupto/);
  root.querySelector("[data-general] button").click(); await tick();
  assert.equal(root.querySelector("[data-status]").hidden, true);
  assert.equal(root.querySelector("[data-unit]").textContent, fixture().unit.name);
});

test("imagen inválida y formato no compatible informan error recuperable", async (t) => {
  const { root, window } = dom(t); const states = []; const options = { page: 1, volume: .8, muted: false, onState: state => states.push(state), onPage() {} };
  const renderer = new ImageRenderer();
  await renderer.mount(root, { url: "asset://localhost/image", name: "Imagen", mimeType: "image/png", sizeBytes: 1 }, options);
  root.querySelector("img").dispatchEvent(new window.Event("error")); assert.match(states.at(-1).error, /corrupta/);
  renderer.command("PLAY_PAUSE"); renderer.destroy(); assert.equal(root.childElementCount, 0);
  const unsupported = await createRenderer("unsupported"); await unsupported.mount(root, { mimeType: "application/x-unknown" }, options);
  assert.match(states.at(-1).error, /no compatible/); unsupported.destroy();
});

for (const Renderer of [AudioRenderer, VideoRenderer]) test(`${Renderer.name}: reproducción, stop, seek, volumen, mute, error y limpieza`, async (t) => {
  const { root, window } = dom(t); const prototype = window.HTMLMediaElement.prototype;
  t.mock.method(prototype, "load", () => {});
  let paused = true;
  t.mock.method(prototype, "play", async function () { paused = false; this.dispatchEvent(new window.Event("play")); });
  t.mock.method(prototype, "pause", function () { paused = true; this.dispatchEvent(new window.Event("pause")); });
  Object.defineProperty(prototype, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(prototype, "duration", { configurable: true, get: () => 60 });
  const renderer = new Renderer(); const states = [];
  await renderer.mount(root, { url: "asset://localhost/media", name: "Local", mimeType: "audio/mp4", sizeBytes: 1 }, { page: 1, volume: .8, muted: false, onState: state => states.push(state), onPage() {} });
  const media = root.querySelector("audio,video"); media.dispatchEvent(new window.Event("loadedmetadata"));
  await renderer.command("PLAY_PAUSE"); assert.equal(states.at(-1).playing, true);
  await renderer.command("PLAY_PAUSE"); assert.equal(states.at(-1).playing, false);
  await renderer.command("SEEK_FORWARD"); assert.equal(media.currentTime, 10);
  renderer.seek(58); await renderer.command("SEEK_FORWARD"); assert.equal(media.currentTime, 60);
  await renderer.command("SEEK_BACKWARD"); assert.equal(media.currentTime, 50);
  await renderer.command("STOP"); assert.equal(media.currentTime, 0);
  renderer.setVolume(.95); await renderer.command("VOLUME_UP"); assert.equal(media.volume, 1);
  await renderer.command("VOLUME_DOWN"); assert.equal(media.volume, .9);
  await renderer.command("MUTE"); assert.equal(media.muted, true);
  await renderer.command("NEXT"); assert.equal(media.currentTime, 0);
  media.dispatchEvent(new window.Event("error")); assert.match(states.at(-1).error, /códec/);
  renderer.destroy(); assert.equal(media.hasAttribute("src"), false); assert.equal(media.isConnected, false); assert.equal(paused, true);
});

test("PDF interno navega páginas, ajusta canvas, ignora comandos no aplicables y valida límites", async (t) => {
  const { root } = dom(t); const states = []; const pages = []; let destroyed = false;
  t.mock.method(globalThis, "fetch", async (url) => { assertLocalUrl(url); return new Response(new Uint8Array([1, 2, 3])); });
  const proxy = { numPages: 3, async getPage() { return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }; } };
  const renderer = new PdfRenderer(async () => ({ promise: Promise.resolve(proxy), async destroy() { destroyed = true; } }));
  await renderer.mount(root, { url: "asset://localhost/doc", name: "PDF", mimeType: "application/pdf", sizeBytes: 3 }, { page: 1, volume: .8, muted: false, onState: state => states.push(state), onPage: page => pages.push(page) });
  assert.equal(root.querySelector("canvas").getAttribute("aria-label"), "Página 1 de 3");
  await renderer.command("NEXT"); assert.equal(states.at(-1).page, 2); assert.deepEqual(pages, [2]);
  await renderer.setPage(3); assert.deepEqual(pages, [2]);
  await renderer.command("NEXT"); assert.equal(states.at(-1).page, 3);
  await renderer.command("PREVIOUS"); assert.equal(states.at(-1).page, 2);
  await renderer.command("PLAY_PAUSE"); assert.equal(states.at(-1).playing, false);
  await renderer.setPage(9); assert.match(states.at(-1).error, /Página 9 ausente/);
  await renderer.setPage(1); assert.equal(states.at(-1).error, "");
  renderer.destroy(); assert.equal(destroyed, true);
});

test("PDF conserva navegación solicitada mientras abre y descarta renders atrasados", async (t) => {
  const { root } = dom(t); const documentReady = deferred(); const firstRender = deferred();
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1])));
  const proxy = { numPages: 3, async getPage(number) { return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: number === 2 ? firstRender.promise : Promise.resolve(), cancel() {} }) }; } };
  const renderer = new PdfRenderer(async () => ({ promise: documentReady.promise, async destroy() {} }));
  const mounting = renderer.mount(root, { url: "asset://localhost/doc", sizeBytes: 1 }, { page: 1, volume: .8, muted: false, onState() {}, onPage() {} });
  await tick(); await renderer.setPage(2); documentReady.resolve(proxy); await tick();
  await renderer.setPage(3); firstRender.resolve(); await mounting;
  assert.equal(root.querySelector("canvas").getAttribute("aria-label"), "Página 3 de 3"); renderer.destroy();
});

test("PDF faltante, tamaño corrupto y documento malformado muestran error sin lanzar", async (t) => {
  const { root } = dom(t);
  for (const [response, error] of [[new Response("", { status: 404 }), /ausente/], [new Response(new Uint8Array([1, 2])), /incompleto o corrupto/], [new Response(new Uint8Array([1])), /corrupto/]]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response); const states = [];
    const renderer = new PdfRenderer(async () => ({ promise: Promise.reject(new Error("PDF corrupto")), async destroy() {} }));
    await renderer.mount(root, { url: "asset://localhost/doc", sizeBytes: 1 }, { page: 1, volume: .8, muted: false, onState: state => states.push(state), onPage() {} });
    assert.match(states.at(-1).error, error); renderer.destroy(); mock.mock.restore();
  }
});

test("reinicio con manifest en disco permite abrir Player offline y detecta corrupción posterior", async (t) => {
  const { root, cleanup } = dom(t); const directory = await mkdtemp(join(tmpdir(), "ac-player-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = fixture();
  for (const resource of manifest.resources) {
    const bytes = new TextEncoder().encode(resource.resourceId); const hash = await sha256(bytes);
    resource.download.checksums.sha256 = hash; resource.download.sizeBytes = bytes.length;
    await writeFile(join(directory, hash), bytes);
  }
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  // Fresh adapter and re-read files simulate restart. Native Rust verification remains separately required.
  const verify = async (hash, size) => { try { const bytes = await readFile(join(directory, hash)); return bytes.length === size && await sha256(bytes) === hash; } catch { return false; } };
  const cache = { async open() {
    const saved = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); const paths = {};
    for (const resource of saved.resources) { assert.equal(await verify(resource.download.checksums.sha256, resource.download.sizeBytes), true); paths[resource.resourceId] = join(directory, resource.download.checksums.sha256); }
    return { manifest: saved, paths };
  } };
  t.mock.method(globalThis, "fetch", () => { throw new Error("Sin Internet"); });
  const classroom = await openLocalClass(cache, manifest.unit.unitId, manifest.version);
  const player = new ClassroomPlayer(root, classroom, () => {}, { toUrl: () => "asset://localhost/cache/file", createRenderer: async kind => rendererDouble(kind), verifyResource: async id => { const resource = manifest.resources.find(item => item.resourceId === id); return verify(resource.download.checksums.sha256, resource.download.sizeBytes); } });
  cleanup(() => player.destroy()); await waitFor(() => root.querySelector("[data-status]").hidden);
  assert.equal(root.querySelector("[data-status]").hidden, true);
  await writeFile(join(directory, manifest.resources[1].download.checksums.sha256), "corrupto");
  root.querySelector("[data-general] button").click(); await tick(); await tick();
  // Disk hashing is async; wait for completion without relying on a fixed timer.
  await waitFor(() => root.querySelector("[role='alert']"));
  assert.match(root.querySelector("[role='alert']").textContent, /corrupto/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("fullscreen y Escape respetan presentación, recurso y cierre de clase", async (t) => {
  const { root, cleanup } = dom(t); let fullscreen = null; let exited = false;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
  document.exitFullscreen = async () => { fullscreen = null; };
  const player = new ClassroomPlayer(root, localClass(), () => { exited = true; }, { verifyResource: async () => true, toUrl, createRenderer: async kind => rendererDouble(kind) });
  cleanup(() => player.destroy()); await tick();
  const shell = root.querySelector(".classroom-player"); shell.requestFullscreen = async () => { fullscreen = shell; };
  await player.dispatch("FULLSCREEN"); assert.equal(fullscreen, shell);
  await player.dispatch("ESCAPE"); assert.equal(fullscreen, null); assert.equal(exited, false);
  root.querySelector("[data-general] button").click(); await tick();
  await player.dispatch("ESCAPE"); assert.equal(player.controller.isPresentation, true); assert.equal(exited, false);
  await player.dispatch("ESCAPE"); assert.equal(exited, true);
});

test("PDF.js real decodifica y dibuja PDF local de dos páginas; rechaza bytes corruptos", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const stream = "1 0 0 rg 0 0 200 200 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 5 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const task = getDocument({ data: new TextEncoder().encode(pdf) });
  try {
    const document = await task.promise; assert.equal(document.numPages, 2);
    const page = await document.getPage(2); const canvas = createCanvas(200, 200);
    await page.render({ canvas, viewport: page.getViewport({ scale: 1 }) }).promise;
    assert.deepEqual([...canvas.getContext("2d").getImageData(100, 100, 1, 1).data], [255, 0, 0, 255]);
  } finally { await task.destroy(); }
  const bad = getDocument({ data: new TextEncoder().encode("archivo corrupto") });
  try { await assert.rejects(bad.promise, /Invalid PDF/); } finally { await bad.destroy(); }
});
