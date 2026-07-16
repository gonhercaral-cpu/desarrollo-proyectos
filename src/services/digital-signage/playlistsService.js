import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  db,
  PLAYLISTS_COLLECTION,
  assertAdminUser,
  cleanText,
  getUserName,
  getUserId,
  normalizePlaylistDocument,
  normalizePlaylistItems,
  cleanPublishStatus,
  getOrderedCollection
} from "./shared";
import { logSignageAudit } from "./auditService";

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
    publishStatus: cleanPublishStatus(data?.publishStatus),
    items: normalizePlaylistItems(data?.items),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(playlistRef, payload);
  await logSignageAudit("crear playlist", "playlist", playlistRef.id, name, {
    plantel,
    publishStatus: payload.publishStatus,
    itemsCount: payload.items.length,
  }, user);

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
    publishStatus:
      data?.publishStatus !== undefined ? cleanPublishStatus(data.publishStatus) : data?.publishStatus,
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
