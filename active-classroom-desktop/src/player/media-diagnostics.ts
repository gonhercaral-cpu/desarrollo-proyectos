import { invoke, isTauri } from "@tauri-apps/api/core";

export interface MediaInspection {
  url: string | null; localPath: string; exists: boolean; expectedSize: number;
  actualSize: number | null; sha256Valid: boolean | null; mime: string;
  codecMime: string | null;
  errorCode: string | null; error: string | null;
}
export function safeMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" && parsed.pathname.startsWith("/media/")) return `${parsed.origin}/media/[local-grant]`;
    if (parsed.protocol === "asset:" || parsed.hostname === "asset.localhost") return `${parsed.protocol}//${parsed.host}/[cache-file]`;
  } catch { /* Never log arbitrary URLs or path values. */ }
  return "[local media]";
}
export function mediaDiagnostic(data: Record<string, unknown>): void {
  const safe = { ...data };
  if (typeof safe.url === "string") safe.url = safeMediaUrl(safe.url);
  if (typeof safe.mediaErrorMessage === "string") safe.mediaErrorMessage = safe.mediaErrorMessage.replace(/(?:https?|asset):\/\/\S+/gi, "[local URL]").replace(/\b[a-f0-9]{64}\b/gi, "[local-id]").slice(0, 256);
  console.info("[Active Classroom Media]", safe);
  if (isTauri()) void invoke("classroom_media_diagnostic", { data: safe }).catch(() => {});
}
export function mediaErrorMessage(code: number, canPlayMime: string, canPlayCodec: string, mime: string, localError?: string | null, canPlayBaseline = canPlayCodec): string {
  if (localError === "missing") return "El archivo no está disponible localmente";
  if (localError === "damaged") return "El archivo descargado está dañado";
  if (code === 1 || code === 2 || localError === "read") return "No se pudo leer el video local";
  if ((code === 3 || code === 4) && (!canPlayMime || (mime === "video/mp4" && !canPlayCodec && !canPlayBaseline))) return "Falta soporte multimedia en este equipo";
  if (code === 3 || code === 4 || localError === "format") return "El formato de video no es compatible";
  return "No se pudo leer el video local";
}
export async function mediaTransportError(url: string): Promise<string | null> {
  if (!url.startsWith("http://127.0.0.1:")) return null;
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), cache: "no-store" });
    return response.headers.get("X-Active-Media-Error");
  } catch { return "read"; }
}
