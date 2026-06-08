import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, storage } from "./firebase";

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function getAuthenticatedUser() {
  const firebaseUser = auth.currentUser;

  if (!firebaseUser) {
    throw new Error("No hay un usuario autenticado en Firebase Auth.");
  }

  if (!firebaseUser.uid) {
    throw new Error("No se encontró el UID del usuario autenticado.");
  }

  if (!firebaseUser.email) {
    throw new Error("No se encontró el correo del usuario autenticado.");
  }

  return firebaseUser;
}

function cleanFileName(fileName) {
  return fileName
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function validateEvidenceFile(file) {
  if (!file) {
    throw new Error("No se seleccionó ningún archivo.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`El archivo no puede pesar más de ${MAX_FILE_SIZE_MB} MB.`);
  }

  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error(
      "Tipo de archivo no permitido. Solo se permiten imágenes, PDF, Word, PowerPoint o Excel."
    );
  }
}

export async function uploadEvidenceFile(projectId, file, currentUser = {}) {
  if (!projectId) {
    throw new Error("Falta el ID del proyecto.");
  }

  validateEvidenceFile(file);

  const firebaseUser = getAuthenticatedUser();

  const currentUserUid = firebaseUser.uid;
  const currentUserEmail = firebaseUser.email || currentUser.email || "";
  const currentUserName =
    currentUser.name ||
    currentUser.displayName ||
    firebaseUser.displayName ||
    currentUserEmail;

  const timestamp = Date.now();
  const safeFileName = cleanFileName(file.name);

  const filePath = `evidence/${projectId}/${currentUserUid}/${timestamp}_${safeFileName}`;

  const fileRef = ref(storage, filePath);

  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type,
    customMetadata: {
      projectId,
      uploadedByUid: currentUserUid,
      uploadedByEmail: currentUserEmail,
      uploadedByName: currentUserName,
      originalFileName: file.name,
    },
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);

  return {
    fileName: file.name,
    filePath,
    fileType: file.type,
    fileSize: file.size,
    downloadUrl,

    uploadedByUid: currentUserUid,
    uploadedByEmail: currentUserEmail,
    uploadedByName: currentUserName,

    reviewStatus: "pending",
    reviewedAt: null,
    reviewedByUid: "",
    reviewedByName: "",
    reviewedByEmail: "",
    reviewComment: "",
  };
}