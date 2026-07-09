import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";

const ASSETS_COLLECTION = "digitalSignageAssets";
const PLAYLISTS_COLLECTION = "digitalSignagePlaylists";
const DEVICES_COLLECTION = "digitalSignageDevices";
const ASSET_STORAGE_ROOT = "digital-signage/assets";

function assertAdminUser(user) {
  if (user?.role !== "admin") {
    throw new Error("Solo administradores pueden gestionar Digital Signage.");
  }
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function cleanDuration(value) {
  const duration = Number(value);

  if (!Number.isFinite(duration) || duration <= 0) {
    return 10;
  }

  return Math.min(Math.round(duration), 3600);
}

function cleanFileName(fileName = "archivo") {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || "archivo";
}

function getAssetTypeFromFile(file) {
  if (file?.type?.startsWith("video/")) return "video";
  return "image";
}

function getUserName(user) {
  return user?.name || user?.displayName || user?.email || "Administrador";
}

function getUserId(user) {
  return user?.uid || user?.id || "";
}

function normalizeAssetDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function normalizePlaylistDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    items: normalizePlaylistItems(data.items),
  };
}

function normalizeDeviceDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function normalizePlaylistItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      assetId: cleanText(item?.assetId),
      title: cleanText(item?.title) || "Contenido sin titulo",
      type: ["image", "video", "web"].includes(item?.type) ? item.type : "image",
      url: cleanText(item?.url),
      durationSeconds: cleanDuration(item?.durationSeconds),
    }))
    .filter((item) => item.assetId && item.url);
}

async function getOrderedCollection(collectionName) {
  const snapshot = await getDocs(
    query(collection(db, collectionName), orderBy("createdAt", "desc"))
  );

  return snapshot.docs;
}

export async function uploadSignageAsset(file, data, user) {
  assertAdminUser(user);

  if (!file) {
    throw new Error("Selecciona una imagen o video.");
  }

  const title = cleanText(data?.title) || cleanText(file.name);
  const plantel = cleanText(data?.plantel);

  if (!title) {
    throw new Error("El titulo es obligatorio.");
  }

  if (!plantel) {
    throw new Error("El plantel es obligatorio.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const fileName = cleanFileName(file.name);
  const storagePath = `${ASSET_STORAGE_ROOT}/${assetRef.id}/${fileName}`;
  const storageReference = ref(storage, storagePath);

  await uploadBytes(storageReference, file);
  const url = await getDownloadURL(storageReference);

  const payload = {
    title,
    type: getAssetTypeFromFile(file),
    url,
    storagePath,
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    active: data?.active !== false,
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function createWebAsset(data, user) {
  assertAdminUser(user);

  const title = cleanText(data?.title);
  const url = cleanText(data?.url);
  const plantel = cleanText(data?.plantel);

  if (!title || !url || !plantel) {
    throw new Error("Completa titulo, URL y plantel.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const payload = {
    title,
    type: "web",
    url,
    storagePath: "",
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    active: data?.active !== false,
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function getSignageAssets() {
  const docs = await getOrderedCollection(ASSETS_COLLECTION);
  return docs.map(normalizeAssetDocument);
}

export async function updateSignageAsset(id, data) {
  if (!id) throw new Error("Falta el ID del asset.");

  const payload = {
    ...data,
    title: data?.title !== undefined ? cleanText(data.title) : data?.title,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    durationSeconds:
      data?.durationSeconds !== undefined
        ? cleanDuration(data.durationSeconds)
        : data?.durationSeconds,
    updatedAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, ASSETS_COLLECTION, id), payload);
}

export async function deleteSignageAsset(id) {
  if (!id) throw new Error("Falta el ID del asset.");

  const assetRef = doc(db, ASSETS_COLLECTION, id);
  const snapshot = await getDoc(assetRef);

  if (snapshot.exists()) {
    const storagePath = snapshot.data()?.storagePath;

    if (storagePath) {
      await deleteObject(ref(storage, storagePath)).catch(() => {});
    }
  }

  await deleteDoc(assetRef);
}

export async function createSignagePlaylist(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const plantel = cleanText(data?.plantel);

  if (!name || !plantel) {
    throw new Error("Completa nombre y plantel.");
  }

  const playlistRef = doc(collection(db, PLAYLISTS_COLLECTION));
  const payload = {
    name,
    plantel,
    active: data?.active !== false,
    items: normalizePlaylistItems(data?.items),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(playlistRef, payload);

  return {
    id: playlistRef.id,
    ...payload,
  };
}

export async function getSignagePlaylists() {
  const docs = await getOrderedCollection(PLAYLISTS_COLLECTION);
  return docs.map(normalizePlaylistDocument);
}

export async function updateSignagePlaylist(id, data) {
  if (!id) throw new Error("Falta el ID de la playlist.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    items: data?.items !== undefined ? normalizePlaylistItems(data.items) : data?.items,
    updatedAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, PLAYLISTS_COLLECTION, id), payload);
}

export async function deleteSignagePlaylist(id) {
  if (!id) throw new Error("Falta el ID de la playlist.");
  await deleteDoc(doc(db, PLAYLISTS_COLLECTION, id));
}

export async function createSignageDevice(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const plantel = cleanText(data?.plantel);
  const location = cleanText(data?.location);

  if (!name || !plantel) {
    throw new Error("Completa nombre y plantel.");
  }

  const deviceToken = await createUniqueDeviceToken();
  const deviceRef = doc(db, DEVICES_COLLECTION, deviceToken);
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

  await setDoc(deviceRef, payload);

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

  await updateDoc(doc(db, DEVICES_COLLECTION, id), payload);
}

export async function deleteSignageDevice(id) {
  if (!id) throw new Error("Falta el ID del dispositivo.");
  await deleteDoc(doc(db, DEVICES_COLLECTION, id));
}

export async function getDeviceByToken(deviceToken) {
  const cleanToken = cleanText(deviceToken);
  if (!cleanToken) return null;

  const snapshot = await getDoc(doc(db, DEVICES_COLLECTION, cleanToken));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDeviceDocument(snapshot);
}

export function subscribeDeviceByToken(deviceToken, callback, onError) {
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

export function subscribePlaylist(playlistId, callback, onError) {
  const cleanPlaylistId = cleanText(playlistId);
  if (!cleanPlaylistId) return () => {};

  return onSnapshot(
    doc(db, PLAYLISTS_COLLECTION, cleanPlaylistId),
    (snapshot) => {
      callback(snapshot.exists() ? normalizePlaylistDocument(snapshot) : null);
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

async function createUniqueDeviceToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateDeviceToken();
    const snapshot = await getDoc(doc(db, DEVICES_COLLECTION, token));

    if (!snapshot.exists()) {
      return token;
    }
  }

  throw new Error("No se pudo generar un token unico para el dispositivo.");
}

function generateDeviceToken() {
  const bytes = new Uint8Array(32);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
