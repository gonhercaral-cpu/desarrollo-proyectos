import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

export async function uploadEvidenceFile(projectId, file, currentUser) {
  if (!projectId) {
    throw new Error("Falta el ID del proyecto.");
  }

  if (!file) {
    throw new Error("No se seleccionó ningún archivo.");
  }

  const timestamp = Date.now();
  const safeFileName = file.name.replaceAll(" ", "_");
  const filePath = `evidence/${projectId}/${timestamp}_${safeFileName}`;

  const fileRef = ref(storage, filePath);

  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type,
    customMetadata: {
      projectId,
      uploadedByEmail: currentUser.email,
      uploadedByName: currentUser.name,
    },
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);

  return {
    fileName: file.name,
    filePath,
    fileType: file.type,
    fileSize: file.size,
    downloadUrl,
  };
}