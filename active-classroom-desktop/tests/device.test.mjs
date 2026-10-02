import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceSession } from "../src/offline/device-session.ts";
import { normalizeDisplayName, readDeviceLabel, saveDeviceLabel, visibleDeviceName } from "../src/offline/device-label.ts";
import { PublicationApi } from "../src/offline/remote.ts";

function setup(activated = false) {
  const stored = { deviceId: "a".repeat(32), name: "Salón 1", activated, revoked: false };
  let response = { status: "pending", code: "123456ABCD", expiresAt: 1000 };
  let disconnected = false;
  let expired = false;
  let exchanges = 0;
  let signIns = 0;
  const dependencies = {
    load: async () => ({ ...stored }),
    proof: async () => ({ deviceId: stored.deviceId, name: stored.name, credential: "b".repeat(64) }),
    mark: async (action) => { Object.assign(stored, { activated: action === "activated", revoked: action === "revoked" }); return { ...stored }; },
    exchange: async () => { exchanges++; if (disconnected) throw new Error("network"); return response; },
    signIn: async (_token, owner) => { assert.equal(owner, `ac-device-${stored.deviceId}`); signIns++; expired = false; },
    token: async () => { if (expired) throw new Error("auth/user-token-expired"); return "id-token"; },
    signOut: async () => {},
    saveLabel: async (label) => { stored.displayName = label.displayName; },
  };
  const states = [];
  const session = new DeviceSession(dependencies, (state) => states.push(state));
  return { session, states, dependencies, stored, authorize: (displayName) => { response = { status: "authorized", customToken: "custom-token", ...(displayName === undefined ? {} : { displayName }) }; }, revoke: () => { response = { status: "revoked" }; }, expire: () => { expired = true; }, disconnect: () => { disconnected = true; }, exchanges: () => exchanges, signIns: () => signIns };
}
test("primer arranque obtiene código sin pedir correo ni contraseña", async () => {
  const { session, stored } = setup(); await session.start(true);
  assert.equal(session.state.phase, "activation"); assert.equal(session.state.code, "123456ABCD"); assert.equal(stored.activated, false);
});
test("activación abre biblioteca y persiste autorización", async () => {
  const f = setup(); await f.session.start(true); f.authorize(); await f.session.connect();
  assert.equal(f.session.state.phase, "ready"); assert.equal(f.stored.activated, true); assert.equal(await f.session.token(), "id-token");
});
test("reinicio activado funciona offline sin intercambiar credenciales", async () => {
  const f = setup(true); f.disconnect(); await f.session.start(false);
  assert.equal(f.session.state.phase, "ready"); assert.equal(f.session.state.online, false); assert.equal(f.exchanges(), 0);
});
test("falla al renovar conexión conserva acceso local", async () => {
  const f = setup(true); f.disconnect(); await f.session.start(true);
  assert.equal(f.session.state.phase, "ready"); assert.equal(f.session.state.online, false);
  await assert.rejects(f.session.token()); assert.equal(f.session.state.phase, "ready");
});
test("instalación nueva offline permanece pendiente", async () => {
  const f = setup(); await f.session.start(false); assert.equal(f.session.state.phase, "activation"); assert.equal(f.exchanges(), 0);
});
test("revocación conocida bloquea biblioteca incluso tras reiniciar offline", async () => {
  const f = setup(true); f.revoke(); await f.session.start(true);
  assert.equal(f.session.state.phase, "revoked"); assert.equal(f.stored.revoked, true); await assert.rejects(f.session.token());
  const reboot = new DeviceSession(f.dependencies, () => {}); await reboot.start(false); assert.equal(reboot.state.phase, "revoked");
});
test("token vencido renueva identidad automáticamente", async () => {
  const f = setup(true); f.authorize(); await f.session.start(true); f.expire();
  assert.equal(await f.session.token(true), "id-token"); assert.equal(f.signIns(), 2); assert.equal(f.stored.activated, true);
});
test("reintentos concurrentes comparten intercambio", async () => {
  const f = setup(true); f.authorize(); await f.session.start(false);
  await Promise.all([f.session.connect(), f.session.connect(), f.session.connect()]); assert.equal(f.exchanges(), 1);
});
test("llavero no disponible falla cerrado sin generar secreto alternativo", async () => {
  const f = setup(); f.dependencies.load = async () => { throw new Error("keyring locked"); }; await f.session.start(true);
  assert.equal(f.session.state.phase, "error"); assert.equal(f.exchanges(), 0);
});

