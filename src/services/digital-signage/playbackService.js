import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  limit,
  db,
  PLAYBACK_LOGS_COLLECTION,
  normalizePlaybackLogDocument,
  cleanPlaybackEvent
} from "./shared";

export async function logPlaybackEvent(event = {}) {
  try {
    const payload = cleanPlaybackEvent(event);

    if (!payload.deviceId || !payload.eventType) return;

    await addDoc(collection(db, PLAYBACK_LOGS_COLLECTION), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("No se pudo registrar reproduccion de Digital Signage.", error);
  }
}

export async function getPlaybackLogs({ limitCount = 500 } = {}) {
  const snapshot = await getDocs(
    query(
      collection(db, PLAYBACK_LOGS_COLLECTION),
      orderBy("createdAt", "desc"),
      limit(Math.min(Math.max(Number(limitCount) || 500, 1), 1000))
    )
  );

  return snapshot.docs.map(normalizePlaybackLogDocument);
}
