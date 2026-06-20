import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase";

const TECHNICAL_INSTALLATIONS_COLLECTION = "technicalInstallations";
const MAX_IMAGE_SIZE_MB = 10;
const MAX_VIDEO_SIZE_MB = 100;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

function getAuthenticatedUser() {
  const firebaseUser = auth.currentUser;

  if (!firebaseUser?.uid) {
    throw new Error("No hay un usuario autenticado en Firebase Auth.");
  }

  return firebaseUser;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function cleanFileName(fileName) {
  return normalizeText(fileName)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);
}

function createEvidenceId() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getEvidenceType(file) {
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return "video";
  }

  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "image";
  }

  return "unknown";
}

function validateInstallationEvidenceFile(file) {
  if (!file) {
    throw new Error("No se seleccionó ningún archivo.");
  }

  const evidenceType = getEvidenceType(file);

  if (evidenceType === "image" && file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`La imagen ${file.name} no puede pesar más de ${MAX_IMAGE_SIZE_MB} MB.`);
  }

  if (evidenceType === "video" && file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`El video ${file.name} no puede pesar más de ${MAX_VIDEO_SIZE_MB} MB.`);
  }

  if (evidenceType === "unknown") {
    throw new Error(
      `El archivo ${file.name} no es válido. Solo se permiten JPG, PNG, WEBP, MP4, MOV o WEBM.`
    );
  }

  return evidenceType;
}

function normalizeEvidenceItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenIds = new Set();

  return items
    .map((item) => {
      const id = normalizeText(item?.id) || createEvidenceId();

      if (seenIds.has(id)) {
        return null;
      }

      seenIds.add(id);

      return {
        id,
        type: normalizeText(item?.type) || "image",
        fileName: normalizeText(item?.fileName),
        fileType: normalizeText(item?.fileType || item?.contentType),
        fileSize: Number(item?.fileSize || 0),
        storagePath: normalizeText(item?.storagePath || item?.filePath),
        downloadUrl: normalizeText(item?.downloadUrl || item?.url),
        description: normalizeText(item?.description),
        uploadedByUid: normalizeText(item?.uploadedByUid),
        uploadedByEmail: normalizeText(item?.uploadedByEmail),
        uploadedByName: normalizeText(item?.uploadedByName),
        createdAt: normalizeText(item?.createdAt || item?.uploadedAt),
      };
    })
    .filter(Boolean);
}

function buildEvidenceSummary(evidenceItems) {
  const normalizedItems = normalizeEvidenceItems(evidenceItems);
  const imageEvidenceCount = normalizedItems.filter((item) => item.type === "image").length;
  const videoEvidenceCount = normalizedItems.filter((item) => item.type === "video").length;

  return {
    evidenceItems: normalizedItems,
    evidenceCount: normalizedItems.length,
    imageEvidenceCount,
    videoEvidenceCount,
  };
}

export async function uploadTechnicalInstallationEvidence(
  installation,
  files,
  description = "",
  currentUserProfile = {}
) {
  const installationId = normalizeText(installation?.id);

  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  const filesToUpload = Array.from(files || []);

  if (filesToUpload.length === 0) {
    throw new Error("Selecciona al menos una foto o video para subir.");
  }

  const firebaseUser = getAuthenticatedUser();
  const uploadedByUid = firebaseUser.uid;
  const uploadedByEmail = firebaseUser.email || currentUserProfile?.email || "";
  const uploadedByName =
    currentUserProfile?.name ||
    currentUserProfile?.displayName ||
    firebaseUser.displayName ||
    uploadedByEmail ||
    "Soporte Técnico";
  const cleanDescription = normalizeText(description);

  const uploadedEvidenceItems = [];

  for (const [index, file] of filesToUpload.entries()) {
    const evidenceType = validateInstallationEvidenceFile(file);
    const timestamp = Date.now();
    const safeFileName = cleanFileName(file.name) || `evidencia_${index + 1}`;
    const storagePath = `technical-installations/${installationId}/evidence/${uploadedByUid}/${timestamp}_${index}_${safeFileName}`;
    const fileRef = ref(storage, storagePath);

    const snapshot = await uploadBytes(fileRef, file, {
      contentType: file.type,
      customMetadata: {
        installationId,
        uploadedByUid,
        uploadedByEmail,
        uploadedByName,
        originalFileName: file.name,
        evidenceType,
      },
    });

    const downloadUrl = await getDownloadURL(snapshot.ref);

    uploadedEvidenceItems.push({
      id: createEvidenceId(),
      type: evidenceType,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      storagePath,
      downloadUrl,
      description: cleanDescription,
      uploadedByUid,
      uploadedByEmail,
      uploadedByName,
      createdAt: new Date().toISOString(),
    });
  }

  const existingEvidenceItems = normalizeEvidenceItems(installation?.evidenceItems);
  const summary = buildEvidenceSummary([
    ...existingEvidenceItems,
    ...uploadedEvidenceItems,
  ]);
  const installationRef = doc(db, TECHNICAL_INSTALLATIONS_COLLECTION, installationId);
  const updateData = {
    ...summary,
    updatedAt: serverTimestamp(),
    updatedBy: uploadedByName,
    updatedByEmail: uploadedByEmail,
    updatedById: uploadedByUid,
  };

  await updateDoc(installationRef, updateData);

  return updateData;
}

export async function deleteTechnicalInstallationEvidence(
  installation,
  evidenceItem,
  currentUserProfile = {}
) {
  const installationId = normalizeText(installation?.id);
  const evidenceId = normalizeText(evidenceItem?.id);

  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  if (!evidenceId) {
    throw new Error("Falta el ID de la evidencia.");
  }

  const firebaseUser = getAuthenticatedUser();
  const currentUserName =
    currentUserProfile?.name ||
    currentUserProfile?.displayName ||
    firebaseUser.displayName ||
    firebaseUser.email ||
    "Soporte Técnico";
  const storagePath = normalizeText(evidenceItem?.storagePath || evidenceItem?.filePath);

  if (storagePath) {
    try {
      await deleteObject(ref(storage, storagePath));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") {
        throw error;
      }
    }
  }

  const nextEvidenceItems = normalizeEvidenceItems(installation?.evidenceItems).filter(
    (item) => item.id !== evidenceId
  );
  const summary = buildEvidenceSummary(nextEvidenceItems);
  const installationRef = doc(db, TECHNICAL_INSTALLATIONS_COLLECTION, installationId);
  const updateData = {
    ...summary,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserName,
    updatedByEmail: firebaseUser.email || currentUserProfile?.email || "",
    updatedById: firebaseUser.uid,
  };

  await updateDoc(installationRef, updateData);

  return updateData;
}
