import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceSession } from "../src/offline/device-session.ts";

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
  };
  const states = [];
  const session = new DeviceSession(dependencies, (state) => states.push(state));
  return { session, states, dependencies, stored, authorize: () => { response = { status: "authorized", customToken: "custom-token" }; }, revoke: () => { response = { status: "revoked" }; }, expire: () => { expired = true; }, disconnect: () => { disconnected = true; }, exchanges: () => exchanges, signIns: () => signIns };
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
