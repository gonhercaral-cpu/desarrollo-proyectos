import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";
import { assignShortcut, audioSeekCollisions, defaultShortcuts, readShortcuts, SHORTCUTS_KEY } from "../src/player/shortcuts.ts";
import { desktopSettings, SETTINGS_KEY } from "../src/settings/preferences.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const layer = text => ({ type: "answer", text, x: 10, y: 20, width: 40, height: 10, color: "#102954", fontSize: 3 });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

function fixture() {
  const m = structuredClone(example); m.resources[0].download.mimeType = "image/png";
  m.slides.forEach(slide => { slide.metadata.presentationResourceId = m.mainPresentationId; slide.metadata.pageNumber = 1; slide.resourceIds = []; });
  Object.assign(m.slides[0], { interactionMode: "builds", buildCount: 3, interaction: { mode: "builds", buildCount: 3, source: "manual" }, builds: Array.from({ length: 3 }, (_, index) => ({ order: index + 1, layers: [layer(`Respuesta ${index + 1}`)] })) });
  const base = m.resources.find(resource => resource.resourceId === "drive-audio");
  for (const [id, name, mime] of [["audio-a", "A.mp3", "audio/mpeg"], ["audio-b", "B.mp3", "audio/mpeg"], ["clip", "Clip.mp4", "video/mp4"]]) {
    const resource = structuredClone(base); Object.assign(resource, { resourceId: id, name }); resource.download.mimeType = mime; m.resources.push(resource);
  }
  m.slides[0].resourceIds = ["uploaded-guide", "audio-a", "audio-b", "clip"];
  return m;
}
function environment(t) {
  const dom = new JSDOM("<div id='teacher'></div><input>", { url: "http://tauri.localhost" });
  const previous = new Map(); const cleanups = []; dom.cleanup = callback => cleanups.push(callback);
  for (const name of ["window", "document"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] }); }
  t.after(() => { for (const cleanup of cleanups) cleanup(); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  const proto = dom.window.HTMLMediaElement.prototype;
  t.mock.method(proto, "load", () => {});
  t.mock.method(proto, "play", function () { Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new dom.window.Event("play")); return Promise.resolve(); });
  t.mock.method(proto, "pause", function () { Object.defineProperty(this, "paused", { configurable: true, value: true }); this.dispatchEvent(new dom.window.Event("pause")); });
  return dom;
}
function visual(kind = "image") {
  return { kind, commands: [], async mount(host, source, options) { host.textContent = kind; options.onState(initialRendererState()); }, async setSource() {}, setPage() {}, command(command) { this.commands.push(command); }, seek() {}, setVolume() {}, destroy() {} };
}
// Mirrors MediaRenderer: seek() receives an absolute time, the SEEK_* commands add the video interval to the current time.
// deferSeek models the real renderer, which reports seeking:true first and the new time only after the decoder settles.
function media(kind, mountGates) {
  return {
    kind, id: "", commands: [], seeks: [], destroyed: false, deferSeek: false, state: initialRendererState(), host: null,
    async mount(host, source, options) {
      this.id = source.url.split("/").pop(); this.host = host; this.options = options;
      await mountGates.get(this.id);
      this.emit({ duration: 100, volume: options.volume, muted: options.muted });
    },
    emit(update) { if (this.destroyed) return; this.state = { ...this.state, ...update }; this.options.onState({ ...this.state }); },
    async command(command) {
      this.commands.push(command);
      if (command === "PLAY_PAUSE") this.emit({ playing: !this.state.playing });
      else if (command === "SEEK_FORWARD") this.seek(this.state.time + desktopSettings().seekIntervalSeconds);
      else if (command === "SEEK_BACKWARD") this.seek(this.state.time - desktopSettings().seekIntervalSeconds);
    },
    seek(time) {
      const target = Math.max(0, Math.min(this.state.duration, time)); this.seeks.push(target);
      if (this.deferSeek) this.emit({ seeking: true }); else this.emit({ time: target });
    },
    finishSeek() { this.emit({ time: this.seeks.at(-1), seeking: false }); },
    setVolume(volume) { this.emit({ volume }); }, setPage() {}, destroy() { this.destroyed = true; },
  };
}
function harness(t) {
  const dom = environment(t);
  const m = fixture();
  const teacher = document.querySelector("#teacher");
  const snapshots = [];
  const bridge = { async status() { return { monitors: [], projecting: true, disconnected: false }; }, async show() {}, async hide() {}, async publish(snapshot) { snapshots.push(snapshot); } };
  const mountGates = new Map(), gates = new Map();
  const hold = (map, id) => { let release; map.set(id, new Promise(resolve => { release = resolve; })); return release; };
  const display = visual("image"); const audios = [], videos = [], documents = [];
  const classroom = { manifest: m, resolveResource(id) { const resource = m.resources.find(item => item.resourceId === id); return { path: `/cache/${id}`, mimeType: resource.download.mimeType, name: resource.name, kind: "x" }; } };
  const player = new ClassroomPlayer(teacher, classroom, () => {}, {
    verifyResource: async id => { await gates.get(id); return true; },
    toUrl: path => `asset://localhost${path}`,
    projectionBridge: bridge,
    createRenderer: async kind => {
      if (kind === "audio") { const stub = media("audio", mountGates); audios.push(stub); return stub; }
      if (kind === "video") { const stub = media("video", mountGates); videos.push(stub); return stub; }
      if (kind === "image") return display;
      const stub = visual(kind); documents.push(stub); return stub;
    },
  });
  dom.cleanup(() => player.destroy());
  const query = selector => teacher.querySelector(selector);
  const open = async id => { query(`[data-resource='${id}']`).click(); await settle(); };
  const play = async () => { query("[data-audio-cmd='PLAY_PAUSE']").click(); await settle(); };
  return { dom, m, teacher, player, display, snapshots, audios, videos, documents, mountGates, gates, hold, query, open, play };
}
const press = (name, extra = {}, target = window) => { const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event; };
const configure = values => window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(values));
const visualState = h => ({ resource: h.player.controller.selectedResourceId, slide: h.player.controller.slideIndex, build: h.player.controller.currentBuild, presentation: h.player.controller.isPresentation, mounts: h.display.mounts, snapshots: h.snapshots.length });

