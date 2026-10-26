import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const layer = text => ({ type: "answer", text, x: 10, y: 20, width: 40, height: 10, color: "#102954", fontSize: 3 });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

function fixture() {
  const m = structuredClone(example); m.resources[0].download.mimeType = "image/png";
  m.slides.forEach((slide, index) => { slide.metadata.presentationResourceId = m.mainPresentationId; slide.metadata.pageNumber = 1; slide.resourceIds = []; });
  Object.assign(m.slides[0], { interactionMode: "builds", buildCount: 3, interaction: { mode: "builds", buildCount: 3, source: "manual" }, builds: Array.from({ length: 3 }, (_, index) => ({ order: index + 1, layers: [layer(`Respuesta ${index + 1}`)] })) });
  const base = m.resources.find(resource => resource.resourceId === "drive-audio");
  for (const [id, name, mime] of [["audio-a", "A.mp3", "audio/mpeg"], ["audio-b", "B.mp3", "audio/mpeg"], ["clip", "Clip.mp4", "video/mp4"]]) {
    const resource = structuredClone(base); Object.assign(resource, { resourceId: id, name }); resource.download.mimeType = mime; m.resources.push(resource);
  }
  m.slides[0].resourceIds = ["uploaded-guide", "audio-a", "audio-b", "clip"];
  return m;
}
function environment(t) {
  const dom = new JSDOM("<div id='teacher'></div><div id='audience'></div><input>", { url: "http://tauri.localhost" });
  const previous = new Map(); const cleanups = []; dom.cleanup = callback => cleanups.push(callback);
  for (const name of ["window", "document"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] }); }
  t.after(() => { for (const cleanup of cleanups) cleanup(); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  // BackgroundMusic creates a real <audio>: jsdom has no media pipeline, so load/play/pause are simulated to avoid "not implemented" noise.
  const proto = dom.window.HTMLMediaElement.prototype;
  t.mock.method(proto, "load", () => {});
  t.mock.method(proto, "play", function () { Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new dom.window.Event("play")); return Promise.resolve(); });
  t.mock.method(proto, "pause", function () { Object.defineProperty(this, "paused", { configurable: true, value: true }); this.dispatchEvent(new dom.window.Event("pause")); });
  return dom;
}
function visual(kind = "image") {
  return { kind, mounts: 0, destroyed: false, async mount(host, source, options) { this.mounts++; host.textContent = kind; options.onState(initialRendererState()); }, async setSource() {}, setPage() {}, command() {}, seek() {}, setVolume() {}, destroy() { this.destroyed = true; } };
}
// Media stub that mirrors MediaRenderer's contract: PLAY_PAUSE toggles, STOP pauses and rewinds, no autoplay.
function media(kind, mountGates) {
  return {
    kind, id: "", commands: [], destroyed: false, state: initialRendererState(), holdPlay: null, host: null,
    async mount(host, source, options) {
      this.id = source.url.split("/").pop(); this.host = host; this.options = options; this.mountOptions = options;
      await mountGates.get(this.id);
      this.emit({ duration: 100, volume: options.volume, muted: options.muted });
    },
    emit(update) { if (this.destroyed) return; this.state = { ...this.state, ...update }; this.options.onState({ ...this.state }); },
    async command(command) {
      this.commands.push(command);
      if (command === "PLAY_PAUSE") {
        if (this.state.playing) this.emit({ playing: false });
        else { if (this.holdPlay) await this.holdPlay; this.emit({ playing: true }); }
      } else if (command === "STOP") this.emit({ playing: false, time: 0 });
      else if (command === "MUTE") this.emit({ muted: !this.state.muted });
    },
    seek(time) { this.emit({ time }); }, setVolume(volume) { this.emit({ volume }); }, setPage() {}, destroy() { this.destroyed = true; },
  };
}
// options.prepare: media goes through prepareMediaSource/releaseMediaSource like in the app; options.music: the Unit has ambient music.
function harness(t, options = {}) {
  const dom = environment(t);
  const m = fixture();
  if (options.music) {
    m.backgroundMusic = [{ id: "bg", resourceId: "bg", sourceType: "file", title: "Ambiente", order: 0 }];
    const bg = structuredClone(m.resources.find(resource => resource.resourceId === "drive-audio"));
    Object.assign(bg, { resourceId: "bg", name: "bg.mp3" }); bg.download.mimeType = "audio/mpeg"; m.resources.push(bg);
  }
  const teacher = document.querySelector("#teacher"), audience = document.querySelector("#audience");
  const projected = visual(); const follower = new ProjectionPlayer(audience, async () => projected);
  const snapshots = [];
  const bridge = { async status() { return { monitors: [], projecting: true, disconnected: false }; }, async show() {}, async hide() {}, async publish(snapshot) { snapshots.push(snapshot); await follower.receive(snapshot); } };
  const gates = new Map(), mountGates = new Map(), prepareGates = new Map(), failures = new Set();
  const hold = (map, id) => { let release; map.set(id, new Promise(resolve => { release = resolve; })); return release; };
  const holdReject = (map, id) => { let reject; map.set(id, new Promise((_, fail) => { reject = fail; })); return () => reject(new Error("mount fallido")); };
  const grants = [], released = [];
  const prepared = options.prepare ? {
    prepareMediaSource: async id => { await prepareGates.get(id); const grant = { url: `asset://localhost/cache/${id}`, mimeType: m.resources.find(item => item.resourceId === id)?.download.mimeType || "audio/mpeg", name: id, sizeBytes: 1, grant: grants.length }; grants.push(grant); return grant; },
    // Only prepared grants are tracked: the player also hands unprepared image sources back, which is not what these tests count.
    releaseMediaSource: source => { if (grants.includes(source)) released.push(source); },
  } : {};
  const display = visual("image"); const audios = [], videos = [], documents = [];
  const classroom = { manifest: m, resolveResource(id) { const resource = m.resources.find(item => item.resourceId === id); return { path: `/cache/${id}`, mimeType: resource.download.mimeType, name: resource.name, kind: "x" }; } };
  const player = new ClassroomPlayer(teacher, classroom, () => {}, {
    verifyResource: async id => { await gates.get(id); return !failures.has(id); },
    toUrl: path => `asset://localhost${path}`,
    projectionBridge: bridge, ...prepared,
    createRenderer: async kind => {
      if (kind === "audio") { const stub = media("audio", mountGates); audios.push(stub); return stub; }
      if (kind === "video") { const stub = media("video", mountGates); videos.push(stub); return stub; }
      if (kind === "image") return display;
      const stub = visual(kind); documents.push(stub); return stub;
    },
  });
  dom.cleanup(() => { player.destroy(); follower.destroy(); });
  const query = selector => teacher.querySelector(selector);
  const open = async id => { query(`[data-resource='${id}']`).click(); await settle(); };
  const play = async () => { query("[data-audio-cmd='PLAY_PAUSE']").click(); await settle(); };
  const grantsOf = id => grants.filter(grant => grant.name === id), releasedOf = id => released.filter(grant => grant.name === id);
  const ambient = () => teacher.querySelector("[data-background-music] audio");
  const toggleAmbient = async () => { query("[data-music-play]").click(); await settle(); };
  const setting = value => window.localStorage.setItem("active-classroom-settings:v1", JSON.stringify({ pauseBackgroundMusic: value }));
  return { dom, m, teacher, audience, player, projected, display, snapshots, audios, videos, documents, gates, mountGates, prepareGates, failures, hold, holdReject, grants, released, grantsOf, releasedOf, ambient, toggleAmbient, setting, query, open, play };
}
const key = (name, extra = {}) => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, ...extra }));
const visualState = h => ({ resource: h.player.controller.selectedResourceId, slide: h.player.controller.slideIndex, build: h.player.controller.currentBuild, mounts: h.display.mounts, projectedMounts: h.projected.mounts, snapshots: h.snapshots.length });

