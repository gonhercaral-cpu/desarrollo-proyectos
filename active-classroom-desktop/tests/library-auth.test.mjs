import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { DeviceSession } from "../src/offline/device-session.ts";
import { SyncError } from "../src/offline/manifest.ts";
import { connectionError, connectionLabel, diagnose } from "../src/offline/connection.ts";

test("Biblioteca restaura identidad, espera ID token y consulta automáticamente después del caché", async (t) => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
    name: "native-auth-test", enforce: "pre",
    resolveId(source) {
      if (source.endsWith("./device-auth")) return "\0session-test";
      if (source.endsWith("./native-cache")) return "\0cache-test";
      if (source.endsWith("/ClassroomPlayer")) return "\0player-test";
    },
    load(id) {
      if (id === "\0session-test") return "export const createDeviceSession = (notify) => globalThis.classroomHarness.createSession(notify);";
      if (id === "\0cache-test") return "export class NativeCache { constructor(owner) { this.owner = owner; } adoptLegacy() { return Promise.resolve(); } list() { return globalThis.classroomHarness.cacheList(); } }";
      if (id === "\0player-test") return "export class ClassroomPlayer {}";
    },
  }] });
  const { mountOfflineLibrary } = await server.ssrLoadModule("/src/offline/library.ts");
  const descriptors = Object.fromEntries(["window", "document", "navigator", "fetch", "classroomHarness"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const publication = { unitId: "unit1", name: "English", levelId: "level-1", version: 1, contentHash: "a".repeat(64) };
  const local = { unit: { unitId: "unit1", name: "English", levelId: "level-1" }, version: 1, integrity: { contentHash: publication.contentHash } };
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const settle = async (predicate) => { for (let count = 0; count < 100; count++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail("El arranque no alcanzó el estado esperado"); };
  try {
    for (const cacheFirst of [true, false]) await t.test(cacheFirst ? "caché termina antes de autenticar" : "autenticación termina antes del caché", async () => {
      const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
      const root = dom.window.document.querySelector("#root");
      const signedIn = deferred(); const cacheLoaded = deferred();
      const identity = { deviceId: "b".repeat(32), name: "active-T4-PRO", activated: true, revoked: false };
      let firebaseReady = false; let calls = 0; let status = 200; let label = "Salón 4"; let interval;
      let session;
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
      dom.window.setInterval = (callback) => { interval = callback; return 1; };
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (_url, init) => {
        assert.equal(firebaseReady, true, "No consultar con un marcador de activación sin ID token");
        assert.equal(init.headers.Authorization, "Bearer firebase-id-token"); calls++;
        return new Response(JSON.stringify({ result: { publications: [publication], nextCursor: null, device: { deviceId: identity.deviceId, displayName: label } } }), { status });
      } });
      globalThis.classroomHarness = {
        cacheList: () => cacheLoaded.promise,
        createSession: (notify) => (session = new DeviceSession({
          load: async () => ({ ...identity }), proof: async () => ({ ...identity, credential: "secret-not-a-token" }),
          exchange: async () => ({ status: "authorized", customToken: "custom-not-id-token" }),
          signIn: async () => { await signedIn.promise; firebaseReady = true; },
          token: async () => { assert.equal(firebaseReady, true); return "firebase-id-token"; },
          mark: async () => identity, saveLabel: async () => {}, signOut: async () => {},
        }, notify)),
      };
      try {
        mountOfflineLibrary(root);
        await settle(() => session?.state.phase === "ready");
        if (cacheFirst) { cacheLoaded.resolve([local]); await settle(() => root.querySelector("[data-open]")); assert.equal(calls, 0); signedIn.resolve(); }
        else { signedIn.resolve(); await settle(() => session.state.online); assert.equal(calls, 0); cacheLoaded.resolve([local]); }
        await settle(() => root.textContent.includes("Salón 4") && calls === 1 && !root.textContent.includes("Consultando…"));
        assert.match(root.textContent, /Actualizado/); assert.equal(root.querySelector("[data-open]").disabled, false);
        label = "Aula Audiovisual"; root.querySelector("[data-refresh]").click();
        await settle(() => root.textContent.includes(label)); assert.equal(session.owner, `ac-device-${identity.deviceId}`);
        for (const failure of [401, 403]) {
          status = failure; root.querySelector("[data-refresh]").click();
          await settle(() => root.textContent.includes(failure === 401 ? "Problema de autenticación" : "Acceso no autorizado"));
          assert.doesNotMatch(root.textContent, /Modo offline|Sin conexión/);
          assert.equal(root.querySelector("[data-open]").disabled, false);
          status = 200; root.querySelector("[data-refresh]").click(); await settle(() => root.textContent.includes("Actualizado"));
        }
        dom.window.dispatchEvent(new dom.window.Event("offline"));
        assert.match(root.textContent, /Modo offline/); assert.equal(root.querySelector("[data-open]").disabled, false);
        interval(); await settle(() => root.textContent.includes("Actualizado"));
      } finally { dom.window.close(); }
    });
  } finally {
    await server.close();
    for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test("diagnóstico separa red, credencial, token, permisos y backend sin divulgar secretos", () => {
  const samples = [
    [new TypeError("secret"), "activation", false, "offline"],
    [new TypeError("secret"), "activation", true, "backend"],
    [new Error("secret"), "identity", true, "credential"],
    [{ code: "auth/user-token-expired", token: "secret" }, "token", true, "expired"],
    [new SyncError("401", "secret"), "publications", true, "401"],
    [new SyncError("403", "secret"), "publications", true, "403"],
    [new SyncError("503", "secret"), "activation", true, "server"],
    [new DOMException("secret", "TimeoutError"), "activation", true, "timeout"],
  ];
  for (const [error, stage, online, code] of samples) {
    const failure = connectionError(error, stage, online); assert.equal(failure.code, code); assert.doesNotMatch(failure.message, /secret/);
  }
  assert.equal(connectionLabel("401"), "Problema de autenticación"); assert.equal(connectionLabel("403"), "Acceso no autorizado");
  const logs = []; const previous = console.info; console.info = (...args) => logs.push(args);
  try { diagnose("token", "failed", "secret-credential"); } finally { console.info = previous; }
  assert.doesNotMatch(JSON.stringify(logs), /secret-credential/); assert.match(JSON.stringify(logs), /unknown/);
});