test("J/L sin foco hacen seek del audio listo (5 atrás / 15 adelante), pausado y reproduciendo, sin tocar la presentación", async t => {
  const h = harness(t); await settle(); configure({ audioSeekBackwardSeconds: 5, audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 50 });
  const before = visualState(h);
  const forward = press("l"); await settle();
  assert.equal(forward.defaultPrevented, true); assert.equal(audio.state.time, 65);
  press("j"); await settle(); assert.equal(audio.state.time, 60);
  assert.deepEqual(audio.seeks, [65, 60]); assert.equal(audio.state.playing, false); assert.deepEqual(audio.commands, []);
  assert.equal(h.query("[data-audio-time]").textContent, "1:00 / 1:40");
  await h.play(); const commands = audio.commands.length; assert.equal(audio.state.playing, true);
  press("l"); await settle();
  assert.equal(audio.state.time, 75); assert.equal(audio.state.playing, true); assert.equal(audio.commands.length, commands);
  assert.deepEqual(visualState(h), before);
});

test("el seek se limita a 0..duración y no se pasa del final ni del inicio", async t => {
  const h = harness(t); await settle(); configure({ audioSeekBackwardSeconds: 30, audioSeekForwardSeconds: 30 });
  await h.open("audio-a"); const [audio] = h.audios;
  audio.emit({ time: 10 }); press("j"); await settle(); assert.equal(audio.state.time, 0);
  press("j"); await settle(); assert.equal(audio.state.time, 0);
  audio.emit({ time: 90 }); press("l"); await settle(); assert.equal(audio.state.time, 100);
  press("l"); await settle(); assert.equal(audio.state.time, 100); assert.equal(audio.state.duration, 100);
});

