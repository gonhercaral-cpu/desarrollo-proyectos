import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { SyncEngine } from "../src/offline/sync.ts";
import { DiskCache } from "./disk-cache.mjs";

// Arranque de la biblioteca: el inventario propio se publica sin esperar list nativo completo,
// la red solo consulta tras hidratar el estado local y un owner/época obsoleto nunca pinta ni sincroniza.
const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
const level = example.unit.levelId;
async function build(unitId, version, name = `Clase ${unitId}`) {
  const manifest = structuredClone(example); manifest.version = version; manifest.unit.unitId = unitId; manifest.unit.name = name;
  const bytes = new Map();
  for (const [index, resource] of manifest.resources.entries()) {
    const content = new TextEncoder().encode(`local-file-${index}-${index === 0 ? version : 1}`);
    resource.download.sizeBytes = content.length; resource.download.checksums.sha256 = await sha256(content);
    bytes.set(resource.resourceId, content);
  }
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
  return { manifest, bytes, publication: { unitId, name, levelId: manifest.unit.levelId, version, contentHash: manifest.integrity.contentHash, publishedAt: manifest.publishedAt, schemaVersion: 2 } };
}
const catalog = async (count, prefix = "unit", version = 1) => { const items = []; for (let index = 0; index < count; index++) items.push(await build(`${prefix}-${String(index).padStart(2, "0")}`, version)); return items; };
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
// Ausencias: vacía un número acotado de turnos del bucle de eventos, sin umbrales de tiempo.
const flush = async () => { for (let turn = 0; turn < 30; turn++) await new Promise((resolve) => setImmediate(resolve)); };
const settle = async (predicate) => { for (let count = 0; count < 600; count++) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail("La biblioteca no alcanzó el estado esperado"); };

function mockCache(items, options = {}) {
  // inventory = total de lecturas; hydration = lectura de arranque (deduplicada por owner/época);
  // recovery = relectura posterior a pending() que hace recover(). Se clasifica de forma síncrona al invocar:
  // una lectura es de recuperación solo si pending() se llamó desde la lectura anterior.
  const calls = { inventory: 0, hydration: 0, recovery: 0, list: 0, adopt: 0, pending: 0, open: [] };
  let pendingSeen = 0;
  const byId = new Map(items.map((item) => [item.manifest.unit.unitId, item.manifest]));
  return { calls, owner: "", call: async () => null,
    // list nativo completo: nunca resuelve; si el arranque lo esperase, las clases no aparecerían.
    list: () => { calls.list++; return new Promise(() => {}); },
    inventory: () => {
      calls.inventory++;
      if (calls.pending > pendingSeen) calls.recovery++; else calls.hydration++;
      pendingSeen = calls.pending;
      const call = calls.inventory;
      return Promise.resolve().then(() => options.inventory ? options.inventory(call) : items.map((item) => item.manifest));
    },
    adoptLegacy: () => { calls.adopt++; return options.adopt ? options.adopt() : Promise.resolve(); },
    pending: async () => { calls.pending++; return options.pending ? options.pending(calls.pending) : []; },
    open: async (unitId) => { calls.open.push(unitId); return { manifest: structuredClone(byId.get(unitId)), paths: {} }; },
    has: async () => true,
  };
}
function makeRemote(publications, sources = []) {
  const remote = { publications, counts: { list: 0, manifest: 0, file: 0 }, manifests: [], files: [], auth: new Set(), gate: undefined };
  remote.fetch = async (raw, init) => {
    const url = new URL(raw); const endpoint = url.pathname.split("/").at(-1);
    remote.auth.add(init.headers.Authorization);
    if (endpoint === "listActiveClassroomPublications") {
      remote.counts.list++; if (remote.gate) await remote.gate;
      return new Response(JSON.stringify({ result: { publications: remote.publications, nextCursor: null, device: { deviceId: "a".repeat(32), displayName: "Equipo Prueba" } } }));
    }
    if (endpoint === "getActiveClassroomPublication") {
      const { unitId, version } = JSON.parse(init.body).data; remote.counts.manifest++; remote.manifests.push(`${unitId}@${version}`);
      return new Response(JSON.stringify({ result: { manifest: sources.find((item) => item.publication.unitId === unitId && item.publication.version === version).manifest } }));
    }
    if (endpoint === "activeClassroomPublicationFile") {
      const unitId = url.searchParams.get("unitId"); const version = Number(url.searchParams.get("version")); remote.counts.file++; remote.files.push(`${unitId}@${version}`);
      return new Response(sources.find((item) => item.publication.unitId === unitId && item.publication.version === version).bytes.get(url.searchParams.get("resourceId")));
    }
    return new Response("", { status: 503 });
  };
  return remote;
}
function fakeSession(deviceId = "a".repeat(32)) {
  const identity = { deviceId, name: "host", displayName: "Equipo Prueba", activated: true, revoked: false };
  const fake = { identity, cacheOwner: `ac-device-${deviceId}`, notify: undefined, state: undefined,
    emit(state) { fake.state = state; fake.notify(state); },
    ready(online = true) { fake.emit({ phase: "ready", online, identity, message: "" }); },
    start: async (online) => { fake.ready(online); },
    connect: async () => { fake.emit({ ...fake.state, online: true }); },
    offline: () => { fake.emit({ ...fake.state, online: false }); },
    connected() {}, reportFailure() {}, revalidateAccess() {}, receiveLabel() {}, resetBinding: async () => {},
    token: async () => `token-${fake.cacheOwner}` };
  return fake;
}

