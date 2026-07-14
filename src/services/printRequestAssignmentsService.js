import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

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

export async function createPrintRequestWithAssignment(request) {
  const createRequest = httpsCallable(functions, "createPrintRequestWithAssignment");
  const result = await createRequest({ request: removeUndefinedValues(request) });
  const data = result.data || {};
  if (!data.requestId || !data.assignedUserId || !data.supportUserId) {
    throw new Error("La solicitud no recibió responsable principal y apoyo.");
  }
  return data;
}

export async function repairMissingPrintRequestAssignments() {
  const repairAssignments = httpsCallable(functions, "repairPrintRequestAssignments");
  const result = await repairAssignments();
  return result.data || { scanned: 0, repaired: 0 };
}
