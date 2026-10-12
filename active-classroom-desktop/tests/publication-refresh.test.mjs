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
    dom.window.localStorage.setItem(`active-classroom-content:ac-device-${identity.deviceId}`, JSON.stringify({ autoUpdate: false }));
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

test("Biblioteca real: auto-update preparado durante clase, nivel completo y Unit nueva seguida", async t => {
  const directory = await mkdtemp(join(tmpdir(), "classroom-auto-content-"));
  const disk = new DiskCache(directory); disk.adoptLegacy = async () => {};
  const old = await fixture(1); const next = await fixture(2);
  async function another(id, levelId) {
    const data = await fixture(1); data.manifest.unit.unitId = id; data.manifest.unit.levelId = levelId;
    const content = Object.fromEntries(Object.entries(data.manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
    data.manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
    Object.assign(data.publication, { unitId: id, levelId, contentHash: data.manifest.integrity.contentHash });
    return data;
  }
  const second = await another("same-level", next.publication.levelId);
  const other = await another("other-level", "level-other");
  const newUnit = await another("tomorrow", next.publication.levelId);
  const sources = [old, next, second, other, newUnit];
  await new SyncEngine(disk, { manifest: async () => old.manifest, download: async (_m, r, write) => write(old.bytes.get(r.resourceId)) }).sync(old.publication);
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
    name: "auto-content-boundaries", enforce: "pre",
    resolveId(source) { if (source.endsWith("./device-auth")) return "\0auto-session"; if (source.endsWith("./native-cache")) return "\0auto-cache"; if (source.endsWith("/ClassroomPlayer")) return "\0auto-player"; },
    load(id) {
      if (id === "\0auto-session") return "export const createDeviceSession = notify => globalThis.autoHarness.session(notify);";
      if (id === "\0auto-cache") return "export class NativeCache { constructor() { return globalThis.autoHarness.cache; } }";
      if (id === "\0auto-player") return "export class ClassroomPlayer { constructor(root, classroom, close) { globalThis.autoHarness.opened = classroom.manifest.version; globalThis.autoHarness.close = close; } destroy() {} }";
    },
  }] });
  const { mountOfflineLibrary } = await server.ssrLoadModule("/src/offline/library.ts");
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const descriptors = Object.fromEntries(["window", "document", "navigator", "fetch", "autoHarness"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let release; const held = new Promise(resolve => { release = resolve; }); let tomorrow = false; const downloaded = [];
  const identity = { deviceId: "d".repeat(32), displayName: "Equipo offline", activated: true, revoked: false };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: { onLine: true } })) Object.defineProperty(globalThis, key, { value, configurable: true });
  globalThis.autoHarness = { cache: disk, session: notify => new DeviceSession({ load: async () => identity, proof: async () => ({ ...identity, credential: "secret" }), exchange: async () => ({ status: "authorized", customToken: "custom" }), signIn: async () => {}, token: async () => "id-token", mark: async () => identity, saveLabel: async () => {}, signOut: async () => {} }, notify) };
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (raw, init) => {
    const url = new URL(raw); const endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "listActiveClassroomPublications") return new Response(JSON.stringify({ result: { publications: [next, second, other, ...(tomorrow ? [newUnit] : [])].map(data => data.publication), nextCursor: null } }));
    if (endpoint === "getActiveClassroomPublication") { const { unitId, version } = JSON.parse(init.body).data; return new Response(JSON.stringify({ result: { manifest: sources.find(data => data.publication.unitId === unitId && data.publication.version === version).manifest } })); }
    if (endpoint === "activeClassroomPublicationFile") {
      const unitId = url.searchParams.get("unitId"); const version = Number(url.searchParams.get("version"));
      downloaded.push(unitId); if (unitId === next.publication.unitId) await held;
      return new Response(sources.find(data => data.publication.unitId === unitId && data.publication.version === version).bytes.get(url.searchParams.get("resourceId")));
    }
    return new Response(JSON.stringify({ result: {} }));
  } });
  t.after(async () => { release(); dom.window.dispatchEvent(new dom.window.Event("beforeunload")); dom.window.close(); await server.close(); await rm(directory, { recursive: true, force: true }); for (const [key, value] of Object.entries(descriptors)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const settle = async predicate => { for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail("El contenido automático no alcanzó el estado esperado"); };
  const root = dom.window.document.querySelector("#root"); mountOfflineLibrary(root);
  await settle(() => downloaded.length && root.querySelector(`[data-open="${old.publication.unitId}"]`));
  const untouched = root.querySelector('[data-unit-card="other-level"]');
  root.querySelector(`[data-open="${old.publication.unitId}"]`).click(); await settle(() => globalThis.autoHarness.opened === 1);
  release(); await settle(async () => (await disk.pending()).length === 1);
  assert.equal((await disk.list())[0].version, 1); assert.equal(globalThis.autoHarness.opened, 1);
  globalThis.autoHarness.close(); await settle(() => root.textContent.includes("Publicada: v2 · Local: v2"));
  assert.doesNotMatch(root.textContent, /requiere reparación/);
  assert.equal((await disk.list())[0].version, 2);
  assert.equal(root.querySelector(".library-workspace [data-download-level]"), null);
  root.querySelector(`.classroom-sidebar [data-level="${old.publication.levelId}"]`).click();
  assert.ok(untouched); root.querySelector(`.classroom-sidebar [data-download-level="${next.publication.levelId}"]`).click();
  await settle(async () => (await disk.list()).some(manifest => manifest.unit.unitId === "same-level"));
  assert.equal((await disk.list()).some(manifest => manifest.unit.unitId === "other-level"), false);
  const follow = root.querySelector(`[data-follow-level="${next.publication.levelId}"]`); follow.checked = true; follow.dispatchEvent(new dom.window.Event("change"));
  tomorrow = true; root.querySelector("[data-refresh]").click();
  await settle(async () => (await disk.list()).some(manifest => manifest.unit.unitId === "tomorrow"));
  assert.equal(downloaded.includes("tomorrow"), false, "El SHA-256 compartido ya verificado no se descarga otra vez");
  dom.window.dispatchEvent(new dom.window.Event("offline"));
  assert.ok(root.querySelector(`[data-open="${old.publication.unitId}"]`));
  assert.equal(root.querySelector(`[data-open="${old.publication.unitId}"]`).disabled, false);
});