let server; let mountOfflineLibrary;
const keys = ["window", "document", "navigator", "fetch", "startupHarness"];
const descriptors = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalWarn = console.warn;
before(async () => {
  console.warn = () => {};
  server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
    name: "startup-cache-boundaries", enforce: "pre",
    resolveId(source) { if (source.endsWith("./device-auth")) return "\0startup-session"; if (source.endsWith("./native-cache")) return "\0startup-cache"; if (source.endsWith("/ClassroomPlayer")) return "\0startup-player"; },
    load(id) {
      if (id === "\0startup-session") return "export const createDeviceSession = (notify) => { const session = globalThis.startupHarness.session; session.notify = notify; return session; };";
      if (id === "\0startup-cache") return "export class NativeCache { constructor(owner) { const cache = globalThis.startupHarness.cacheFor(owner); cache.owner = owner; return cache; } }";
      if (id === "\0startup-player") return "export class ClassroomPlayer { constructor(host, classroom, close) { globalThis.startupHarness.opened = { unitId: classroom.manifest.unit.unitId, version: classroom.manifest.version }; globalThis.startupHarness.close = close; } destroy() {} }";
    },
  }] });
  ({ mountOfflineLibrary } = await server.ssrLoadModule("/src/offline/library.ts"));
});
after(async () => {
  console.warn = originalWarn; await server?.close();
  for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
});

function launch(t, harness, prefs = { autoUpdate: false }) {
  harness.session ||= fakeSession(); harness.intervals = new Map();
  // La biblioteca arranca con session.start(navigator.onLine): navigator y sesión comparten el mismo valor.
  const online = harness.online !== false;
  globalThis.startupHarness = harness;
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: { onLine: online } })) Object.defineProperty(globalThis, key, { value, configurable: true });
  dom.window.setInterval = (callback, delay) => { harness.intervals.set(delay, callback); return 1; };
  dom.window.localStorage.setItem(`active-classroom-content:${harness.session.cacheOwner}`, JSON.stringify(prefs));
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: harness.remote.fetch });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("beforeunload")); dom.window.close(); });
  const root = dom.window.document.querySelector("#root");
  mountOfflineLibrary(root);
  return { root, dom };
}
const cards = (root) => root.querySelectorAll("[data-unit-card]").length;
const localCards = (root) => (root.textContent.match(/Local: v\d+/g) || []).length;

