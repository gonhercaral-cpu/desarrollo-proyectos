const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore, FieldValue } = functionsRequire("firebase-admin/firestore");
const { createSignageHandlers } = require("../functions/digitalSignage");

class TestError extends Error { constructor(code, message) { super(message); this.code = code; } }

describe("Digital Signage: comunicación real con Firestore emulado", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, () => {
  let app, db, handlers;
  let clock = Date.now();
  const uid = `ds-admin-${randomUUID()}`;
  const auth = { uid, token: {} };
  const token = () => `ds2_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const call = (data, actor = auth) => handlers.control({ data, auth: actor });
  const sessions = new Map();
  const exchange = (credential, data = {}) => {
    if (!sessions.has(credential)) sessions.set(credential, randomUUID());
    return handlers.exchange({ data: { token: credential, playerSessionId: sessions.get(credential), ...data } });
  };
  async function pending() {
    const credential = token();
    const session = await handlers.pairing({ data: { action: "create", token: credential, sessionId: randomUUID() } });
    return { credential, session };
  }
  async function device() {
    const { credential, session } = await pending();
    const result = await call({ action: "claim", code: session.code, device: {
      name: "Recepción", plantel: "Centro", location: "Lobby", assignedPlaylistId: "playlist-original",
    } });
    return { credential, deviceId: result.deviceId, session };
  }
  before(async () => {
    app = initializeApp({ projectId: "security-rules-audit" }, `signage-${randomUUID()}`);
    db = getFirestore(app);
    handlers = createSignageHandlers({ db, FieldValue, HttpsError: TestError, now: () => clock });
    await db.collection("users").doc(uid).set({ role: "admin", active: true });
  });
  after(async () => { await deleteApp(app); });

  it("exige administrador activo y rechaza identidades Classroom", async () => {
    await assert.rejects(call({ action: "status", deviceId: "x" }, null), { code: "permission-denied" });
    await assert.rejects(call({ action: "status", deviceId: "x" }, { uid, token: { activeClassroomDevice: true } }), { code: "permission-denied" });
    const disabled = `ds-disabled-${randomUUID()}`;
    await db.collection("users").doc(disabled).set({ role: "admin", active: false });
    await assert.rejects(call({ action: "status", deviceId: "x" }, { uid: disabled }), { code: "permission-denied" });
  });

  it("vincula sin persistir credencial y solo el navegador con secreto consulta la sesión", async () => {
    const d = await device();
    const publicData = (await db.collection("digitalSignageDevices").doc(d.deviceId).get()).data();
    assert.equal(publicData.deviceToken, "");
    assert.equal(JSON.stringify(publicData).includes(d.credential), false);
    const poll = await handlers.pairing({ data: { action: "poll", sessionId: d.session.id, token: d.credential } });
    assert.equal(poll.status, "claimed");
    assert.equal(poll.deviceId, d.deviceId);
    assert.equal(JSON.stringify(poll).includes(d.credential), false);
    await assert.rejects(handlers.pairing({ data: { action: "poll", sessionId: d.session.id, token: token() } }), { code: "permission-denied" });
    const state = await exchange(d.credential);
    assert.equal(state.device.assignedPlaylistId, "playlist-original");
  });

  it("una pantalla anterior puede estar conectada sin tener control remoto y no pierde su configuración", async () => {
    const deviceId = `legacy-${randomUUID()}`;
    const ref = db.collection("digitalSignageDevices").doc(deviceId);
    const original = {
      name: "Pantalla Windows", plantel: "Centro", location: "Recepción", active: true,
      deviceToken: deviceId, assignedPlaylistId: "playlist-conservada", playbackMode: "stream", lastSeenMillis: clock,
    };
    await ref.set(original);
    const status = await call({ action: "status", deviceId });
    assert.equal(status.enabled, false);
    assert.equal(status.online, true);
    assert.equal(status.lastSeenAt, clock);
    assert.equal(status.mode, "stream");
    assert.equal(status.telemetry, null);
    await assert.rejects(call({ action: "command", deviceId, requestId: randomUUID(), type: "refresh" }), { code: "failed-precondition" });
    await assert.rejects(call({ action: "monitor_start", deviceId, sessionId: randomUUID() }), { code: "failed-precondition" });
    assert.deepEqual((await ref.get()).data(), original);
    clock += 76000;
    assert.equal((await call({ action: "status", deviceId })).online, true);
    clock += 45000;
    assert.equal((await call({ action: "status", deviceId })).online, false);
    await ref.update({ lastSeenMillis: clock, active: false });
    const inactive = await call({ action: "status", deviceId });
    assert.equal(inactive.active, false);
    assert.equal(inactive.online, false);
    await ref.update({ active: true });
    const reactivated = await call({ action: "status", deviceId });
    assert.equal(reactivated.online, true);
    assert.equal(reactivated.enabled, false);
    assert.equal((await ref.get()).data().assignedPlaylistId, "playlist-conservada");
    assert.equal((await db.collection("digitalSignageControl").doc(deviceId).get()).exists, false);
  });

  it("rechaza códigos inválidos, expirados, duplicados y carreras de claim", async () => {
    await assert.rejects(call({ action: "claim", code: "invalid" }), { code: "invalid-argument" });
    const p = await pending();
    const request = { action: "claim", code: p.session.code, device: { name: "N", plantel: "P", location: "L" } };
    const results = await Promise.allSettled([call(request), call(request)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(call(request), { code: "failed-precondition" });
    const expired = await pending();
    clock += 601000;
    await assert.rejects(call({ ...request, code: expired.session.code }), { code: "failed-precondition" });
  });

  it("revincula preservando registro, playlist, asociaciones y modo e invalida token anterior", async () => {
    const d = await device();
    await call({ action: "mode", deviceId: d.deviceId, mode: "stream" });
    await db.collection("digitalSignageDevices").doc(d.deviceId).update({ association: "estable" });
    const p = await pending();
    const result = await call({ action: "rebind", deviceId: d.deviceId, code: p.session.code });
    assert.equal(result.deviceId, d.deviceId);
    await assert.rejects(exchange(d.credential), { code: "permission-denied" });
    const current = await exchange(p.credential);
    assert.equal(current.device.name, "Recepción");
    assert.equal(current.device.assignedPlaylistId, "playlist-original");
    assert.equal(current.device.association, "estable");
    assert.equal(current.mode, "stream");
  });

  it("recarga: pendiente → recibida → ejecutada y deduplica envíos y consultas", async () => {
    const d = await device();
    const request = { action: "command", deviceId: d.deviceId, requestId: randomUUID(), type: "refresh" };
    const first = await call(request);
    assert.equal(first.command.status, "pending");
    const [a, b] = await Promise.all([exchange(d.credential), exchange(d.credential, { playerSessionId: randomUUID() })]);
    const delivered = [a, b].filter((value) => value.command);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].command.status, "received");
    // Whichever session won can recover a dropped response, without another session claiming it.
    sessions.set(d.credential, delivered[0].command.receivedBy);
    assert.equal((await exchange(d.credential)).command.id, first.command.id);
    assert.equal((await call(request)).command.id, first.command.id);
    await exchange(d.credential, { ack: { id: first.command.id, status: "executed", result: "Playlist aplicada" } });
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).command.status, "executed");
    assert.equal((await exchange(d.credential)).command, null);
  });

  it("revinculación conserva acomodos y el canal privado entrega solo versiones nuevas de su plantel", async () => {
    const d = await device();
    const layoutRef = db.collection("digitalSignageRoomLayouts").doc(`ds-test-room-${randomUUID()}`);
    await layoutRef.set({ publishedPlantel: "Centro", publishedSnapshot: {
      id: layoutRef.id, name: "Acomodo", plantel: "Centro", active: true, timezone: "America/Tijuana",
      publishedAtMillis: clock, displayRules: [{ id: "rule", active: true, deviceIds: [d.deviceId] }],
    } });
    try {
      const p = await pending();
      await call({ action: "rebind", deviceId: d.deviceId, code: p.session.code });
      const first = await exchange(p.credential, { readOnly: true });
      assert.equal(first.roomManifest.deviceToken, d.deviceId);
      assert.equal(first.roomManifest.layouts[0].id, layoutRef.id);
      assert.ok(first.roomRevision);
      assert.equal(JSON.stringify(first.roomManifest).includes(p.credential), false);
      const unchanged = await exchange(p.credential, { readOnly: true, roomRevision: first.roomRevision });
      assert.equal(Object.hasOwn(unchanged, "roomManifest"), false);
      await db.collection("digitalSignageDevices").doc(d.deviceId).update({ plantel: "Otro plantel" });
      const relocated = await exchange(p.credential, { readOnly: true, roomRevision: first.roomRevision });
      assert.equal(relocated.roomManifest, null);
      assert.equal(relocated.roomRevision, "");
    } finally { await layoutRef.delete(); }
  });

  it("expira órdenes desconectadas y rechaza ACK ajeno/tardío", async () => {
    const d = await device();
    const request = { action: "command", deviceId: d.deviceId, requestId: randomUUID(), type: "refresh" };
    await call(request);
    clock += 121000;
    assert.equal((await exchange(d.credential, { ack: { id: request.requestId, status: "executed" } })).command, null);
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).command.status, "expired");
    clock += 10000;
    await call({ ...request, requestId: randomUUID() });
    await exchange(d.credential, { ack: { id: "otro", status: "executed" } });
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).command.status, "received");
  });

  it("cada pantalla aplica modo propio y reporta origen independiente del modo", async () => {
    const a = await device(), b = await device();
    await call({ action: "mode", deviceId: a.deviceId, mode: "stream" });
    await exchange(a.credential, { telemetry: { title: "Vídeo", type: "video", state: "playing", appliedMode: "stream", origin: "unknown", positionSeconds: 4 } });
    await exchange(b.credential, { telemetry: { title: "Imagen", type: "image", state: "playing", appliedMode: "cache", origin: "cache" } });
    const sa = await call({ action: "status", deviceId: a.deviceId });
    const sb = await call({ action: "status", deviceId: b.deviceId });
    assert.equal(sa.mode, "stream"); assert.equal(sa.telemetry.origin, "unknown");
    assert.equal(sb.mode, "cache"); assert.equal(sb.telemetry.origin, "cache");
    assert.equal(sa.online, true);
    clock += 76000;
    assert.equal((await call({ action: "status", deviceId: a.deviceId })).online, true);
    clock += 45000;
    assert.equal((await call({ action: "status", deviceId: a.deviceId })).online, false);
  });

  it("monitoreo privado exige sesión vigente y descarta capturas de otra sesión", async () => {
    const d = await device(), sessionId = randomUUID();
    await call({ action: "monitor_start", deviceId: d.deviceId, sessionId });
    await assert.rejects(call({ action: "monitor_start", deviceId: d.deviceId, sessionId: randomUUID() }), { code: "already-exists" });
    const frame = { dataUrl: "data:image/jpeg;base64,/9j/", capturedAt: clock };
    await exchange(d.credential, { frame, monitorSessionId: "otra" });
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).monitor.frame, null);
    clock += 9000;
    await exchange(d.credential, { frame: { ...frame, capturedAt: clock }, monitorSessionId: sessionId });
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).monitor.frame.dataUrl, frame.dataUrl);
    await call({ action: "monitor_stop", deviceId: d.deviceId, sessionId });
    assert.equal((await exchange(d.credential)).monitor, null);
  });

  it("web: no ejecuta código ni acepta navegación de origen arbitrario y expira al cerrar sesión", async () => {
    const d = await device(), sessionId = randomUUID();
    await exchange(d.credential, { telemetry: { contentId: "web-1", type: "web", state: "playing", webUrl: "https://example.org/" } });
    const request = { action: "command", deviceId: d.deviceId, requestId: randomUUID(), type: "web_reload", sessionId };
    await assert.rejects(call(request), { code: "permission-denied" });
    await call({ action: "monitor_start", deviceId: d.deviceId, sessionId });
    await assert.rejects(call({ ...request, type: "eval" }), { code: "invalid-argument" });
    for (const path of ["//evil.test", "/\\evil.test", "javascript:alert(1)", "/\nabc"]) {
      await assert.rejects(call({ ...request, type: "web_navigate", payload: { path } }), { code: "invalid-argument" });
    }
    await call(request);
    await call({ action: "monitor_stop", deviceId: d.deviceId, sessionId });
    assert.equal((await exchange(d.credential)).command, null);
    assert.equal((await call({ action: "status", deviceId: d.deviceId })).command.status, "expired");
  });

  it("desactivar pantalla suspende comandos y telemetría", async () => {
    const d = await device();
    await db.collection("digitalSignageDevices").doc(d.deviceId).update({ active: false });
    assert.equal((await exchange(d.credential, { telemetry: { state: "playing" } })).device.active, false);
    await assert.rejects(call({ action: "command", deviceId: d.deviceId, requestId: randomUUID(), type: "refresh" }), { code: "failed-precondition" });
  });
});