test("abrir audio no remonta la diapositiva ni cambia selección, build o snapshot, y no arranca solo", async t => {
  const h = harness(t); await settle();
  h.query("[data-renderer]").click(); await settle();
  assert.equal(h.player.controller.currentBuild, 1);
  const before = visualState(h);
  await h.open("audio-a");
  const [audio] = h.audios;
  assert.deepEqual(visualState(h), before);
  assert.equal(h.audios.length, 1); assert.equal(audio.state.playing, false); assert.deepEqual(audio.commands, []);
  assert.equal(audio.host, h.query("[data-audio-host]")); assert.equal(h.query("[data-renderer]").contains(audio.host), false);
  assert.equal(audio.mountOptions.page, 1); assert.equal(typeof audio.mountOptions.onPage, "function"); assert.equal(typeof audio.mountOptions.volume, "number");
  assert.equal(h.query("[data-audio-dock]").hidden, false); assert.equal(h.query("[data-audio-title]").textContent, "A.mp3");
  assert.match(h.teacher.querySelector(".interaction-surface").textContent, /Respuesta 1/);
  assert.match(h.audience.querySelector(".interaction-surface").textContent, /Respuesta 1/);
  assert.equal(h.audience.querySelector("[data-audio-dock]"), null);
  await h.play();
  assert.equal(audio.state.playing, true); assert.match(h.query("[data-audio-cmd='PLAY_PAUSE']").textContent, /Pausar/);
  assert.deepEqual(visualState(h), before);
});

