import { SyncError } from "./manifest.ts";

export type ConnectionStage = "identity" | "activation" | "sign-in" | "token" | "publications";
export type ConnectionCode = "offline" | "credential" | "not-activated" | "expired" | "auth" | "401" | "403" | "timeout" | "backend" | "server";
const messages: Record<ConnectionCode, string> = {
  offline: "Modo offline. Tus clases descargadas siguen disponibles.",
  credential: "No se pudo leer la credencial segura del equipo. Solicita asistencia técnica.",
  "not-activated": "Este equipo necesita activarse.",
  expired: "La sesión del equipo venció. Reintentando conexión automáticamente.",
  auth: "No se pudo autenticar el equipo. Reintenta; tus clases locales se conservan.",
  "401": "El servidor rechazó la sesión del equipo (401). Reintenta conexión.",
  "403": "El equipo no tiene acceso autorizado (403). Solicita revisión al administrador.",
  timeout: "La conexión agotó el tiempo. Reintenta; tus clases locales se conservan.",
  backend: "No se pudo contactar al servidor. Tus clases locales se conservan.",
  server: "El servidor no pudo completar la conexión. Reintenta.",
};
export function connectionError(error: unknown, stage: ConnectionStage, online = globalThis.navigator?.onLine !== false): SyncError {
  if (error instanceof SyncError && ["cancelled", "integrity", "404"].includes(error.code)) return error;
  const raw = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const code: ConnectionCode = stage === "identity" ? "credential"
    : raw === "401" || raw === "403" ? raw
    : raw === "auth/user-token-expired" || raw === "auth/id-token-expired" ? "expired"
    : raw === "timeout" || (error instanceof Error && error.name === "TimeoutError") ? "timeout"
    : raw === "auth/network-request-failed" || raw === "network" || error instanceof TypeError ? online ? "backend" : "offline"
    : raw.startsWith("auth/") || raw === "auth" ? "auth"
    : ["offline", "credential", "not-activated", "expired", "backend", "server"].includes(raw) ? raw as ConnectionCode
    : /^5\d\d$/.test(raw) ? "server" : online ? "backend" : "offline";
  return new SyncError(code, messages[code]);
}
export function diagnose(stage: ConnectionStage, event: "failed" | "pending" | "revoked" | "authenticated" | "refresh-id-token" | "listed" | "empty", code?: string): void {
  // Fixed event names and classified codes only. Never log SDK errors, URLs, IDs or payloads.
  const safeCode = code && (Object.hasOwn(messages, code) || ["network", "cancelled", "integrity", "404"].includes(code) || /^[45]\d\d$/.test(code)) ? code : code ? "unknown" : undefined;
  console.info("[Active Classroom]", { stage, event, ...(safeCode ? { code: safeCode } : {}) });
}
export function connectionLabel(code?: string): string {
  return code === "401" || code === "auth" || code === "expired" ? "Problema de autenticación"
    : code === "403" ? "Acceso no autorizado"
    : code === "credential" ? "Credencial no disponible"
    : code === "timeout" ? "Tiempo agotado"
    : code === "backend" || code === "server" ? "Servidor no disponible" : "Modo offline";
}
