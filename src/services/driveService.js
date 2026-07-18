import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

const DRIVE_SETTINGS_REF = doc(db, "systemSettings", "drive");
const DRIVE_DEPARTMENT_FOLDERS_COLLECTION = "driveDepartmentFolders";

const driveListFolderCallable = httpsCallable(functions, "driveListFolder");
const driveCreateFolderCallable = httpsCallable(functions, "driveCreateFolder");
const driveUploadFileCallable = httpsCallable(functions, "driveUploadFile");
const driveCreateResumableUploadCallable = httpsCallable(functions, "driveCreateResumableUpload");
const driveRenameItemCallable = httpsCallable(functions, "driveRenameItem");
const driveMoveItemCallable = httpsCallable(functions, "driveMoveItem");
const driveDeleteItemCallable = httpsCallable(functions, "driveDeleteItem");
const driveListTrashCallable = httpsCallable(functions, "driveListTrash");
const driveRestoreItemCallable = httpsCallable(functions, "driveRestoreItem");
const driveLogResumableUploadCompletedCallable = httpsCallable(
  functions,
  "driveLogResumableUploadCompleted"
);
const driveListActivityLogsCallable = httpsCallable(functions, "driveListActivityLogs");
const driveSearchFilesCallable = httpsCallable(functions, "driveSearchFiles");
const driveGetStorageQuotaCallable = httpsCallable(functions, "driveGetStorageQuota");
const driveEnsureDepartmentFoldersCallable = httpsCallable(
  functions,
  "driveEnsureDepartmentFolders"
);
const driveListAllowedDepartmentFoldersCallable = httpsCallable(
  functions,
  "driveListAllowedDepartmentFolders"
);
const driveListMyDriveCallable = httpsCallable(functions, "driveListMyDrive");
const driveCreatePrivateFolderCallable = httpsCallable(functions, "driveCreatePrivateFolder");
const driveShareItemCallable = httpsCallable(functions, "driveShareItem");
const driveUnshareItemCallable = httpsCallable(functions, "driveUnshareItem");
const driveListSharedWithMeCallable = httpsCallable(functions, "driveListSharedWithMe");
const driveListItemSharesCallable = httpsCallable(functions, "driveListItemShares");
const driveListShareableUsersCallable = httpsCallable(functions, "driveListShareableUsers");
const importDriveFileToSignageStorageCallable = httpsCallable(
  functions,
  "importDriveFileToSignageStorage"
);

export async function listDriveFolder(folderId) {
  const response = await driveListFolderCallable({ folderId });
  return response.data;
}

export async function createDriveFolder(parentId, name) {
  const response = await driveCreateFolderCallable({ parentId, name });
  return response.data;
}

export async function uploadDriveFile({ folderId, name, mimeType, base64 }) {
  const response = await driveUploadFileCallable({
    folderId,
    name,
    mimeType,
    base64,
  });
  return response.data;
}

export async function createDriveResumableUpload({ folderId, name, mimeType, size }) {
  const response = await driveCreateResumableUploadCallable({
    folderId,
    name,
    mimeType,
    size,
  });
  return response.data;
}

export async function importDriveFileToSignageStorage({ driveFileId, assetId, filename = "" }) {
  const response = await importDriveFileToSignageStorageCallable({
    driveFileId,
    assetId,
    filename,
  });
  return response.data;
}

export async function renameDriveItem(fileId, name) {
  const response = await driveRenameItemCallable({ fileId, name });
  return response.data;
}

export async function moveDriveItem(fileId, targetFolderId) {
  const response = await driveMoveItemCallable({ fileId, targetFolderId });
  return response.data;
}

export async function deleteDriveItem(fileId) {
  const response = await driveDeleteItemCallable({ fileId });
  return response.data;
}

export async function listDriveTrash(folderId) {
  const response = await driveListTrashCallable({ folderId });
  return response.data;
}

export async function restoreDriveItem(fileId) {
  const response = await driveRestoreItemCallable({ fileId });
  return response.data;
}

export async function listDriveActivityLogs({ limitCount = 50, folderId = "", fileId = "" } = {}) {
  const response = await driveListActivityLogsCallable({ limitCount, folderId, fileId });
  return response.data;
}

export async function logDriveResumableUploadCompleted({
  folderId,
  fileId = "",
  name,
  mimeType,
  size,
}) {
  const response = await driveLogResumableUploadCompletedCallable({
    folderId,
    fileId,
    name,
    mimeType,
    size,
  });
  return response.data;
}

// Fase 7 fix — ID canónico de carpeta de Nube AES. Las carpetas permitidas
// traen `folderId` (id real de Google Drive) además de `id` (id de documento
// visual). La subida DEBE usar `folderId`. Mismo criterio que DriveManager.
export function resolveNubeAesFolderId(folder) {
  if (!folder || typeof folder !== "object") return "";
  return String(folder.folderId || folder.id || "").trim();
}

