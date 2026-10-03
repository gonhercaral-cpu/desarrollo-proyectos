import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { DeviceSession } from "../src/offline/device-session.ts";
import { PublicationApi } from "../src/offline/remote.ts";
import { mergeLibraryPublications } from "../src/offline/library-publications.ts";
import { canonical, sha256, localState } from "../src/offline/manifest.ts";
import { SyncEngine } from "../src/offline/sync.ts";
import { DiskCache } from "./disk-cache.mjs";

const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
async function fixture(version) {
  const manifest = structuredClone(example); manifest.version = version;
  const bytes = new Map();
  for (const [index, resource] of manifest.resources.entries()) {
    const content = new TextEncoder().encode(`local-file-${index}-${index === 0 ? version : 1}`);
    resource.download.sizeBytes = content.length; resource.download.checksums.sha256 = await sha256(content);
    bytes.set(resource.resourceId, content);
  }
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  return { manifest, bytes, publication: { unitId: manifest.unit.unitId, name: manifest.unit.name, levelId: manifest.unit.levelId, version, contentHash: manifest.integrity.contentHash, publishedAt: manifest.publishedAt, schemaVersion: 2 } };
}

test("merge separa versiones numéricas: v1/v2, v2/v10, iguales y sin copia local", async () => {
  for (const [localVersion, remoteVersion, expected] of [[1, 2, "Actualización disponible"], [2, 10, "Actualización disponible"], [10, 10, "Actualizada"], [undefined, 2, "No descargada"]]) {
    const local = localVersion ? (await fixture(localVersion)).manifest : undefined;
    const remote = (await fixture(remoteVersion)).publication;
    const entry = mergeLibraryPublications(local ? [local] : [], [remote]).get(remote.unitId);
    assert.equal(entry.remoteVersion, remoteVersion); assert.equal(entry.localVersion, localVersion);
    assert.equal(localState(entry.local, entry.remote), expected);
    assert.equal(entry.local, local);
  }
});

test("cada consulta comienza sin cursor/cache y una página antigua no reemplaza v10", async () => {
  const first = (await fixture(1)).publication; const second = (await fixture(2)).publication; const tenth = (await fixture(10)).publication;
  const requests = []; let round = 0;
  const api = new PublicationApi(async () => "secret-id-token", async (_url, init) => {
    assert.equal(init.cache, "no-store");
    const data = JSON.parse(init.body).data; requests.push(data);
    if (data.cursor === null) round++;
    const publications = round === 1 ? [first] : round === 2 ? [second] : data.cursor === null ? [tenth] : [second];
    return new Response(JSON.stringify({ result: { publications, nextCursor: round === 3 && data.cursor === null ? "next-page" : null } }));
  });
  assert.equal((await api.list())[0].version, 1); assert.equal((await api.list())[0].version, 2); assert.equal((await api.list())[0].version, 10);
  assert.deepEqual(requests.map((request) => request.cursor), [null, null, null, "next-page"]);
  const ambiguous = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: { publications: [{ ...second, version: "v2" }], nextCursor: null } })));
  await assert.rejects(ambiguous.list(), { code: "response" });
});

