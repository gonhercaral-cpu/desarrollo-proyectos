import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  limit,
  db,
  DEVICES_COLLECTION,
  PAIRING_SESSIONS_COLLECTION,
  PAIRING_CODE_TTL_MS,
  assertAdminUser,
  cleanText,
  getUserName,
  getUserId,
  normalizePairingSessionDocument,
  createUniqueDeviceToken,
  generatePairingCode,
  generateSessionSecret,
  normalizePairingCode,
  getTimestampMillis,
  isPairingSessionClaimable
} from "./shared";
import { logSignageAudit } from "./auditService";

export async function createPairingSession() {
  const pairingRef = doc(collection(db, PAIRING_SESSIONS_COLLECTION));
  const code = generatePairingCode();
  const setupSecret = generateSessionSecret();
  const payload = {
    code,
    status: "pending",
    deviceToken: null,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + PAIRING_CODE_TTL_MS),
    claimedAt: null,
    claimedBy: "",
    userAgent:
      typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
    lastSeenAt: serverTimestamp(),
    setupSecret,
  };

  await setDoc(pairingRef, payload);

  return {
    id: pairingRef.id,
    ...payload,
  };
}

export function subscribePairingSession(sessionId, callback, onError) {
  const cleanSessionId = cleanText(sessionId);
  if (!cleanSessionId) return () => {};

  return onSnapshot(
    doc(db, PAIRING_SESSIONS_COLLECTION, cleanSessionId),
    (snapshot) => {
      callback(snapshot.exists() ? normalizePairingSessionDocument(snapshot) : null);
    },
    onError
  );
}

export async function updatePairingSessionHeartbeat(sessionId, setupSecret) {
  const cleanSessionId = cleanText(sessionId);
  const cleanSecret = cleanText(setupSecret);
  if (!cleanSessionId || !cleanSecret) return;

  await updateDoc(doc(db, PAIRING_SESSIONS_COLLECTION, cleanSessionId), {
    lastSeenAt: serverTimestamp(),
    setupSecret: cleanSecret,
  });
}

export async function claimPairingCode(code, deviceData, user) {
  assertAdminUser(user);

  const cleanCode = normalizePairingCode(code);
  const name = cleanText(deviceData?.name);
  const plantel = cleanText(deviceData?.plantel);
  const location = cleanText(deviceData?.location);
  const assignedPlaylistId = cleanText(deviceData?.assignedPlaylistId);

  if (!cleanCode) {
    throw new Error("Ingresa el codigo de vinculacion.");
  }

  if (!name || !plantel || !location) {
    throw new Error("Completa nombre, plantel y ubicacion.");
  }

  const pairingSnapshot = await getDocs(
    query(
      collection(db, PAIRING_SESSIONS_COLLECTION),
      where("code", "==", cleanCode),
      limit(10)
    )
  );
  const now = Date.now();
  const sessionDocument = pairingSnapshot.docs.find((candidate) => {
    const data = candidate.data();
    return isPairingSessionClaimable(data, now);
  });

  if (!sessionDocument) {
    throw new Error("Codigo invalido, expirado o ya usado.");
  }

  const deviceToken = await createUniqueDeviceToken();
  const deviceRef = doc(db, DEVICES_COLLECTION, deviceToken);
  const pairingRef = doc(db, PAIRING_SESSIONS_COLLECTION, sessionDocument.id);

  await runTransaction(db, async (transaction) => {
    const pairingDoc = await transaction.get(pairingRef);

    if (!pairingDoc.exists()) {
      throw new Error("Codigo no encontrado.");
    }

    const pairingData = pairingDoc.data();
    if (pairingData.status !== "pending") {
      throw new Error("Codigo ya usado.");
    }

    if (!isPairingSessionClaimable(pairingData, Date.now())) {
      throw new Error("Codigo expirado.");
    }

    transaction.set(deviceRef, {
      name,
      plantel,
      location,
      deviceToken,
      assignedPlaylistId,
      active: true,
      lastSeenAt: null,
      lastSeenMillis: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: getUserName(user),
      createdById: getUserId(user),
    });

    transaction.update(pairingRef, {
      status: "claimed",
      deviceToken,
      claimedAt: serverTimestamp(),
      claimedBy: getUserName(user),
      updatedAt: serverTimestamp(),
    });
  });
  await logSignageAudit("vincular pantalla por codigo", "pairing", deviceToken, name, {
    code: cleanCode,
    plantel,
    location,
    assignedPlaylistId,
  }, user);

  return {
    id: deviceToken,
    deviceToken,
    name,
    plantel,
    location,
    assignedPlaylistId,
  };
}

export async function expireOldPairingSessions() {
  const snapshot = await getDocs(
    query(
      collection(db, PAIRING_SESSIONS_COLLECTION),
      where("status", "==", "pending"),
      limit(50)
    )
  );
  const now = Date.now();

  await Promise.all(
    snapshot.docs
      .filter((sessionDocument) => getTimestampMillis(sessionDocument.data().expiresAt) <= now)
      .map((sessionDocument) =>
        updateDoc(doc(db, PAIRING_SESSIONS_COLLECTION, sessionDocument.id), {
          status: "expired",
          updatedAt: serverTimestamp(),
        })
      )
  );
}
