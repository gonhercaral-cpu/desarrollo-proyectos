import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, storage } from "./firebase";

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const GENERIC_FILE_TYPES = new Set(["", "application/octet-stream"]);

const ALLOWED_FILE_TYPES_BY_EXTENSION = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt: ["text/plain"],
};

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
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

function getFileExtension(fileName = "") {
  const parts = String(fileName || "").trim().split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function isGenericFileType(type = "") {
  return GENERIC_FILE_TYPES.has(String(type || "").toLowerCase());
}

function hasAllowedFileType(file) {
  const extension = getFileExtension(file?.name);
  const allowedTypes = ALLOWED_FILE_TYPES_BY_EXTENSION[extension];
  const type = String(file?.type || "").toLowerCase();

  if (!allowedTypes) return false;
  if (isGenericFileType(type)) return true;

  return allowedTypes.includes(type);
}

function validateEvidenceFile(file) {
  if (!file) {
    throw new Error("No se seleccionó ningún archivo.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`El archivo no puede pesar más de ${MAX_FILE_SIZE_MB} MB.`);
  }

  if (!hasAllowedFileType(file)) {
    throw new Error("Tipo de archivo no permitido. Solo se permiten imagenes, PDF, Word, PowerPoint, Excel o TXT.");
    /*
      "Tipo de archivo no permitido. Solo se permiten imágenes, PDF, Word, PowerPoint o Excel."
    */
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
    contentType: file.type || "application/octet-stream",
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
