import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

export async function uploadEvidenceFile(projectId, file, firebaseUser, profile = {}) {
  if (!projectId) {
    throw new Error("Falta el ID del proyecto.");
  }

  if (!file) {
    throw new Error("No se seleccionó ningún archivo.");
  }

  const userId = firebaseUser?.uid;

  if (!userId) {
    throw new Error("No se encontró el UID del usuario actual.");
  }

  const userEmail = firebaseUser?.email || profile?.email || "";
  const userName =
    profile?.name ||
    firebaseUser?.displayName ||
    firebaseUser?.email ||
    "Usuario";

  const timestamp = Date.now();

  const safeFileName = file.name
    .replaceAll(" ", "_")
    .replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ]/g, "");

  const filePath = `evidence/${projectId}/${userId}/${timestamp}_${safeFileName}`;

  const fileRef = ref(storage, filePath);

  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      projectId,
      uploadedByUid: userId,
      uploadedByEmail: userEmail,
      uploadedByName: userName,
    },
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);

  return {
    fileName: file.name,
    originalName: file.name,
    filePath,
    fileType: file.type || "application/octet-stream",
    fileSize: file.size,
    downloadUrl,
    uploadedByUid: userId,
    uploadedBy: userId,
    uploadedByEmail: userEmail,
    uploadedByName: userName,
  };
}