for (const online of [false, true]) test(`60 clases ya descargadas se ven y abren sin esperar list nativo ni adopción lenta (${online ? "online" : "offline"})`, async (t) => {
  const items = await catalog(60);
  const cache = mockCache(items, { adopt: () => new Promise(() => {}) });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote, online };
  const { root } = launch(t, harness);
  await settle(() => cards(root) === 60);
  assert.equal(harness.session.state.online, online, "La sesión arranca con la misma conectividad que navigator");
  assert.equal(cache.calls.list, 0, "Ningún list completo durante el arranque");
  assert.equal(root.querySelector('[data-open="unit-00"]').disabled, false);
  root.querySelector('[data-open="unit-00"]').click();
  await settle(() => harness.opened?.unitId === "unit-00");
  assert.equal(harness.opened.version, 1); assert.deepEqual(cache.calls.open, ["unit-00"]);
  if (online) await settle(() => remote.counts.list === 1);
  else { await flush(); assert.equal(remote.auth.size, 0, "Offline: ninguna petición remota, ni siquiera con credenciales"); }
  assert.equal(cache.calls.list, 0); assert.equal(remote.counts.list, online ? 1 : 0); assert.equal(remote.counts.manifest, 0); assert.equal(remote.counts.file, 0);
});

test("inventario diferido: online/refresh/preferencias/polling no consultan ni encolan hasta hidratar; luego 0 manifest y 0 descarga", async (t) => {
  const items = await catalog(60);
  const gate = deferred();
  const cache = mockCache(items, { inventory: () => gate.promise.then(() => items.map((item) => item.manifest)) });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote };
  // Sin inventario, un nivel seguido y todas las Units pendientes encolarían 60 descargas falsas.
  const { root, dom } = launch(t, harness, { autoUpdate: true, followedLevels: [level], pendingUnits: items.map((item) => item.publication.unitId) });
  await settle(() => cache.calls.hydration === 1 && root.querySelector("[data-refresh]"));
  dom.window.dispatchEvent(new dom.window.Event("online"));
  root.querySelector("[data-refresh]").click();
  dom.window.dispatchEvent(new dom.window.Event("classroom-content-preferences"));
  harness.intervals.get(30000)?.(); harness.intervals.get(5 * 60 * 1000)?.();
  harness.session.ready(true);
  await flush();
  assert.deepEqual(remote.counts, { list: 0, manifest: 0, file: 0 });
  assert.equal(cache.calls.hydration, 1); assert.equal(cache.calls.recovery, 0, "La recuperación espera a la hidratación");
  assert.equal(cards(root), 0); assert.doesNotMatch(root.textContent, /No hay clases locales|En cola|Obteniendo manifest/);
  gate.resolve();
  await settle(() => cards(root) === 60 && remote.counts.list === 1 && !root.textContent.includes("Consultando…"));
  await flush();
  assert.equal(cache.calls.hydration, 1, "Los disparadores comparten una sola lectura de hidratación");
  assert.equal(cache.calls.recovery, 1, "recover() relee el inventario una vez tras pending");
  assert.ok(cache.calls.pending >= 1);
  assert.equal(remote.counts.list, 1, "Los disparadores previos esperan y se consolidan en una consulta");
  assert.equal(remote.counts.manifest, 0); assert.equal(remote.counts.file, 0);
  assert.doesNotMatch(root.textContent, /En cola|Obteniendo manifest|Descargando/);
  assert.equal(cache.calls.list, 0);
});

test("red lenta: las clases locales abren con la consulta retenida y la versión nueva se activa al cerrar la clase en uso", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "classroom-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const disk = new DiskCache(directory); disk.adoptLegacy = async () => {}; disk.inventory = () => DiskCache.prototype.list.call(disk);
  const first = await Promise.all(["u0", "u1", "u2"].map((id) => build(id, 1)));
  for (const item of first) await new SyncEngine(disk, { manifest: async () => item.manifest, download: async (_m, resource, write) => write(item.bytes.get(resource.resourceId)) }).sync(item.publication);
  const next = await build("u0", 2);
  const remote = makeRemote([next.publication, first[1].publication, first[2].publication], [...first, next]);
  const gate = deferred(); remote.gate = gate.promise;
  const harness = { cacheFor: () => disk, remote };
  const { root } = launch(t, harness, { autoUpdate: true });
  await settle(() => cards(root) === 3 && remote.counts.list === 1);
  root.querySelector('[data-open="u1"]').click();
  await settle(() => harness.opened?.unitId === "u1");
  harness.close(); await settle(() => cards(root) === 3);
  root.querySelector('[data-open="u0"]').click();
  await settle(() => harness.opened?.unitId === "u0" && harness.opened.version === 1);
  assert.deepEqual(remote.counts, { list: 1, manifest: 0, file: 0 });
  gate.resolve();
  await settle(async () => (await disk.pending()).length === 1);
  assert.equal((await disk.list()).find((item) => item.unit.unitId === "u0").version, 1, "La versión en uso no se reemplaza durante la clase");
  assert.deepEqual(harness.opened, { unitId: "u0", version: 1 });
  assert.deepEqual([...new Set(remote.manifests)], ["u0@2"]); assert.ok(remote.files.every((file) => file === "u0@2"));
  harness.close();
  await settle(() => root.textContent.includes("Publicada: v2 · Local: v2"));
  assert.equal((await disk.list()).find((item) => item.unit.unitId === "u0").version, 2);
  assert.equal((await disk.list()).find((item) => item.unit.unitId === "u1").version, 1);
});