test("controles: pausa, posición, detener, fin del audio y volumen sin tocar el visual", async t => {
  const h = harness(t); await settle(); await h.open("audio-a");
  const [audio] = h.audios; const before = visualState(h);
  await h.play(); assert.equal(audio.state.playing, true);
  const seek = h.query("[data-audio-seek]"); assert.equal(seek.disabled, false);
  seek.value = "30"; seek.dispatchEvent(new window.Event("input", { bubbles: true })); await settle();
  assert.equal(audio.state.time, 30); assert.equal(h.query("[data-audio-time]").textContent, "0:30 / 1:40");
  await h.play(); assert.equal(audio.state.playing, false); assert.equal(audio.state.time, 30);
  await h.play(); h.query("[data-audio-cmd='STOP']").click(); await settle();
  assert.equal(audio.state.playing, false); assert.equal(audio.state.time, 0);
  await h.play(); audio.emit({ time: 100, playing: false }); await settle();
  assert.match(h.query("[data-audio-cmd='PLAY_PAUSE']").textContent, /Reproducir/); assert.equal(h.query("[data-audio-dock]").hidden, false);
  const volume = h.query("[data-audio-volume]"); volume.value = "0.3"; volume.dispatchEvent(new window.Event("input", { bubbles: true })); await settle();
  assert.equal(audio.state.volume, 0.3);
  h.query("[data-audio-cmd='MUTE']").click(); await settle(); assert.equal(audio.state.muted, true);
  assert.equal(h.player.controller.currentBuild, before.build); assert.equal(h.display.mounts, before.mounts);
  // PLAY_PAUSE solo se envía cuando el estado reportado difiere del deseado.
  const toggles = audio.commands.filter(command => command === "PLAY_PAUSE").length;
  h.query("[data-audio-cmd='STOP']").click(); await settle();
  assert.equal(audio.commands.filter(command => command === "PLAY_PAUSE").length, toggles);
});