test("activación recibe alias, conserva hostname y reinicio offline conserva último nombre", async () => {
  const f = setup(); f.authorize("Salón 4 - Inglés"); await f.session.start(true);
  assert.equal(visibleDeviceName(f.session.state.identity), "Salón 4 - Inglés"); assert.equal(f.stored.name, "Salón 1");
  const owner = f.session.owner; const signIns = f.signIns();
  await f.session.receiveLabel({ deviceId: f.stored.deviceId, displayName: "Aula Audiovisual" });
  assert.equal(f.session.owner, owner); assert.equal(f.signIns(), signIns); assert.equal(f.stored.activated, true);
  f.disconnect(); const reboot = new DeviceSession(f.dependencies, () => {}); await reboot.start(false);
  assert.equal(visibleDeviceName(reboot.state.identity), "Aula Audiovisual"); assert.equal(reboot.state.phase, "ready");
});

test("sincronización/conexión posterior actualiza nombre sin nueva activación; vaciar usa hostname", async () => {
  const f = setup(true); f.authorize("Salón 4"); await f.session.start(true);
  f.authorize("Salón 5"); await f.session.connect(); assert.equal(f.stored.displayName, "Salón 5");
  await f.session.receiveLabel({ deviceId: "b".repeat(32), displayName: "Equipo ajeno" }); assert.equal(f.stored.displayName, "Salón 5");
  await f.session.receiveLabel({ deviceId: f.stored.deviceId, displayName: "<script>" }); assert.equal(f.stored.displayName, "Salón 5");
  await f.session.receiveLabel({ deviceId: f.stored.deviceId, displayName: "" }); assert.equal(visibleDeviceName(f.session.state.identity), f.stored.name);
});

test("almacenamiento público separa equipos, tolera corrupción y nunca guarda secretos", () => {
  const records = new Map(); const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const deviceId = "a".repeat(32);
  saveDeviceLabel(storage, { deviceId, displayName: "  Salo\u0301n 1  ", credential: "secret-never-save", deviceName: "hostname" });
  assert.equal(readDeviceLabel(storage, deviceId), "Salón 1"); assert.equal(readDeviceLabel(storage, "b".repeat(32)), undefined);
  assert.deepEqual(JSON.parse([...records.values()][0]), { deviceId, displayName: "Salón 1" });
  storage.setItem([...records.keys()][0], "{broken"); assert.equal(readDeviceLabel(storage, deviceId), undefined);
  for (const value of ["A\nB", "<script>", "\u202Eevil", "\u200Bhidden", "x".repeat(101)]) assert.throws(() => normalizeDisplayName(value));
});

test("fallo de almacenamiento del alias no bloquea credenciales ni clase local", async () => {
  const f = setup(true); f.authorize(); await f.session.start(true);
  f.dependencies.saveLabel = async () => { throw new Error("quota"); };
  await f.session.receiveLabel({ deviceId: f.stored.deviceId, displayName: "Salón nuevo" });
  assert.equal(f.session.state.phase, "ready"); assert.equal(await f.session.token(), "id-token");
  assert.equal(visibleDeviceName(f.session.state.identity), "Salón nuevo");
});

test("listado y manifest transportan alias sin alterar contrato del contenido", async () => {
  const label = { deviceId: "a".repeat(32), deviceName: "active-T4-PRO", displayName: "Salón 4" };
  const publication = { unitId: "unit", levelId: "level", version: 1, name: "Unit", contentHash: "b".repeat(64) };
  const manifest = { version: 1 }; const received = [];
  const api = new PublicationApi(async () => "token", async (url) => new Response(JSON.stringify({ result: url.endsWith("listActiveClassroomPublications") ? { device: label, publications: [publication], nextCursor: null } : { device: label, manifest } })));
  api.onDevice = async (device) => { received.push(device); };
  assert.deepEqual(await api.list(), [publication]); assert.deepEqual(await api.manifest(publication), manifest);
  assert.deepEqual(received, [label, label]);
});
