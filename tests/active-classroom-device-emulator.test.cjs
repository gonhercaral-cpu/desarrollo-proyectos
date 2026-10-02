const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const { randomBytes } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createDeviceHandlers } = require("../drive/activeClassroomDevices");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Requiere emulador Firestore.");
const app = admin.initializeApp({ projectId: "active-classroom-device-tests" }, "device-tests");
const db = app.firestore();
const handlers = createDeviceHandlers({ db, auth: { createCustomToken: async (uid, claims) => ({ uid, claims }), revokeRefreshTokens: async () => {} }, assertAdmin: async () => ({ uid: "admin", role: "admin", active: true }) });
after(() => app.delete());
test("Firestore: registro concurrente conserva un único código y aprobación atómica", async () => {
  const data = { deviceId: randomBytes(16).toString("hex"), credential: randomBytes(32).toString("hex"), name: "Salón test" };
  const request = { data, rawRequest: { ip: randomBytes(16).toString("hex") } };
  const results = await Promise.all([handlers.session(request), handlers.session(request)]);
  assert.equal(results[0].code, results[1].code);
  const approvals = await Promise.allSettled([handlers.approve({ data: { code: results[0].code } }), handlers.approve({ data: { code: results[0].code } })]);
  assert.equal(approvals.filter((result) => result.status === "fulfilled").length, 1);
  const session = await handlers.session(request);
  assert.equal(session.status, "authorized");
  const decoded = { uid: session.customToken.uid, token: session.customToken.claims };
  assert.equal((await handlers.authorizeDevice(decoded)).active, true);
  await handlers.revoke({ data: { deviceId: data.deviceId } });
  await assert.rejects(handlers.authorizeDevice(decoded), { code: "permission-denied" });
  assert.equal((await handlers.session(request)).status, "revoked");
});