test("el audio persiste al navegar adelante y atrás, con el teclado de presentación intacto", async t => {
  const h = harness(t); await settle(); await h.open("audio-a");
  const [audio] = h.audios; await h.play(); const commands = audio.commands.length;
  for (let step = 1; step <= 3; step++) { h.query("[data-slide-next]").click(); await settle(); assert.equal(h.player.controller.currentBuild, step); }
  h.query("[data-slide-next]").click(); await settle(); assert.equal(h.player.controller.slideIndex, 1);
  key(" "); await settle(); key("ArrowRight"); await settle();
  assert.equal(audio.commands.length, commands); assert.equal(audio.state.playing, true); assert.equal(audio.destroyed, false);
  h.query("[data-slides] button").click(); await settle(); assert.equal(h.player.controller.slideIndex, 0);
  h.query("[data-slide-previous]").click(); await settle();
  assert.equal(h.audios.length, 1); assert.equal(audio.destroyed, false); assert.equal(audio.state.playing, true); assert.equal(h.query("[data-audio-dock]").hidden, false);
});

test("un segundo audio destruye el anterior antes de prepararse; el mismo audio reabre el dock sin alternar", async t => {
  const h = harness(t); await settle(); await h.open("audio-a");
  const [a] = h.audios; await h.play(); a.emit({ time: 12 });
  const releaseB = h.hold(h.gates, "audio-b");
  await h.open("audio-b");
  assert.equal(a.destroyed, true); assert.equal(h.audios.length, 1); assert.match(h.query("[data-audio-status]").textContent, /Abriendo/);
  assert.equal(h.query("[data-audio-cmd='PLAY_PAUSE']").disabled, true);
  releaseB(); await settle();
  const b = h.audios[1]; assert.equal(b.id, "audio-b"); assert.equal(b.state.playing, false);
  await h.play(); b.emit({ time: 7 });
  h.query("[data-audio-toggle]").click();
  const commands = b.commands.length;
  await h.open("audio-b");
  assert.equal(h.audios.length, 2); assert.equal(b.destroyed, false); assert.equal(b.commands.length, commands);
  assert.equal(b.state.playing, true); assert.equal(b.state.time, 7); assert.equal(h.query("[data-audio-body]").hidden, false);
});

test("selección rápida A/B y destroy ignoran resultados tardíos", async t => {
  const h = harness(t); await settle();
  const releaseA = h.hold(h.gates, "audio-a"), releaseB = h.hold(h.gates, "audio-b");
  h.query("[data-resource='audio-a']").click(); h.query("[data-resource='audio-b']").click(); await settle();
  releaseB(); await settle(); releaseA(); await settle();
  assert.deepEqual(h.audios.map(stub => stub.id), ["audio-b"]); assert.equal(h.query("[data-audio-title]").textContent, "B.mp3");
  // Mount diferido de C frente a un cambio posterior.
  const releaseMount = h.hold(h.mountGates, "audio-a");
  await h.open("audio-a"); const late = h.audios[1];
  assert.equal(h.audios[0].destroyed, true);
  await h.open("audio-b"); assert.equal(late.destroyed, true);
  releaseMount(); await settle();
  assert.equal(late.state.duration, 0); assert.equal(h.query("[data-audio-title]").textContent, "B.mp3");
  // destroy con preparación pendiente y con audio montado.
  const releaseLast = h.hold(h.gates, "audio-a");
  await h.open("audio-a"); const count = h.audios.length; const previous = h.audios.at(-1);
  h.player.destroy(); releaseLast(); await settle();
  assert.equal(h.audios.length, count); assert.equal(previous.destroyed, true);
  assert.doesNotThrow(() => h.player.destroy());
});

test("destroy destruye el audio montado y el video, e ignora estados posteriores", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); await h.play();
  const [audio] = h.audios; h.player.destroy();
  assert.equal(audio.destroyed, true); assert.doesNotThrow(() => audio.options.onState({ ...initialRendererState(), playing: true }));
  assert.equal(h.teacher.children.length, 0);
});

