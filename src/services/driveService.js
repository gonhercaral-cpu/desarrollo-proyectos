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
import app, { auth, db, functions } from "./firebase";
import { detectFileKind, resolveFileMimeType } from "../utils/fileTypes";

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

export class CloudFileError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CloudFileError";
    this.code = code;
    this.status = Number(options.status || 0);
  }
}

function decodeHeader(value, fallback = "") {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseContentDispositionName(value = "") {
  const encoded = String(value).match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeHeader(encoded);
  return String(value).match(/filename="([^"]+)"/i)?.[1] || "";
}

function booleanHeader(headers, name, fallback) {
  const value = headers.get(name);
  if (value === null) return fallback;
  return value === "true";
}

async function readCloudFileError(response) {
  let code = response.status === 401
    ? "unauthenticated"
    : response.status === 403
      ? "permission-denied"
      : response.status === 404
        ? "not-found"
        : response.status === 415
          ? "unsupported-format"
          : "drive-error";
  let message = "No se pudo obtener el archivo.";
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") message = payload.error;
    if (payload?.error && typeof payload.error === "object") {
      code = payload.error.code || code;
      message = payload.error.message || message;
    }
  } catch {
    // Respuesta no JSON: conserva clasificación HTTP.
  }
  return new CloudFileError(code, message, { status: response.status });
}

export function getCloudFileErrorMessage(error, action = "abrir") {
  const messages = {
    unauthenticated: "Tu sesión caducó. Inicia sesión nuevamente.",
    "permission-denied": "No tienes permiso para acceder a este archivo.",
    "not-found": "El archivo no existe o ya no está disponible.",
    "unsupported-format": "Este formato no es compatible con la acción solicitada.",
    "unsupported-export": "Este archivo nativo de Google no admite una exportación compatible.",
    "export-failed": "No se pudo exportar el documento nativo de Google.",
    "import-failed": "No se pudo importar el documento al Editor Editorial.",
    connection: "No se pudo conectar con Nube AES. Revisa tu conexión e intenta nuevamente.",
    "invalid-response": "Nube AES devolvió contenido inválido.",
    "invalid-request": "La solicitud del archivo no es válida.",
    "drive-error": "No se pudo obtener el archivo desde Drive.",
  };
  return messages[error?.code]
    || error?.message
    || `No se pudo ${action} el archivo.`;
}

export async function getCloudFileContent(file) {
  const fileId = String(file?.id || file || "").trim();
  if (!fileId) throw new CloudFileError("not-found", "No se encontró el archivo de Nube AES.");
  const currentUser = auth.currentUser;
  if (!currentUser) throw new CloudFileError("unauthenticated", "Debes iniciar sesión para abrir el archivo.");
  let token;
  try {
    token = await currentUser.getIdToken();
  } catch (error) {
    const code = String(error?.code || "").startsWith("auth/") ? "unauthenticated" : "connection";
    throw new CloudFileError(code, "No se pudo validar tu sesión.", { cause: error });
  }
  const projectId = app.options.projectId;
  let response;
  try {
    response = await fetch(
      `https://us-central1-${projectId}.cloudfunctions.net/driveFileContent?fileId=${encodeURIComponent(fileId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/octet-stream",
        },
      }
    );
  } catch (error) {
    throw new CloudFileError("connection", "No se pudo conectar con Nube AES.", { cause: error });
  }
  if (!response.ok) {
    throw await readCloudFileError(response);
  }

  const responseMimeType = String(response.headers.get("Content-Type") || "").split(";")[0].trim();
  const originalName = decodeHeader(response.headers.get("X-Nube-Original-Name"), file?.name || "archivo");
  const deliveredName = decodeHeader(
    response.headers.get("X-Nube-File-Name"),
    parseContentDispositionName(response.headers.get("Content-Disposition")) || originalName
  );
  const originalMimeType = decodeHeader(
    response.headers.get("X-Nube-Original-Mime-Type"),
    resolveFileMimeType(file?.mimeType, originalName)
  );
  const deliveredMimeType = decodeHeader(
    response.headers.get("X-Nube-Delivered-Mime-Type"),
    responseMimeType || originalMimeType
  );
  const responseBlob = await response.blob();
  const blob = responseBlob.type === deliveredMimeType
    ? responseBlob
    : responseBlob.slice(0, responseBlob.size, deliveredMimeType);
  if (!blob.size && Number(file?.size || 0) > 0) {
    throw new CloudFileError("invalid-response", "Nube AES devolvió un archivo vacío.");
  }
  const detectedKind = detectFileKind({ name: deliveredName, mimeType: deliveredMimeType });

  return {
    fileId,
    originalName,
    deliveredName,
    originalMimeType,
    deliveredMimeType,
    kind: response.headers.get("X-Nube-File-Type") || detectedKind,
    size: blob.size,
    exported: booleanHeader(response.headers, "X-Nube-Exported", originalMimeType.startsWith("application/vnd.google-apps.")),
    previewable: booleanHeader(response.headers, "X-Nube-Previewable", detectedKind !== "unsupported"),
    editable: booleanHeader(response.headers, "X-Nube-Editable", detectedKind === "docx"),
    blob,
  };
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
