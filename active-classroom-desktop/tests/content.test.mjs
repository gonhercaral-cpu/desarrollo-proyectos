import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { DownloadQueue } from "../src/offline/download-queue.ts";
import { SyncEngine } from "../src/offline/sync.ts";
import { contentOwner, contentPreferences, saveContentPreferences, requiredContent } from "../src/offline/content-preferences.ts";
import { reconcileLibrary } from "../src/ui/library-dom.ts";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { DiskCache } from "./disk-cache.mjs";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const settle = async predicate => { for (let i = 0; i < 12000; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail("La cola no terminó"); };
async function fixture(id, version = 1, size = 7) {
  const block = Buffer.alloc(Math.min(size, 65536), version);
  const digest = createHash("sha256"); for (let offset = 0; offset < size; offset += block.length) digest.update(block.subarray(0, Math.min(block.length, size - offset)));
  const hash = digest.digest("hex");
  const manifest = structuredClone(example); manifest.unit.unitId = id; manifest.version = version;
  for (const resource of manifest.resources) Object.assign(resource.download, { sizeBytes: size, checksums: { sha256: hash } });
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  const publication = { unitId: id, version, levelId: manifest.unit.levelId, name: manifest.unit.name, contentHash: manifest.integrity.contentHash, schemaVersion: 2, publishedAt: manifest.publishedAt };
  return { manifest, publication, block, size };
}
async function disk(t) { const root = await mkdtemp(join(tmpdir(), "classroom-content-")); t.after(() => rm(root, { recursive: true, force: true })); return new DiskCache(root); }
function remote(fixtures, extra = {}) {
  const source = new Map(fixtures.map(value => [`${value.publication.unitId}:${value.publication.version}`, value]));
  return { manifest: async p => source.get(`${p.unitId}:${p.version}`).manifest,
    download: async (manifest, _resource, write, signal) => { const data = source.get(`${manifest.unit.unitId}:${manifest.version}`); for (let offset = 0; offset < data.size; offset += data.block.length) { signal.throwIfAborted(); await write(data.block.subarray(0, Math.min(data.block.length, data.size - offset))); } }, ...extra };
}

test("30+ Units grandes: dos trabajadores, SHA compartido descargado una vez, todas offline", async t => {
  const cache = await disk(t); const data = await Promise.all(Array.from({ length: 32 }, (_, i) => fixture(`unit-${i}`, 1, 36 * 1024 * 1024)));
  let active = 0, maximum = 0, downloads = 0;
  const provider = remote(data); const download = provider.download;
  provider.download = async (...args) => { active++; maximum = Math.max(maximum, active); downloads++; try { await download(...args); } finally { active--; } };
  const states = []; const queue = new DownloadQueue(cache, provider, task => states.push(task.state)); t.after(() => queue.close());
  data.forEach(value => queue.enqueue(value.publication));
  await settle(() => [...queue.tasks.values()].every(task => task.state === "ready"));
  assert.equal(downloads, 1); assert.ok(maximum <= 2); assert.equal((await cache.list()).length, 32);
  assert.ok(states.includes("queued")); assert.ok(states.includes("downloading"));
  await cache.open("unit-31", 1);
});

test("Unit abierta conserva versión; nueva queda preparada y se activa al cerrar/reiniciar", async t => {
  const cache = await disk(t); const old = await fixture("open-unit"); const next = await fixture("open-unit", 2);
  await new SyncEngine(cache, remote([old])).sync(old.publication);
  const queue = new DownloadQueue(cache, remote([next]), () => {}); queue.protectedUnit = "open-unit"; queue.enqueue(next.publication);
  await settle(() => queue.tasks.get("open-unit").state === "staged");
  assert.equal((await cache.list())[0].version, 1); assert.equal((await cache.pending())[0].version, 2);
  await cache.open("open-unit", 1); await queue.activatePending(); assert.equal((await cache.list())[0].version, 1);
  queue.protectedUnit = ""; await queue.activatePending(); assert.equal((await cache.list())[0].version, 2); assert.equal((await cache.pending()).length, 0);
});

test("fallo/cierre conserva versión anterior; reinicio reutiliza blobs completos y reintenta", async t => {
  const cache = await disk(t); const old = await fixture("retry"); const next = await fixture("retry", 2);
  await new SyncEngine(cache, remote([old])).sync(old.publication);
  const failed = new DownloadQueue(cache, remote([next], { download: async (_m, _r, write) => { await write(next.block.subarray(0, 2)); throw new Error("sin Internet"); } }), () => {});
  failed.enqueue(next.publication); await settle(() => failed.tasks.get("retry").state === "failed");
  assert.equal((await cache.list())[0].version, 1); failed.close();
  const restart = new DownloadQueue(cache, remote([next]), () => {}); restart.enqueue(next.publication);
  await settle(() => restart.tasks.get("retry").state === "ready"); assert.equal((await cache.list())[0].version, 2);
});

test("contenido por defecto, nivel seguido nuevo/parcial y desactivación; preferencias separadas por equipo", async () => {
  const map = new Map(); const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  contentOwner("room-a"); assert.equal(contentPreferences(storage).autoUpdate, true);
  const old = await fixture("downloaded"); const update = await fixture("downloaded", 2); const fresh = await fixture("new");
  assert.deepEqual(requiredContent([old.manifest], [update.publication, fresh.publication], contentPreferences(storage)).map(p => p.unitId), ["downloaded"]);
  saveContentPreferences({ autoUpdate: false, followedLevels: [fresh.publication.levelId], pendingUnits: ["retry"] }, storage);
  assert.deepEqual(requiredContent([old.manifest], [update.publication, fresh.publication], contentPreferences(storage)).map(p => p.unitId), ["downloaded", "new"]);
  contentOwner("room-b"); assert.deepEqual(contentPreferences(storage), { autoUpdate: true, followedLevels: [], pendingUnits: [] });
  contentOwner("room-a"); assert.equal(contentPreferences(storage).autoUpdate, false);
});

test("100 cambios de progreso conservan grid, 32 cards, miniatura, botones y orden", () => {
  const dom = new JSDOM("<div id='root'></div>"); const root = dom.window.document.querySelector("#root");
  const markup = percent => `<main><div class="unit-grid">${Array.from({ length: 32 }, (_, i) => `<article data-unit-card="unit-${i}"><div class="unit-thumbnail"><div class="unit-cover-fallback">Imagen</div></div><h2>Unit ${i}</h2><progress max="100" value="${i === 0 ? percent : 0}"></progress><button data-open="unit-${i}">Abrir clase</button></article>`).join("")}</div></main>`;
  reconcileLibrary(root, markup(0)); const grid = root.querySelector(".unit-grid"); const cards = [...root.querySelectorAll("article")]; const button = cards[0].querySelector("button");
  const image = dom.window.document.createElement("img"); image.className = "unit-cover-image"; cards[0].querySelector(".unit-cover-fallback").replaceWith(image);
  for (let i = 1; i <= 100; i++) { reconcileLibrary(root, markup(i)); assert.equal(root.querySelector(".unit-grid"), grid); assert.deepEqual([...root.querySelectorAll("article")], cards); assert.equal(cards[0].querySelector("img"), image); assert.equal(cards[0].querySelector("button"), button); }
  assert.equal(cards[0].querySelector("progress").value, 100); dom.window.close();
});
