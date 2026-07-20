import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../services/firebase";
import { buildCustomFontRecord, isEmbeddableFontFile } from "../models/editorialFonts";
import { sanitizeFirestoreData } from "../utils/editorialFirestore";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

function safeFileName(fileName) {
  return String(fileName || "fuente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fuente";
}

export function subscribeEditorialFonts({ projectId, onChange, onError }) {
  const fontsQuery = query(
    collection(db, EDITORIAL_COLLECTIONS.assets),
    where("projectId", "==", projectId),
    where("type", "==", "font")
  );
  return onSnapshot(fontsQuery, (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, onError);
}

export async function uploadEditorialFont({ projectId, file, family, weight, style, license, user }) {
  const uid = user?.uid || user?.id;
  if (!projectId || !uid || !file) throw new Error("No se pudo preparar la fuente.");
  if (!isEmbeddableFontFile(file.name)) throw new Error("Usa una fuente TTF, OTF, WOFF o WOFF2.");
  if (!String(license || "").trim()) throw new Error("Registra licencia o autorización de uso.");
  const assetRef = doc(collection(db, EDITORIAL_COLLECTIONS.assets));
  const storagePath = `editorial/${projectId}/fonts/${uid}/${assetRef.id}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || "application/octet-stream" });
  try {
    const url = await getDownloadURL(storageRef);
    const record = buildCustomFontRecord({ file, family, weight, style, license, storagePath, url, user });
    await setDoc(assetRef, sanitizeFirestoreData({
      ...record,
      projectId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    return { id: assetRef.id, projectId, ...record };
  } catch (error) {
    await deleteObject(storageRef).catch(() => {});
    throw error;
  }
}