test("botón real: refresca v2 sobre local v1, verifica/activa y reinicia offline con v2", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "classroom-refresh-"));
  const disk = new DiskCache(directory); disk.adoptLegacy = async () => {};
  const versions = new Map(await Promise.all([1, 2, 10].map(async (version) => [version, await fixture(version)])));
  const first = versions.get(1);
  await new SyncEngine(disk, { manifest: async () => first.manifest, download: async (_manifest, resource, write) => write(first.bytes.get(resource.resourceId)) }).sync(first.publication);
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
    name: "refresh-native-boundaries", enforce: "pre",
    resolveId(source) { if (source.endsWith("./device-auth")) return "\0session-refresh"; if (source.endsWith("./native-cache")) return "\0cache-refresh"; if (source.endsWith("/ClassroomPlayer")) return "\0player-refresh"; },
    load(id) {
      if (id === "\0session-refresh") return "export const createDeviceSession = (notify) => globalThis.refreshHarness.session(notify);";
      if (id === "\0cache-refresh") return "export class NativeCache { constructor() { return globalThis.refreshHarness.cache; } }";
      if (id === "\0player-refresh") return "export class ClassroomPlayer { constructor(root, classroom, close) { globalThis.refreshHarness.opened = classroom.manifest.version; globalThis.refreshHarness.close = close; } destroy() {} }";
    },
  }] });
  const { mountOfflineLibrary } = await server.ssrLoadModule("/src/offline/library.ts");
  const descriptors = Object.fromEntries(["window", "document", "navigator", "fetch", "refreshHarness"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalInfo = console.info; const logs = []; console.info = (...args) => logs.push(args);
  let dom; let online = true; let remoteVersion = 1; let calls = 0; let release; let held = false;
  t.after(async () => { dom?.window.close(); await server.close(); await rm(directory, { recursive: true, force: true }); console.info = originalInfo; for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const settle = async (predicate) => { for (let count = 0; count < 300; count++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail("Biblioteca no alcanzó el estado esperado"); };
  const identity = { deviceId: "c".repeat(32), name: "test-hostname", displayName: "Equipo Prueba", activated: true, revoked: false };
  globalThis.refreshHarness = { cache: disk, session: (notify) => new DeviceSession({ load: async () => identity, proof: async () => ({ ...identity, credential: "secret-proof" }), exchange: async () => ({ status: "authorized", customToken: "secret-custom-token", displayName: identity.displayName }), signIn: async () => {}, token: async () => "secret-id-token", mark: async () => identity, saveLabel: async () => {}, signOut: async () => {} }, notify) };
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, init) => {
    assert.equal(online, true, "El reinicio offline no debe consultar servidor");
    assert.equal(init.headers.Authorization, "Bearer secret-id-token");
    const endpoint = new URL(url).pathname.split("/").at(-1);
    if (endpoint === "listActiveClassroomPublications") { calls++; assert.equal(JSON.parse(init.body).data.cursor, null); return new Response(JSON.stringify({ result: { publications: [versions.get(remoteVersion).publication], nextCursor: null, device: { deviceId: identity.deviceId, displayName: identity.displayName } } })); }
    if (endpoint === "getActiveClassroomPublication") return new Response(JSON.stringify({ result: { manifest: versions.get(JSON.parse(init.body).data.version).manifest } }));
    if (endpoint === "activeClassroomPublicationFile") {
      held = true;
      if (release === undefined) await new Promise((resolve) => { release = resolve; });
      const query = new URL(url).searchParams;
      return new Response(versions.get(Number(query.get("version"))).bytes.get(query.get("resourceId")));
    }
    return new Response(JSON.stringify({ result: {} }));
  } });
  function mount() {
    dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: { onLine: online } })) Object.defineProperty(globalThis, key, { value, configurable: true });
    const root = dom.window.document.querySelector("#root"); mountOfflineLibrary(root); return root;
  }
  let root = mount();
  await settle(() => calls === 1 && !root.textContent.includes("Consultando…"));
  remoteVersion = 2; root.querySelector("[data-refresh]").click();
  await settle(() => root.textContent.includes("Publicada: v2 · Local: v1"));
  assert.equal(calls, 2); assert.match(root.textContent, /Actualización disponible/);
  root.querySelector("[data-open]").click(); await settle(() => globalThis.refreshHarness.opened === 1);
  globalThis.refreshHarness.close(); await settle(() => root.querySelector("[data-sync]") && !root.querySelector("[data-open]").disabled);
  root.querySelector("[data-sync]").click(); await settle(() => held);
  assert.match(root.textContent, /Publicada: v2 · Local: v1/); assert.equal(root.querySelector("[data-open]").disabled, false);
  assert.equal((await disk.list())[0].version, 1);
  release(); await settle(() => root.textContent.includes("Publicada: v2 · Local: v2") && !root.textContent.includes("Descargando"));
  assert.match(root.textContent, /Actualizada/); assert.equal((await disk.list())[0].version, 2);
  await disk.open(first.manifest.unit.unitId, 1);
  const logEvents = logs.map((entry) => entry[1]?.event);
  for (const event of ["REFRESH_START", "REMOTE_PUBLICATION", "LOCAL_PUBLICATION", "UPDATE_AVAILABLE", "REFRESH_COMPLETE", "VERSION_ACTIVATED"]) assert.ok(logEvents.includes(event), event);
  assert.doesNotMatch(JSON.stringify(logs), /secret-|test-hostname/);
  assert.ok(logs.some((entry) => entry[1]?.event === "UPDATE_AVAILABLE" && entry[1].version === 2 && entry[1].localVersion === 1));
  remoteVersion = 10; root.querySelector("[data-refresh]").click();
  await settle(() => root.textContent.includes("Publicada: v10 · Local: v2")); assert.match(root.textContent, /Actualización disponible/);
  dom.window.close(); online = false; globalThis.refreshHarness.cache = new DiskCache(directory); globalThis.refreshHarness.cache.adoptLegacy = async () => {};
  const previousCalls = calls; root = mount(); await settle(() => root.textContent.includes("Local: v2"));
  assert.match(root.textContent, /Equipo Prueba/); assert.equal(calls, previousCalls);
  globalThis.refreshHarness.opened = undefined; root.querySelector("[data-open]").click(); await settle(() => globalThis.refreshHarness.opened === 2);
});
