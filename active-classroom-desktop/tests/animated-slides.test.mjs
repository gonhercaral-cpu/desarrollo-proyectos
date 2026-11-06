import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, sha256, validateManifest } from "../src/offline/manifest.ts";
import { animatedSource } from "../src/player/animated-source.ts";
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
