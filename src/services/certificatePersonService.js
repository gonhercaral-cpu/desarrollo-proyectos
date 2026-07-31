import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const addPersonCallable = httpsCallable(functions, "addCertificatePerson");
const updateNameCallable = httpsCallable(functions, "updateCertificatePersonName");
const deletePersonCallable = httpsCallable(functions, "deleteCertificatePerson");
const updateQrCallable = httpsCallable(functions, "updateCertificatePersonQr");
const markGenerationFailedCallable = httpsCallable(functions, "markCertificatePersonGenerationFailed");

function operationId(prefix = "certificate-person") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeCallableError(error) {
  const normalized = new Error(error?.message || "No fue posible completar la operación.");
  normalized.code = String(error?.code || "").replace(/^functions\//, "");
  normalized.details = error?.details || {};
  return normalized;
}

export async function addCertificatePerson(input) {
  try {
    const result = await addPersonCallable({ ...input, operationId: input.operationId || operationId("add") });
    return result.data || {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}

export async function updateCertificatePersonName(input) {
  try {
    const result = await updateNameCallable(input);
    return result.data || {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}

export async function deleteCertificatePerson(input) {
  try {
    const result = await deletePersonCallable(input);
    return result.data || {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}

export async function updateCertificatePersonQr(input) {
  try {
    const result = await updateQrCallable(input);
    return result.data || {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}

export async function markCertificatePersonGenerationFailed(input) {
  try {
    const result = await markGenerationFailedCallable(input);
    return result.data || {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}