test("el video pausa el audio, un documento no, y volver a la presentación no reanuda", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); await h.play();
  const [audio] = h.audios; audio.emit({ time: 12 });
  await h.open("uploaded-guide");
  assert.equal(h.player.controller.selectedResourceId, "uploaded-guide"); assert.equal(audio.state.playing, true); assert.equal(h.documents.length, 1);
  const releaseClip = h.hold(h.gates, "clip");
  h.query("[data-resource='clip']").click(); await settle();
  assert.equal(audio.state.playing, false, "pausa al abrir el video aunque su preparación siga pendiente"); assert.equal(audio.state.time, 12);
  releaseClip(); await settle();
  assert.equal(h.videos.length, 1); assert.equal(audio.destroyed, false);
  h.query("[data-presentation]").click(); await settle();
  assert.equal(h.player.controller.isPresentation, true);
  const commands = audio.commands.length; await settle();
  assert.equal(audio.state.playing, false); assert.equal(audio.state.time, 12); assert.equal(audio.commands.length, commands);
  assert.equal(h.query("[data-audio-dock]").hidden, false);
});

test("exclusión mutua audio/video en ambos órdenes, incluso con play diferido", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); const [audio] = h.audios;
  await h.open("clip"); const [video] = h.videos;
  // Video reproduciendo, luego audio: el video se pausa.
  await h.player.dispatch("PLAY_PAUSE"); assert.equal(video.state.playing, true);
  await h.play(); assert.equal(audio.state.playing, true); assert.equal(video.state.playing, false);
  // Audio reproduciendo, luego video: el audio se pausa.
  await h.player.dispatch("PLAY_PAUSE"); assert.equal(video.state.playing, true); assert.equal(audio.state.playing, false);
  await h.player.dispatch("PLAY_PAUSE"); assert.equal(video.state.playing, false);
  // Play de video diferido que llega después de que el audio ya sonaba.
  let releaseVideo; video.holdPlay = new Promise(resolve => { releaseVideo = resolve; });
  const pendingVideo = h.player.dispatch("PLAY_PAUSE"); await settle();
  await h.play(); assert.equal(audio.state.playing, true);
  releaseVideo(); await pendingVideo; await settle();
  assert.equal(video.state.playing, true); assert.equal(audio.state.playing, false);
  await h.player.dispatch("PLAY_PAUSE"); video.holdPlay = null;
  // Play de audio diferido que llega después de que el video ya sonaba.
  let releaseAudio; audio.holdPlay = new Promise(resolve => { releaseAudio = resolve; });
  await h.play(); await h.player.dispatch("PLAY_PAUSE");
  assert.equal(video.state.playing, true);
  releaseAudio(); await settle();
  assert.equal(video.state.playing, true); assert.equal(audio.state.playing, false);
});

test("audio con mount diferido mientras suena el video: los controles esperan y luego pausan el video", async t => {
  const h = harness(t); await settle(); await h.open("clip"); const [video] = h.videos;
  await h.player.dispatch("PLAY_PAUSE"); assert.equal(video.state.playing, true);
  const releaseMount = h.hold(h.mountGates, "audio-a");
  h.query("[data-resource='audio-a']").click(); await settle();
  const button = h.query("[data-audio-cmd='PLAY_PAUSE']"); assert.equal(button.disabled, true);
  button.click(); await settle(); assert.equal(h.audios[0].commands.length, 0); assert.equal(video.state.playing, true);
  releaseMount(); await settle();
  assert.equal(video.state.playing, true); assert.equal(h.audios[0].state.playing, false);
  await h.play(); assert.equal(h.audios[0].state.playing, true); assert.equal(video.state.playing, false);
});

test("minimizar y restaurar no desmonta ni detiene el audio", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); await h.play(); const [audio] = h.audios;
  h.query("[data-audio-toggle]").click();
  assert.equal(h.query("[data-audio-body]").hidden, true); assert.equal(h.query("[data-audio-dock]").hidden, false);
  assert.equal(h.query("[data-audio-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(audio.destroyed, false); assert.equal(audio.state.playing, true); assert.equal(h.audios.length, 1);
  h.query("[data-audio-toggle]").click();
  assert.equal(h.query("[data-audio-body]").hidden, false); assert.equal(audio.destroyed, false); assert.equal(audio.state.playing, true);
});

