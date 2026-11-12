import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, sha256, validateManifest } from "../src/offline/manifest.ts";
import { animatedSource, preloadAnimationImage } from "../src/player/animated-source.ts";
import { SyncEngine, openLocalClass } from "../src/offline/sync.ts";
import { localSource } from "../src/player/local-source.ts";
import { DiskCache } from "./disk-cache.mjs";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
function fixture() {
  const manifest = structuredClone(example);
  manifest.resources[0].download.mimeType = "image/png";
  const base = manifest.resources[0];
  for (const [id, mime] of [["background", "image/png"], ["animated", "image/gif"]]) manifest.resources.push({ ...structuredClone(base), resourceId: id, download: { ...structuredClone(base.download), mimeType: mime } });
  base.animation = { backgroundResourceId: "background", images: [{ resourceId: "animated", x: 10, y: 20, width: 30, height: 40 }] };
  return manifest;
}
async function sign(manifest) {
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  return manifest;
}

test("manifest híbrido conserva PNG completo y valida referencias, MIME, geometría y cuotas", async () => {
  await validateManifest(await sign(fixture()));
  for (const mutate of [
    m => { m.resources[0].animation.backgroundResourceId = "missing"; },
    m => { m.resources[0].animation.images[0].resourceId = "background"; },
    m => { m.resources[0].animation.images[0].width = 95; },
    m => { m.resources[0].animation.images[0].x = NaN; },
    m => { m.resources.find(resource => resource.resourceId === "animated").animation = m.resources[0].animation; },
    m => { m.resources[0].animation.images = Array(9).fill(m.resources[0].animation.images[0]); },
  ]) {
    const m = fixture(); mutate(m);
    await assert.rejects(validateManifest(await sign(m)), { code: "manifest" });
  }
});

test("fuente híbrida precarga todos los archivos antes de quitar representación estática", async () => {
  const classroom = { manifest: fixture() };
  const fallback = { url: "asset://localhost/full.png", mimeType: "image/png", sizeBytes: 1, name: "Slide" };
  const preloaded = [];
  const source = await animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
    async id => ({ ...fallback, url: `asset://localhost/${id}`, mimeType: id === "animated" ? "image/gif" : "image/png" }),
    async value => { preloaded.push(value.url); });
  assert.equal(source.url, "asset://localhost/background");
  assert.deepEqual(source.layers, [{ type: "image", x: 10, y: 20, width: 30, height: 40, url: "asset://localhost/animated", fit: "fill" }]);
  assert.equal(preloaded.length, 2);
  assert.equal(fallback.layers, undefined);
});

test("asset ausente o GIF inválido conserva diapositiva estática completa", async () => {
  const classroom = { manifest: fixture() }; const fallback = { url: "asset://localhost/full.png" };
  for (const failed of ["load", "decode"]) {
    const source = await animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
      async () => { if (failed === "load") throw new Error("damaged"); return fallback; },
      async () => { throw new Error("invalid-gif"); });
    assert.equal(source, fallback);
  }
});

function fakeImage(t) {
  const created = []; const previous = Object.getOwnPropertyDescriptor(globalThis, "Image");
  globalThis.Image = class { constructor() { this.attrs = new Map(); this.decodes = 0; created.push(this); }
    set src(value) { this.attrs.set("src", value); } get src() { return this.attrs.get("src"); }
    removeAttribute(name) { this.attrs.delete(name); } decode() { this.decodes++; return new Promise(() => {}); } };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "Image", previous); else delete globalThis.Image; });
  return created;
}

test("preloadAnimationImage: abort limpia src, cancela timeout y no espera decode", async t => {
  const created = fakeImage(t); const cleared = []; const realClear = globalThis.clearTimeout;
  t.mock.method(globalThis, "clearTimeout", handle => { cleared.push(handle); realClear(handle); });
  const controller = new AbortController();
  const pending = preloadAnimationImage({ url: "asset://localhost/x" }, controller.signal);
  const outcome = assert.rejects(pending, /animation-load-aborted/);
  assert.equal(created[0].src, "asset://localhost/x");
  controller.abort(); await outcome;
  assert.equal(created[0].attrs.has("src"), false);
  assert.equal(cleared.length, 1, "el timeout de 10 s se cancela");
});

test("preloadAnimationImage no inicia si la señal ya está abortada", async t => {
  const created = fakeImage(t); const controller = new AbortController(); controller.abort();
  await preloadAnimationImage({ url: "asset://localhost/x" }, controller.signal);
  assert.equal(created.length, 0);
});

