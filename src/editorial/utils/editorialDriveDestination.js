// Fase 7 — Integración con Nube AES (Google Drive vía Cloud Functions).
// No se llama a Google Drive directo desde el navegador: se usan las Cloud
// Functions existentes (driveService). Aquí sólo hay lógica pura: normalizar el
// registro de destino y evitar duplicaciones accidentales.

// Registro que se guarda en el export tras subir a Drive.
export function buildDriveDestinationRecord({ driveFile = {}, folder = {}, sourceExportId = "", user = {} } = {}) {
  const fileId = String(driveFile.id || driveFile.fileId || "");
  if (!fileId) {
    throw new Error("La respuesta de Drive no incluye ID de archivo.");
  }
  return {
    fileId,
    fileName: String(driveFile.name || ""),
    folderId: String(folder.id || folder.folderId || ""),
    folderName: String(folder.name || ""),
    url: String(driveFile.webViewLink || driveFile.url || ""),
    sourceExportId: String(sourceExportId || ""),
    savedByUid: String(user.uid || user.id || ""),
    savedByName: String(user.name || user.email || "Usuario"),
  };
}

// ¿Ya existe un destino en la misma carpeta para este export? (evita duplicar).
export function findExistingDestination(destinations = [], folderId) {
  const id = String(folderId || "");
  return (Array.isArray(destinations) ? destinations : []).find(
    (dest) => dest && dest.folderId === id
  ) || null;
}

// Decide la acción de guardado: "create" si no existe en la carpeta, o
// "replace" si ya hay uno y el usuario confirmó reemplazar. Sin confirmación y
// con duplicado, "blocked".
export function resolveSaveAction({ destinations = [], folderId, confirmReplace = false } = {}) {
  const existing = findExistingDestination(destinations, folderId);
  if (!existing) return { action: "create", existing: null };
  if (confirmReplace) return { action: "replace", existing };
  return { action: "blocked", existing };
}

// Aplica un destino nuevo a la lista, reemplazando el de la misma carpeta.
export function upsertDestination(destinations = [], record) {
  const list = (Array.isArray(destinations) ? destinations : []).filter(
    (dest) => dest && dest.folderId !== record.folderId
  );
  return [...list, record];
}