test("error de inventario no se muestra como biblioteca vacía, no descarga y se recupera sin remontar", async (t) => {
  const items = await catalog(60);
  const cache = mockCache(items, { inventory: (call) => { if (call < 3) throw new Error("Disco ocupado"); return items.map((item) => item.manifest); } });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote };
  const { root } = launch(t, harness, { autoUpdate: true, followedLevels: [level] });
  await settle(() => root.textContent.includes("Disco ocupado"));
  assert.equal(cards(root), 0); assert.doesNotMatch(root.textContent, /No hay clases locales/);
  assert.equal(cache.calls.hydration, 1); assert.equal(cache.calls.recovery, 0);
  root.querySelector("[data-refresh]").click();
  await settle(() => cache.calls.hydration === 2); await flush();
  assert.equal(cache.calls.recovery, 0, "Sin hidratación no hay recuperación");
  assert.match(root.textContent, /Disco ocupado/); assert.deepEqual(remote.counts, { list: 0, manifest: 0, file: 0 });
  harness.intervals.get(30000)();
  await settle(() => cards(root) === 60 && remote.counts.list === 1 && !root.textContent.includes("Consultando…"));
  await flush();
  assert.equal(cache.calls.hydration, 3); assert.equal(cache.calls.recovery, 1); assert.doesNotMatch(root.textContent, /Disco ocupado/);
  assert.equal(remote.counts.manifest, 0); assert.equal(remote.counts.file, 0); assert.equal(cache.calls.list, 0);
});

test("adopción incorpora clases y pending rechaza: inventario actualizado, propias visibles, 0 falsas descargas y reintentos deduplicados", async (t) => {
  const items = await catalog(10); const own = items.slice(0, 5).map((item) => item.manifest);
  const cache = mockCache(items, { inventory: (call) => call === 1 ? own : items.map((item) => item.manifest), pending: (call) => { if (call === 1) throw new Error("Pending bloqueado"); return []; } });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote };
  const { root, dom } = launch(t, harness, { autoUpdate: true, followedLevels: [level] });
  await settle(() => cache.calls.recovery === 1 && localCards(root) === 10 && remote.counts.list === 1 && !root.textContent.includes("Consultando…"));
  await flush();
  assert.deepEqual([remote.counts.manifest, remote.counts.file], [0, 0], "Recuperación incompleta: no se encola con estado desconocido");
  assert.equal(cache.calls.pending, 1, "Sin disparador no hay reintento en bucle");
  dom.window.dispatchEvent(new dom.window.Event("online")); root.querySelector("[data-refresh]").click(); harness.intervals.get(30000)(); harness.session.ready(true);
  await settle(() => cache.calls.pending === 2 && cache.calls.recovery === 2 &&!root.textContent.includes("Consultando…"));
  await flush();
  assert.equal(cache.calls.pending, 2, "Los disparadores simultáneos comparten una sola recuperación"); assert.equal(cache.calls.recovery, 2);
  assert.equal(localCards(root), 10); assert.deepEqual(remote.counts.manifest + remote.counts.file, 0);
});

