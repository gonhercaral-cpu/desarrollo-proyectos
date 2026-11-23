import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const layer = text => ({ type: "answer", text, x: 10, y: 20, width: 40, height: 10, color: "#102954", fontSize: 3 });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

function fixture(music) {
  const m = structuredClone(example); m.resources[0].download.mimeType = "image/png";
  m.slides.forEach(slide => { slide.metadata.presentationResourceId = m.mainPresentationId; slide.metadata.pageNumber = 1; slide.resourceIds = []; });
  Object.assign(m.slides[0], { interactionMode: "builds", buildCount: 3, interaction: { mode: "builds", buildCount: 3, source: "manual" }, builds: Array.from({ length: 3 }, (_, index) => ({ order: index + 1, layers: [layer(`Respuesta ${index + 1}`)] })) });
  const base = m.resources.find(resource => resource.resourceId === "drive-audio");
  const add = (id, name, mime) => { const resource = structuredClone(base); Object.assign(resource, { resourceId: id, name }); resource.download.mimeType = mime; m.resources.push(resource); };
  add("audio-a", "A.mp3", "audio/mpeg"); add("clip", "Clip.mp4", "video/mp4");
  m.slides[0].resourceIds = ["uploaded-guide", "audio-a", "clip"];
  if (music) { m.backgroundMusic = [{ id: "bg", resourceId: "bg", sourceType: "file", title: "Ambiente", order: 0 }]; add("bg", "bg.mp3", "audio/mpeg"); }
  return m;
}
function environment(t) {
  const dom = new JSDOM("<div id='teacher'></div><input>", { url: "http://tauri.localhost" });
  const previous = new Map();
  for (const name of ["window", "document"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] }); }
  const proto = dom.window.HTMLMediaElement.prototype;
  t.mock.method(proto, "load", () => {});
  t.mock.method(proto, "play", function () { Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new dom.window.Event("play")); return Promise.resolve(); });
  t.mock.method(proto, "pause", function () { Object.defineProperty(this, "paused", { configurable: true, value: true }); this.dispatchEvent(new dom.window.Event("pause")); });
  t.mock.method(dom.window.Element.prototype, "getBoundingClientRect", function () {
    return this.hasAttribute("data-browser-host") ? { left: 0, top: 90, width: 1000, height: 600, x: 0, y: 90 } : { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0 };
  });
  dom.teardown = () => { dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } };
  return dom;
}
function visual(kind = "image") {
  return { kind, mounts: 0, destroyed: false, async mount(host, source, options) { this.mounts++; host.textContent = kind; options.onState(initialRendererState()); }, async setSource() {}, setPage() {}, command() {}, seek() {}, setVolume() {}, destroy() { this.destroyed = true; } };
}
// Mirrors MediaRenderer's contract: PLAY_PAUSE toggles and nothing starts by itself.
function media(kind) {
  return {
    kind, commands: [], destroyed: false, state: initialRendererState(),
    async mount(host, source, options) { this.options = options; this.emit({ duration: 100, volume: options.volume, muted: options.muted }); },
    emit(update) { if (this.destroyed) return; this.state = { ...this.state, ...update }; this.options.onState({ ...this.state }); },
    async command(command) { this.commands.push(command); if (command === "PLAY_PAUSE") this.emit({ playing: !this.state.playing }); },
    seek() {}, setVolume() {}, setPage() {}, destroy() { this.destroyed = true; },
  };
}
function fakeBrowser() {
  const calls = [], state = { open: false, url: "", title: "", loading: false, presenting: false };
  const bridge = { calls, state, names: () => calls.map(call => call.name) };
  for (const name of ["open", "navigate", "back", "forward", "reload", "layout", "present", "returnToHost", "status", "close"]) {
    bridge[name] = async (...args) => {
      calls.push({ name, args });
      if (name === "open") Object.assign(state, { open: true, url: args[0], title: "Sitio" });
      if (name === "close") Object.assign(state, { open: false, url: "", title: "", presenting: false });
      return { ...state };
    };
  }
  return bridge;
}
function harness(t, options = {}) {
  const dom = environment(t);
  const m = fixture(options.music);
  // Mix mode: the ambient music keeps playing next to class audio, so only the browser can be what pauses it.
  if (options.music) window.localStorage.setItem("active-classroom-settings:v1", JSON.stringify({ pauseBackgroundMusic: false }));
  const teacher = document.querySelector("#teacher");
  const monitors = [{ id: "m1", name: "Portátil", primary: true, width: 1920, height: 1080, x: 0, y: 0, scaleFactor: 1 }, { id: "m2", name: "Proyector", primary: false, width: 1280, height: 720, x: 1920, y: 0, scaleFactor: 1 }];
  const projection = { projecting: !!options.projecting, hides: 0, snapshots: [] };
  const projectionBridge = {
    async status() { return { monitors, projecting: projection.projecting, disconnected: false }; },
    async show() { projection.projecting = true; }, async hide() { projection.hides++; projection.projecting = false; },
    async publish(snapshot) { projection.snapshots.push(snapshot); },
  };
  const browser = fakeBrowser();
  const display = visual("image"), audios = [], videos = [];
  const classroom = { manifest: m, resolveResource(id) { const resource = m.resources.find(item => item.resourceId === id); return { path: `/cache/${id}`, mimeType: resource.download.mimeType, name: resource.name, kind: "x" }; } };
  let exits = 0;
  const player = new ClassroomPlayer(teacher, classroom, () => { exits++; }, {
    verifyResource: async () => true, toUrl: path => `asset://localhost${path}`, projectionBridge,
    ...(options.withoutBrowser ? {} : { browserBridge: browser }),
    createRenderer: async kind => {
      if (kind === "audio") { const stub = media("audio"); audios.push(stub); return stub; }
      if (kind === "video") { const stub = media("video"); videos.push(stub); return stub; }
      return kind === "image" ? display : visual(kind);
    },
  });
  t.after(() => { player.destroy(); dom.teardown(); });
  const query = selector => teacher.querySelector(selector);
  return {
    player, teacher, browser, projection, display, audios, videos, query, get exits() { return exits; },
    open: async id => { query(`[data-resource='${id}']`).click(); await settle(); },
    openBrowser: async () => { query("[data-browser-open]").click(); await settle(); },
    closeBrowser: async () => { query("[data-browser-close]").click(); await settle(); },
    visit: async (url = "example.com") => { query("[data-browser-url]").value = url; query("[data-browser-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await settle(); },
    advance: async () => { await player.dispatch("ADVANCE"); await settle(); },
    ambient: () => teacher.querySelector("[data-background-music] audio"),
  };
}
const key = (name, extra = {}) => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));

