import { SyncError } from "./manifest.ts";

export type ConnectionStage = "identity" | "activation" | "sign-in" | "token" | "publications";
export type ConnectionCode = "offline" | "credential" | "not-activated" | "expired" | "auth" | "401" | "403" | "404" | "timeout" | "backend" | "server" | "response" | "client";
const messages: Record<ConnectionCode, string> = {
  offline: "Modo offline. Tus clases descargadas siguen disponibles.",
  credential: "No se pudo leer la credencial segura del equipo. Solicita asistencia técnica.",
  "not-activated": "Este equipo necesita activarse.",
  expired: "La sesión del equipo venció. Reintentando conexión automáticamente.",
  auth: "No se pudo autenticar el equipo. Reintenta; tus clases locales se conservan.",
  "401": "No se pudo verificar la sesión del equipo. Reintenta conexión.",
  "403": "El equipo no tiene acceso autorizado. Solicita revisión al administrador.",
  "404": "La publicación o el archivo ya no están disponibles. Actualiza la biblioteca.",
  timeout: "La conexión agotó el tiempo. Reintenta; tus clases locales se conservan.",
  backend: "No se pudo contactar al servidor. Tus clases locales se conservan.",
  server: "El servidor no pudo completar la conexión. Reintenta.",
  response: "No se pudo leer la biblioteca recibida. Solicita asistencia técnica.",
  client: "La aplicación no pudo consultar la biblioteca. Actualiza Active Classroom o solicita asistencia.",
};
export function connectionError(error: unknown, stage: ConnectionStage, online = globalThis.navigator?.onLine !== false): SyncError {
  if (error instanceof SyncError && ["cancelled", "integrity"].includes(error.code)) return error;
  const raw = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const code: ConnectionCode = stage === "identity" ? "credential"
    : raw === "401" || raw === "403" || raw === "404" ? raw
    : raw === "auth/user-token-expired" || raw === "auth/id-token-expired" ? "expired"
    : raw === "timeout" || (error instanceof Error && error.name === "TimeoutError") ? "timeout"
    : error instanceof TypeError && /illegal invocation|Can only call.*fetch|does not implement interface Window/i.test(error.message) ? "client"
    : error instanceof SyntaxError ? "response"
    : raw === "auth/network-request-failed" || raw === "network" || error instanceof TypeError ? online ? "backend" : "offline"
    : raw.startsWith("auth/") || raw === "auth" ? "auth"
    : ["offline", "credential", "not-activated", "expired", "backend", "server", "response", "client"].includes(raw) ? raw as ConnectionCode
    : /^5\d\d$/.test(raw) ? "server" : online ? "backend" : "offline";
  return new SyncError(code, messages[code]);
}
export function diagnose(stage: ConnectionStage, event: "failed" | "pending" | "revoked" | "authenticated" | "refresh-id-token" | "listed" | "empty", code?: string, context?: { endpoint?: string; httpStatus?: number }): void {
  // Fixed event names and classified codes only. Never log SDK errors, URLs, IDs or payloads.
  const safeCode = code && (Object.hasOwn(messages, code) || ["network", "cancelled", "integrity", "404"].includes(code) || /^[45]\d\d$/.test(code)) ? code : code ? "unknown" : undefined;
  const endpoint = ["listActiveClassroomPublications", "getActiveClassroomPublication", "activeClassroomPublicationFile", "reportActiveClassroomDeviceSync"].includes(context?.endpoint || "") ? context!.endpoint : undefined;
  const httpStatus = context?.httpStatus;
  console.info("[Active Classroom]", { stage, event, ...(safeCode ? { code: safeCode } : {}), ...(endpoint ? { endpoint } : {}), ...(Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? { httpStatus } : {}) });
}
export function connectionLabel(code?: string): string {
  return code === "401" || code === "auth" || code === "expired" ? "Problema de autenticación"
    : code === "403" ? "Acceso no autorizado"
    : code === "404" ? "Contenido no disponible"
    : code === "server" || /^5\d\d$/.test(code || "") ? "Error del servidor"
    : code === "response" || code === "client" ? "Error de sincronización"
    : code === "credential" ? "Credencial no disponible"
    : code === "timeout" ? "Tiempo agotado"
    : code === "backend" ? "Servidor inaccesible" : "Modo offline";
}
