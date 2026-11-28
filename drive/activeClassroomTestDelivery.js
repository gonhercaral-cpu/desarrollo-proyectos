const { HttpsError } = require("firebase-functions/v2/https");
const { requireClassroom } = require("./activeClassroomPermissions");

const validDevice = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

function canReceiveUnit(unit, deviceId) {
  if (!Object.hasOwn(unit || {}, "studioTestDeviceId")) return true;
  return validDevice(deviceId) && unit.studioTestDeviceId === deviceId;
}

function createTestDelivery({ db, getProfile, timestamp }) {
  return async function restrictTestUnit(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = requireClassroom(await getProfile(uid), "publishVersions");
    requireClassroom(profile, "manageDevices");
    const { unitId, deviceId } = request.data || {};
    if (typeof unitId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(unitId) || !validDevice(deviceId)) {
      throw new HttpsError("invalid-argument", "Selecciona una unidad y un equipo de prueba válidos.");
    }
    const unitRef = db.collection("activeClassroomUnits").doc(unitId);
    await db.runTransaction(async transaction => {
      const unit = (await transaction.get(unitRef)).data();
      const device = (await transaction.get(db.collection("activeClassroomDevices").doc(deviceId))).data();
      const publications = await transaction.get(unitRef.collection("publications").limit(1));
      if (!unit?.draft || device?.status !== "authorized") throw new HttpsError("failed-precondition", "Guarda el borrador y vincula el equipo de prueba primero.");
      if (unit.studioTestDeviceId === deviceId) return;
      if (Object.hasOwn(unit, "studioTestDeviceId") || unit.publishedVersion || !publications.empty || ["pending", "publishing"].includes(unit.publicationJob?.state)) {
        throw new HttpsError("failed-precondition", "Usa una unidad nueva, sin publicaciones ni entregas programadas.");
      }
      transaction.update(unitRef, { studioTestDeviceId: deviceId, studioTestAssignedByUid: uid, studioTestAssignedAt: timestamp() });
    });
    return { deviceId };
  };
}

module.exports = { canReceiveUnit, createTestDelivery };