test("errores locales del audio son visibles y recuperables sin afectar la diapositiva", async t => {
  const h = harness(t); await settle();
  h.failures.add("audio-a"); const before = visualState(h);
  await h.open("audio-a");
  assert.equal(h.audios.length, 0); assert.equal(h.query("[data-audio-status]").hidden, false); assert.equal(h.query("[data-audio-status]").getAttribute("role"), "alert");
  assert.equal(h.query("[data-audio-cmd='PLAY_PAUSE']").disabled, true);
  h.query("[data-audio-cmd='STOP']").click(); h.query("[data-audio-cmd='MUTE']").click(); await settle();
  assert.equal(h.query("[data-status]").textContent, "");
  assert.deepEqual(visualState(h), before);
  h.failures.delete("audio-a"); await h.open("audio-a");
  assert.equal(h.audios.length, 1); assert.equal(h.query("[data-audio-status]").hidden, true); assert.equal(h.query("[data-audio-cmd='PLAY_PAUSE']").disabled, false);
  h.audios[0].emit({ error: "No se pudo leer el audio local" });
  assert.match(h.query("[data-audio-status]").textContent, /No se pudo leer/);
  await h.open("audio-a"); assert.equal(h.audios.length, 2); assert.equal(h.audios[0].destroyed, true);
  assert.equal(h.query("[data-audio-status]").hidden, true);
});

test("doble clic mientras play está pendiente no envía otro toggle", async t => {
  const h = harness(t); await settle(); await h.open("audio-a");
  const [audio] = h.audios; let release;
  audio.holdPlay = new Promise(resolve => { release = resolve; });
  const button = h.query("[data-audio-cmd='PLAY_PAUSE']");
  button.click(); button.click(); await settle();
  assert.equal(audio.commands.filter(command => command === "PLAY_PAUSE").length, 1);
  assert.equal(button.disabled, true);
  release(); await settle();
  assert.equal(audio.state.playing, true); assert.equal(button.disabled, false);
});

test("cerrar el audio lo destruye sin afectar el visual", async t => {
  const h = harness(t); await settle(); await h.open("audio-a"); const [audio] = h.audios; const before = visualState(h);
  h.query("[data-audio-cmd='CLOSE']").click(); await settle();
  assert.equal(audio.destroyed, true); assert.equal(h.query("[data-audio-dock]").hidden, true); assert.deepEqual(visualState(h), before);
});

test("grants de audio: se liberan una sola vez al reemplazar y cerrar, nunca mientras se usan", async t => {
  const h = harness(t, { prepare: true }); await settle();
  await h.open("audio-a"); await h.play();
  const [a] = h.grantsOf("audio-a");
  // En uso: navegar, avanzar builds y reabrir el mismo audio no liberan nada.
  h.query("[data-slide-next]").click(); await settle(); await h.open("audio-a");
  assert.equal(h.grantsOf("audio-a").length, 1); assert.equal(h.released.length, 0);
  await h.open("audio-b"); const [b] = h.grantsOf("audio-b");
  assert.deepEqual(h.released, [a]); assert.equal(h.audios[0].destroyed, true);
  h.query("[data-audio-cmd='CLOSE']").click(); await settle();
  assert.deepEqual(h.released, [a, b]);
  h.query("[data-audio-cmd='CLOSE']").click(); await settle();
  assert.equal(h.released.length, 2, "cerrar dos veces no libera dos veces");
});