test("inventario posterior a la recuperación falla: no reconcilia con estado viejo y se recupera con el siguiente disparador", async (t) => {
  const items = await catalog(10); const own = items.slice(0, 5).map((item) => item.manifest);
  const cache = mockCache(items, { inventory: (call) => { if (call === 1) return own; if (call === 2) throw new Error("Inventario final caído"); return items.map((item) => item.manifest); } });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote };
  const { root } = launch(t, harness, { autoUpdate: true, followedLevels: [level] });
  await settle(() => cache.calls.recovery === 1 && remote.counts.list === 1 && !root.textContent.includes("Consultando…"));
  await flush();
  assert.equal(localCards(root), 5, "Las clases propias siguen visibles");
  assert.deepEqual([remote.counts.manifest, remote.counts.file], [0, 0], "No se descarga lo que quizá ya estaba adoptado");
  harness.intervals.get(30000)();
  await settle(() => localCards(root) === 10);
  await flush();
  assert.equal(cache.calls.recovery, 2); assert.deepEqual([remote.counts.manifest, remote.counts.file], [0, 0]);
});

test("offline con biblioteca vacía y adopción retenida: mensaje honesto y clases adoptadas al terminar", async (t) => {
  const items = await catalog(3); const gate = deferred();
  const cache = mockCache(items, { inventory: (call) => call === 1 ? [] : items.map((item) => item.manifest), adopt: () => gate.promise });
  const remote = makeRemote([]);
  const harness = { cacheFor: () => cache, remote, online: false };
  const { root } = launch(t, harness);
  await settle(() => cache.calls.hydration === 1 && root.textContent.includes("Recuperando clases anteriores"));
  assert.doesNotMatch(root.textContent, /No hay clases locales/); assert.equal(cards(root), 0);
  gate.resolve();
  await settle(() => cards(root) === 3);
  assert.doesNotMatch(root.textContent, /Recuperando clases anteriores|No hay clases locales/); assert.equal(remote.auth.size, 0);
});

test("cambio de owner durante el inventario descarta el resultado tardío y no sincroniza con la promesa vieja", async (t) => {
  const itemsA = await catalog(60, "unit"); const itemsB = await catalog(2, "otro");
  const gate = deferred();
  const cacheA = mockCache(itemsA, { inventory: () => gate.promise.then(() => itemsA.map((item) => item.manifest)) });
  const cacheB = mockCache(itemsB);
  const remote = makeRemote(itemsB.map((item) => item.publication));
  const harness = { cacheFor: (owner) => owner.endsWith("a".repeat(32)) ? cacheA : cacheB, remote };
  const { root } = launch(t, harness);
  await settle(() => cacheA.calls.hydration === 1);
  harness.session.cacheOwner = `ac-device-${"b".repeat(32)}`; harness.session.ready(true);
  await settle(() => cards(root) === 2 && remote.counts.list === 1 && !root.textContent.includes("Consultando…"));
  gate.resolve(); await flush();
  assert.equal(cards(root), 2); assert.equal(root.querySelector('[data-unit-card="unit-00"]'), null);
  assert.ok(root.querySelector('[data-unit-card="otro-00"]'));
  assert.equal(cacheA.calls.adopt, 0, "El owner anterior no ejecuta recuperación tardía");
  assert.equal(cacheA.calls.pending, 0); assert.equal(cacheA.calls.recovery, 0);
  assert.equal(remote.counts.list, 1); assert.deepEqual([...remote.auth], [`Bearer token-ac-device-${"b".repeat(32)}`]);
  assert.equal(remote.counts.manifest, 0); assert.equal(remote.counts.file, 0);
});

test("revocación durante el inventario: el resultado tardío no pinta clases ni consulta la red", async (t) => {
  const items = await catalog(60);
  const gate = deferred();
  const cache = mockCache(items, { inventory: () => gate.promise.then(() => items.map((item) => item.manifest)) });
  const remote = makeRemote(items.map((item) => item.publication));
  const harness = { cacheFor: () => cache, remote };
  const { root } = launch(t, harness);
  await settle(() => cache.calls.hydration === 1);
  harness.session.emit({ phase: "revoked", online: false, identity: harness.session.identity, message: "Equipo revocado" });
  await settle(() => root.textContent.includes("volver a vincularse"));
  gate.resolve(); await flush();
  assert.equal(cards(root), 0); assert.match(root.textContent, /volver a vincularse/);
  assert.equal(cache.calls.adopt, 0); assert.deepEqual(remote.counts, { list: 0, manifest: 0, file: 0 });
});
