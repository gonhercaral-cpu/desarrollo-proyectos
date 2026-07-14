import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const createRequestCallable = httpsCallable(functions, "createPrintRequestWithAssignment");
const repairAssignmentsCallable = httpsCallable(functions, "repairPrintRequestAssignments");

function removeUndefinedValues(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(removeUndefinedValues);
  }
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefinedValues(item)])
  );
}

export function createPrintRequestSubmissionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `submission-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function createPrintRequestWithAssignment(request, options = {}) {
  try {
    const result = await createRequestCallable({
      request: removeUndefinedValues(request),
      submissionId: options.submissionId || createPrintRequestSubmissionId(),
    });
    const data = result.data || {};
    if (!data.requestId || !data.folio || !data.assignedUserId || !data.supportUserId) {
      throw new Error("La solicitud no recibió folio, responsable principal y apoyo.");
    }
    return data;
  } catch (error) {
    const code = String(error?.code || "").replace(/^functions\//, "");
    const messages = {
      "invalid-argument": error?.message || "Revisa los datos enviados.",
      "failed-precondition": error?.message || "No fue posible determinar responsable y apoyo.",
      "resource-exhausted": "Demasiadas solicitudes. Espera un momento e intenta nuevamente.",
      "unavailable": "Servicio temporalmente no disponible. Intenta nuevamente.",
      "internal": "El servidor no pudo registrar la solicitud. Intenta nuevamente.",
    };
    const publicError = new Error(messages[code] || error?.message || "No se pudo registrar la solicitud.");
    publicError.code = code || "unknown";
    throw publicError;
  }
}

export async function repairMissingPrintRequestAssignments() {
  const result = await repairAssignmentsCallable();
  return result.data || { scanned: 0, repaired: 0 };
}
