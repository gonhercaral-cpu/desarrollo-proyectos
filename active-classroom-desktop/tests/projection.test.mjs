import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { ClassSessionController, isProjectionSnapshot } from "../src/player/ClassSessionController.ts";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { ProjectionCoordinator } from "../src/player/projection/ProjectionCoordinator.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { showProjectionOnMonitor } from "../src/player/projection/windowPlacement.ts";
import { PhysicalPosition } from "@tauri-apps/api/window";
import { preferredMonitor, readMonitorPreference, saveMonitorPreference } from "../src/player/projection/monitors.ts";
import { initialRendererState } from "../src/player/types.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
const fixture = () => { const manifest = structuredClone(example); manifest.resources[0].download.mimeType = "application/pdf"; return manifest; };
const source = (mimeType = "application/pdf", url = "asset://localhost/cache/Unit%2001/archivo%20%C3%B1") => ({ url, mimeType, name: "Archivo privado", sizeBytes: 10 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const monitors = [
  { id: "main", name: "eDP-1", primary: true, width: 1920, height: 1080, x: 0, y: 0, scaleFactor: 1 },
  { id: "projector", name: "HDMI-1", primary: false, width: 1280, height: 720, x: 1920, y: 0, scaleFactor: 1 },
];
function dom(t) {
  const instance = new JSDOM("<!doctype html><div id='app'></div><div id='audience'></div>", { url: "http://tauri.localhost" });
  const previous = new Map(); const cleanups = [];
  for (const name of ["window", "document", "localStorage", "HTMLVideoElement", "ResizeObserver"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "ResizeObserver" ? class { observe() {} disconnect() {} } : instance.window[name] });
  }
  t.after(() => {
    for (const cleanup of cleanups) cleanup(); instance.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { root: document.querySelector("#app"), audience: document.querySelector("#audience"), window: instance.window, cleanup: callback => cleanups.push(callback) };
}
function snapshot(mime = "application/pdf") {
  const controller = new ClassSessionController(fixture()); controller.record(initialRendererState(), source(mime)); return controller.snapshot();
}
function rendererDouble(kind) {
  return { kind, pages: [], states: [], destroyed: false,
    async mount(host, source, options) { this.source = source; this.options = options; host.textContent = "contenido"; options.onState({ ...initialRendererState(), pages: 2, page: options.page }); },
    setPage(page) { this.pages.push(page); }, command() {}, seek() {}, setVolume() {},
    applyPlayback(state) { this.states.push(state); }, destroy() { this.destroyed = true; },
  };
}
function bridge() {
  return { monitors: structuredClone(monitors), projecting: false, snapshots: [], shown: [], closed: [],
    async status() { return { monitors: this.monitors, projecting: this.projecting, disconnected: false }; },
    async show(id) { this.projecting = true; this.shown.push(id); }, async hide() { this.projecting = false; },
    async close(id) { this.projecting = false; this.closed.push(id); }, async publish(value) { this.snapshots.push(value); },
  };
}

test("sesión única conserva posición, aumenta revisión y omite nombres/notas del proyector", () => {
  const controller = new ClassSessionController(fixture()); controller.goSlide(1);
  controller.record({ ...initialRendererState(), playing: true, time: 12, volume: .6 }, source());
  const first = controller.snapshot(), second = controller.snapshot();
  assert.equal(second.sessionId, first.sessionId); assert.ok(second.revision > first.revision);
  assert.equal(first.page, 2); assert.equal(first.source.name, ""); assert.equal(first.playback.time, 12);
  assert.equal(isProjectionSnapshot(first), true); assert.equal("notes" in first, false);
  controller.selectResource("uploaded-guide"); controller.pageChanged(7);
  assert.equal(controller.snapshot().source, null);
  controller.returnToPresentation(); assert.equal(controller.page, 2);
});

test("selección persiste y recupera monitor por nombre si cambian posición o resolución", t => {
  dom(t); saveMonitorPreference(monitors[1]);
  assert.equal(preferredMonitor(monitors, readMonitorPreference()).id, "projector");
  const reconnected = { ...monitors[1], id: "new", x: -1280, width: 1920, height: 1080 };
  assert.equal(preferredMonitor([monitors[0], reconnected], readMonitorPreference()).id, "new");
  assert.equal(preferredMonitor([monitors[0]], readMonitorPreference()), undefined);
  assert.equal(preferredMonitor(monitors).primary, false);
  localStorage.setItem("active-classroom-projection-monitor", "invalid"); assert.equal(readMonitorPreference(), undefined);
});

test("desconectar y reconectar HDMI preserva sesión; restaurar proyecta snapshot actual", async t => {
  const { cleanup } = dom(t); const native = bridge(); const controller = new ClassSessionController(fixture());
  controller.goSlide(1); controller.record({ ...initialRendererState(), time: 22, playing: true }, source("video/webm"));
  const coordinator = new ProjectionCoordinator(() => {}, native, true); cleanup(() => coordinator.destroy());
  coordinator.update(controller.snapshot()); await coordinator.poll(); await coordinator.toggle();
  assert.equal(coordinator.projecting, true);
  native.monitors = [monitors[0]]; native.projecting = false; await coordinator.poll();
  assert.equal(coordinator.message, "Segunda pantalla desconectada"); assert.equal(controller.page, 2);
  controller.record({ ...initialRendererState(), time: 33, playing: false }, source("video/webm"));
  coordinator.update(controller.snapshot()); await tick();
  native.monitors = monitors; await coordinator.poll(); assert.match(coordinator.message, /Restaurar proyección/);
  await coordinator.toggle(); assert.equal(coordinator.projecting, true);
  assert.equal(native.snapshots.at(-1).playback.time, 33); assert.equal(native.snapshots.at(-1).page, 2);
  coordinator.destroy(); await tick(); assert.equal(native.closed.at(-1), controller.sessionId);
});

test("IPC serializa snapshots, combina pendientes y bloquea doble apertura", async t => {
  const { cleanup } = dom(t); const native = bridge(); const gate = deferred(); const showing = deferred();
  native.publish = async value => { native.snapshots.push(value); if (native.snapshots.length === 1) await gate.promise; };
  native.show = async id => { native.shown.push(id); await showing.promise; native.projecting = true; };
  const coordinator = new ProjectionCoordinator(() => {}, native, true); cleanup(() => coordinator.destroy());
  const state = snapshot(); coordinator.update(state); coordinator.update({ ...state, revision: 2 }); coordinator.update({ ...state, revision: 3 });
  gate.resolve(); await tick(); assert.deepEqual(native.snapshots.map(value => value.revision), [1, 3]);
  await coordinator.poll(); const opening = coordinator.toggle(); await coordinator.toggle();
  showing.resolve(); await opening; assert.equal(native.shown.length, 1);
});

test("cambiar monitor durante proyección reutiliza salida sin cambiar sesión", async t => {
  const { cleanup } = dom(t); const native = bridge(); native.monitors.push({ ...monitors[1], id: "other", name: "DP-1", x: -1280 });
  const controller = new ClassSessionController(fixture()); controller.goSlide(1);
  const coordinator = new ProjectionCoordinator(() => {}, native, true); cleanup(() => coordinator.destroy());
  coordinator.update(controller.snapshot()); await coordinator.poll(); await coordinator.toggle();
  await coordinator.select("other"); assert.deepEqual(native.shown, ["projector", "other"]);
  assert.equal(coordinator.projecting, true); assert.equal(coordinator.selected.id, "other");
  assert.equal(readMonitorPreference().id, "other"); assert.equal(controller.page, 2); assert.equal(native.closed.length, 0);
});

test("SDK Tauri real usa posición física del monitor antes de mostrar y solo controla audiencia", async t => {
  const { window } = dom(t); const calls = [];
  const selected = { ...monitors[1], x: -2560, y: 300, width: 2560, height: 1440, scaleFactor: 2 };
  const display = monitor => ({ name: monitor.name, position: { x: monitor.x, y: monitor.y }, size: { width: monitor.width, height: monitor.height }, scaleFactor: monitor.scaleFactor, workArea: { position: { x: monitor.x, y: monitor.y }, size: { width: monitor.width, height: monitor.height } } });
  window.__TAURI_INTERNALS__ = { async invoke(command, args) {
    calls.push({ command, args });
    if (command === "classroom_projection" && args.action === "prepare") return { operation: 1, monitor: selected };
    if (command === "plugin:window|available_monitors") return [display(monitors[0]), display(selected)];
    if (command === "plugin:window|get_all_windows") return ["teacher", "audience"];
    if (command === "plugin:window|set_fullscreen_on_monitor") {
      assert.equal(args.label, "audience"); assert.equal(args.value.x, -2560); assert.equal(args.value.y, 300);
      assert.ok(args.value instanceof PhysicalPosition); return null;
    }
    if (command === "classroom_projection" && args.action === "activate") { assert.equal(args.data.operation, 1); return null; }
    throw new Error(`Comando inesperado: ${command}`);
  } };
  await showProjectionOnMonitor(selected.id);
  assert.deepEqual(calls.map(call => call.command === "classroom_projection" ? call.args.action : call.command), ["prepare", "plugin:window|available_monitors", "plugin:window|get_all_windows", "plugin:window|set_fullscreen_on_monitor", "activate"]);
});

for (const failure of ["missing-monitor", "fullscreen-denied", "disconnected-before-show", "missing-window"]) test(`${failure}: nunca muestra ventana ni usa fullscreen genérico como fallback`, async () => {
  const calls = []; const selected = monitors[1];
  const real = { name: selected.name, position: new PhysicalPosition(selected.x, selected.y), size: { width: selected.width, height: selected.height }, scaleFactor: selected.scaleFactor };
  const api = {
    async prepare(id) { assert.equal(id, selected.id); calls.push("prepare-hidden"); return { operation: 7, monitor: selected }; },
    async availableMonitors() { return failure === "missing-monitor" ? [] : [real]; },
    async audience() { return failure === "missing-window" ? null : { async setFullscreenOnMonitor(position) { calls.push("fullscreen-on-monitor"); assert.equal(position, real.position); if (failure === "fullscreen-denied") throw new Error("permission denied"); } }; },
    async activate() { calls.push("activate-attempt"); throw new Error("Monitor desconectado"); },
    async abort(operation) { assert.equal(operation, 7); calls.push("abort-hidden"); },
  };
  await assert.rejects(showProjectionOnMonitor(selected.id, api));
  assert.equal(calls.at(-1), "abort-hidden");
  if (failure !== "disconnected-before-show") assert.equal(calls.includes("activate-attempt"), false);
});

test("fallo nativo informa sin modificar sesión ni impedir clase local", async t => {
  const { cleanup } = dom(t); const native = bridge(); native.show = async () => { throw new Error("HDMI unavailable"); };
  const coordinator = new ProjectionCoordinator(() => {}, native, true); cleanup(() => coordinator.destroy());
  await coordinator.poll(); await coordinator.toggle(); assert.match(coordinator.message, /Revisa la conexión/); assert.equal(coordinator.projecting, false);
  native.publish = async () => { throw new Error("IPC unavailable"); }; coordinator.update(snapshot()); await tick();
  assert.match(coordinator.message, /clase local continúa/);
});

test("PDF local sigue páginas y descarta eventos atrasados; audiencia sin comandos", async t => {
  const { audience, cleanup } = dom(t); const renderers = [];
  const player = new ProjectionPlayer(audience, async kind => { const renderer = rendererDouble(kind); renderers.push(renderer); return renderer; }); cleanup(() => player.destroy());
  t.mock.method(globalThis, "fetch", () => { throw new Error("Internet prohibido"); });
  const first = snapshot(); await player.receive(first); await player.receive({ ...first, revision: 2, page: 2 }); await player.receive(first);
  assert.equal(renderers.length, 1); assert.deepEqual(renderers[0].pages, [2]);
  assert.equal(renderers[0].options.silent, true); assert.equal(renderers[0].source.name, "");
  renderers[0].options.onPage(8); assert.deepEqual(renderers[0].pages, [2]);
  assert.equal(audience.querySelectorAll("button,input,aside").length, 0); assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("imagen y video siguen selección/play/pause/seek; audio nunca crea segundo reproductor", async t => {
  const { audience, cleanup } = dom(t); const renderers = [];
  const player = new ProjectionPlayer(audience, async kind => { const renderer = rendererDouble(kind); renderers.push(renderer); return renderer; }); cleanup(() => player.destroy());
  const first = snapshot("image/png"); await player.receive(first); assert.equal(renderers[0].kind, "image");
  const video = { ...first, revision: 2, resourceId: "video", source: source("video/webm"), playback: { ...first.playback, playing: true, time: 12, duration: 100 } };
  await player.receive(video); assert.equal(renderers[0].destroyed, true); assert.equal(renderers[1].kind, "video");
  assert.equal(renderers[1].states.at(-1).playing, true); assert.equal(renderers[1].states.at(-1).volume, 0); assert.equal(renderers[1].states.at(-1).muted, true);
  await player.receive({ ...video, revision: 3, playback: { ...video.playback, playing: false, time: 40 } });
  assert.equal(renderers[1].states.at(-1).time, 40); assert.equal(renderers[1].states.at(-1).playing, false);
  await player.receive({ ...video, revision: 4, resourceId: "audio", source: source("audio/mpeg") });
  assert.equal(renderers[1].destroyed, true); assert.equal(renderers.length, 2); assert.equal(audience.textContent, "♪"); assert.equal(audience.querySelector("audio,video"), null);
});

test("snapshots inconsistentes/remotos y recurso ausente/corrupto dejan pantalla segura", async t => {
  const { audience, cleanup } = dom(t); const renderer = rendererDouble("pdf");
  const player = new ProjectionPlayer(audience, async () => renderer); cleanup(() => player.destroy());
  const first = snapshot(); await player.receive(first);
  for (const invalid of [{ ...first, page: -1 }, { ...first, playback: null }, { ...first, source: source("application/pdf", "https://drive.google.com/file") }]) {
    assert.equal(isProjectionSnapshot(invalid), false); await player.receive(invalid); assert.equal(audience.childElementCount, 0);
  }
  await player.receive({ ...first, revision: 3, source: null }); assert.equal(audience.childElementCount, 0);
  await player.receive({ ...first, revision: 4, playback: { ...first.playback, error: "Archivo corrupto" } }); assert.equal(audience.childElementCount, 0);
});

test("cambio rápido y cierre descartan mounts obsoletos sin perder página nueva", async t => {
  const { audience, cleanup } = dom(t); const gate = deferred(); const old = rendererDouble("pdf"); const current = rendererDouble("image"); let calls = 0;
  const player = new ProjectionPlayer(audience, async () => ++calls === 1 ? gate.promise : current); cleanup(() => player.destroy());
  const first = snapshot(); const loading = player.receive(first);
  await player.receive({ ...first, revision: 2, resourceId: "image", source: source("image/png") });
  gate.resolve(old); await loading; assert.equal(old.destroyed, true); assert.equal(current.destroyed, false);
  await player.receive(null); assert.equal(current.destroyed, true); assert.equal(audience.childElementCount, 0);
  player.destroy(); await player.receive({ ...first, revision: 3 }); assert.equal(calls, 2);
});

test("video real de audiencia permanece silenciado al reproducir, buscar, volumen y mute", async t => {
  const { audience, window, cleanup } = dom(t); const prototype = window.HTMLMediaElement.prototype; const paused = new WeakMap();
  t.mock.method(prototype, "load", () => {});
  t.mock.method(prototype, "play", async function () { paused.set(this, false); this.dispatchEvent(new window.Event("play")); });
  t.mock.method(prototype, "pause", function () { paused.set(this, true); this.dispatchEvent(new window.Event("pause")); });
  Object.defineProperty(prototype, "paused", { configurable: true, get() { return paused.get(this) !== false; } });
  Object.defineProperty(prototype, "duration", { configurable: true, get: () => 100 });
  const renderer = new VideoRenderer(); cleanup(() => renderer.destroy());
  await renderer.mount(audience, source("video/webm"), { page: 1, volume: .8, muted: false, silent: true, onState() {}, onPage() {} });
  const video = audience.querySelector("video");
  await renderer.applyPlayback({ ...initialRendererState(), playing: true, time: 15, duration: 100 });
  assert.equal(video.paused, false); assert.equal(video.currentTime, 15);
  await renderer.command("MUTE"); renderer.setVolume(1); assert.equal(video.muted, true); assert.equal(video.volume, 0);
  await renderer.applyPlayback({ ...initialRendererState(), playing: false, time: 35, duration: 100 });
  assert.equal(video.paused, true); assert.equal(video.currentTime, 35); renderer.destroy(); assert.equal(video.hasAttribute("src"), false);
});

test("shortcuts del profesor gobiernan proyector offline y mantienen notas privadas", async t => {
  const { root, audience, window, cleanup } = dom(t); const native = bridge(); const followerRenderers = [];
  const follower = new ProjectionPlayer(audience, async kind => { const renderer = rendererDouble(kind); followerRenderers.push(renderer); return renderer; });
  cleanup(() => follower.destroy()); native.publish = async value => { native.snapshots.push(value); await follower.receive(value); };
  const manifest = fixture(); manifest.slides[1].metadata.notes = "Solo para profesor";
  const classroom = { manifest, resolveResource(id) { const resource = manifest.resources.find(value => value.resourceId === id); return { path: `/cache/${id}`, mimeType: resource.download.mimeType, name: resource.name, kind: resource.kind }; } };
  const player = new ClassroomPlayer(root, classroom, () => {}, { projectionBridge: native, verifyResource: async () => true, toUrl: path => `asset://localhost${path}`, createRenderer: async kind => rendererDouble(kind) });
  cleanup(() => player.destroy()); t.mock.method(globalThis, "fetch", () => { throw new Error("Internet prohibido"); }); await tick();
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true })); await tick();
  assert.equal(player.controller.page, 2); assert.equal(native.snapshots.at(-1).page, 2); assert.equal(followerRenderers.at(-1).pages.at(-1), 2);
  assert.equal(root.querySelector("[data-notes]").textContent, "Solo para profesor"); assert.equal(audience.textContent.includes("Solo para profesor"), false);
  assert.equal(globalThis.fetch.mock.callCount(), 0); player.destroy(); await tick(); assert.equal(native.closed.length, 1);
});

test("capabilities separan audiencia de caché/identidad/dialog y bootstrap no inicia Firebase", async () => {
  const capability = JSON.parse(await readFile(new URL("../src-tauri/capabilities/audience.json", import.meta.url), "utf8"));
  assert.deepEqual(capability.windows, ["audience"]); assert.deepEqual(capability.permissions, ["core:event:allow-listen", "core:event:allow-unlisten"]);
  const teacher = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.deepEqual(teacher.windows, ["teacher"]); assert.ok(teacher.permissions.includes("core:window:allow-set-fullscreen-on-monitor"));
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8"); assert.match(main, /getCurrentWindow\(\).label === "audience"/);
  const audienceEntry = await readFile(new URL("../src/player/projection/mountProjection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(audienceEntry, /firebase|offline\/auth|sync\.ts/); assert.match(audienceEntry, /stopPropagation/);
});
