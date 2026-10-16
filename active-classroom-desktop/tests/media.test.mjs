import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { assertLocalUrl } from "../src/player/local-source.ts";
import { mediaErrorMessage, safeMediaUrl } from "../src/player/media-diagnostics.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";

test("ruta multimedia exige loopback, grant opaco y ninguna ruta libre", () => {
  assert.doesNotThrow(() => assertLocalUrl(`http://127.0.0.1:12345/media/${"a".repeat(64)}`));
  for (const url of ["http://localhost:1234/media/abc", "http://127.0.0.1:1234/etc/passwd", `http://127.0.0.1:1234/media/${"a".repeat(64)}?path=/etc/passwd`, `http://user:secret@127.0.0.1:1234/media/${"a".repeat(64)}`, `http://127.0.0.1.evil:1234/media/${"a".repeat(64)}`]) assert.throws(() => assertLocalUrl(url));
  assert.equal(safeMediaUrl(`http://127.0.0.1:12345/media/${"a".repeat(64)}`), "http://127.0.0.1:12345/media/[local-grant]");
  assert.equal(safeMediaUrl("asset://localhost/private/home/hash"), "asset://localhost/[cache-file]");
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
  const dom = new JSDOM("<div id='host'></div>");
  const previous = new Map();
  for (const name of ["window", "document", "HTMLVideoElement"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] }); }
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
