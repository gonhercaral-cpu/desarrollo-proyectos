import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  db,
  DEVICES_COLLECTION,
  assertAdminUser,
  cleanText,
  getUserName,
  getUserId,
  normalizeDeviceDocument,
  getOrderedCollection,
  createUniqueDeviceToken
} from "./shared";
import { logSignageAudit } from "./auditService";
import { isSecureSignageToken, playerSignageExchange } from "./controlService";
import { deleteRoomDisplayQuietly, saveRoomDevice } from "./roomLayoutsService";

export async function createSignageDevice(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const plantel = cleanText(data?.plantel);
  const location = cleanText(data?.location);

  if (!name || !plantel) {
    throw new Error("Completa nombre y plantel.");
  }

  const deviceToken = await createUniqueDeviceToken();
  const payload = {
    name,
    plantel,
    location,
    deviceToken,
    assignedPlaylistId: cleanText(data?.assignedPlaylistId),
    active: data?.active !== false,
    lastSeenAt: null,
    lastSeenMillis: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  // Pantalla + manifiesto (acomodos ya publicados del plantel) en una sola transacción.
  await saveRoomDevice({ id: deviceToken, ...payload }, { mustBeNew: true });
  await logSignageAudit("crear dispositivo", "device", deviceToken, name, {
    plantel,
    location,
    assignedPlaylistId: payload.assignedPlaylistId,
  }, user);

  return {
    id: deviceToken,
    ...payload,
  };
}

export async function getSignageDevices() {
  const docs = await getOrderedCollection(DEVICES_COLLECTION);
  return docs.map(normalizeDeviceDocument);
}

export async function updateSignageDevice(id, data) {
  if (!id) throw new Error("Falta el ID del dispositivo.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    location: data?.location !== undefined ? cleanText(data.location) : data?.location,
    assignedPlaylistId:
      data?.assignedPlaylistId !== undefined
        ? cleanText(data.assignedPlaylistId)
        : data?.assignedPlaylistId,
    updatedAt: serverTimestamp(),
  };

  delete payload.deviceToken;
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  // Pantalla + manifiesto atómicos; la autorización real la aplican las reglas de Firestore.
  await saveRoomDevice({ id, ...payload });
}

export async function deleteSignageDevice(id) {
  if (!id) throw new Error("Falta el ID del dispositivo.");
  await deleteDoc(doc(db, DEVICES_COLLECTION, id));
  await deleteRoomDisplayQuietly(id);
}

export async function getDeviceByToken(deviceToken) {
  if (isSecureSignageToken(deviceToken)) {
    return (await playerSignageExchange(deviceToken, { readOnly: true })).device;
  }

  const cleanToken = cleanText(deviceToken);
  if (!cleanToken) return null;

  const snapshot = await getDoc(doc(db, DEVICES_COLLECTION, cleanToken));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDeviceDocument(snapshot);
}

export function subscribeDeviceByToken(deviceToken, callback, onError) {
  if (isSecureSignageToken(deviceToken)) {
    let cancelled = false;
    let timer;
    async function poll() {
      try {
        const device = await getDeviceByToken(deviceToken);
        if (!cancelled) callback(device);
      } catch (error) {
        if (!cancelled) {
          if (error.code === "functions/permission-denied") callback(null);
          else onError?.(error);
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 10000);
    }
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }

  const cleanToken = cleanText(deviceToken);
  if (!cleanToken) return () => {};

  return onSnapshot(
    doc(db, DEVICES_COLLECTION, cleanToken),
    (snapshot) => {
      callback(snapshot.exists() ? normalizeDeviceDocument(snapshot) : null);
    },
    onError
  );
}

export async function updateDeviceHeartbeat(deviceId) {
  const cleanDeviceId = cleanText(deviceId);
  if (!cleanDeviceId) return;

  await updateDoc(doc(db, DEVICES_COLLECTION, cleanDeviceId), {
    lastSeenAt: serverTimestamp(),
    lastSeenMillis: Date.now(),
    updatedAt: serverTimestamp(),
  });
}
