import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";

const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, seconds = 8) { const end = Date.now() + seconds * 1000; while (!check() && Date.now() < end) await delay(25); assert(check(), "Estado multimedia esperado no llegó"); }
const observations = [];
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
  const response = await fetch(source.url, { headers: { Range: "bytes=0-1" } });
  assert(response.status === 206 && response.headers.get("Accept-Ranges") === "bytes" && response.headers.get("Content-Length") === "2" && response.headers.get("Content-Type") === "video/mp4", "Range probe del WebView falló");
  await response.body?.cancel();
  const renderer = new VideoRenderer(); let state = initialRendererState();
  await renderer.mount(document.querySelector("#media"), source, { ...rendererOptions, onState(value) { state = value; } });
  const media = renderer.media;
  await until(() => media.readyState >= 2 || !!media.error);
  assert(!media.error, `HTTP MediaError ${media.error?.code}`);
  assert(source.codecMime?.includes("avc1.") && source.codecMime?.includes("mp4a.40.2"), "Códecs reales ausentes del diagnóstico");
  assert(media.canPlayType(source.codecMime), "Códecs reales no disponibles en runner");
  assert(media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'), "H264/AAC no disponible en runner");
  await renderer.command("PLAY_PAUSE"); await until(() => media.currentTime > .15); await renderer.command("PLAY_PAUSE"); assert(media.paused, "Pause");
  renderer.seek(5); await until(() => !media.seeking && Math.abs(media.currentTime - 5) < .3);
  renderer.seek(1); await until(() => !media.seeking && Math.abs(media.currentTime - 1) < .3);
  renderer.setVolume(.25); assert(media.volume === .25, "Volumen");
  await renderer.command("MUTE"); assert(media.muted === false, "Mute toggle"); await renderer.command("MUTE");
  await invoke("fixture_fullscreen", { active: true }); await delay(200); await invoke("fixture_fullscreen", { active: false });
  const projected = new ProjectionPlayer(document.querySelector("#audience"));
  await projected.receive({ sessionId: "media-fixture", revision: 1, unitId: "u", version: 1, resourceId: "v", slideIndex: 0, page: 1, source, playback: { ...state, time: 1, playing: true, muted: false }, updatedAt: Date.now() });
  await until(() => document.querySelector("#audience video")?.currentTime > 1);
  assert(document.querySelector("#audience video").muted, "Audiencia debe conservar silencio"); projected.destroy();
  observations.push({ transport: "loopback", size: source.sizeBytes, codecMime: source.codecMime, code: media.error?.code || 0, loaded: true, playPauseSeekVolumeMuteFullscreenProjection: true }); renderer.destroy();
}
function emptyRenderer(kind) {
  return { kind, async mount(host, source, options) { host.textContent = source.name; options.onState({ ...initialRendererState(), pages: 80 }); }, command() {}, setPage() {}, seek() {}, setVolume() {}, destroy() {} };
}
async function scroll(seed) {
  const manifest = structuredClone(seed); const base = manifest.resources[0];
  base.download.mimeType = "image/png"; base.kind = "image";
  manifest.resources = [base];
  for (let index = 0; index < 120; index++) { const resource = structuredClone(base); resource.resourceId = `resource-${index}`; resource.name = `Recurso ${index + 1} con nombre largo`; manifest.resources.push(resource); }
  manifest.generalResourceIds = manifest.resources.slice(61).map(item => item.resourceId);
  manifest.slides = Array.from({ length: 80 }, (_, index) => ({ slideId: `slide-${index}`, index, title: `Diapositiva ${index + 1}`, resourceIds: manifest.resources.slice(1, 61).map(item => item.resourceId), metadata: { pageNumber: index + 1, notes: "Notas" } }));
  const root = document.querySelector("#app");
  const classroom = { manifest, resolveResource(id) { const resource = manifest.resources.find(item => item.resourceId === id); return { path: "/cache/hash", name: resource.name, mimeType: resource.download.mimeType, kind: resource.kind }; } };
  const player = new ClassroomPlayer(root, classroom, () => {}, { verifyResource: async () => true, toUrl: () => "asset://localhost/cache/hash", createRenderer: async kind => emptyRenderer(kind) });
  try {
    await delay(100);
    const panel = root.querySelector(".player-resources"); const projection = root.querySelector(".player-projection");
    assert(panel.getBoundingClientRect().bottom <= innerHeight + 1, "Panel fuera del viewport");
    assert(getComputedStyle(root.querySelector(".player-scroll-list")).overflowY === "auto", "Lista sin scroll");
    const bounds = projection.getBoundingClientRect();
    for (const selector of ["[data-slides]", "[data-associated]", "[data-general]"]) {
      const list = root.querySelector(selector); const last = list.lastElementChild;
      list.scrollTop = list.scrollHeight;
      const sections = root.querySelector(".player-resource-sections"); sections.scrollTop += last.getBoundingClientRect().bottom - sections.getBoundingClientRect().bottom;
      await delay(25);
      const rectangle = last.getBoundingClientRect();
      assert(rectangle.top >= list.getBoundingClientRect().top - 1 && rectangle.bottom <= list.getBoundingClientRect().bottom + 1, `${selector}: último elemento cortado`);
      assert(rectangle.bottom <= innerHeight + 1, `${selector}: último elemento fuera de ventana`);
      assert(projection.getBoundingClientRect().top === bounds.top, "Bloque proyección se desplazó");
      observations.push({ scroll: selector, last: last.textContent, reachable: true });
    }
    root.querySelector("[data-slides]").lastElementChild.click(); await delay(25); assert(player.controller.slideIndex === 79, "Última diapositiva inaccesible");
    root.querySelector("[data-associated]").lastElementChild.click(); await delay(25); assert(player.controller.selectedResourceId === "resource-59", "Último asociado inaccesible");
    root.querySelector("[data-general]").lastElementChild.click(); await delay(25); assert(player.controller.selectedResourceId === "resource-119", "Último general inaccesible");
    root.querySelector("[data-presentation]").click(); await delay(25); assert(player.controller.isPresentation, "Volver a presentación");
  } finally { player.destroy(); }
}
async function run() {
try {
  const fixture = await invoke("media_fixture");
  await oldAsset(fixture.source, fixture.path);
  await video(fixture.source); await video(fixture.source); // Reopen, fully local.
  await video(fixture.largeSource);
  await scroll(fixture.manifest);
  await invoke("fixture_size", { width: 920, height: 640 }); await delay(200); await scroll(fixture.manifest);
  await invoke("fixture_report", { ok: true, result: observations });
} catch (error) { await invoke("fixture_report", { ok: false, result: { error: String(error), observations } }); }
}
void run();