test("animatedSource no inicia precarga si se aborta mientras espera load", async () => {
  const classroom = { manifest: fixture() }; const fallback = { url: "asset://localhost/full.png" };
  const controller = new AbortController(); let preloads = 0;
  const source = await animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
    async id => { controller.abort(); return { url: `asset://localhost/${id}` }; },
    async () => { preloads++; }, controller.signal);
  assert.equal(source, fallback); assert.equal(preloads, 0);
});

function layered(count) {
  const manifest = fixture();
  manifest.resources[0].animation = { backgroundResourceId: "background", images: Array.from({ length: count }, (_, i) => ({ resourceId: `l${i}`, x: i, y: i, width: 10, height: 10 })) };
  return manifest;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("animatedSource limita load y decode a 2 trabajos y conserva el orden de capas", async () => {
  const classroom = { manifest: layered(4) }; const fallback = { url: "asset://localhost/full.png", name: "Slide" };
  const ids = ["background", "l0", "l1", "l2", "l3"]; const gates = new Map(ids.map(id => [id, deferred()]));
  let active = 0, max = 0; const started = [];
  const enter = () => { active++; max = Math.max(max, active); };
  const pending = animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
    async id => { enter(); started.push(id); await gates.get(id).promise; active--; return { url: `asset://localhost/${id}` }; },
    async () => { enter(); await tick(); active--; });
  await tick();
  assert.deepEqual(started, ["background", "l0"]);
  for (const id of ["l3", "l2", "l1", "l0", "background"]) gates.get(id).resolve(); // l0 termina antes que el fondo
  const source = await pending;
  assert.equal(max, 2); assert.deepEqual(started, ids);
  assert.equal(source.url, "asset://localhost/background");
  assert.deepEqual(source.layers.map(layer => layer.url), ids.slice(1).map(id => `asset://localhost/${id}`));
});

test("animatedSource no procesa más capas tras abortar en el primer job", async () => {
  const classroom = { manifest: layered(4) }; const fallback = { url: "asset://localhost/full.png" };
  const controller = new AbortController(); const loads = []; const preloads = [];
  const source = await animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
    async id => { loads.push(id); return { url: `asset://localhost/${id}` }; },
    async value => { preloads.push(value.url); controller.abort(); }, controller.signal);
  assert.equal(source, fallback);
  assert.deepEqual(loads, ["background", "l0"]);
  assert.deepEqual(preloads, ["asset://localhost/background"]);
});

test("animatedSource: un error cancela precargas hermanas y retira el listener externo", async t => {
  const classroom = { manifest: layered(4) }; const fallback = { url: "asset://localhost/full.png" };
  const controller = new AbortController(); const removed = t.mock.method(controller.signal, "removeEventListener");
  const loads = []; let siblingAborted = false;
  const source = await animatedSource(classroom, classroom.manifest.mainPresentationId, fallback,
    async id => { loads.push(id); return { url: `asset://localhost/${id}` }; },
    async (value, signal) => {
      if (value.url.endsWith("/background")) throw new Error("invalid-gif");
      if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      siblingAborted = signal.aborted;
    }, controller.signal);
  await tick();
  assert.equal(source, fallback); assert.equal(siblingAborted, true);
  assert.deepEqual(loads, ["background", "l0"]);
  assert.deepEqual(removed.mock.calls.map(call => call.arguments[0]), ["abort"]);
});

test("GIF y fondo descargan con integridad y se abren después de reiniciar sin red", async t => {
  const root = await mkdtemp(join(tmpdir(), "animated-classroom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture(); const bytes = new Map();
  for (const resource of manifest.resources) {
    const data = new TextEncoder().encode(resource.resourceId);
    resource.download.sizeBytes = data.length; resource.download.checksums.sha256 = await sha256(data); bytes.set(resource.resourceId, data);
  }
  await sign(manifest);
  const publication = { ...manifest.unit, version: manifest.version, contentHash: manifest.integrity.contentHash };
  await new SyncEngine(new DiskCache(root), { async manifest() { return manifest; }, async download(_m, resource, write) { await write(bytes.get(resource.resourceId)); } }).sync(publication);
  const classroom = await openLocalClass(new DiskCache(root), manifest.unit.unitId, manifest.version);
  const load = async id => localSource(classroom, id, path => `asset://localhost/${path.replaceAll("\\", "/")}`);
  const fallback = await load(manifest.mainPresentationId);
  const animated = await animatedSource(classroom, manifest.mainPresentationId, fallback, load, async () => {});
  assert.notEqual(animated.url, fallback.url);
  assert.equal(animated.layers.length, 1);
  assert.match(animated.layers[0].url, /^asset:/);
});
