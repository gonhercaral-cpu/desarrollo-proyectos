import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { ClassSessionController, isProjectionSnapshot } from "../src/player/ClassSessionController.ts";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";
import { shortcutFor } from "../src/player/shortcuts.ts";
import { validateManifest, canonical, sha256 } from "../src/offline/manifest.ts";
import { SyncEngine, openLocalClass } from "../src/offline/sync.ts";
import { DiskCache } from "./disk-cache.mjs";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const layer = text => ({ type: "answer", text, x: 10, y: 20, width: 40, height: 10, color: "#102954", fontSize: 3 });
function fixture(count = 3) {
  const m = structuredClone(example); m.resources[0].download.mimeType = "image/png";
  m.slides.forEach((slide, index) => { slide.metadata.presentationResourceId = m.mainPresentationId; slide.metadata.pageNumber = 1; slide.resourceIds = index ? [] : ["uploaded-guide"]; });
  if (count) Object.assign(m.slides[0], { interactionMode: "builds", buildCount: count, interaction: { mode: "builds", buildCount: count, source: "manual" }, builds: Array.from({ length: count }, (_, index) => ({ order: index + 1, layers: [layer(`Respuesta ${index + 1}`)] })) });
  return m;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }
function environment(t) {
  const dom = new JSDOM("<div id='teacher'></div><div id='audience'></div><input>", { url: "http://tauri.localhost" });
  const previous = new Map();
  const cleanups = []; dom.cleanup = callback => cleanups.push(callback);
  for (const name of ["window", "document"]) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] }); }
  t.after(() => { for (const cleanup of cleanups) cleanup(); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  return dom;
}
function renderer() { return { kind: "image", mounts: 0, async mount(host, source, options) { this.mounts++; host.textContent = "base"; this.source = source; options.onState(initialRendererState()); }, async setSource(source) { this.source = source; }, setPage() {}, command() {}, seek() {}, setVolume() {}, destroy() {} }; }

for (const count of [0, 1, 3, 50]) test(`ADVANCE/BACK ${count} builds, límites y retorno a presentación`, () => {
  const c = new ClassSessionController(fixture(count));
  c.back(); assert.equal(c.slideIndex, 0);
  for (let index = 1; index <= count; index++) { c.advance(); assert.equal(c.currentBuild, index); assert.equal(c.slideIndex, 0); }
  c.selectResource("uploaded-guide"); c.returnToPresentation(); assert.equal(c.currentBuild, count);
  if (count) { c.back(); assert.equal(c.currentBuild, count - 1); c.advance(); }
  c.advance(); assert.equal(c.slideIndex, 1); assert.equal(c.currentBuild, 0);
  c.back(); assert.equal(c.slideIndex, 0); assert.equal(c.currentBuild, 0);
});

test("clic, Espacio, flechas y botones revelan sin remontar; proyector sigue estado sin indicador", async t => {
  const dom = environment(t);
  const m = fixture(); const teacher = document.querySelector("#teacher"), audience = document.querySelector("#audience");
  const projected = renderer(); const follower = new ProjectionPlayer(audience, async () => projected);
  const snapshots = [];
  const bridge = { async status() { return { monitors: [], projecting: true, disconnected: false }; }, async show() {}, async hide() {}, async publish(snapshot) { snapshots.push(snapshot); await follower.receive(snapshot); } };
  const display = renderer(); const player = new ClassroomPlayer(teacher, { manifest: m, resolveResource(id) { const resource = m.resources.find(item => item.resourceId === id); return { path: `/cache/${id}`, mimeType: resource.download.mimeType, name: resource.name, kind: "image" }; } }, () => {}, { verifyResource: async () => true, toUrl: path => `asset://localhost${path}`, createRenderer: async () => display, projectionBridge: bridge });
  dom.cleanup(() => { player.destroy(); follower.destroy(); });
  await settle();
  teacher.querySelector("[data-renderer]").click(); await settle();
  assert.equal(player.controller.currentBuild, 1); assert.match(teacher.querySelector(".interaction-surface").textContent, /Respuesta 1/);
  assert.equal(audience.querySelector(".interaction-surface").textContent, "Respuesta 1");
  assert.match(teacher.querySelector("[data-build]").textContent, /Paso 1 \/ 3/); assert.equal(audience.querySelector("[data-build]"), null);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " " })); await settle(); assert.equal(player.controller.currentBuild, 2);
  teacher.querySelector("[data-slide-next]").click(); await settle(); assert.equal(player.controller.currentBuild, 3);
  teacher.querySelector("[data-slide-previous]").click(); await settle(); assert.equal(player.controller.currentBuild, 2);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" })); await settle(); assert.equal(player.controller.currentBuild, 1);
  document.querySelector("input").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle(); assert.equal(player.controller.currentBuild, 1);
  await Promise.all([player.dispatch("ADVANCE"), player.dispatch("ADVANCE")]); await settle(); assert.equal(player.controller.currentBuild, 3);
  assert.equal(display.mounts, 1); assert.equal(projected.mounts, 1); assert.equal(snapshots.at(-1).currentBuild, 3);
  await player.dispatch("ADVANCE"); await settle(); assert.equal(player.controller.slideIndex, 1); assert.equal(audience.querySelector(".interaction-surface"), null);
});