// Sube el archivo a la sesión resumable de Drive (PUT directo a la URL de
// sesión que devuelve la Cloud Function). Genérico, sin dependencias de UI.
function putFileToDriveSession({ file, uploadUrl, mimeType, onProgress }) {
  return new Promise((resolve, reject) => {
    const cleanUploadUrl = String(uploadUrl || "").trim();
    if (!cleanUploadUrl) {
      reject(new Error("No se pudo preparar la sesión de subida."));
      return;
    }
    const request = new XMLHttpRequest();
    let lastProgress = 0;
    const uploadError = (message) => {
      const error = new Error(message);
      error.uploadProgress = lastProgress;
      error.maybeCompleted = lastProgress >= 98;
      error.status = request.status || 0;
      return error;
    };
    request.open("PUT", cleanUploadUrl);
    request.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      lastProgress = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(lastProgress);
    };
    request.onload = () => {
      let data = null;
      try {
        if (request.responseText) data = JSON.parse(request.responseText);
      } catch {
        // Respuesta no-JSON de Drive; se ignora, el archivo puede haberse creado.
      }
      if ([200, 201, 204].includes(request.status)) { onProgress?.(100); resolve(data); return; }
      if (request.status === 308) { resolve({ incomplete: true, status: 308, uploadProgress: lastProgress }); return; }
      reject(uploadError(`Google Drive rechazó la subida (${request.status}).`));
    };
    request.onerror = () => reject(uploadError("No se pudo confirmar la subida por CORS o red."));
    request.onabort = () => reject(uploadError("La subida fue cancelada."));
    request.send(file);
  });
}

// Adaptador compartido de subida a Nube AES. Mismo contrato que el módulo
// funcional DriveManager: folderId canónico + subida resumable + registro de
// actividad. `file` es un File/Blob real. Devuelve { id, name, folderId }.
export async function uploadFileToNubeAES({ folder, file, replaceFileId = "", onProgress } = {}) {
  const folderId = resolveNubeAesFolderId(folder);
  if (!folderId) throw new Error("La carpeta seleccionada no tiene carpeta de Drive sincronizada.");
  if (!file) throw new Error("No hay archivo para subir.");
  const mimeType = file.type || "application/octet-stream";
  const name = file.name || "archivo";
  const session = await createDriveResumableUpload({ folderId, name, mimeType, size: file.size });
  const result = await putFileToDriveSession({ file, uploadUrl: session?.uploadUrl, mimeType, onProgress });
  const fileId = result?.id || "";
  // El registro de actividad no debe bloquear una subida ya completada.
  await logDriveResumableUploadCompleted({ folderId, fileId, name, mimeType, size: file.size }).catch(() => {});
  // Reemplazo: sólo tras subir el nuevo archivo con éxito, borra el anterior.
  if (replaceFileId && fileId && replaceFileId !== fileId) {
    await deleteDriveItem(replaceFileId).catch(() => {});
  }
  return { id: fileId, name, folderId, mimeType, size: file.size, incomplete: Boolean(result?.incomplete) };
}

export async function searchDriveFiles({ query, type, folderId }) {
  const response = await driveSearchFilesCallable({ query, type, folderId });
  return response.data;
}

export async function getDriveStorageQuota() {
  const response = await driveGetStorageQuotaCallable();
  return response.data;
}

export async function ensureDriveDepartmentFolders() {
  const response = await driveEnsureDepartmentFoldersCallable();
  return response.data;
}

export async function listAllowedDriveDepartmentFolders() {
  const response = await driveListAllowedDepartmentFoldersCallable();
  return response.data;
}

export async function getDriveRootSettings() {
  const snapshot = await getDoc(DRIVE_SETTINGS_REF);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function saveDriveRootFolderId(rootFolderId) {
  const cleanRootFolderId = String(rootFolderId || "").trim();

  await setDoc(
    DRIVE_SETTINGS_REF,
    {
      rootFolderId: cleanRootFolderId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return cleanRootFolderId;
}

export async function getDriveDepartmentFolders() {
  const foldersQuery = query(
    collection(db, DRIVE_DEPARTMENT_FOLDERS_COLLECTION),
    orderBy("departmentName", "asc")
  );
  const snapshot = await getDocs(foldersQuery);

  return snapshot.docs.map((folderDoc) => ({
    id: folderDoc.id,
    ...folderDoc.data(),
  }));
}

export async function listMyDrive() {
  const response = await driveListMyDriveCallable();
  return response.data;
}

export async function createPrivateFolder({ name, parentId = "" }) {
  const response = await driveCreatePrivateFolderCallable({ name, parentId });
  return response.data;
}

export async function shareDriveItem({ fileId, sharedWithUid, role }) {
  const response = await driveShareItemCallable({ fileId, sharedWithUid, role });
  return response.data;
}

export async function unshareDriveItem({ fileId, sharedWithUid }) {
  const response = await driveUnshareItemCallable({ fileId, sharedWithUid });
  return response.data;
}

export async function listSharedWithMe() {
  const response = await driveListSharedWithMeCallable();
  return response.data;
}

export async function listDriveItemShares(fileId) {
  const response = await driveListItemSharesCallable({ fileId });
  return response.data;
}

export async function listDriveShareableUsers() {
  const response = await driveListShareableUsersCallable();
  return response.data;
}

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
