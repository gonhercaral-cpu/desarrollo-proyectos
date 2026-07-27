import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { buildActiveMaterialCorrectionLevels } from "../utils/materialCorrectionCatalogs";
import { validateMaterialCorrectionClientUpdate } from "../material-corrections/detailState";

const callable = (name, timeout = 70000) => httpsCallable(functions, name, { timeout });

const createReportCallable = callable("createMaterialCorrectionReport");
const checkDuplicatesCallable = callable("checkMaterialCorrectionDuplicates");
const trackingCallable = callable("getMaterialCorrectionTracking");
const addPublicInformationCallable = callable("addPublicMaterialCorrectionInformation");
const authorizeEvidenceCallable = callable("authorizeMaterialCorrectionEvidenceUpload");
const finalizeEvidenceCallable = callable("finalizeMaterialCorrectionEvidenceUpload", 140000);
const evidenceDownloadCallable = callable("getMaterialCorrectionEvidenceDownloadUrl");
const deleteEvidenceCallable = callable("deleteMaterialCorrectionEvidence");
const updateReportCallable = callable("updateMaterialCorrectionReport");
const addCommentCallable = callable("addMaterialCorrectionComment");
const reorderReportsCallable = callable("reorderMaterialCorrectionReports");
const listAssigneesCallable = callable("listMaterialCorrectionAssignees");

function dataFrom(result) {
  return result?.data || {};
}

function getCallableErrorDetails(error, fallback) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const messages = {
    "invalid-argument": error?.message || "Revisa la información.",
    "permission-denied": "No tienes permiso para esta acción.",
    unauthenticated: "Inicia sesión para continuar.",
    "not-found": "No se encontró el reporte o el enlace no es válido.",
    "failed-precondition": error?.message || "La acción no puede realizarse en el estado actual.",
    "resource-exhausted": "Demasiadas solicitudes. Espera e intenta nuevamente.",
    unavailable: "Servicio temporalmente no disponible.",
    internal: "El servidor no pudo completar la acción.",
  };
  return {
    code: code || "unknown",
    message: messages[code] || error?.message || fallback,
  };
}

async function run(callableFunction, payload, fallback) {
  try {
    return dataFrom(await callableFunction(payload));
  } catch (error) {
    const details = getCallableErrorDetails(error, fallback);
    if (error instanceof Error) {
      error.message = details.message;
      error.code = details.code;
      throw error;
    }
    const normalized = new Error(details.message, { cause: error });
    normalized.code = details.code;
    throw normalized;
  }
}

export function createMaterialCorrectionReport(payload) {
  return run(createReportCallable, payload, "No se pudo registrar el reporte.");
}

export function checkMaterialCorrectionDuplicates(payload) {
  return run(checkDuplicatesCallable, payload, "No se pudo revisar posibles duplicados.");
}

export function getMaterialCorrectionTracking(folio, token) {
  return run(trackingCallable, { folio, token }, "No se pudo consultar el seguimiento.");
}

export function addPublicMaterialCorrectionInformation({ folio, token, message }) {
  return run(
    addPublicInformationCallable,
    { folio, token, message },
    "No se pudo agregar la información."
  );
}

export async function uploadMaterialCorrectionEvidence({
  file,
  folio = "",
  token = "",
  reportId = "",
  additional = false,
  category = "",
  signal,
  onProgress,
  permissionContext,
}) {
  if (reportId && !permissionContext?.canEditOperational) {
    throw new Error("Solo el responsable asignado puede agregar archivos corregidos.");
  }
  const authorization = await run(authorizeEvidenceCallable, {
    folio,
    token,
    reportId,
    additional,
    category,
    file: {
      name: file.name,
      size: file.size,
      contentType: file.type,
    },
  }, "No se pudo autorizar la carga.");
  onProgress?.(20);
  let response;
  try {
    response = await fetch(authorization.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": authorization.contentType },
      body: file,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("La carga falló por conexión. Intenta nuevamente.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`La carga falló (${response.status}).`);
  }
  onProgress?.(80);
  const result = await run(finalizeEvidenceCallable, {
    folio,
    token,
    reportId,
    evidenceId: authorization.evidenceId,
  }, "El servidor no pudo validar la evidencia.");
  onProgress?.(100);
  return result;
}

export function getMaterialCorrectionEvidenceDownloadUrl({
  reportId = "",
  folio = "",
  token = "",
  evidenceId,
}) {
  return run(evidenceDownloadCallable, {
    reportId,
    folio,
    token,
    evidenceId,
  }, "No se pudo abrir la evidencia.");
}

export function deleteMaterialCorrectionEvidence(reportId, evidenceId, permissionContext) {
  if (!permissionContext?.canEditAdministration) {
    throw new Error("Solo administradores pueden eliminar evidencias.");
  }
  return run(
    deleteEvidenceCallable,
    { reportId, evidenceId },
    "No se pudo eliminar la evidencia."
  );
}

export function subscribeToMaterialCorrectionReports(onChange, onError) {
  const reportsQuery = query(
    collection(db, "materialCorrectionReports"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    reportsQuery,
    (snapshot) => onChange(snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }))),
    onError
  );
}

export function subscribeToMaterialCorrectionDetail(reportId, handlers = {}) {
  const reportRef = doc(db, "materialCorrectionReports", reportId);
  const unsubscribers = [
    onSnapshot(reportRef, (snapshot) => {
      handlers.onReport?.(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, handlers.onError),
    onSnapshot(
      query(collection(reportRef, "comments"), orderBy("createdAt", "asc")),
      (snapshot) => handlers.onComments?.(snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))),
      handlers.onError
    ),
    onSnapshot(
      query(collection(reportRef, "history"), orderBy("createdAt", "desc")),
      (snapshot) => handlers.onHistory?.(snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))),
      handlers.onError
    ),
    onSnapshot(
      collection(reportRef, "evidences"),
      (snapshot) => handlers.onEvidences?.(snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))),
      handlers.onError
    ),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function updateMaterialCorrectionReport(
  reportId,
  changes,
  action = "update",
  permissionContext
) {
  validateMaterialCorrectionClientUpdate({
    changes,
    action,
    permissions: permissionContext,
  });
  return run(
    updateReportCallable,
    { reportId, changes, action },
    "No se pudo actualizar el reporte."
  );
}

export function addMaterialCorrectionComment(reportId, comment, permissionContext) {
  if (!permissionContext?.canComment) {
    throw new Error("Solo el responsable asignado puede agregar comentarios.");
  }
  return run(
    addCommentCallable,
    { reportId, ...comment },
    "No se pudo guardar el comentario."
  );
}

export function reorderMaterialCorrectionReports(orderedIds, { isAdmin = false } = {}) {
  if (!isAdmin) {
    throw new Error("Solo administradores pueden cambiar el orden manual.");
  }
  return run(
    reorderReportsCallable,
    { orderedIds },
    "No se pudo guardar el orden manual."
  );
}

export async function listMaterialCorrectionAssignees() {
  const data = await run(
    listAssigneesCallable,
    {},
    "No se pudieron cargar responsables."
  );
  return data.assignees || [];
}

export async function listActiveMaterialCorrectionLevels() {
  const snapshot = await getDocs(query(
    collection(db, "certificateTemplates"),
    where("active", "==", true)
  ));
  return buildActiveMaterialCorrectionLevels(snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })));
}
