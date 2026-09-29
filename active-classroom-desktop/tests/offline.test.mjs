import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rename, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, sha256, validateManifest, localState, SyncError } from "../src/offline/manifest.ts";
import { SyncEngine, openLocalClass } from "../src/offline/sync.ts";
import { PublicationApi } from "../src/offline/remote.ts";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
async function fixture(version = 1, changed = false) {
  const manifest = structuredClone(example);
  manifest.version = version;
  const bytes = new Map();
  for (const [index, resource] of manifest.resources.entries()) {
    const content = new TextEncoder().encode(`archivo ${index} ${changed && index === 0 ? "nuevo" : "original"}`);
    const hash = await sha256(content);
    Object.assign(resource.download, { sizeBytes: content.length, checksums: { sha256: hash } });
    bytes.set(resource.resourceId, content);
  }
  await seal(manifest);
  const publication = { unitId: manifest.unit.unitId, name: manifest.unit.name, levelId: manifest.unit.levelId, version, contentHash: manifest.integrity.contentHash, schemaVersion: 2, publishedAt: manifest.publishedAt };
  return { manifest, bytes, publication };
}
async function seal(manifest) {
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
}

// Real filesystem adapter for portable contract tests. Rust implements the same
// CacheStore protocol; these tests do not replace cargo/native integration tests.
class DiskCache {
  constructor(root) { this.root = root; this.full = false; }
  object(hash) { return join(this.root, "objects", hash); }
  part(hash) { return join(this.root, "temporary", hash); }
  version(manifest) { return join(this.root, "units", manifest.unit.unitId, "versions", String(manifest.version)); }
  async list() {
    const selected = [];
    for (const unit of await readdir(join(this.root, "units")).catch(() => [])) {
      const versions = (await readdir(join(this.root, "units", unit, "versions"))).map(Number).sort((a, b) => b - a);
      for (const version of versions) {
        try { selected.push((await this.open(unit, version)).manifest); break; } catch { /* Uncommitted/corrupt versions are invisible. */ }
      }
    }
    return selected;
  }
  async has(hash, size) { try { const bytes = await readFile(this.object(hash)); return bytes.length === size && await sha256(bytes) === hash; } catch { return false; } }
  async begin(hash) { await mkdir(join(this.root, "temporary"), { recursive: true }); await writeFile(this.part(hash), ""); }
  async append(hash, offset, chunk) {
    if (this.full) throw new SyncError("disk-full", "Espacio insuficiente");
    assert.equal((await stat(this.part(hash))).size, offset);
    await appendFile(this.part(hash), chunk);
  }
  async finish(hash, size) {
    const bytes = await readFile(this.part(hash));
    if (bytes.length !== size || await sha256(bytes) !== hash) throw new SyncError("integrity", "SHA-256 incorrecto");
    await mkdir(join(this.root, "objects"), { recursive: true });
    await rename(this.part(hash), this.object(hash));
  }
  async discard(hash) { await rm(this.part(hash), { force: true }); }
  async commit(manifest) {
    await validateManifest(manifest);
    for (const resource of manifest.resources) if (!await this.has(resource.download.checksums.sha256, resource.download.sizeBytes)) throw new SyncError("integrity", "Archivo ausente");
    const directory = this.version(manifest);
    await mkdir(directory, { recursive: true });
    const previous = await readFile(join(directory, "manifest.json"), "utf8").catch(() => null);
    if (previous && canonical(JSON.parse(previous)) !== canonical(manifest)) throw new SyncError("version", "Versión inmutable");
    await writeFile(join(directory, "manifest.pending"), JSON.stringify(manifest));
    await rename(join(directory, "manifest.pending"), join(directory, "manifest.json"));
  }
  async open(unitId, version) {
    const manifest = await validateManifest(JSON.parse(await readFile(join(this.root, "units", unitId, "versions", String(version), "manifest.json"), "utf8")));
    const paths = {};
    for (const resource of manifest.resources) {
      assert.ok(await this.has(resource.download.checksums.sha256, resource.download.sizeBytes));
      paths[resource.resourceId] = this.object(resource.download.checksums.sha256);
    }
    return { manifest, paths };
  }
}
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), "ac-offline-")); t.after(() => rm(root, { recursive: true, force: true })); return new DiskCache(root); }
function source(data, overrides = {}) {
  const calls = [];
  return { calls, manifest: async () => data.manifest, download: async (_manifest, resource, write) => { calls.push(resource.resourceId); await write(data.bytes.get(resource.resourceId)); }, ...overrides };
}

