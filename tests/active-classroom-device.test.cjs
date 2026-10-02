const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createDeviceHandlers, isDevice, DEVICE_PREFIX } = require("../drive/activeClassroomDevices");
const { createDesktopHandlers } = require("../drive/activeClassroomDesktop");
const example = require("../docs/active-classroom-manifest.example.json");
const { guardClassroomDevices } = require("../functions/deviceAccess");

function database() {
  const records = new Map();
  const doc = (path) => ({ path, id: path.split("/").at(-1), get: async () => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }), collection: (name) => collection(`${path}/${name}`) });
  const collection = (path) => ({ doc: (name) => doc(`${path}/${name}`), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [{ id: example.unit.unitId, data: () => ({ publishedVersion: example.version }) }] }) }) }) });
  return { records, doc, collection, runTransaction: async (operation) => {
    const writes = [];
    const result = await operation({ get: (ref) => ref.get(), set: (ref, value) => writes.push(() => records.set(ref.path, structuredClone(value))), update: (ref, value) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...structuredClone(value) })), delete: (ref) => writes.push(() => records.delete(ref.path)) });
    writes.forEach((write) => write()); return result;
  } };
}
function setup() {
  const db = database(); let clock = 1000;
  const proof = { deviceId: "a".repeat(32), credential: "b".repeat(64), name: "Salón 1" };
  const adminRequest = (data) => ({ auth: { uid: "admin" }, data });
  const devices = createDeviceHandlers({ db, now: () => clock, auth: { createCustomToken: async (uid, claims) => ({ uid, claims }), revokeRefreshTokens: async () => {} }, assertAdmin: async (request) => ({ uid: request.auth?.uid, role: request.auth?.uid === "admin" ? "admin" : "requester", active: request.auth?.uid !== "inactive" }) });
  const session = (data = proof) => devices.session({ data, rawRequest: { ip: "127.0.0.1" } });
  async function activate() { const pending = await session(); await devices.approve(adminRequest({ code: pending.code })); return session(); }
  const decoded = (token) => ({ uid: token.uid, token: token.claims });
  return { db, proof, devices, adminRequest, session, activate, decoded, advance: () => { clock += 900001; } };
}
test("registro guarda hash, código temporal y nunca credencial original", async () => {
  const f = setup(); const pending = await f.session(); const record = f.db.records.get(`activeClassroomDevices/${f.proof.deviceId}`);
  assert.equal(pending.status, "pending"); assert.match(pending.code, /^[A-F0-9]{10}$/); assert.equal(record.credential, undefined); assert.notEqual(record.credentialHash, f.proof.credential);
  assert.deepEqual(await f.session(), pending);
});
test("aprobación requiere administrador activo; código se usa una vez", async () => {
  const f = setup(); const pending = await f.session();
  await assert.rejects(f.devices.approve({ auth: { uid: "teacher" }, data: { code: pending.code } }), { code: "permission-denied" });
  await assert.rejects(f.devices.approve({ auth: { uid: "inactive" }, data: { code: pending.code } }), { code: "permission-denied" });
  await f.devices.approve(f.adminRequest({ code: pending.code }));
  await assert.rejects(f.devices.approve(f.adminRequest({ code: pending.code })), { code: "not-found" });
  const session = await f.session(); assert.equal(session.status, "authorized"); assert.equal(session.customToken.claims.activeClassroomDevice, true);
  assert.equal(session.customToken.claims.admin, undefined); assert.equal(session.customToken.uid, `${DEVICE_PREFIX}${f.proof.deviceId}`);
});
test("código vencido no autoriza y se reemplaza conservando identidad", async () => {
  const f = setup(); const previous = await f.session(); f.advance();
  await assert.rejects(f.devices.approve(f.adminRequest({ code: previous.code })), { code: "not-found" });
  const current = await f.session(); assert.notEqual(current.code, previous.code);
});
test("deviceId o código solos no permiten obtener sesión", async () => {
  const f = setup(); await f.activate();
  await assert.rejects(f.session({ deviceId: f.proof.deviceId }), { code: "unauthenticated" });
  await assert.rejects(f.session({ ...f.proof, credential: "c".repeat(64) }), { code: "unauthenticated" });
});
test("revocación bloquea ID tokens existentes inmediatamente", async () => {
  const f = setup(); const { customToken } = await f.activate(); const decoded = f.decoded(customToken);
  assert.equal((await f.devices.authorizeDevice(decoded)).active, true);
  await f.devices.revoke(f.adminRequest({ deviceId: f.proof.deviceId }));
  await assert.rejects(f.devices.authorizeDevice(decoded), { code: "permission-denied" }); assert.equal((await f.session()).status, "revoked");
});
test("no acepta claims incompletos ni generación distinta", async () => {
  const f = setup(); const { customToken } = await f.activate();
  await assert.rejects(f.devices.authorizeDevice({ uid: customToken.uid }), { code: "permission-denied" });
  await assert.rejects(f.devices.authorizeDevice({ uid: customToken.uid, token: { ...customToken.claims, deviceGeneration: 999 } }), { code: "permission-denied" });
  assert.equal(isDevice({ uid: customToken.uid }), true);
});
test("dispositivo autorizado lista manifests publicados y descarga snapshot sin acceder a Drive", async () => {
  const f = setup(); const { customToken } = await f.activate();
  f.db.records.set(`activeClassroomUnits/${example.unit.unitId}/publications/${example.version}`, { manifest: example });
  let driveCalls = 0;
  const desktop = createDesktopHandlers({ db: f.db, isDevice, authorizeDevice: f.devices.authorizeDevice, getProfile: async () => ({ active: true }), resolveFile: async () => { driveCalls++; throw new Error("Drive must remain inaccessible"); } });
  const auth = f.decoded(customToken);
  assert.equal((await desktop.list({ auth })).publications.length, 1);
  assert.deepEqual((await desktop.get({ auth, data: { unitId: example.unit.unitId, version: example.version } })).manifest, example);
  const resource = example.resources.find((resource) => resource.file.provider === "drive");
  const download = await desktop.resolveDownload(await f.devices.authorizeDevice(auth), { unitId: example.unit.unitId, version: example.version, resourceId: resource.resourceId });
  assert.equal(download.checksums.sha256, resource.download.checksums.sha256); assert.equal(driveCalls, 0);
  await f.devices.revoke(f.adminRequest({ deviceId: f.proof.deviceId })); await assert.rejects(desktop.list({ auth }), { code: "permission-denied" });
});
test("usuarios humanos conservan comprobación de permisos de Drive", async () => {
  const f = setup(); f.db.records.set(`activeClassroomUnits/${example.unit.unitId}/publications/${example.version}`, { manifest: example });
  const desktop = createDesktopHandlers({ db: f.db, resolveFile: async () => { const error = new Error("Forbidden"); error.code = "permission-denied"; throw error; } });
  const resource = example.resources.find((resource) => resource.file.provider === "drive");
  await assert.rejects(desktop.resolveDownload({ active: true }, { unitId: example.unit.unitId, version: example.version, resourceId: resource.resourceId }), { code: "permission-denied" });
});
test("registro limita instalaciones por IP", async () => {
  const f = setup();
  for (let i = 0; i < 10; i++) await f.session({ ...f.proof, deviceId: i.toString(16).padStart(32, "0") });
  await assert.rejects(f.session({ ...f.proof, deviceId: "f".repeat(32) }), { code: "resource-exhausted" });
});
test("equipo no ejecuta callables administrativos ni de otros módulos", () => {
  class PermissionError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const guarded = guardClassroomDevices(() => "human-result", PermissionError);
  assert.throws(() => guarded({ auth: { uid: "ac-device-123", token: {} } }), { code: "permission-denied" });
  assert.throws(() => guarded({ auth: { uid: "any", token: { activeClassroomDevice: true } } }), { code: "permission-denied" });
  assert.equal(guarded({ auth: { uid: "admin", token: {} } }), "human-result");
});
