import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { assertLocalUrl } from "../src/player/local-source.ts";
import { mediaErrorMessage, safeMediaUrl } from "../src/player/media-diagnostics.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";

async function mediaFixture(t, configure = () => {}) {
  const dom = new JSDOM("<div id='host'></div>", { url: "https://tauri.localhost" }); const previous = new Map();
  for (const name of ["window", "document", "HTMLVideoElement", "CustomEvent"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] }); }
  const renderer = new VideoRenderer();
  t.after(() => { renderer.destroy(); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const prototype = dom.window.HTMLMediaElement.prototype;
  configure(prototype, dom);
  const load = t.mock.method(prototype, "load", () => {}); const pause = t.mock.method(prototype, "pause", () => {});
  t.mock.method(prototype, "canPlayType", () => "probably");
  await renderer.mount(document.querySelector("#host"), { url: `http://127.0.0.1:1234/media/${"a".repeat(64)}`, name: "Local", mimeType: "video/mp4", sizeBytes: 100 }, { page: 1, volume: .8, muted: false, onPage() {}, onState() {} });
  return { dom, renderer, video: renderer.media, load, pause };
}
test("loadeddata/playing sin canplay no cierran video tras 20 segundos", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { dom, renderer, video, load, pause } = await mediaFixture(t); const src = video.src;
  Object.defineProperties(video, { readyState: { value: 2 }, paused: { value: false }, currentTime: { value: 1 } });
  video.dispatchEvent(new dom.window.Event("loadeddata")); video.dispatchEvent(new dom.window.Event("playing"));
  video.dispatchEvent(new dom.window.Event("waiting")); video.dispatchEvent(new dom.window.Event("stalled"));
  t.mock.timers.tick(25000);
  assert.equal(video.src, src); assert.equal(load.mock.callCount(), 1); assert.equal(pause.mock.callCount(), 0);
  assert.equal(renderer.state.error, ""); assert.equal(renderer.state.loading, false); assert.equal(renderer.state.buffering, true);
});
test("diagnóstico observa compositor sin actualizar Player por frame; detiene y libera callbacks", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] }); t.mock.method(console, "info", () => {});
  const queue = new Map(); let id = 0; let cancelled = 0;
  const { dom, renderer } = await mediaFixture(t, (_prototype, instance) => {
    instance.window.HTMLVideoElement.prototype.requestVideoFrameCallback = callback => { queue.set(++id, callback); return id; };
    instance.window.HTMLVideoElement.prototype.cancelVideoFrameCallback = key => { queue.delete(key); cancelled++; };
  });
  const states = []; renderer.options.onState = state => states.push(state);
  dom.window.localStorage.setItem("active-classroom-media-diagnostics", "true");
  for (let index = 1; index <= 20; index++) { const [key, callback] = queue.entries().next().value; queue.delete(key); callback(0, { presentedFrames: index, mediaTime: index / 30 }); }
  assert.equal(states.length, 0); assert.equal(queue.size, 1);
  dom.window.localStorage.setItem("active-classroom-media-diagnostics", "false");
  const [key, callback] = queue.entries().next().value; queue.delete(key); callback(0, { presentedFrames: 21, mediaTime: .7 }); assert.equal(queue.size, 0);
  dom.window.localStorage.setItem("active-classroom-media-diagnostics", "true"); t.mock.timers.tick(1000); assert.equal(queue.size, 1);
  renderer.destroy(); assert.equal(queue.size, 0); assert.equal(cancelled, 1);
});
test("preparación lenta mantiene reproductor; solo MediaError fatal lo detiene", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { dom, renderer, video, load } = await mediaFixture(t); const src = video.src;
  t.mock.timers.tick(25000); assert.equal(video.src, src); assert.equal(load.mock.callCount(), 1); assert.equal(renderer.state.error, "");
  video.dispatchEvent(new dom.window.Event("canplay")); assert.equal(renderer.state.loading, false);
  Object.defineProperty(video, "error", { value: { code: 3, message: "Decode failed" } }); video.dispatchEvent(new dom.window.Event("error"));
  assert.ok(renderer.state.error);
});
test("play AbortError temporal permite reintento sin destruir sesión ni src", async t => {
  const { renderer, video, load, pause } = await mediaFixture(t); const src = video.src;
  t.mock.method(video, "play", async () => { throw Object.assign(new Error("Play interrupted by seek"), { name: "AbortError" }); });
  await renderer.command("PLAY_PAUSE");
  assert.equal(renderer.state.error, ""); assert.equal(video.src, src); assert.equal(load.mock.callCount(), 1); assert.equal(pause.mock.callCount(), 0);
});
test("MEDIA_ERR_ABORTED no se convierte en fallo fatal ni desmonta video", async t => {
  const { dom, renderer, video, load, pause } = await mediaFixture(t); const src = video.src;
  Object.defineProperty(video, "error", { value: { code: 1, message: "Aborted" } }); video.dispatchEvent(new dom.window.Event("error"));
  assert.equal(renderer.state.error, ""); assert.equal(video.src, src); assert.equal(load.mock.callCount(), 1); assert.equal(pause.mock.callCount(), 0);
});

test("ruta multimedia exige loopback, grant opaco y ninguna ruta libre", () => {
  assert.doesNotThrow(() => assertLocalUrl(`http://127.0.0.1:12345/media/${"a".repeat(64)}`));
  for (const url of ["http://localhost:1234/media/abc", "http://127.0.0.1:1234/etc/passwd", `http://127.0.0.1:1234/media/${"a".repeat(64)}?path=/etc/passwd`, `http://user:secret@127.0.0.1:1234/media/${"a".repeat(64)}`, `http://127.0.0.1.evil:1234/media/${"a".repeat(64)}`]) assert.throws(() => assertLocalUrl(url));
  assert.equal(safeMediaUrl(`http://127.0.0.1:12345/media/${"a".repeat(64)}`), "http://127.0.0.1:12345/media/[local-grant]");
  assert.equal(safeMediaUrl("asset://localhost/private/home/hash"), "asset://localhost/[cache-file]");
});