test("manifest verifica assets y orden de builds; snapshot rechaza capas remotas", async () => {
  const m = fixture();
  for (const mutate of [slide => { slide.buildCount = 4; }, slide => { slide.builds[0].order = 2; }, slide => { slide.builds[0].layers[0].x = 101; }, slide => { slide.builds[0].layers = [{ ...layer(""), type: "image", resourceId: "missing" }]; }]) {
    const broken = structuredClone(m); mutate(broken.slides[0]); assert.throws(() => new ClassSessionController(broken));
  }
  const controller = new ClassSessionController(m); controller.record(initialRendererState(), { url: "asset://localhost/cache/base", mimeType: "image/png", name: "", sizeBytes: 10, layers: [{ ...layer(""), type: "image", url: "https://example.com/asset" }] });
  assert.equal(isProjectionSnapshot(controller.snapshot()), false);
  assert.equal(shortcutFor({ key: " ", target: null }, true), "ADVANCE");
});

test("sincroniza raster builds y assets, reinicia y recorre pasos completamente offline", async t => {
  const root = await mkdtemp(join(tmpdir(), "classroom-builds-")); t.after(() => rm(root, { recursive: true, force: true }));
  const m = fixture(); const extra = structuredClone(m.resources[0]); extra.resourceId = "state-1"; m.resources.push(extra);
  Object.assign(m.slides[0], { buildCount: 1, interaction: { mode: "builds", buildCount: 1, source: "pptx" }, builds: [{ order: 1, resourceId: "state-1" }] });
  const bytes = new Map();
  for (const resource of m.resources) { const data = new TextEncoder().encode(resource.resourceId); resource.download.sizeBytes = data.length; resource.download.checksums.sha256 = await sha256(data); bytes.set(resource.resourceId, data); }
  const content = Object.fromEntries(Object.entries(m).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key))); m.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  await validateManifest(m);
  const publication = { unitId: m.unit.unitId, version: m.version, contentHash: m.integrity.contentHash, schemaVersion: 2 };
  await new SyncEngine(new DiskCache(root), { async manifest() { return m; }, async download(_manifest, resource, chunk) { await chunk(bytes.get(resource.resourceId)); } }).sync(publication);
  const classroom = await openLocalClass(new DiskCache(root), m.unit.unitId, m.version);
  const controller = new ClassSessionController(classroom.manifest); controller.advance(); assert.equal(controller.currentBuild, 1); assert.ok(classroom.resolveResource("state-1").path.startsWith(root)); controller.advance(); assert.equal(controller.slideIndex, 1);
});