test("manifest exige integridad, IDs seguros, asociaciones válidas y orden de slides", async () => {
  await validateManifest(example);
  for (const change of [m => { m.unit.unitId = "../escape"; }, m => { m.resources[0].download.sizeBytes = -1; }, m => { m.slides[0].index = 3; }, m => { m.slides[0].resourceIds = ["unknown"]; }, m => { m.schemaVersion = 1; }, m => { m.generalResourceIds = [m.mainPresentationId]; }]) {
    const bad = structuredClone(example); change(bad); await seal(bad);
    await assert.rejects(validateManifest(bad), { code: "manifest" });
  }
  const tampered = structuredClone(example); tampered.unit.name = "Cambiado";
  await assert.rejects(validateManifest(tampered), { code: "manifest" });
});

test("descarga, verifica SHA-256, reinicia proceso lógico y abre clase sin ningún servicio remoto", async (t) => {
  const cache = await temporary(t);
  const data = await fixture();
  const remote = source(data);
  await new SyncEngine(cache, remote).sync(data.publication);
  assert.equal(remote.calls.length, 3);
  const restarted = new DiskCache(cache.root);
  const [local] = await restarted.list();
  assert.equal(local.version, 1);
  const classroom = await openLocalClass(restarted, local.unit.unitId, 1);
  for (const resource of local.resources) {
    const resolved = classroom.resolveResource(resource.resourceId);
    assert.deepEqual(await readFile(resolved.path), Buffer.from(data.bytes.get(resource.resourceId)));
    assert.equal(resolved.mimeType, resource.download.mimeType);
  }
  assert.throws(() => classroom.resolveResource("unknown"), { code: "cache" });
});

test("actualización descarga solo cambios, conserva versión anterior y activa únicamente al completar", async (t) => {
  const cache = await temporary(t);
  const first = await fixture(); const second = await fixture(2, true);
  await new SyncEngine(cache, source(first)).sync(first.publication);
  assert.equal(localState((await cache.list())[0], second.publication), "Actualización disponible");
  const remote = source(second, { download: async (_manifest, resource, write) => {
    assert.equal((await new DiskCache(cache.root).list())[0].version, 1);
    remote.calls.push(resource.resourceId); await write(second.bytes.get(resource.resourceId));
  } });
  await new SyncEngine(cache, remote).sync(second.publication);
  assert.deepEqual(remote.calls, [second.manifest.mainPresentationId]);
  assert.equal((await new DiskCache(cache.root).list())[0].version, 2);
  await cache.open(first.manifest.unit.unitId, 1);
  assert.equal(localState((await cache.list())[0], second.publication), "Actualizada");
});

for (const failure of ["network", "403", "integrity", "short", "disk-full", "cancelled"]) {
  test(`${failure}: actualización fallida conserva clase anterior y permite reintento`, async (t) => {
    const cache = await temporary(t);
    const first = await fixture(); const second = await fixture(2, true);
    await new SyncEngine(cache, source(first)).sync(first.publication);
    let engine;
    const remote = source(second, { download: async (_manifest, resource, write) => {
      const bytes = second.bytes.get(resource.resourceId);
      if (failure === "disk-full") { cache.full = true; await write(bytes); }
      else if (failure === "integrity") await write(new Uint8Array(bytes.length));
      else if (failure === "short") await write(bytes.subarray(0, 2));
      else if (failure === "cancelled") { await write(bytes.subarray(0, 2)); engine.cancel(); }
      else throw new SyncError(failure, "fallo simulado");
    } });
    engine = new SyncEngine(cache, remote);
    await assert.rejects(engine.sync(second.publication));
    assert.equal((await new DiskCache(cache.root).list())[0].version, 1);
    await openLocalClass(new DiskCache(cache.root), first.manifest.unit.unitId, 1);
    assert.equal((await readdir(join(cache.root, "temporary"))).length, 0);
    cache.full = false;
    await new SyncEngine(cache, source(second)).sync(second.publication);
    assert.equal((await cache.list())[0].version, 2);
  });
}