test("J/L acumulan destino y coalescen; un seek en curso, src/elemento/load estables", async t => {
  const dom = new JSDOM("<div id='host'></div>", { url: "https://tauri.localhost" }); const previous = new Map();
  for (const name of ["window", "document", "HTMLVideoElement"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] }); }
  const renderer = new VideoRenderer(); t.after(() => { renderer.destroy(); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const prototype = dom.window.HTMLMediaElement.prototype; const load = t.mock.method(prototype, "load", () => {}); t.mock.method(prototype, "pause", () => {});
  await renderer.mount(document.querySelector("#host"), { url: `http://127.0.0.1:1234/media/${"a".repeat(64)}`, name: "Local", mimeType: "video/mp4", sizeBytes: 1024 * 1024 * 1024 }, { page: 1, volume: .8, muted: true, onPage() {}, onState() {} });
  const video = renderer.media; const url = video.src; let position = 20; let seeking = false; const writes = [];
  Object.defineProperties(video, { duration: { value: 300 }, seeking: { get: () => seeking }, currentTime: { get: () => position, set: value => { position = value; seeking = true; writes.push(value); } } }); video.dispatchEvent(new dom.window.Event("canplay"));
  for (let index = 0; index < 10; index++) await renderer.command("SEEK_FORWARD"); await new Promise(resolve => setTimeout(resolve, 110)); assert.deepEqual(writes, [120]);
  for (let index = 0; index < 10; index++) await renderer.command("SEEK_BACKWARD"); await new Promise(resolve => setTimeout(resolve, 110)); assert.deepEqual(writes, [120]);
  seeking = false; video.dispatchEvent(new dom.window.Event("seeked")); assert.deepEqual(writes, [120, 20]); seeking = false; video.dispatchEvent(new dom.window.Event("seeked"));
  assert.equal(video.src, url); assert.equal(document.querySelector("video"), video); assert.equal(load.mock.callCount(), 1); assert.equal(video.preload, "auto");
  Object.defineProperty(video,"paused",{value:false}); video.dispatchEvent(new dom.window.Event("waiting")); assert.equal(renderer.state.buffering,true);
  position = 20.5; video.dispatchEvent(new dom.window.Event("timeupdate")); assert.equal(renderer.state.buffering,false,"Reloj reanudado limpia waiting sin exigir otro playing");
  renderer.seek(999); await new Promise(resolve => setTimeout(resolve, 110)); assert.equal(writes.at(-1), 300);
});
test("MediaError distingue lectura, integridad, formato y soporte del equipo", () => {
  const classify = (code, mime = "probably", codecs = "probably", local) => mediaErrorMessage(code, mime, codecs, "video/mp4", local);
  assert.equal(classify(2), "No se pudo leer el video local");
  assert.equal(classify(4, "probably", "probably", "missing"), "El archivo no está disponible localmente");
  assert.equal(classify(3, "probably", "probably", "damaged"), "El archivo descargado está dañado");
  assert.equal(classify(4), "El formato de video no es compatible");
  assert.equal(classify(4, "maybe", ""), "Falta soporte multimedia en este equipo");
  assert.equal(classify(3, "", ""), "Falta soporte multimedia en este equipo");
  assert.equal(mediaErrorMessage(4, "maybe", "", "video/mp4", null, "probably"), "El formato de video no es compatible");
});
test("renderer registra eventos/código y MIME sin publicar grant ni URL sensible", async (t) => {
  const dom = new JSDOM("<div id='host'></div>", { url: "https://tauri.localhost" });
  dom.window.localStorage.setItem("active-classroom-media-diagnostics", "true");
  const previous = new Map();
  for (const name of ["window", "document", "HTMLVideoElement", "CustomEvent"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] }); }
  const renderer = new VideoRenderer();
  t.after(() => { renderer.destroy(); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const prototype = dom.window.HTMLMediaElement.prototype;
  t.mock.method(prototype, "load", () => {}); t.mock.method(prototype, "pause", () => {});
  t.mock.method(prototype, "canPlayType", () => "probably");
  const log = t.mock.method(console, "info", () => {}); const states = [];
  await renderer.mount(document.querySelector("#host"), { url: `http://127.0.0.1:1234/media/${"b".repeat(64)}`, name: "Video", mimeType: "video/mp4", sizeBytes: 100 }, { page: 1, volume: .8, muted: true, onPage() {}, onState: state => states.push(state) });
  const video = renderer.media;
  for (const event of ["loadstart", "loadedmetadata", "canplay", "stalled", "suspend"]) video.dispatchEvent(new dom.window.Event(event));
  Object.defineProperty(video, "error", { value: { code: 3, message: `Decode http://127.0.0.1:1234/media/${"b".repeat(64)}` } });
  video.dispatchEvent(new dom.window.Event("error"));
  assert.equal(states.at(-1).error, "El formato de video no es compatible");
  const diagnostics = log.mock.calls.map(call => call.arguments[1]);
  assert.equal(diagnostics.find(item => item.event === "error").mediaErrorCode, 3);
  assert.equal(diagnostics.find(item => item.event === "error").mime, "video/mp4");
  assert.ok(diagnostics.some(item => item.event === "canplay"));
  assert.ok(!JSON.stringify(diagnostics).includes("b".repeat(64)));
});