test("la cabecera mantiene el reloj y añade el botón Navegador web; el overlay vive dentro del root", async t => {
  const h = harness(t); await settle();
  const clock = h.query("time[data-teacher-clock]");
  assert.ok(clock); assert.ok(clock.textContent.length > 0);
  const button = h.query(".player-header [data-browser-open]");
  assert.match(button.textContent, /Navegador web/);
  assert.ok(h.teacher.contains(h.query("[data-browser-tool]"))); assert.equal(h.query("[data-browser-tool]").hidden, true);
  assert.equal(h.query("iframe"), null);
});

test("abrir y cerrar el navegador conserva la diapositiva, los builds, los nodos y las pestañas", async t => {
  const h = harness(t); await settle();
  await h.advance();
  assert.equal(h.player.controller.currentBuild, 1);
  const controller = h.player.controller, nodes = [h.query("[data-renderer]"), h.query(".player-renderer-content"), h.query(".interaction-surface"), h.query("[data-slides]"), h.query("[data-teacher-workspace]"), h.query("#tab-music")];
  const before = { resource: controller.selectedResourceId, slide: controller.slideIndex, build: controller.currentBuild, mounts: h.display.mounts };
  h.query("#tab-music").click();
  const activeTab = () => h.query(".player-tab.is-active").id;
  assert.equal(activeTab(), "tab-music");
  await h.openBrowser();
  assert.equal(h.query("[data-browser-tool]").hidden, false); assert.equal(h.player.controller, controller);
  await h.visit();
  assert.equal(h.browser.state.open, true); assert.equal(h.browser.calls[0].args[1].width, 1000);
  await h.closeBrowser();
  assert.deepEqual({ resource: controller.selectedResourceId, slide: controller.slideIndex, build: controller.currentBuild, mounts: h.display.mounts }, before);
  assert.equal(h.display.destroyed, false);
  assert.deepEqual([h.query("[data-renderer]"), h.query(".player-renderer-content"), h.query(".interaction-surface"), h.query("[data-slides]"), h.query("[data-teacher-workspace]"), h.query("#tab-music")], nodes);
  assert.match(h.query(".interaction-surface").textContent, /Respuesta 1/);
  assert.equal(activeTab(), "tab-music");
  assert.equal(document.activeElement, h.query("[data-browser-open]"));
  assert.equal(h.browser.names().at(-1), "close");
});

