const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const DEVICE_PREFIX = "ac-device-";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const isDevice = (auth) => auth?.token?.activeClassroomDevice === true || auth?.activeClassroomDevice === true || auth?.uid?.startsWith(DEVICE_PREFIX);
function identity(data) {
  if (!/^[a-f0-9]{32}$/.test(data?.deviceId || "") || !/^[a-f0-9]{64}$/.test(data?.credential || "")) {
    throw new HttpsError("unauthenticated", "Identidad de equipo inválida.");
  }
  return { deviceId: data.deviceId, credentialHash: digest(data.credential) };
}
function sameHash(left, right) {
  return typeof left === "string" && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function createDeviceHandlers({ db, auth, assertAdmin, now = Date.now }) {
  const devices = db.collection("activeClassroomDevices");
  const codes = db.collection("activeClassroomDeviceCodes");
  const expires = () => now() + 15 * 60 * 1000;
  async function administrator(request) {
    const profile = await assertAdmin(request);
    if (profile.active !== true || profile.role !== "admin" || isDevice(request.auth)) throw new HttpsError("permission-denied", "Se requiere administrador activo.");
    return profile;
  }
  async function session(request) {
    const { deviceId, credentialHash } = identity(request.data);
    const ref = devices.doc(deviceId);
    // Enrollment is proof-bound and rate limited before any durable registration.
    const rateRef = db.collection("activeClassroomDeviceRates").doc(digest(request.rawRequest?.ip || "unknown"));
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      await db.runTransaction(async (transaction) => {
        const rate = (await transaction.get(rateRef)).data();
        const recent = rate?.expiresAt > now();
        if (recent && rate.count >= 10) throw new HttpsError("resource-exhausted", "Espera antes de registrar otro equipo.");
        transaction.set(rateRef, { count: recent ? rate.count + 1 : 1, expiresAt: recent ? rate.expiresAt : now() + 3600000 });
      });
    }
    const result = await db.runTransaction(async (transaction) => {
      const stored = (await transaction.get(ref)).data();
      if (stored && !sameHash(stored.credentialHash, credentialHash)) throw new HttpsError("unauthenticated", "Credencial de equipo inválida.");
      if (stored?.status === "revoked") return { status: "revoked" };
      if (stored?.status === "authorized") return { status: "authorized", generation: stored.generation };
      if (stored?.expiresAt > now()) return { status: "pending", code: stored.code, expiresAt: stored.expiresAt };
      const code = randomBytes(5).toString("hex").toUpperCase();
      const codeRef = codes.doc(code);
      if ((await transaction.get(codeRef)).exists) throw new HttpsError("aborted", "Reintenta la activación.");
      if (stored?.code) transaction.delete(codes.doc(stored.code));
      const name = typeof request.data.name === "string" ? request.data.name.trim().slice(0, 100) : "Equipo del salón";
      const expiresAt = expires();
      transaction.set(ref, { credentialHash, name: name || "Equipo del salón", status: "pending", code, expiresAt, createdAt: stored?.createdAt || now() });
      transaction.set(codeRef, { deviceId, expiresAt });
      return { status: "pending", code, expiresAt };
    });
    if (result.status !== "authorized") return result;
    const customToken = await auth.createCustomToken(`${DEVICE_PREFIX}${deviceId}`, { activeClassroomDevice: true, deviceId, deviceGeneration: result.generation });
    return { status: "authorized", customToken };
  }
  async function approve(request) {
    const adminProfile = await administrator(request);
    const code = String(request.data?.code || "").replace(/[ -]/g, "").toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(code)) throw new HttpsError("invalid-argument", "Código de activación inválido.");
    return db.runTransaction(async (transaction) => {
      const codeRef = codes.doc(code);
      const pending = (await transaction.get(codeRef)).data();
      if (!pending || pending.expiresAt <= now()) throw new HttpsError("not-found", "Código vencido o ya utilizado.");
      const ref = devices.doc(pending.deviceId);
      const device = (await transaction.get(ref)).data();
      if (device?.status !== "pending" || device.code !== code) throw new HttpsError("failed-precondition", "Equipo no pendiente de activación.");
      transaction.update(ref, { status: "authorized", generation: 1, approvedBy: adminProfile.uid, approvedAt: now(), code: null });
      transaction.delete(codeRef);
      return { deviceId: pending.deviceId, name: device.name, status: "authorized" };
    });
  }
  async function revoke(request) {
    const adminProfile = await administrator(request);
    if (!/^[a-f0-9]{32}$/.test(request.data?.deviceId || "")) throw new HttpsError("invalid-argument", "Equipo inválido.");
    const deviceId = request.data.deviceId;
    await db.runTransaction(async (transaction) => {
      const ref = devices.doc(deviceId);
      const device = (await transaction.get(ref)).data();
      if (!device) throw new HttpsError("not-found", "Equipo no encontrado.");
      transaction.update(ref, { status: "revoked", generation: (device.generation || 0) + 1, revokedBy: adminProfile.uid, revokedAt: now() });
      if (device.code) transaction.delete(codes.doc(device.code));
    });
    // Registry revocation is authoritative even if this optional Auth cleanup fails.
    await auth.revokeRefreshTokens(`${DEVICE_PREFIX}${deviceId}`).catch((error) => {
      if (error.code !== "auth/user-not-found") throw error;
    });
    return { deviceId, status: "revoked" };
  }
  async function authorizeDevice(decoded) {
    const claims = decoded?.token || decoded;
    if (!claims?.activeClassroomDevice || !/^[a-f0-9]{32}$/.test(claims.deviceId || "") || decoded.uid !== `${DEVICE_PREFIX}${claims.deviceId}`) {
      throw new HttpsError("permission-denied", "Equipo no autorizado.");
    }
    const device = (await devices.doc(claims.deviceId).get()).data();
    if (device?.status !== "authorized" || device.generation !== claims.deviceGeneration) throw new HttpsError("permission-denied", "Autorización del equipo revocada.", { deviceRevoked: true });
    return { uid: decoded.uid, active: true, activeClassroomDevice: true, deviceId: claims.deviceId };
  }
  return { session, approve, revoke, authorizeDevice };
}
module.exports = { createDeviceHandlers, isDevice, DEVICE_PREFIX };
