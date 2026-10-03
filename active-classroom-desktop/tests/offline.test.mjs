import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, sha256, validateManifest, localState, SyncError } from "../src/offline/manifest.ts";
import { DiskCache } from "./disk-cache.mjs";
import { SyncEngine, openLocalClass, unitSyncMessage } from "../src/offline/sync.ts";
import { PublicationApi } from "../src/offline/remote.ts";
import { connectionError, connectionLabel } from "../src/offline/connection.ts";

test("transporte conserva el receptor global exigido por Window.fetch", async () => {
  let calls = 0;
  const api = new PublicationApi(async () => "id-token", function (_url, init) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    calls++; assert.equal(init.headers.Authorization, "Bearer id-token");
    return Promise.resolve(new Response(JSON.stringify({ result: { publications: [], nextCursor: null } })));
  });
  assert.deepEqual(await api.list(), []); assert.equal(calls, 1);
});

test("diagnóstico mantiene endpoint/HTTP sin tokens, queries, secretos ni cuerpos", async () => {
  const logs = []; const previous = console.info; console.info = (...args) => logs.push(args);
  try {
    for (const status of [401, 403, 404, 500, 503]) {
      const api = new PublicationApi(async () => "secret-token", async () => new Response("secret-body", { status }));
      await assert.rejects(api.request("activeClassroomPublicationFile?resourceId=private-id", {}, async () => null), { code: String(status) });
      const failure = connectionError(new SyncError(String(status), ""), "publications");
      assert.notEqual(connectionLabel(failure.code), "Modo offline");
      assert.notEqual(connectionLabel(failure.code), "Servidor inaccesible");
      assert.doesNotMatch(failure.message, /401|403|404|500|503/);
    }
  } finally { console.info = previous; }
  assert.doesNotMatch(JSON.stringify(logs), /secret-token|secret-body|private-id/);
  for (const status of [401, 403, 404, 500, 503]) assert.ok(logs.some((entry) => entry[1].endpoint === "activeClassroomPublicationFile" && entry[1].httpStatus === status));
});