test("al abrir pausa audio, video en reproducción, música ambiente y proyección, y al cerrar no reanuda nada", async t => {
  const h = harness(t, { music: true, projecting: true }); await settle();
  assert.equal(h.player.controller.slideIndex, 0);
  await h.open("audio-a"); const [audio] = h.audios;
  h.query("[data-audio-cmd='PLAY_PAUSE']").click(); await settle(); assert.equal(audio.state.playing, true);
  h.query("[data-music-play]").click(); await settle(); assert.equal(h.ambient().paused, false);
  assert.equal(h.projection.projecting, true);
  await h.openBrowser();
  assert.equal(audio.state.playing, false); assert.deepEqual(audio.commands, ["PLAY_PAUSE", "PLAY_PAUSE"]);
  assert.equal(h.ambient().paused, true);
  assert.equal(h.projection.hides, 1); assert.equal(h.projection.projecting, false);
  await h.closeBrowser(); await settle();
  assert.equal(audio.state.playing, false); assert.deepEqual(audio.commands, ["PLAY_PAUSE", "PLAY_PAUSE"]);
  assert.equal(h.ambient().paused, true); assert.equal(h.projection.projecting, false); assert.equal(h.projection.hides, 1);
  assert.equal(h.audios.length, 1);
});

test("un video en reproducción se pausa y uno ya pausado no recibe comandos; no hay autoplay al volver", async t => {
  const h = harness(t); await settle();
  await h.open("clip"); const [video] = h.videos;
  assert.equal(video.state.playing, false);
  await h.openBrowser();
  assert.deepEqual(video.commands, [], "pausado: sin comandos");
  await h.closeBrowser(); assert.deepEqual(video.commands, []); assert.equal(video.state.playing, false);
  video.emit({ playing: true });
  await h.openBrowser();
  assert.deepEqual(video.commands, ["PLAY_PAUSE"]); assert.equal(video.state.playing, false);
  await h.closeBrowser(); await settle();
  assert.deepEqual(video.commands, ["PLAY_PAUSE"]); assert.equal(video.state.playing, false);
  assert.equal(h.videos.length, 1); assert.equal(video.destroyed, false);
});

test("con el navegador activo se ignoran los atajos y comandos de clase; Escape solo cierra el overlay", async t => {
  const h = harness(t); await settle();
  await h.advance(); assert.equal(h.player.controller.currentBuild, 1);
  await h.openBrowser();
  await h.player.dispatch("ADVANCE"); await h.player.dispatch("BACK"); await h.player.dispatch("PROJECT"); await h.player.dispatch("ESCAPE");
  key("ArrowRight"); key("ArrowLeft"); key(" "); key("f"); await settle();
  assert.equal(h.player.controller.currentBuild, 1); assert.equal(h.exits, 0); assert.equal(h.projection.hides, 0);
  key("Escape"); await settle();
  assert.equal(h.query("[data-browser-tool]").hidden, true); assert.equal(h.exits, 0);
  assert.equal(document.activeElement, h.query("[data-browser-open]"));
  await h.advance(); assert.equal(h.player.controller.currentBuild, 2, "los comandos vuelven al cerrar");
});

test("destroy libera el backend con la página abierta, también si hay un open pendiente, y es idempotente", async t => {
  const h = harness(t); await settle();
  await h.openBrowser(); await h.visit();
  h.player.destroy(); await settle();
  assert.equal(h.browser.names().at(-1), "close"); assert.equal(h.browser.state.open, false);
  assert.equal(h.teacher.querySelector("[data-browser-tool]"), null);
  const calls = h.browser.calls.length; h.player.destroy(); await settle(); assert.equal(h.browser.calls.length, calls);
});

test("destroy con open pendiente cierra el backend cuando el open termina", async t => {
  const h = harness(t); await settle();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const open = h.browser.open; h.browser.open = async (...args) => { await gate; return open(...args); };
  await h.openBrowser();
  h.query("[data-browser-url]").value = "example.com"; h.query("[data-browser-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  h.player.destroy(); release(); await settle();
  assert.equal(h.browser.state.open, false); assert.equal(h.browser.names().at(-1), "close");
});

test("sin Tauri el overlay avisa y la clase no se toca: nada se pausa ni se oculta", async t => {
  const h = harness(t, { withoutBrowser: true, projecting: true }); await settle();
  await h.open("audio-a"); const [audio] = h.audios;
  h.query("[data-audio-cmd='PLAY_PAUSE']").click(); await settle(); assert.equal(audio.state.playing, true);
  await h.openBrowser();
  assert.equal(h.query("[data-browser-tool]").hidden, false);
  assert.match(h.query("[data-browser-note]").textContent, /aplicación de escritorio/);
  assert.equal(audio.state.playing, true); assert.equal(h.projection.hides, 0);
  key("Escape"); await settle();
  assert.equal(h.query("[data-browser-tool]").hidden, true); assert.equal(h.exits, 0);
});


test("un play de video que termina tarde no reproduce detrás del navegador", async t => {
  const h = harness(t); await settle();
  await h.open("clip"); const [video] = h.videos;
  await h.openBrowser(); video.emit({ playing: true }); await settle();
  assert.equal(video.state.playing, false);
  assert.equal(video.commands.at(-1), "PLAY_PAUSE");
  await h.closeBrowser(); assert.equal(video.state.playing, false);
});
