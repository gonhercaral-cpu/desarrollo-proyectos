import { arrayUnion, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { createDriveFolder, uploadDriveFile } from "../../services/driveService";
import { createPrintRequestWithAssignment } from "../../services/printRequestAssignmentsService";
import { buildDriveDestinationRecord, resolveSaveAction } from "../utils/editorialDriveDestination";
import { buildPrintAutofill, buildPrintRequestPayload, isPrintableExport } from "../utils/editorialPrintPayload";
import { getEditorialDocumentRef } from "./editorialPagesService";

function exportDocRef(projectId, documentId, exportId) {
  return doc(collection(getEditorialDocumentRef(projectId, documentId), "exports"), exportId);
}

async function fetchExportBase64(exportItem) {
  const url = exportItem.downloadUrl || exportItem.downloadURL;
  if (!url) throw new Error("La exportación no tiene archivo descargable.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("No se pudo leer el archivo de la exportación.");
  const buffer = await response.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), contentType: response.headers.get("content-type") || "application/pdf" };
}

// Nube AES: guarda una exportación terminada en Drive mediante las Cloud
// Functions existentes (no se llama a Google Drive desde el navegador). Evita
// duplicaciones; reemplaza sólo con confirmación.
export async function saveEditorialExportToDrive({ projectId, documentId, exportItem, folder, fileName, confirmReplace = false, user }) {
  if (!exportItem || exportItem.status !== "completed") throw new Error("La exportación no está terminada.");
  const destinations = Array.isArray(exportItem.driveDestinations) ? exportItem.driveDestinations : [];
  const decision = resolveSaveAction({ destinations, folderId: folder?.id, confirmReplace });
  if (decision.action === "blocked") {
    const error = new Error("Ya existe un archivo en esa carpeta. Confirma para reemplazar.");
    error.code = "duplicate";
    error.existing = decision.existing;
    throw error;
  }
  const { base64, contentType } = await fetchExportBase64(exportItem);
  const name = String(fileName || `${exportItem.type}-${exportItem.variant}.pdf`);
  const driveFile = await uploadDriveFile({ folderId: folder.id, name, mimeType: contentType, base64 });
  const record = buildDriveDestinationRecord({ driveFile, folder, sourceExportId: exportItem.id, user });
  await updateDoc(exportDocRef(projectId, documentId, exportItem.id), {
    driveDestinations: arrayUnion({ ...record, savedAt: new Date().toISOString(), replaced: decision.action === "replace" }),
    updatedAt: serverTimestamp(),
  });
  return record;
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