test("grants de audio: resultados tardíos obsoletos se liberan y el audio vigente conserva el suyo", async t => {
  const h = harness(t, { prepare: true }); await settle();
  const releaseA = h.hold(h.prepareGates, "audio-a"), releaseB = h.hold(h.prepareGates, "audio-b");
  h.query("[data-resource='audio-a']").click(); h.query("[data-resource='audio-b']").click(); await settle();
  releaseB(); await settle(); releaseA(); await settle();
  const [a] = h.grantsOf("audio-a"), [b] = h.grantsOf("audio-b");
  assert.deepEqual(h.released, [a], "solo el grant obsoleto");
  assert.deepEqual(h.audios.map(stub => stub.id), ["audio-b"]); assert.equal(h.audios[0].destroyed, false);
  // Mount diferido de A frente a B: el renderer viejo se destruye, su grant se libera una vez y B sigue intacto.
  const releaseMount = h.hold(h.mountGates, "audio-a");
  await h.open("audio-a"); const late = h.audios[1]; const [a2] = h.grantsOf("audio-a").slice(-1);
  assert.deepEqual(h.released, [a, b]);
  await h.open("audio-b"); const b2 = h.grantsOf("audio-b")[1];
  assert.equal(late.destroyed, true); assert.deepEqual(h.released, [a, b, a2]); assert.ok(b2);
  releaseMount(); await settle();
  assert.equal(h.released.length, 3, "el mount tardío no libera otra vez"); assert.equal(h.audios.at(-1).destroyed, false);
  assert.equal(h.query("[data-audio-title]").textContent, "B.mp3");
  // Un callback viejo no toca la reproducción nueva.
  late.options.onState({ ...initialRendererState(), playing: true, error: "viejo" });
  assert.equal(h.audios.at(-1).destroyed, false); assert.equal(h.query("[data-audio-status]").hidden, true);
});

test("grants de audio: destroy libera el vigente y el que llega después, una sola vez", async t => {
  const h = harness(t, { prepare: true }); await settle();
  await h.open("audio-a"); const [a] = h.grantsOf("audio-a");
  const releaseB = h.hold(h.prepareGates, "audio-b");
  h.query("[data-resource='audio-b']").click(); await settle();
  assert.deepEqual(h.released, [a], "el reemplazo libera el anterior antes de terminar de preparar");
  h.player.destroy(); assert.deepEqual(h.released, [a]);
  releaseB(); await settle();
  assert.deepEqual(h.released, [a, ...h.grantsOf("audio-b")]); assert.equal(h.audios.length, 1);
  assert.doesNotThrow(() => h.player.destroy()); assert.equal(h.released.length, 2);
});

test("grants de audio: destroy con el audio sonando lo destruye y libera su grant una vez", async t => {
  const h = harness(t, { prepare: true }); await settle();
  await h.open("audio-a"); await h.play(); h.player.destroy();
  assert.equal(h.releasedOf("audio-a").length, 1); assert.equal(h.audios[0].destroyed, true);
  assert.doesNotThrow(() => h.player.destroy()); assert.equal(h.releasedOf("audio-a").length, 1);
});

test("grants de audio: un mount fallido libera el grant, muestra el error y se puede reintentar", async t => {
  const h = harness(t, { prepare: true }); await settle();
  const fail = h.holdReject(h.mountGates, "audio-a");
  h.query("[data-resource='audio-a']").click(); await settle(); fail(); await settle();
  assert.equal(h.releasedOf("audio-a").length, 1); assert.equal(h.audios[0].destroyed, true);
  assert.equal(h.query("[data-audio-status]").getAttribute("role"), "alert"); assert.match(h.query("[data-audio-status]").textContent, /mount fallido/);
  h.mountGates.delete("audio-a"); await h.open("audio-a");
  assert.equal(h.grantsOf("audio-a").length, 2); assert.equal(h.releasedOf("audio-a").length, 1); assert.equal(h.query("[data-audio-status]").hidden, true);
  assert.equal(h.audios[1].destroyed, false);
});

