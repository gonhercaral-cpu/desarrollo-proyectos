import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "../src/design-system.css";
import "../src/styles.css";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";
import { sidebarMarkup } from "../src/ui/shell.ts";
import "../src/offline/library.css";
import "../src/player/player.css";
import { interactiveSlides } from "./builds-browser.mjs";
import { validateManifest, canonical, sha256 } from "../src/offline/manifest.ts";
import { createRenderer } from "../src/player/renderers/factory.ts";
import { PdfRenderer } from "../src/player/renderers/Presentation/PdfRenderer.ts";
import { mediaPerformance } from "./media-performance.mjs";
import { playAndObserve } from "./media-play-observer.mjs";

const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function checkpoint(phase) { await invoke("fixture_checkpoint", { phase }); }
async function bounded(operation, phase) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Native operation timed out: ${phase}`)), 15000); })]);
  } finally { clearTimeout(timer); }
}
async function until(check, seconds = 8) { const end = Date.now() + seconds * 1000; while (!check() && Date.now() < end) await delay(25); assert(check(), "Estado multimedia esperado no llegó"); }
export const observations = [];
let nativeProjection = false;
let projectionRevision = 0;
const rendererOptions = { page: 1, volume: .5, muted: true, onPage() {}, onState() {} };
async function oldAsset(source, path) {
  const renderer = new VideoRenderer(); let state = initialRendererState();
  await renderer.mount(document.querySelector("#media"), { ...source, url: convertFileSrc(path) }, { ...rendererOptions, onState(value) { state = value; } });
  const media = renderer.media;
  const end = Date.now() + 8000;
  while (media.readyState < 1 && !media.error && Date.now() < end) await delay(25);
  observations.push({ transport: "asset", loaded: media.readyState >= 1, code: media.error?.code || 0, message: media.error?.message || "", networkState: media.networkState, readyState: media.readyState });
  renderer.destroy();
}
async function video(source) {
  await checkpoint(`video-${source.sizeBytes}:range-probes`);
  observations.push({ phase: "before-video", size: source.sizeBytes, memory: await invoke("fixture_memory") });
  const response = await fetch(source.url, { headers: { Range: "bytes=0-1" } });
  assert(response.status === 206 && response.headers.get("Accept-Ranges") === "bytes" && response.headers.get("Content-Length") === "2" && response.headers.get("Content-Type") === "video/mp4", "Range probe del WebView falló");
  await response.body?.cancel();
  const full = await fetch(source.url);
  assert(full.status === 200 && Number(full.headers.get("Content-Length")) === source.sizeBytes, "Respuesta sin Range inválida");
  const reader = full.body.getReader(); const chunk = await reader.read();
  assert(chunk.value.length > 0, "Streaming sin Range vacío"); await reader.cancel();
  const invalid = await fetch(source.url, { headers: { Range: `bytes=${source.sizeBytes}-` } });
  assert(invalid.status === 416, "Range inválido debe devolver 416"); await invalid.body?.cancel();
  const renderer = new VideoRenderer(); let state = initialRendererState();
  await checkpoint(`video-${source.sizeBytes}:mount`);
  await renderer.mount(document.querySelector("#media"), source, { ...rendererOptions, onState(value) { state = value; } });
  const media = renderer.media;
  await until(() => media.readyState >= 2 || !!media.error);
  observations.push({ phase: "loaded-video", size: source.sizeBytes, memory: await invoke("fixture_memory"), videos: document.querySelectorAll("video").length });
  assert(!media.error, `HTTP MediaError ${media.error?.code}`);
  assert(source.codecMime?.includes("avc1.") && source.codecMime?.includes("mp4a.40.2"), "Códecs reales ausentes del diagnóstico");
  assert(media.canPlayType(source.codecMime), "Códecs reales no disponibles en runner");
  assert(media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'), "H264/AAC no disponible en runner");
  await checkpoint(`video-${source.sizeBytes}:first-play`);
  observations.push({ phase: "first-play", ...await playAndObserve(renderer) }); await until(() => media.currentTime > .15); await renderer.command("PLAY_PAUSE"); assert(media.paused, "Pause");
  await checkpoint(`video-${source.sizeBytes}:seeks`);
  const lateSeek = media.duration * .75;
  renderer.seek(lateSeek); await until(() => !media.seeking && Math.abs(media.currentTime - lateSeek) < .3);
  renderer.seek(5); await until(() => !media.seeking && Math.abs(media.currentTime - 5) < .3);
  renderer.seek(1); await until(() => !media.seeking && Math.abs(media.currentTime - 1) < .3);
  // PulseAudio quantizes its native gain (25% returns 0.249998316...), so
  // verify the requested percentage rather than bit equality of sink doubles.
  renderer.setVolume(.25); assert(Math.round(media.volume * 100) === 25, `Volumen esperado=25% observado=${media.volume * 100}%`);
  await renderer.command("MUTE"); assert(media.muted === false, "Mute toggle"); await renderer.command("MUTE");
  await invoke("fixture_fullscreen", { active: true }); await delay(200); await invoke("fixture_fullscreen", { active: false });
  await checkpoint(`video-${source.sizeBytes}:teacher-resume`);
  // Feed the real, advancing teacher clock. A single fabricated playing=true
  // snapshot from a paused teacher is a frozen authority: the projector must
  // stop following it after one second. Slow native preroll on Ubuntu 26 exposed
  // that invalid fixture, not a reason to weaken the production clock watchdog.
  const snapshot = () => ({ sessionId: "media-fixture", revision: ++projectionRevision, unitId: "u", version: 1, resourceId: "v", slideIndex: 0, page: 1, source, playback: { ...state, time: media.currentTime, playing: !media.paused && !media.ended, seeking: media.seeking, muted: false }, updatedAt: Date.now() });
  const firstRevision = projectionRevision + 1;
  const projected = nativeProjection ? undefined : new ProjectionPlayer(document.querySelector("#audience"));
  try {
    observations.push({ phase: "teacher-resume", ...await playAndObserve(renderer) });
    await checkpoint(`video-${source.sizeBytes}:projector-poll`);
    let audience;
    for (let count = 0; count < 100; count++) {
      const current = snapshot();
      if (nativeProjection) {
        await bounded(invoke("fixture_project", { snapshot: current }), "projector-publish");
        audience = await bounded(invoke("fixture_audience_state"), "projector-state");
      } else {
        await projected.receive(current);
        const video = document.querySelector("#audience video");
        audience = video ? { revision: current.revision, time: video.currentTime, paused: video.paused, muted: video.muted, videos: document.querySelectorAll("#audience video").length, audio: document.querySelectorAll("#audience audio").length, error: video.error?.code || 0 } : undefined;
      }
      if (audience?.revision >= firstRevision && audience.time > 1 && !audience.paused) break;
      await delay(80);
    }
    assert(audience?.revision >= firstRevision && audience.revision <= projectionRevision && audience.time > 1 && !audience.paused && audience.muted && audience.videos === 1 && audience.audio === 0 && !audience.error, `Video en segunda ventana falló: ${JSON.stringify(audience)}`);
    assert(media.currentTime > 1 && !media.paused && !media.error, "Maestro debe reproducir realmente durante la prueba del proyector");
    assert(document.querySelectorAll(nativeProjection ? "video" : "#media video").length === 1, "Profesor contiene decoders duplicados");
  } finally {
    await checkpoint(`video-${source.sizeBytes}:projection-cleanup`);
    if (!media.paused) await renderer.command("PLAY_PAUSE");
    if (nativeProjection) await invoke("fixture_project", { snapshot: null });
    projected?.destroy();
  }
  observations.push({ phase: "after-projection", size: source.sizeBytes, memory: await invoke("fixture_memory") });
  observations.push({ transport: "loopback", size: source.sizeBytes, codecMime: source.codecMime, code: media.error?.code || 0, loaded: true, playPauseSeekVolumeMuteFullscreenProjection: true }); renderer.destroy();
  await delay(250);
  assert(document.querySelectorAll("video").length === 0, "Quedó un decoder huérfano");
  observations.push({ phase: "after-close", size: source.sizeBytes, memory: await invoke("fixture_memory") });
  await checkpoint(`video-${source.sizeBytes}:closed`);
}
function emptyRenderer(kind) {
  return { kind, async mount(host, source, options) { host.textContent = source.name; options.onState({ ...initialRendererState(), pages: 80 }); }, command() {}, setPage() {}, seek() {}, setVolume() {}, destroy() {} };
}
async function backgroundMusic(fixture, videoSource) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  // PDF.js official main-thread fallback for this tiny fixture. Production worker
  // stays untouched; fixture origin does not serve the production asset bundle.
  globalThis.pdfjsWorker = { WorkerMessageHandler };
  const input = structuredClone(fixture.manifest);
  if (fixture.globalTracks) {
    delete input.backgroundMusic;
    const content = Object.fromEntries(Object.entries(input).filter(([key]) => !["version","publishedAt","integrity"].includes(key)));
    input.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  }
  const manifest = await validateManifest(input);
  const host = document.createElement("div"); document.body.append(host);
  const classroom = { manifest, resolveResource(id) { const resource = manifest.resources.find(item => item.resourceId === id); return { path: fixture.paths[id], mimeType: resource.download.mimeType, name: resource.name, kind: resource.kind }; } };
  // Keep old manifests readable, but music selection/resolution uses only the
  // global catalog. A Unit with no backgroundMusic must behave identically.
  const player = new ClassroomPlayer(host, classroom, () => {}, { verifyResource: async () => true, toUrl: convertFileSrc, prepareMediaSource: async id => id === "music-wave" ? fixture.source : videoSource, ...(fixture.globalTracks ? { ambientMusic: { tracks: fixture.globalTracks, prepare: async () => fixture.globalSource } } : {}), createRenderer: kind => kind === "pdf" ? Promise.resolve(new PdfRenderer(async data => getDocument({ data }))) : createRenderer(kind) });
  try {
    await until(() => !host.querySelector("[data-status]").textContent);
    await player.dispatch("BACKGROUND_MUSIC_PLAY_PAUSE");
    const audio = host.querySelector("audio");
    await until(() => audio.currentTime > .15); assert(!audio.paused, "Música offline no reproduce");
    await player.dispatch("ADVANCE"); await delay(200);
    assert(player.controller.currentBuild === 1 && host.querySelector("audio") === audio && !audio.paused, "Revelado reinició música");
    await player.dispatch("ADVANCE"); await player.dispatch("ADVANCE"); await delay(200);
    assert(player.controller.slideIndex === 1 && !audio.paused, "Cambiar slide detuvo música");
    const volume = host.querySelector("[data-music-volume]"); volume.value = ".2"; volume.dispatchEvent(new Event("input"));
    assert(Math.round(audio.volume * 100) === 20, `Volumen de música no independiente: ${audio.volume}`);
    host.querySelector("[data-general] [data-resource]").click();
    await until(() => host.querySelector("video")?.readyState >= 2);
    assert(!audio.paused, "Abrir recurso pausado reinició música");
    await player.dispatch("PLAY_PAUSE"); await until(() => host.querySelector("video").currentTime > .15);
    assert(audio.paused && Math.round(audio.volume * 100) === 20 && Math.round(host.querySelector("video").volume * 100) === 80, "Multimedia compite con música o mezcló volúmenes");
    host.querySelector("[data-presentation]").click(); await delay(200);
    assert(audio.paused, "Música reanudó inesperadamente");
    await player.dispatch("BACKGROUND_MUSIC_PLAY_PAUSE"); await until(() => !audio.paused);
    await player.dispatch("BACKGROUND_MUSIC_PLAY_PAUSE"); assert(audio.paused, "Pausa manual no aplicada");
    const openVideo = () => host.querySelector(`[data-resource="${manifest.generalResourceIds[0]}"]`).click();
    openVideo(); await until(() => host.querySelector("video")?.readyState >= 2);
    host.querySelector('[data-resource="transition-pdf"]').click();
    await until(() => !!host.querySelector("canvas") || !!host.querySelector("[data-status]").textContent.includes("No se pudo"));
    assert(host.querySelector("canvas") && !host.querySelector("video"), "Video a PDF dejó decoder o no renderizó PDF");
    openVideo(); await until(() => host.querySelector("video")?.readyState >= 2);
    await player.dispatch("PLAY_PAUSE"); await until(() => host.querySelector("video").currentTime > .15); await player.dispatch("PLAY_PAUSE");
    assert(audio.paused, "Transición PDF/video perdió pausa manual");
    const audience = await invoke("fixture_audience_state"); assert(!audience.audio, "Proyector contiene segunda música");
    observations.push({ backgroundMusic: true, realWav: true, offline: true, survivesSlidesAndBuilds: true, independentVolume: true, automaticPause: true, explicitResumeOnly: true, singleAudioOwner: true, videoPdfVideo: true });
  } finally { player.destroy(); host.remove(); }
}
export async function scroll(seed, slideCount = 80, changeProjectorStatus = false) {
  const manifest = structuredClone(seed); const base = manifest.resources[0];
  base.download.mimeType = "image/png"; base.kind = "image";
  manifest.resources = [base];
  for (let index = 0; index < 120; index++) { const resource = structuredClone(base); resource.resourceId = `resource-${index}`; resource.name = `Recurso ${index + 1} con nombre largo`; manifest.resources.push(resource); }
  manifest.generalResourceIds = manifest.resources.slice(61).map(item => item.resourceId);
  manifest.slides = Array.from({ length: slideCount }, (_, index) => ({ slideId: `slide-${index}`, index, title: `Diapositiva ${index + 1}`, resourceIds: manifest.resources.slice(1, 61).map(item => item.resourceId), metadata: { pageNumber: index + 1, notes: "Notas" } }));
  const root = document.querySelector("#app");
  for (const selector of ["#media", "#audience"]) { const host = document.querySelector(selector); if (host) host.hidden = true; }
  root.className = "desktop-shell is-classroom";
  root.innerHTML = sidebarMarkup({ levels: ["level-1"], selectedLevel: "", inClass: true, deviceName: "Aula de prueba", state: "Sincronizado", updatedAt: Date.now() }) + '<main class="classroom-workspace"></main>';
  const host = root.querySelector(".classroom-workspace");
  const classroom = { manifest, resolveResource(id) { const resource = manifest.resources.find(item => item.resourceId === id); return { path: "/cache/hash", name: resource.name, mimeType: resource.download.mimeType, kind: resource.kind }; } };
  let failProjectorPublish;
  const pendingPublish = new Promise((resolve, reject) => { failProjectorPublish = reject; });
  const projectionBridge = changeProjectorStatus ? { status: () => new Promise(() => {}), publish: () => pendingPublish, async show() {}, async hide() {} } : undefined;
  const player = new ClassroomPlayer(host, classroom, () => {}, { verifyResource: async () => true, toUrl: () => "asset://localhost/cache/hash", createRenderer: async kind => emptyRenderer(kind), projectionBridge });
  try {
    await delay(100);
    const panel = root.querySelector(".player-resources"); const projection = root.querySelector(".player-projection");
    assert(panel.getBoundingClientRect().bottom <= innerHeight + 1, "Panel fuera del viewport");
    assert(root.scrollWidth <= innerWidth + 1, "La aplicación desborda horizontalmente");
    const sidebar = root.querySelector(".classroom-sidebar");
    assert(sidebar.scrollWidth <= sidebar.clientWidth + 1, "Sidebar desborda horizontalmente");
    const footer = [...root.querySelectorAll(".classroom-sidebar-footer > *")];
    for (let index = 1; index < footer.length; index++) assert(footer[index].getBoundingClientRect().top > footer[index - 1].getBoundingClientRect().bottom, "Footer encimado");
    assert(footer.at(-1).getBoundingClientRect().bottom <= innerHeight + 1, "Versión fuera de ventana");
    for (const selector of ["[data-exit]", "[data-slide-next]", "[data-command='FULLSCREEN']", "[data-project]"]) {
      const bounds = root.querySelector(selector).getBoundingClientRect();
      assert(bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1, `${selector}: botón cortado`);
    }
    assert(getComputedStyle(root.querySelector(".player-scroll-list")).overflowY === "auto", "Lista sin scroll");
    const bounds = projection.getBoundingClientRect();
    for (const selector of ["[data-slides]", "[data-associated]", "[data-general]"]) {
      const list = root.querySelector(selector); const last = list.lastElementChild;
      list.scrollTop = list.scrollHeight;
      await until(() => Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 1.5, 2);
      const before = { projectorHeight: projection.getBoundingClientRect().height, clientHeight: list.clientHeight, scrollTop: list.scrollTop, status: root.querySelector("[data-projector-status]").textContent };
      if (changeProjectorStatus && selector === "[data-slides]") failProjectorPublish(new Error("Salida de proyección desconectada"));
      const sections = root.querySelector(".player-resource-sections");
      const bottomOverflow = last.getBoundingClientRect().bottom - sections.getBoundingClientRect().bottom;
      if (bottomOverflow > 0) sections.scrollTop += bottomOverflow;
      await delay(50);
      const rectangle = last.getBoundingClientRect();
      observations.push({ viewport: [innerWidth, innerHeight], slides: slideCount, selector, before, projectorHeight: projection.getBoundingClientRect().height, status: root.querySelector("[data-projector-status]").textContent, scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, clientWidth: list.clientWidth, scrollWidth: list.scrollWidth, list: list.getBoundingClientRect().toJSON(), last: rectangle.toJSON(), sections: sections.getBoundingClientRect().toJSON(), display: getComputedStyle(last).display });
      if (changeProjectorStatus && selector === "[data-slides]") {
        assert(root.querySelector("[data-projector-status]").textContent.includes("No se pudo actualizar el proyector"), "La transición del estado no ocurrió");
        assert(projection.getBoundingClientRect().height === before.projectorHeight && list.clientHeight === before.clientHeight, "El estado del Proyector cambió la altura de la lista");
      }
      assert(rectangle.top >= list.getBoundingClientRect().top - 1 && rectangle.bottom <= list.getBoundingClientRect().bottom, `${selector}: último elemento cortado`);
      assert(rectangle.bottom <= innerHeight + 1, `${selector}: último elemento fuera de ventana`);
      assert(projection.getBoundingClientRect().top === bounds.top, "Bloque proyección se desplazó");
      observations.push({ scroll: selector, last: last.textContent, reachable: true });
    }
    root.querySelector("[data-slides]").lastElementChild.click(); await delay(25); assert(player.controller.slideIndex === slideCount - 1, "Última diapositiva inaccesible");
    root.querySelector("[data-associated]").lastElementChild.querySelector("[data-resource]").click(); await delay(25); assert(player.controller.selectedResourceId === "resource-59", "Último asociado inaccesible");
    root.querySelector("[data-general]").lastElementChild.querySelector("[data-resource]").click(); await delay(25); assert(player.controller.selectedResourceId === "resource-119", "Último general inaccesible");
    root.querySelector("[data-presentation]").click(); await delay(25); assert(player.controller.isPresentation, "Volver a presentación");
    observations.push({ responsive: [innerWidth, innerHeight], slides: slideCount, associated: 60, general: 60, footerSeparated: true, allLastItemsAccessible: true });
  } finally { player.destroy(); }
}
async function run() {
try {
  await checkpoint("startup");
  const fixture = await invoke("media_fixture");
  nativeProjection = fixture.nativeProjection;
  if (nativeProjection) { let ready; for (let count = 0; count < 100; count++) { ready = await invoke("fixture_audience_state"); if (ready?.ready) break; await delay(50); } assert(ready?.ready, "Ventana proyector no quedó lista"); }
  observations.push({ phase: "startup-memory", memory: await invoke("fixture_memory") });
  await checkpoint("asset-protocol-control"); await oldAsset(fixture.source, fixture.path);
  await video(fixture.source); await video(fixture.source); // Reopen, fully local.
  for (const source of fixture.largeSources || [fixture.largeSource]) await video(source);
  const memory = () => invoke("fixture_memory");
  const baseline = await memory();
  for (let index = 0; index < 10; index++) await video(fixture.largeSource);
  const after = await memory();
  const rss = process => Number.parseInt(process.rss || "0", 10);
  for (const process of after) {
    const before = baseline.find(item => item.pid === process.pid);
    if (before) {
      assert(rss(process) - rss(before) < 160 * 1024, `Memoria crece al reabrir: ${process.name}`);
      if (Number.isFinite(process.descriptors)) assert(process.descriptors <= before.descriptors + 32, `Descriptores crecen al reabrir: ${process.name}`);
      if (process.threads) assert(Number(process.threads) <= Number(before.threads) + 16, `Threads crecen al reabrir: ${process.name}`);
    }
    if (process.pid === after[0].pid) assert(rss(process) < 256 * 1024, "Proceso principal carga archivo completo");
    if (process.name.startsWith("WebKitWeb")) assert(rss(process) < 768 * 1024, "WebKit almacena video completo en RAM");
  }
  observations.push({ repetitiveMemory: { baseline, after, opens: 10, bounded: true } });
  await checkpoint("interactive-slides"); observations.push({ interactiveSlides: await interactiveSlides(fixture.buildFixture) });
  if (fixture.musicFixture) { await checkpoint("background-music"); await backgroundMusic(fixture.musicFixture, fixture.source); }
  if (fixture.performance) { await checkpoint("performance-stress"); observations.push({ performance: await mediaPerformance(fixture) }); }
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [920, 640]]) {
    await checkpoint(`layout-${width}-${height}`); await invoke("fixture_size", { width, height }); await delay(200); await scroll(fixture.manifest);
    for (const count of [10, 50, 120]) await scroll(fixture.manifest, count, true);
  }
  await invoke("fixture_report", { ok: true, result: observations });
} catch (error) { await invoke("fixture_report", { ok: false, result: { error: String(error), observations } }); }
}
async function runAudience() {
  const projected = new ProjectionPlayer(document.querySelector("#audience"));
  let revision = 0; let seekEvents = 0;
  let observed; let frameCallback; let presentedFrames = 0; let frameTime = 0;
  const frame = (_now, metadata) => { presentedFrames = metadata.presentedFrames; frameTime = metadata.mediaTime; frameCallback = observed.requestVideoFrameCallback(frame); };
  document.addEventListener("seeking", event => { if (event.target instanceof HTMLVideoElement) seekEvents++; }, true);
  await listen("fixture-projection", event => { revision = event.payload?.revision || 0; void projected.receive(event.payload); });
  await invoke("fixture_audience_state", { report: { ready: true } });
  setInterval(() => {
    const media = document.querySelector("video"); const quality = media?.getVideoPlaybackQuality?.();
    if (media !== observed) {
      if (frameCallback !== undefined) observed?.cancelVideoFrameCallback?.(frameCallback);
      observed = media; presentedFrames = 0; frameTime = 0;
      frameCallback = observed?.requestVideoFrameCallback?.(frame);
    }
    void invoke("fixture_audience_state", { report: { ready: true, revision, seekEvents, time: media?.currentTime || 0, paused: media?.paused, seeking: media?.seeking, readyState: media?.readyState, muted: media?.muted, frames: quality?.totalVideoFrames, droppedFrames: quality?.droppedVideoFrames, presentedFrames: media?.requestVideoFrameCallback ? presentedFrames : null, frameTime: media?.requestVideoFrameCallback ? frameTime : null, videos: document.querySelectorAll("video").length, audio: document.querySelectorAll("audio").length, error: media?.error?.code || 0 } });
  }, 80);
}
if (location.pathname === "/projection-test.html") void runAudience();
else if (!document.documentElement.hasAttribute("data-layout-only")) void run();
