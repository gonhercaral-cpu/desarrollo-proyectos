import { arrayUnion, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { createDriveFolder, resolveNubeAesFolderId, uploadFileToNubeAES } from "../../services/driveService";
import { createPrintRequestWithAssignment } from "../../services/printRequestAssignmentsService";
import { buildDriveDestinationRecord, resolveSaveAction } from "../utils/editorialDriveDestination";
import { buildPrintAutofill, buildPrintRequestPayload, isPrintableExport } from "../utils/editorialPrintPayload";
import { resolveEditorialDownloadUrl } from "./editorialExportsService";
import { getEditorialDocumentRef } from "./editorialPagesService";

function exportDocRef(projectId, documentId, exportId) {
  return doc(collection(getEditorialDocumentRef(projectId, documentId), "exports"), exportId);
}

// Obtiene la exportación de Storage como un File real (mismo tipo de objeto que
// sube DriveManager). Resuelve la URL desde downloadUrl o storagePath.
async function fetchExportAsFile(exportItem, fileName) {
  const url = await resolveEditorialDownloadUrl(exportItem);
  const response = await fetch(url);
  if (!response.ok) throw new Error("No se pudo leer el archivo de la exportación.");
  const blob = await response.blob();
  const type = blob.type || "application/pdf";
  const name = String(fileName || `${exportItem.type}-${exportItem.variant}.pdf`);
  return new File([blob], name, { type });
}

// Nube AES: guarda una exportación terminada en Drive reutilizando EXACTAMENTE
// el adaptador funcional (uploadFileToNubeAES): folderId canónico + subida
// resumable + registro. Evita duplicaciones; reemplaza sólo con confirmación.
// El registro del destino se escribe SÓLO tras una subida exitosa.
export async function saveEditorialExportToDrive({ projectId, documentId, exportItem, folder, fileName, confirmReplace = false, user }) {
  if (!exportItem || exportItem.status !== "completed") throw new Error("La exportación no está terminada.");
  const folderId = resolveNubeAesFolderId(folder);
  if (!folderId) throw new Error("La carpeta seleccionada no tiene carpeta de Drive sincronizada.");

  const destinations = Array.isArray(exportItem.driveDestinations) ? exportItem.driveDestinations : [];
  const decision = resolveSaveAction({ destinations, folderId, confirmReplace });
  if (decision.action === "blocked") {
    const error = new Error("Ya existe un archivo en esa carpeta. Confirma para reemplazar.");
    error.code = "duplicate";
    error.existing = decision.existing;
    throw error;
  }

  try {
    const file = await fetchExportAsFile(exportItem, fileName);
    const uploaded = await uploadFileToNubeAES({
      folder,
      file,
      replaceFileId: decision.action === "replace" ? decision.existing?.fileId || "" : "",
    });
    const record = buildDriveDestinationRecord({
      driveFile: { id: uploaded.id, name: uploaded.name, webViewLink: uploaded.id ? `https://drive.google.com/file/d/${uploaded.id}/view` : "" },
      folder,
      sourceExportId: exportItem.id,
      user,
    });
    // Registro sólo tras confirmar la subida.
    await updateDoc(exportDocRef(projectId, documentId, exportItem.id), {
      driveDestinations: arrayUnion({ ...record, savedAt: new Date().toISOString(), replaced: decision.action === "replace" }),
      updatedAt: serverTimestamp(),
    });
    return record;
  } catch (error) {
    console.error("Editorial: fallo al guardar en Nube AES", error);
    throw error;
  }
}

export async function createEditorialDriveFolder({ parentId, name }) {
  return createDriveFolder(parentId, name);
}

// Imprenta: crea una solicitud de impresión desde un PDF de imprenta editorial,
// reutilizando la Cloud Function existente. Guarda relación bidireccional. El
// flujo de certificados queda intacto (requestType genérico, sin plantillas).
export async function createEditorialPrintRequest({ project, document, exportItem, form, user }) {
  if (!isPrintableExport(exportItem)) throw new Error("Selecciona una exportación de imprenta terminada.");
  const autofill = buildPrintAutofill({ project, document, exportItem, user });
  const payload = buildPrintRequestPayload({ project, document, exportItem, autofill, form });
  const result = await createPrintRequestWithAssignment(payload);
  // Relación bidireccional: guarda la solicitud en el export editorial.
  await updateDoc(exportDocRef(project.id, document.id, exportItem.id), {
    printRequests: arrayUnion({
      requestId: result.requestId,
      folio: result.folio,
      requestType: payload.requestType,
      campus: payload.campus,
      requestedQuantity: payload.requestedQuantity,
      createdByUid: String(user?.uid || user?.id || ""),
      createdAt: new Date().toISOString(),
    }),
    updatedAt: serverTimestamp(),
  });
  return result;
}