test("doble clic comparte descarga y reintento completo no repite archivos", async (t) => {
  const cache = await temporary(t); const data = await fixture(); const remote = source(data); const engine = new SyncEngine(cache, remote);
  const a = engine.sync(data.publication); const b = engine.sync(data.publication);
  assert.equal(a, b); await Promise.all([a, b]);
  await engine.sync(data.publication);
  assert.equal(remote.calls.length, 3);
});
test("rechaza downgrade y alteración del contenido de una versión ya comprometida", async (t) => {
  const cache = await temporary(t); const first = await fixture(); const second = await fixture(2, true);
  await new SyncEngine(cache, source(second)).sync(second.publication);
  await assert.rejects(new SyncEngine(cache, source(first)).sync(first.publication), { code: "version" });
  const replaced = await fixture(2, false);
  await assert.rejects(new SyncEngine(cache, source(replaced)).sync(replaced.publication), { code: "version" });
  assert.equal((await cache.list())[0].integrity.contentHash, second.publication.contentHash);
});
test("archivo local corrupto nunca se reutiliza: conserva fallback y repara al sincronizar", async (t) => {
  const cache = await temporary(t); const first = await fixture(); const second = await fixture(2, true);
  await new SyncEngine(cache, source(first)).sync(first.publication);
  await new SyncEngine(cache, source(second)).sync(second.publication);
  await writeFile(cache.object(second.manifest.resources[0].download.checksums.sha256), "corrupto");
  assert.equal((await new DiskCache(cache.root).list())[0].version, 1);
  const remote = source(second);
  await new SyncEngine(cache, remote).sync(second.publication);
  assert.equal(remote.calls.length, 1);
  assert.equal((await cache.list())[0].version, 2);
});
test("manifest parcial después de cierre abrupto no se activa", async (t) => {
  const cache = await temporary(t); const data = await fixture();
  const directory = cache.version(data.manifest); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.pending"), JSON.stringify(data.manifest));
  assert.deepEqual(await new DiskCache(cache.root).list(), []);
});
test("HTTP renueva token tras 401 una vez y envía Bearer a endpoint exacto", async () => {
  const forced = []; const auth = [];
  const api = new PublicationApi(async force => { forced.push(force); return force ? "new-token" : "old-token"; }, async (url, options) => {
    assert.ok(url.endsWith("/listActiveClassroomPublications")); auth.push(options.headers.Authorization);
    return new Response(auth.length === 1 ? "" : JSON.stringify({ result: { publications: [], nextCursor: null } }), { status: auth.length === 1 ? 401 : 200 });
  });
  assert.deepEqual(await api.list(), []);
  assert.deepEqual(forced, [false, true]); assert.deepEqual(auth, ["Bearer old-token", "Bearer new-token"]);
});
test("HTTP 401 persistente y 403 no causan bucle de renovación", async () => {
  for (const status of [401, 403]) {
    let count = 0;
    const api = new PublicationApi(async () => "token", async () => { count++; return new Response("", { status }); });
    await assert.rejects(api.list(), { code: String(status) });
    assert.equal(count, status === 401 ? 2 : 1);
  }
});
test("catálogo continúa paginación con páginas vacías", async () => {
  const data = await fixture(); let page = 0;
  const api = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: ++page === 1 ? { publications: [], nextCursor: "draft-only" } : { publications: [data.publication], nextCursor: null } })));
  assert.deepEqual(await api.list(), [data.publication]); assert.equal(page, 2);
});
test("timeout y cancelación terminan incluso si no se logra renovar token", async () => {
  const api = new PublicationApi(() => new Promise(() => {}), fetch, 15);
  await assert.rejects(api.list(), { code: "timeout" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.list(controller.signal), { code: "cancelled" });
});
test("descarga HTTP respeta metadata y propaga error de disco, sin reclasificarlo como red", async () => {
  const data = await fixture(); const resource = data.manifest.resources[0];
  const api = new PublicationApi(async () => "token", async () => new Response(data.bytes.get(resource.resourceId)));
  await assert.rejects(api.download(data.manifest, resource, async () => { throw new SyncError("disk-full", "Sin espacio"); }, new AbortController().signal), { code: "disk-full" });
  const bad = new PublicationApi(async () => "token", async () => new Response("abc", { headers: { "X-Content-SHA256": "wrong" } }));
  await assert.rejects(bad.download(data.manifest, resource, async () => {}, new AbortController().signal), { code: "integrity" });
});