test("grants: el audio no libera el source del video y viceversa", async t => {
  const h = harness(t, { prepare: true }); await settle();
  await h.open("clip"); const [clip] = h.grantsOf("clip");
  await h.open("audio-a"); const [a] = h.grantsOf("audio-a");
  assert.deepEqual(h.released, []);
  h.query("[data-presentation]").click(); await settle();
  assert.deepEqual(h.released, [clip]);
  h.query("[data-audio-cmd='CLOSE']").click(); await settle();
  assert.deepEqual(h.released, [clip, a]);
});

test("música ambiente (pausar ajustado): el audio independiente la pausa, la bloquea mientras suena y no la reanuda", async t => {
  const h = harness(t, { prepare: true, music: true }); await settle();
  await h.toggleAmbient(); const ambient = h.ambient(); assert.equal(ambient.paused, false);
  await h.open("audio-a"); assert.equal(ambient.paused, false, "abrir un audio no pausa ni arranca nada");
  await h.play(); assert.equal(h.audios[0].state.playing, true); assert.equal(ambient.paused, true);
  await h.toggleAmbient(); assert.equal(ambient.paused, true, "la música no reinicia mientras el audio suena");
  await h.play(); assert.equal(h.audios[0].state.playing, false);
  await settle(); assert.equal(ambient.paused, true, "no se reanuda sola al pausar el audio");
  await h.toggleAmbient(); assert.equal(ambient.paused, false, "el docente la puede reanudar");
  await h.play(); assert.equal(ambient.paused, true);
  h.query("[data-audio-cmd='STOP']").click(); await settle(); assert.equal(ambient.paused, true);
});

test("música ambiente: la intención de reproducir bloquea el reinicio aunque el play siga pendiente", async t => {
  const h = harness(t, { music: true }); await settle();
  await h.toggleAmbient(); const ambient = h.ambient();
  await h.open("audio-a"); const [audio] = h.audios; let releasePlay; audio.holdPlay = new Promise(resolve => { releasePlay = resolve; });
  await h.play(); assert.equal(audio.state.playing, false); assert.equal(ambient.paused, true, "se pausa al pedir reproducir");
  await h.toggleAmbient(); assert.equal(ambient.paused, true);
  releasePlay(); await settle(); assert.equal(audio.state.playing, true); assert.equal(ambient.paused, true);
  // Al terminar la pista la intención se cancela y la música vuelve a poder iniciarse manualmente.
  audio.emit({ playing: false, time: 100 }); await settle();
  await h.toggleAmbient(); assert.equal(ambient.paused, false);
});

test("música ambiente (pausar desactivado): se conserva la mezcla con el audio independiente", async t => {
  const h = harness(t, { prepare: true, music: true }); await settle(); h.setting(false);
  await h.toggleAmbient(); const ambient = h.ambient(); assert.equal(ambient.paused, false);
  await h.open("audio-a"); await h.play();
  assert.equal(h.audios[0].state.playing, true); assert.equal(ambient.paused, false);
  await h.toggleAmbient(); assert.equal(ambient.paused, true, "el control manual sigue funcionando");
  await h.toggleAmbient(); assert.equal(ambient.paused, false); assert.equal(h.audios[0].state.playing, true);
});

test("música ambiente: el video sigue pausándola y el audio pausado por el video no reanuda nada", async t => {
  const h = harness(t, { music: true }); await settle();
  await h.toggleAmbient(); const ambient = h.ambient();
  await h.open("audio-a"); await h.play(); const [audio] = h.audios;
  await h.open("clip"); const [video] = h.videos;
  assert.equal(audio.state.playing, false);
  await h.player.dispatch("PLAY_PAUSE"); assert.equal(video.state.playing, true); assert.equal(ambient.paused, true);
  await h.player.dispatch("PLAY_PAUSE"); await settle();
  assert.equal(audio.state.playing, false); assert.equal(ambient.paused, true);
});