test("los intervalos de audio son independientes y heredan el de video cuando faltan", async t => {
  const h = harness(t); await settle(); configure({ seekIntervalSeconds: 9 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 50 });
  press("l"); await settle(); press("j"); await settle(); assert.deepEqual(audio.seeks, [59, 50]);
  configure({ seekIntervalSeconds: 9, audioSeekForwardSeconds: 20 });
  press("l"); await settle(); press("j"); await settle(); assert.deepEqual(audio.seeks, [59, 50, 70, 61], "adelantar usa 20 y retroceder hereda 9");
  assert.equal(desktopSettings().seekIntervalSeconds, 9);
});

test("J/L siguen los atajos SEEK_* remapeados, no teclas fijas", async t => {
  const h = harness(t); await settle(); configure({ audioSeekBackwardSeconds: 5, audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 50 });
  assert.deepEqual(assignShortcut("SEEK_FORWARD", "x"), {}); assert.deepEqual(assignShortcut("SEEK_BACKWARD", "z"), {});
  const old = press("l"); await settle(); press("j"); await settle();
  assert.equal(old.defaultPrevented, false); assert.deepEqual(audio.seeks, []);
  press("x"); await settle(); press("z"); await settle(); assert.deepEqual(audio.seeks, [65, 60]);
  assert.deepEqual(assignShortcut("SEEK_FORWARD", "Ctrl+Shift+l"), {}); press("L", { ctrlKey: true, shiftKey: true }); await settle();
  assert.equal(audio.state.time, 75);
});

test("flechas, Espacio y PageDown navegan sin cambiar tiempo ni estado del audio", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); await h.play(); const [audio] = h.audios; audio.emit({ time: 40 });
  const commands = audio.commands.length;
  press("ArrowRight"); await settle(); assert.equal(h.player.controller.currentBuild, 1);
  press(" "); await settle(); assert.equal(h.player.controller.currentBuild, 2);
  press("PageDown"); await settle(); assert.equal(h.player.controller.currentBuild, 3);
  press("ArrowLeft"); await settle(); press("PageUp"); await settle(); assert.equal(h.player.controller.currentBuild, 1);
  assert.equal(audio.state.time, 40); assert.equal(audio.state.playing, true); assert.deepEqual(audio.seeks, []); assert.equal(audio.commands.length, commands);
  assert.equal(audio.destroyed, false);
});

test("con PDF o imagen abierto el audio listo sigue siendo dueño del seek y el visual no recibe SEEK", async t => {
  const h = harness(t); await settle(); configure({ audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 10 });
  await h.open("uploaded-guide"); assert.equal(h.player.controller.isPresentation, false); assert.equal(h.documents.length, 1);
  press("l"); await settle();
  assert.equal(audio.state.time, 25); assert.deepEqual(h.documents[0].commands, []);
});

test("al abrir un video el seek conserva el video e intervalo anterior, incluso con un audio viejo cargado", async t => {
  const h = harness(t); await settle(); configure({ seekIntervalSeconds: 7, audioSeekBackwardSeconds: 5, audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 20 });
  await h.open("clip"); const [video] = h.videos; video.emit({ time: 30 });
  const forward = press("l"); await settle();
  assert.equal(forward.defaultPrevented, true); assert.deepEqual(video.commands, ["SEEK_FORWARD"]); assert.equal(video.state.time, 37);
  press("j"); await settle(); assert.deepEqual(video.commands, ["SEEK_FORWARD", "SEEK_BACKWARD"]); assert.equal(video.state.time, 30);
  assert.deepEqual(audio.seeks, []); assert.equal(audio.state.time, 20);
});

