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
function displayName(value) {
  if (typeof value !== "string" || !/^[\p{L}\p{M}\p{N} .,'’()/_:#&+-]*$/u.test(value)) throw new HttpsError("invalid-argument", "Nombre visible inválido. Usa letras, números, espacios y puntuación habitual.");
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length > 100) throw new HttpsError("invalid-argument", "Nombre visible: máximo 100 caracteres.");
  return normalized;
}
function names(device, technicalName) {
  const deviceName = device.deviceName || technicalName || null;
  // Old versions wrote aliases into `name`; recover hostname from authenticated proof.
  const visible = device.displayName ?? (device.renamedAt ? device.name || "" : "");
  return { deviceName, displayName: visible, name: visible || deviceName || device.name || "Equipo del salón" };
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
      const technicalName = typeof request.data.name === "string" ? request.data.name.trim().slice(0, 100) : "Equipo del salón";
      const label = names(stored || {}, technicalName || "Equipo del salón");
      if (stored?.status === "authorized") {
        const appVersion = typeof request.data.appVersion === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(request.data.appVersion) ? request.data.appVersion : stored.appVersion || null;
        transaction.update(ref, { lastSeenAt: now(), appVersion, deviceName: label.deviceName, displayName: label.displayName });
        return { status: "authorized", generation: stored.generation, ...label };
      }
      if (stored?.expiresAt > now()) {
        transaction.update(ref, { deviceName: label.deviceName, displayName: label.displayName });
        return { status: "pending", code: stored.code, expiresAt: stored.expiresAt, ...label };
      }
      const code = randomBytes(5).toString("hex").toUpperCase();
      const codeRef = codes.doc(code);
      if ((await transaction.get(codeRef)).exists) throw new HttpsError("aborted", "Reintenta la activación.");
      if (stored?.code) transaction.delete(codes.doc(stored.code));
      const expiresAt = expires();
      transaction.set(ref, { ...stored, credentialHash, name: stored?.name || label.deviceName, deviceName: label.deviceName, displayName: label.displayName, status: "pending", code, expiresAt, createdAt: stored?.createdAt || now(), requestedAt: now() });
      transaction.set(codeRef, { deviceId, expiresAt });
      return { status: "pending", code, expiresAt, ...label };
    });
    if (result.status !== "authorized") return result;
    const customToken = await auth.createCustomToken(`${DEVICE_PREFIX}${deviceId}`, { activeClassroomDevice: true, deviceId, deviceGeneration: result.generation });
    return { status: "authorized", customToken, deviceName: result.deviceName, displayName: result.displayName };
  }
  async function approve(request) {
    const adminProfile = await administrator(request);
    const code = String(request.data?.code || "").replace(/[ -]/g, "").toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(code)) throw new HttpsError("invalid-argument", "Código de activación inválido.");
    const requestedName = request.data?.displayName === undefined ? undefined : displayName(request.data.displayName);
    return db.runTransaction(async (transaction) => {
      const codeRef = codes.doc(code);
      const pending = (await transaction.get(codeRef)).data();
      if (!pending || pending.expiresAt <= now()) throw new HttpsError("not-found", "Código vencido o ya utilizado.");
      const ref = devices.doc(pending.deviceId);
      const device = (await transaction.get(ref)).data();
      if (device?.status !== "pending" || device.code !== code) throw new HttpsError("failed-precondition", "Equipo no pendiente de activación.");
      const visible = requestedName ?? names(device).displayName;
      transaction.update(ref, { status: "authorized", generation: (device.generation || 0) + 1, approvedBy: adminProfile.uid, approvedAt: now(), code: null, displayName: visible });
      transaction.delete(codeRef);
      return { deviceId: pending.deviceId, ...names({ ...device, displayName: visible }), status: "authorized" };
    });
  }
  async function disable(request, rejectPending = false) {
    const adminProfile = await administrator(request);
    if (!/^[a-f0-9]{32}$/.test(request.data?.deviceId || "")) throw new HttpsError("invalid-argument", "Equipo inválido.");
    const deviceId = request.data.deviceId;
    await db.runTransaction(async (transaction) => {
      const ref = devices.doc(deviceId);
      const device = (await transaction.get(ref)).data();
      if (!device) throw new HttpsError("not-found", "Equipo no encontrado.");
      if (rejectPending && device.status !== "pending") throw new HttpsError("failed-precondition", "Solo se pueden rechazar solicitudes pendientes.");
      transaction.update(ref, { status: "revoked", generation: (device.generation || 0) + 1, revokedBy: adminProfile.uid, revokedAt: now(), revokedReason: rejectPending ? "rejected" : "revoked", code: null });
      if (device.code) transaction.delete(codes.doc(device.code));
    });
    // Registry revocation is authoritative even if this optional Auth cleanup fails.
    await auth.revokeRefreshTokens(`${DEVICE_PREFIX}${deviceId}`).catch((error) => {
      if (error.code !== "auth/user-not-found") throw error;
    });
    return { deviceId, status: "revoked" };
  }
  const revoke = (request) => disable(request);
  const reject = (request) => disable(request, true);
  async function list(request) {
    await administrator(request);
    const cursor = request.data?.cursor || null;
    if (cursor && !/^[a-f0-9]{32}$/.test(cursor)) throw new HttpsError("invalid-argument", "Cursor inválido.");
    let query = devices.orderBy("__name__").limit(101);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    // Explicit projection: never send credential hashes, token material or IP counters to the web.
    const result = snapshot.docs.slice(0, 100).map((document) => {
      const device = document.data();
      return {
        deviceId: document.id, ...names(device), status: device.status,
        code: device.status === "pending" ? device.code || null : null,
        expiresAt: device.status === "pending" ? device.expiresAt || null : null,
        requestedAt: device.requestedAt || device.createdAt || null,
        approvedAt: device.approvedAt || null, revokedAt: device.revokedAt || null,
        revokedReason: device.revokedReason || null,
        lastSeenAt: device.lastSeenAt || null, lastSyncAt: device.lastSyncAt || null,
        lastSyncUnitId: device.lastSyncUnitId || null, lastSyncVersion: device.lastSyncVersion || null,
        appVersion: device.appVersion || null,
      };
    });
    return { devices: result, nextCursor: snapshot.docs.length > 100 ? result.at(-1).deviceId : null };
  }
  async function rename(request) {
    const profile = await administrator(request);
    const { deviceId } = request.data || {};
    // Retain the old callable payload for already published web clients.
    const visible = displayName(request.data?.displayName ?? request.data?.name);
    if (!/^[a-f0-9]{32}$/.test(deviceId || "")) throw new HttpsError("invalid-argument", "Equipo inválido.");
    await db.runTransaction(async (transaction) => {
      const ref = devices.doc(deviceId);
      if (!(await transaction.get(ref)).exists) throw new HttpsError("not-found", "Equipo no encontrado.");
      transaction.update(ref, { displayName: visible, renamedAt: now(), renamedBy: profile.uid });
    });
    return { deviceId, displayName: visible };
  }
  async function reportSync(request) {
    await authorizeDevice(request.auth);
    const { unitId, version } = request.data || {};
    if (typeof unitId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(unitId) || !Number.isSafeInteger(version) || version < 1) throw new HttpsError("invalid-argument", "Publicación inválida.");
    const claims = request.auth.token;
    await db.runTransaction(async (transaction) => {
      const ref = devices.doc(claims.deviceId);
      const device = (await transaction.get(ref)).data();
      const publication = await transaction.get(db.doc(`activeClassroomUnits/${unitId}/publications/${version}`));
      if (device?.status !== "authorized" || device.generation !== claims.deviceGeneration) throw new HttpsError("permission-denied", "Equipo revocado.");
      if (!publication.exists || !publication.data()?.manifest) throw new HttpsError("not-found", "Publicación no encontrada.");
      transaction.update(ref, { lastSeenAt: now(), lastSyncAt: now(), lastSyncUnitId: unitId, lastSyncVersion: version });
    });
    return { recorded: true };
  }
  async function authorizeDevice(decoded) {
    const claims = decoded?.token || decoded;
    if (!claims?.activeClassroomDevice || !/^[a-f0-9]{32}$/.test(claims.deviceId || "") || decoded.uid !== `${DEVICE_PREFIX}${claims.deviceId}`) {
      throw new HttpsError("permission-denied", "Equipo no autorizado.");
    }
    const device = (await devices.doc(claims.deviceId).get()).data();
    if (device?.status !== "authorized" || device.generation !== claims.deviceGeneration) throw new HttpsError("permission-denied", "Autorización del equipo revocada.", { deviceRevoked: true });
    if (!device.lastSeenAt || now() - device.lastSeenAt >= 60000) await devices.doc(claims.deviceId).update({ lastSeenAt: now() });
    return { uid: decoded.uid, active: true, activeClassroomDevice: true, deviceId: claims.deviceId, ...names(device) };
  }
  return { session, approve, revoke, reject, list, rename, reportSync, authorizeDevice };
}
module.exports = { createDeviceHandlers, isDevice, DEVICE_PREFIX };