test("respuesta ilegible, catálogo inválido, red y error del cliente se distinguen", async () => {
  for (const payload of ["broken-json", "null", '{"result":{}}', '{"result":{"publications":[null],"nextCursor":null}}']) {
    const api = new PublicationApi(async () => "token", async () => new Response(payload));
    await assert.rejects(api.list(), { code: "response" });
  }
  const illegal = new PublicationApi(async () => "token", async () => { throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"); });
  await assert.rejects(illegal.list(), { code: "client" });
  assert.equal(connectionError(new TypeError("Failed to fetch"), "publications", false).code, "offline");
  assert.equal(connectionError(new TypeError("Failed to fetch"), "publications", true).code, "backend");
});

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


test("archivo grande usa rangos autenticados y verifica SHA-256 antes de activar", async (t) => {
  const cache = await temporary(t); const data = await fixture();
  const resource = data.manifest.resources[0];
  const bytes = new Uint8Array(36633632).fill(117);
  Object.assign(resource.download, { sizeBytes: bytes.length, checksums: { sha256: await sha256(bytes) } });
  await seal(data.manifest); data.publication.contentHash = data.manifest.integrity.contentHash;
  const ranges = []; let tokens = 0;
  const api = new PublicationApi(async () => { tokens++; return "device-id-token"; }, async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer device-id-token");
    if (url.includes("getActiveClassroomPublication")) return new Response(JSON.stringify({ result: { manifest: data.manifest } }));
    const id = new URL(url).searchParams.get("resourceId");
    const current = data.manifest.resources.find(item => item.resourceId === id);
    const content = id === resource.resourceId ? bytes : data.bytes.get(id);
    if (init.headers.Range) {
      ranges.push(init.headers.Range);
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range).map(Number);
      const part = content.slice(start, end + 1);
      assert.ok(part.length <= 4 * 1024 * 1024);
      return new Response(part, { status: 206, headers: { "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${content.length}`, "X-Content-SHA256": current.download.checksums.sha256 } });
    }
    return new Response(content);
  });
  await new SyncEngine(cache, api).sync(data.publication);
  assert.equal(ranges.length, 9); assert.ok(tokens >= 10);
  const reboot = new DiskCache(cache.root);
  assert.equal((await reboot.list())[0].version, 1);
  const local = await openLocalClass(reboot, data.publication.unitId, 1);
  assert.equal(await sha256(new Uint8Array(await readFile(local.resolveResource(resource.resourceId).path))), resource.download.checksums.sha256);
});

test("bloque con rango falso, tamaño incorrecto o fallo intermedio no activa versión", async (t) => {
  for (const mode of ["range", "size", "network"]) {
    const cache = await temporary(t); const data = await fixture(); const resource = data.manifest.resources[0];
    const content = new Uint8Array(5 * 1024 * 1024).fill(9);
    Object.assign(resource.download, { sizeBytes: content.length, checksums: { sha256: await sha256(content) } });
    await seal(data.manifest); data.publication.contentHash = data.manifest.integrity.contentHash;
    const api = new PublicationApi(async () => "token", async (url, init) => {
      if (url.includes("getActiveClassroomPublication")) return new Response(JSON.stringify({ result: { manifest: data.manifest } }));
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range).map(Number);
      if (mode === "network" && start > 0) throw new TypeError("Failed to fetch");
      const bytes = content.slice(start, end + 1 - (mode === "size" ? 1 : 0));
      return new Response(bytes, { status: 206, headers: { "Content-Range": mode === "range" ? "bytes 0-1/2" : `bytes ${start}-${end}/${content.length}` } });
    });
    await assert.rejects(new SyncEngine(cache, api).sync(data.publication));
    assert.deepEqual(await cache.list(), []);
  }
});

test("mensajes de Unit conservan etapa y distinguen caché, integridad y espacio", () => {
  for (const [code, stage, message] of [["500", "manifest", /obtener el manifest/], ["backend", "download", /descargar un archivo/], ["integrity", "verify", /Archivo corrupto/], ["disk-full", "cache", /Sin espacio disponible/], ["cache", "activate", /guardar la clase local/]]) {
    const error = new SyncError(code, "technical-secret"); error.stage = stage;
    assert.match(unitSyncMessage(error), message); assert.doesNotMatch(unitSyncMessage(error), /technical-secret/);
  }
});

test("publicación Office entrega PDF local y conserva original como metadata sin descargarlo", async (t) => {
  const cache=await temporary(t); const data=await fixture();
  for(const resource of data.manifest.resources.slice(0,2)) {
    resource.originalMime="application/vnd.openxmlformats-officedocument.presentationml.presentation";
    resource.deliveryMime="application/pdf";
    resource.mimeType=resource.originalMime;
    resource.original={snapshot:{path:"original.pptx",mimeType:resource.originalMime}};
    resource.derivative={revision:"revision1",processorVersion:"office-pdf-v1",pageCount:2,file:resource.download};
    resource.download.mimeType="application/pdf"; resource.download.name="Presentation.pdf";
  }
  await seal(data.manifest);data.publication.contentHash=data.manifest.integrity.contentHash;
  const remote=source(data); await new SyncEngine(cache,remote).sync(data.publication);
  const classroom=await openLocalClass(cache,data.publication.unitId,1);
  const {rendererKind}=await import("../src/player/types.ts");
  for(const resource of data.manifest.resources.slice(0,2)) {
    const local=classroom.resolveResource(resource.resourceId);
    assert.equal(local.mimeType,"application/pdf");assert.equal(rendererKind(local.mimeType),"pdf");
    assert.doesNotMatch(local.path,/original\.pptx/);
  }
  assert.equal(remote.calls.length,data.manifest.resources.length);
});