test("si el docente reproduce explícitamente el audio sobre un video pausado, el audio recupera el seek hasta que el video vuelve a sonar", async t => {
  const h = harness(t); await settle(); configure({ seekIntervalSeconds: 7, audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 20 });
  await h.open("clip"); const [video] = h.videos; video.emit({ time: 30 });
  await h.play(); assert.equal(audio.state.playing, true);
  press("l"); await settle();
  assert.deepEqual(audio.seeks, [35]); assert.deepEqual(video.commands, []); assert.equal(video.state.time, 30);
  await h.player.dispatch("PLAY_PAUSE"); await settle();
  assert.equal(video.state.playing, true); assert.equal(audio.state.playing, false);
  press("l"); await settle();
  assert.deepEqual(video.commands, ["PLAY_PAUSE", "SEEK_FORWARD"]); assert.equal(video.state.time, 37); assert.deepEqual(audio.seeks, [35]);
  // Reproducir el audio otra vez lo hace dueño; abrir un video (aunque ya esté abierto) devuelve el seek al video.
  await h.play(); press("l"); await settle(); assert.equal(audio.seeks.length, 2);
  await h.open("clip"); press("l"); await settle();
  assert.equal(audio.seeks.length, 2); assert.equal(video.commands.at(-1), "SEEK_FORWARD");
});

test("input, textarea, select, contenteditable, composición, defaultPrevented y Ajustes no disparan el seek", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 50 });
  const targets = [document.querySelector("input")];
  for (const html of ["<textarea></textarea>", "<select></select>", '<div contenteditable="true"><span></span></div>']) { const host = document.createElement("div"); host.innerHTML = html; document.body.append(host); targets.push(host.querySelector("span") || host.firstElementChild); }
  for (const target of targets) { const event = press("l", {}, target); assert.equal(event.defaultPrevented, false); }
  assert.equal(press("l", { isComposing: true }).defaultPrevented, false);
  const handled = document.createElement("button"); document.body.append(handled); handled.addEventListener("keydown", event => event.preventDefault());
  press("l", {}, handled);
  const dialog = document.createElement("div"); dialog.dataset.settingsDialog = ""; document.body.append(dialog);
  assert.equal(press("l").defaultPrevented, false); dialog.remove();
  await settle(); assert.deepEqual(audio.seeks, []);
  press("l"); await settle(); assert.equal(audio.seeks.length, 1);
});

test("repetir la tecla hace un seek por evento, acumulando mientras el renderer aún no informa el tiempo", async t => {
  const h = harness(t); await settle(); configure({ audioSeekBackwardSeconds: 5, audioSeekForwardSeconds: 15 });
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 10 });
  for (let i = 0; i < 3; i++) press("l", { repeat: i > 0 });
  await settle(); assert.deepEqual(audio.seeks, [25, 40, 55]); assert.equal(audio.state.time, 55);
  audio.deferSeek = true;
  press("l", { repeat: true }); press("l", { repeat: true }); await settle();
  assert.deepEqual(audio.seeks.slice(3), [70, 85], "el segundo evento parte del destino pendiente, no del tiempo viejo");
  audio.finishSeek(); await settle(); assert.equal(audio.state.time, 85);
  press("j"); await settle(); assert.equal(audio.seeks.at(-1), 80, "tras informar el tiempo se vuelve a leer del renderer");
  assert.equal(audio.commands.length, 0);
});

test("audio cargando, con error, cerrado o reemplazado no consume J/L ni acepta resultados viejos", async t => {
  const h = harness(t); await settle();
  const release = h.hold(h.mountGates, "audio-a"); h.query("[data-resource='audio-a']").click(); await settle();
  const [first] = h.audios; const loading = press("l"); await settle();
  assert.equal(loading.defaultPrevented, false); assert.deepEqual(first.seeks, []);
  release(); await settle(); press("l"); await settle(); assert.deepEqual(first.seeks, [5]);
  first.emit({ error: "No se pudo leer" }); const failed = press("l"); await settle();
  assert.equal(failed.defaultPrevented, false); assert.deepEqual(first.seeks, [5]);
  await h.open("audio-a"); const [, second] = h.audios; assert.equal(first.destroyed, true);
  await h.open("audio-b"); const [, , third] = h.audios; assert.equal(second.destroyed, true);
  second.options.onState({ ...initialRendererState(), duration: 100, time: 99 });
  press("l"); await settle(); assert.deepEqual(second.seeks, []); assert.deepEqual(third.seeks, [5]); assert.equal(third.state.time, 5);
  h.query("[data-audio-cmd='CLOSE']").click(); await settle();
  const closed = press("l"); await settle(); assert.equal(closed.defaultPrevented, false); assert.deepEqual(third.seeks, [5]);
});

