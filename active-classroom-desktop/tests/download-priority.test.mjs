import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadQueue } from "../src/offline/download-queue.ts";
import { BlobTransfers, SyncEngine, openLocalClass } from "../src/offline/sync.ts";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { DiskCache } from "./disk-cache.mjs";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
const settle = async predicate => { for (let i = 0; i < 2000; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail("Condición no alcanzada"); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// El tamaño distingue el SHA de cada Unit; la versión cambia el contenido de la misma Unit.
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
async function disk(t) { const root = await mkdtemp(join(tmpdir(), "classroom-priority-")); t.after(() => rm(root, { recursive: true, force: true })); return new DiskCache(root); }
// Cada descarga espera su compuerta (deferred) antes de escribir; registra inicios y abortos.
function gated(fixtures) {
  const source = new Map(fixtures.map(value => [`${value.publication.unitId}:${value.publication.version}`, value]));
  const gates = new Map(); const started = []; const aborted = [];
  const gate = id => { if (!gates.has(id)) { let open; const promise = new Promise(resolve => { open = resolve; }); gates.set(id, { promise, open }); } return gates.get(id); };
  const provider = {
    manifest: async p => source.get(`${p.unitId}:${p.version}`).manifest,
    download: async (manifest, _resource, write, signal) => {
      const id = manifest.unit.unitId; started.push(id); signal.addEventListener("abort", () => aborted.push(id), { once: true });
      await gate(id).promise;
      const data = source.get(`${id}:${manifest.version}`);
      for (let offset = 0; offset < data.size; offset += data.block.length) { signal.throwIfAborted(); await write(data.block.subarray(0, Math.min(data.block.length, data.size - offset))); }
    },
  };
  return { provider, started, aborted, release: id => gate(id).open() };
}

test("pace: sin modo interactivo no retrasa; primer chunk inmediato y presupuesto compartido de 4 MiB/s", async t => {
  mock.timers.enable({ apis: ["setTimeout"] }); t.after(() => mock.timers.reset());
  let clock = 1000; const transfers = new BlobTransfers(() => clock); const signal = new AbortController().signal;
  await transfers.pace(1024 * 1024, signal); // apagado: inmediato, aunque sea grande
  transfers.setInteractive(true);
  await transfers.pace(65536, signal); // burst inicial
  const done = []; // dos workers comparten el mismo presupuesto
  const first = transfers.pace(65536, signal).then(() => done.push("a"));
  const second = transfers.pace(65536, signal).then(() => done.push("b"));
  await flush(); assert.deepEqual(done, []);
  clock += 16; mock.timers.tick(16); await flush(); assert.deepEqual(done, ["a"]);
  clock += 16; mock.timers.tick(16); await flush(); assert.deepEqual(done, ["a", "b"]);
  await Promise.all([first, second]);
});

test("pace: abortar rechaza rápido y limpia; desactivar libera esperas y reinicia presupuesto", async t => {
  mock.timers.enable({ apis: ["setTimeout"] }); t.after(() => mock.timers.reset());
  let clock = 0; const transfers = new BlobTransfers(() => clock); transfers.setInteractive(true);
  await transfers.pace(65536, new AbortController().signal);
  const controller = new AbortController(); const outcome = [];
  const waiting = transfers.pace(65536, controller.signal).then(() => outcome.push("ok"), error => outcome.push(error.code));
  await flush(); assert.deepEqual(outcome, []);
  controller.abort(); await flush(); assert.deepEqual(outcome, ["cancelled"]);
  mock.timers.tick(10000); await waiting; // el timer fue limpiado: nada más ocurre
  assert.deepEqual(outcome, ["cancelled"]);
  await assert.rejects(transfers.pace(65536, controller.signal), { code: "cancelled" });
  const parked = []; const live = new AbortController();
  const released = transfers.pace(65536, live.signal).then(() => parked.push("liberada"));
  await flush(); assert.deepEqual(parked, []);
  transfers.setInteractive(false); await flush(); assert.deepEqual(parked, ["liberada"]); await released;
  await transfers.pace(10 * 1024 * 1024, live.signal); // apagado: sin retraso
  transfers.setInteractive(true); // presupuesto reiniciado: el primer chunk vuelve a ser inmediato
  await transfers.pace(65536, live.signal);
});

test("SyncEngine paga el ritmo antes de cada append y cancelar durante la espera descarta el .part", async t => {
  const cache = await disk(t); const data = await fixture("paced", 1, 65536 * 3);
  const events = []; const append = cache.append.bind(cache); cache.append = async (...args) => { events.push("append"); return append(...args); };
  const recorder = new BlobTransfers(); recorder.pace = async () => { events.push("pace"); };
  const provider = { manifest: async () => data.manifest, download: async (_m, _r, write) => { for (let i = 0; i < 3; i++) await write(data.block); } };
  await new SyncEngine(cache, provider, recorder).sync(data.publication);
  assert.deepEqual(events, ["pace", "append", "pace", "append", "pace", "append"]);

  mock.timers.enable({ apis: ["setTimeout"] }); t.after(() => mock.timers.reset());
  const other = await disk(t); const real = new BlobTransfers(() => 0); real.setInteractive(true);
  const engine = new SyncEngine(other, provider, real); const run = engine.sync(data.publication);
  const rejected = assert.rejects(run, { code: "cancelled" });
  // Con setTimeout simulado, se sondea con setImmediate hasta que el primer chunk está escrito.
  const part = other.part(data.manifest.resources[0].download.checksums.sha256);
  for (let i = 0; i < 200000 && (await stat(part).catch(() => null))?.size !== 65536; i++) await flush();
  assert.equal((await stat(part)).size, 65536);
  engine.cancel(); await rejected;
  await assert.rejects(stat(other.part(data.manifest.resources[0].download.checksums.sha256)));
  assert.equal((await other.list()).length, 0);
});

test("cola interactiva: 2 workers en curso se drenan a 1 sin abortar y al desactivar vuelve a 2", async t => {
  const cache = await disk(t); const data = await Promise.all([1, 2, 3, 4, 5, 6].map(i => fixture(`unit-${i}`, 1, 100 + i)));
  const remote = gated(data); const queue = new DownloadQueue(cache, remote.provider, () => {}); t.after(() => { queue.close(); data.forEach(value => remote.release(value.publication.unitId)); });
  data.slice(0, 4).forEach(value => queue.enqueue(value.publication));
  await settle(() => remote.started.length === 2); assert.deepEqual([...remote.started].sort(), ["unit-1", "unit-2"]);
  queue.setInteractive(true);
  remote.release("unit-1"); await settle(() => queue.tasks.get("unit-1").state === "ready");
  await pause(40); assert.deepEqual([...remote.started].sort(), ["unit-1", "unit-2"]); // unit-2 sigue; no entra unit-3
  assert.equal(queue.tasks.get("unit-2").state, "downloading");
  remote.release("unit-2"); await settle(() => remote.started.includes("unit-3"));
  await pause(40); assert.ok(!remote.started.includes("unit-4")); // un solo worker toma tareas nuevas
  queue.setInteractive(false);
  await settle(() => remote.started.includes("unit-4")); // concurrencia normal con unit-3 aún en curso
  assert.equal(queue.tasks.get("unit-3").state, "downloading");
  queue.enqueue(data[4].publication); queue.enqueue(data[5].publication);
  await pause(40); assert.equal(remote.started.length, 4); // máximo 2 en vuelo
  data.forEach(value => remote.release(value.publication.unitId));
  await settle(() => [...queue.tasks.values()].every(task => task.state === "ready"));
  assert.deepEqual(remote.aborted, []);
  assert.equal((await cache.list()).length, 6);
});

test("clase abierta con descarga B bloqueada: A se abre, B continúa; incompleta no es abrible; update de A queda staged", async t => {
  const cache = await disk(t);
  const a = await fixture("unit-a", 1, 200); const a2 = await fixture("unit-a", 2, 200); const b = await fixture("unit-b", 1, 300);
  const seed = gated([a]); seed.release("unit-a"); await new SyncEngine(cache, seed.provider).sync(a.publication);
  const remote = gated([a2, b]); const queue = new DownloadQueue(cache, remote.provider, () => {}); t.after(() => { queue.close(); remote.release("unit-b"); remote.release("unit-a"); });
  queue.protectedUnit = "unit-a"; queue.setInteractive(true);
  queue.enqueue(b.publication); await settle(() => remote.started.includes("unit-b"));
  // B parcial: ni lista ni abrible; A completa se abre con B bloqueada.
  assert.deepEqual((await cache.list()).map(item => item.unit.unitId), ["unit-a"]);
  await assert.rejects(cache.open("unit-b", 1));
  const classroom = await openLocalClass(cache, "unit-a", 1);
  assert.ok(classroom.resolveResource(a.manifest.resources[0].resourceId).path);
  assert.equal(queue.tasks.get("unit-b").state, "downloading"); assert.deepEqual(remote.aborted, []);
  // Update de A encolado durante la clase: espera su turno (un worker) y queda staged.
  queue.enqueue(a2.publication); assert.equal(queue.tasks.get("unit-a").state, "queued");
  remote.release("unit-b"); await settle(() => queue.tasks.get("unit-b").state === "ready");
  remote.release("unit-a"); await settle(() => queue.tasks.get("unit-a").state === "staged");
  assert.equal((await cache.list()).find(item => item.unit.unitId === "unit-a").version, 1);
  assert.equal((await cache.pending())[0].version, 2);
  await cache.open("unit-b", 1); assert.deepEqual(remote.aborted, []);
  // Cierre de la clase: se activa la versión preparada.
  queue.protectedUnit = ""; queue.setInteractive(false); await queue.activatePending();
  assert.equal((await cache.list()).find(item => item.unit.unitId === "unit-a").version, 2);
});
