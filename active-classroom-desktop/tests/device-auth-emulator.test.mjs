import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signOut } from "firebase/auth";
import { DeviceSession } from "../src/offline/device-session.ts";
import { signInDevice, deviceIdToken } from "../src/offline/firebase-session.ts";
import { PublicationApi } from "../src/offline/remote.ts";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { SyncEngine, openLocalClass } from "../src/offline/sync.ts";
import { DiskCache } from "./disk-cache.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../drive/package.json", import.meta.url));
const admin = require("firebase-admin");
const express = require("express");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { createDeviceHandlers, isDevice } = require("./activeClassroomDevices.js");
const { createDesktopHandlers } = require("./activeClassroomDesktop.js");
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Requiere emuladores Auth, Firestore y Storage; nunca ejecutar contra producción.");

test("Auth real: activación, reinicio, Bearer ID token, nombre, renovación y revocación", async (t) => {
  // Isolate fixtures from the rules suite's per-test clearFirestore/clearStorage.
  const projectId = "security-rules-audit";
  const backend = admin.initializeApp({ projectId });
  const fixtures = admin.initializeApp({ projectId: "active-classroom-publication-tests", storageBucket: "active-classroom-publication-tests.appspot.com" }, "publication-fixtures");
  const db = fixtures.firestore(); const adminAuth = backend.auth();
  const handlers = createDeviceHandlers({ db, auth: adminAuth, assertAdmin: async (request) => {
    if (request.auth?.uid !== "test-admin") throw new HttpsError("permission-denied", "Administrador requerido.");
    return { uid: "test-admin", role: "admin", active: true };
  } });
  // Larger than the 32 MB Functions response limit; each request stays <= 4 MiB.
  const content = Buffer.alloc(36633632, 117);
  const hash = createHash("sha256").update(content).digest("hex");
  const bucket = fixtures.storage().bucket();
  const frozen = bucket.file(`active-classroom/publications/files/${hash}`);
  await frozen.save(content, { resumable: false, metadata: { contentType: "application/pdf" } });
  const [fileMetadata] = await frozen.getMetadata();
  const manifest = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
  manifest.unit.unitId = `auth-${randomBytes(8).toString("hex")}`;
  for (const resource of manifest.resources) Object.assign(resource.download, { path: frozen.name, generation: fileMetadata.generation, sizeBytes: content.length, checksums: { sha256: hash } });
  const sealed = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(sealed)));
  await db.doc(`activeClassroomUnits/${manifest.unit.unitId}`).set({ publishedVersion: manifest.version });
  await db.doc(`activeClassroomUnits/${manifest.unit.unitId}/publications/${manifest.version}`).set({ manifest });
  let authenticatedRequests = 0; let force401 = false; let network = true;
  const desktop = createDesktopHandlers({ db, isDevice, authorizeDevice: async (auth) => {
    assert.equal(auth.token.firebase.sign_in_provider, "custom");
    authenticatedRequests++; return handlers.authorizeDevice(auth);
  }, getProfile: async () => { throw new Error("No se debe consultar un perfil humano"); },
  getRequestProfile: async (request) => handlers.authorizeDevice(await adminAuth.verifyIdToken(request.headers.authorization.slice(7))),
  resolveFile: async () => { throw new Error("No se debe acceder a Drive"); },
  bucket });
  const app = express(); app.use(express.json());
  app.post("/activeClassroomDeviceSession", onCall(handlers.session));
  app.post("/listActiveClassroomPublications", (request, response, next) => { if (force401) { force401 = false; return response.status(401).json({ error: { status: "UNAUTHENTICATED" } }); } next(); }, onCall(desktop.list));
  app.post("/getActiveClassroomPublication", onCall(desktop.get));
  app.post("/approveActiveClassroomDevice", onCall(handlers.approve));
  app.get("/activeClassroomPublicationFile", desktop.file);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const identity = { deviceId: randomBytes(16).toString("hex"), name: "active-test", activated: false, revoked: false };
  const cacheRoot = await mkdtemp(join(tmpdir(), "ac-auth-sync-"));
  const credential = randomBytes(32).toString("hex"); const clients = [];
  const transport = async (url, init) => {
    if (!network) throw new TypeError("Network unavailable");
    return fetch(`${base}/${String(url).split("cloudfunctions.net/")[1]}`, init);
  };
  const createSession = () => {
    const client = initializeApp({ apiKey: "emulator-public-test-key", projectId }, randomBytes(8).toString("hex")); clients.push(client);
    const auth = initializeAuth(client, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const session = new DeviceSession({
      load: async () => ({ ...identity }), proof: async () => ({ deviceId: identity.deviceId, name: identity.name, credential }),
      mark: async (action) => { identity.activated = action === "activated"; identity.revoked = action === "revoked"; return { ...identity }; },
      exchange: async (proof) => {
        const response = await transport("https://test.cloudfunctions.net/activeClassroomDeviceSession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: proof }) });
        assert.equal(response.status, 200); return (await response.json()).result;
      }, signIn: (token, owner) => signInDevice(auth, token, owner), token: (owner, force) => deviceIdToken(auth, owner, force),
      signOut: () => signOut(auth), saveLabel: async ({ displayName }) => { identity.displayName = displayName; },
    }, () => {});
    const api = new PublicationApi((force) => session.token(force), transport);
    api.onDevice = (label) => session.receiveLabel(label); api.onDenied = () => session.revalidateAccess();
    return { session, api, auth };
  };
  try {
    const first = createSession(); await first.session.start(true);
    assert.equal(first.session.state.phase, "activation");
    await handlers.approve({ auth: { uid: "test-admin" }, data: { code: first.session.state.code, displayName: "Salón test" } });
    await first.session.connect(); assert.equal(first.session.state.online, true); assert.equal(identity.activated, true);
    const token = await first.session.token(); const decoded = await adminAuth.verifyIdToken(token);
    assert.equal(decoded.uid, first.session.owner); assert.equal(decoded.activeClassroomDevice, true); assert.equal(decoded.deviceGeneration, 1);
    await signOut(first.auth);
    const reboot = createSession(); await reboot.session.start(true);
    assert.equal(reboot.session.state.phase, "ready");
    const publications = await reboot.api.list(); const publication = publications.find((item) => item.unitId === manifest.unit.unitId);
    assert.ok(publication); assert.ok(authenticatedRequests > 0); assert.equal(reboot.session.state.identity.displayName, "Salón test");
    assert.deepEqual(await reboot.api.manifest(publication), manifest);
    const chunks = []; await reboot.api.download(manifest, manifest.resources[0], async (chunk) => chunks.push(chunk), new AbortController().signal);
    assert.deepEqual(Buffer.concat(chunks), content);
    assert.equal(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"), hash);
    const cache = new DiskCache(cacheRoot);
    await new SyncEngine(cache, reboot.api).sync(publication);
    assert.equal((await cache.list())[0].version, 1);
    network = false;
    const reopened = await openLocalClass(new DiskCache(cacheRoot), manifest.unit.unitId, 1);
    for (const resource of manifest.resources) assert.ok(reopened.resolveResource(resource.resourceId).path);
    network = true;
    // A draft without a publication never appears in the device catalog.
    const draftId = `draft-${randomBytes(8).toString("hex")}`;
    await db.doc(`activeClassroomUnits/${draftId}`).set({ draft: { name: "Privado" } });
    assert.equal((await reboot.api.list()).some((item) => item.unitId === draftId), false);
    await assert.rejects(reboot.api.manifest({ ...publication, unitId: draftId }), { code: "404" });
    await handlers.rename({ auth: { uid: "test-admin" }, data: { deviceId: identity.deviceId, displayName: "Aula nueva" } });
    await reboot.api.list(); assert.equal(reboot.session.state.identity.displayName, "Aula nueva");
    // Advance the SDK's expiry clock, exercising its actual Secure Token emulator exchange.
    const now = Date.now; Date.now = () => now() + 65 * 60 * 1000;
    let renewed;
    try { renewed = await reboot.session.token(); } finally { Date.now = now; }
    assert.equal((await adminAuth.verifyIdToken(renewed)).uid, reboot.session.owner);
    force401 = true; assert.ok((await reboot.api.list()).some((item) => item.unitId === manifest.unit.unitId));
    await assert.rejects(reboot.api.call("approveActiveClassroomDevice", { code: "0000000000" }), { code: "403" });
    network = false; const offline = createSession(); await offline.session.start(false);
    assert.equal(offline.session.state.phase, "ready"); assert.equal(offline.session.state.identity.displayName, "Aula nueva");
    await t.test("revocado no lista, no obtiene manifest ni descarga con su último ID token", async () => {
      network = true;
      const authorization = `Bearer ${await reboot.session.token()}`;
      await handlers.revoke({ auth: { uid: "test-admin" }, data: { deviceId: identity.deviceId } });
      for (const endpoint of ["listActiveClassroomPublications", "getActiveClassroomPublication", `activeClassroomPublicationFile?unitId=${manifest.unit.unitId}&version=${manifest.version}&resourceId=${manifest.resources[0].resourceId}`]) {
        const file = endpoint.startsWith("activeClassroomPublicationFile");
        const response = await fetch(`${base}/${endpoint}`, { method: file ? "GET" : "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, ...(file ? {} : { body: JSON.stringify({ data: { unitId: manifest.unit.unitId, version: manifest.version } }) }) });
        assert.ok([401, 403].includes(response.status), `Revocado accedió a ${endpoint.split("?")[0]}`);
        await response.body?.cancel();
      }
      await assert.rejects(reboot.api.list(), { code: "403" }); assert.equal(reboot.session.state.phase, "revoked");
      const revoked = createSession(); await revoked.session.start(false); assert.equal(revoked.session.state.phase, "revoked");
    });
  } finally {
    await Promise.all(clients.map(deleteApp)); await new Promise((resolve) => server.close(resolve));
    await backend.delete(); await fixtures.delete();
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