test("teardown: un solo listener por reproductor, sin duplicados por cambios de atajos y ninguno tras destroy", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); const [audio] = h.audios;
  for (let i = 0; i < 5; i++) window.dispatchEvent(new window.Event("classroom-shortcuts-changed"));
  press("l"); await settle(); assert.deepEqual(audio.seeks, [5]);
  h.player.destroy();
  const after = press("l"); await settle(); assert.equal(after.defaultPrevented, false); assert.deepEqual(audio.seeks, [5]);
  assert.doesNotThrow(() => h.player.destroy());
});

test("conflictos nuevos entre seek de audio y navegación exigen reemplazo explícito sin tocar otras preferencias", t => {
  const h = environment(t); configure({ seekIntervalSeconds: 9, audioSeekForwardSeconds: 20 });
  assert.deepEqual(audioSeekCollisions(defaultShortcuts()), [], "NEXT/PREVIOUS comparten flechas con ADVANCE/BACK en contextos excluyentes");
  assert.deepEqual(assignShortcut("SEEK_FORWARD", "PageDown"), { conflict: "ADVANCE" });
  assert.deepEqual(assignShortcut("ADVANCE", "l"), { conflict: "SEEK_FORWARD" });
  assert.deepEqual(assignShortcut("BACK", "j"), { conflict: "SEEK_BACKWARD" });
  assert.deepEqual(assignShortcut("OPEN_RESOURCE", "l"), { conflict: "SEEK_FORWARD" });
  assert.deepEqual(readShortcuts(), defaultShortcuts(), "una asignación rechazada no escribe nada");
  assert.deepEqual(assignShortcut("NEXT", "ArrowRight"), {}); assert.deepEqual(assignShortcut("PREVIOUS", "ArrowLeft"), {});
  assert.deepEqual(assignShortcut("SEEK_FORWARD", "PageDown", true), {});
  const map = readShortcuts(); assert.deepEqual(map.SEEK_FORWARD, ["PageDown"]); assert.deepEqual(map.ADVANCE, ["ArrowRight", "Space"]); assert.deepEqual(map.BACK, defaultShortcuts().BACK);
  assert.deepEqual(audioSeekCollisions(map), []);
  assert.deepEqual(assignShortcut("BACK", "j", true), {}); assert.deepEqual(readShortcuts().SEEK_BACKWARD, []);
  assert.equal(desktopSettings().seekIntervalSeconds, 9); assert.equal(desktopSettings().audioSeekForwardSeconds, 20);
  void h;
});

test("colisión legacy: se conserva el storage, la navegación gana en la presentación y la advertencia identifica el par", async t => {
  const h = harness(t); await settle(); configure({ audioSeekForwardSeconds: 15 });
  window.localStorage.setItem(SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: { SEEK_FORWARD: ["PageDown"], MUTE: ["u"] } }));
  const map = readShortcuts();
  assert.deepEqual(map.SEEK_FORWARD, ["PageDown"]); assert.deepEqual(map.MUTE, ["u"]); assert.ok(map.ADVANCE.includes("PageDown"), "no se reinician los mapas válidos");
  assert.deepEqual(audioSeekCollisions(map), [{ key: "PageDown", seek: "SEEK_FORWARD", navigation: "ADVANCE" }]);
  await h.open("audio-a"); const [audio] = h.audios; audio.emit({ time: 10 });
  press("PageDown"); await settle();
  assert.equal(h.player.controller.currentBuild, 1); assert.deepEqual(audio.seeks, []); assert.equal(audio.state.time, 10);
  press("l"); await settle(); assert.deepEqual(audio.seeks, [], "l ya no está asignado");
  assert.equal(window.localStorage.getItem(SHORTCUTS_KEY).includes("PageDown"), true);
});
