import { invoke } from "@tauri-apps/api/core";
import { assertLocalUrl } from "./local-source.ts";
import { mediaDiagnostic, type MediaInspection } from "./media-diagnostics.ts";
import type { LocalClassroom, RendererSource } from "./types.ts";

export async function prepareNativeMedia(owner: string, classroom: LocalClassroom, resourceId: string): Promise<RendererSource> {
  const resource = classroom.manifest.resources.find((item) => item.resourceId === resourceId);
  if (!resource) throw new Error("El archivo no está disponible localmente");
  const inspection = await invoke<MediaInspection>("classroom_media", { owner, unitId: classroom.manifest.unit.unitId, version: classroom.manifest.version, resourceId });
  mediaDiagnostic({ event: "cache-inspection", localPath: inspection.localPath, exists: inspection.exists, expectedSize: inspection.expectedSize, actualSize: inspection.actualSize, sha256Valid: inspection.sha256Valid, mime: inspection.mime, codecMime: inspection.codecMime, url: inspection.url || "" });
  if (inspection.error || !inspection.url) {
    const message = inspection.error || "No se pudo leer el video local";
    throw new Error(inspection.mime.startsWith("audio/") ? message.replace("video", "audio") : message);
  }
  assertLocalUrl(inspection.url);
  if (inspection.mime !== resource.download.mimeType.split(";")[0].trim().toLowerCase() || inspection.expectedSize !== resource.download.sizeBytes || !inspection.sha256Valid) throw new Error("El archivo descargado está dañado");
  // Probe the actual loopback transport; request at most two bytes, never fetch a file body.
  let response: Response;
  try { response = await fetch(inspection.url, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(5000), cache: "no-store" }); }
  catch { throw new Error(inspection.mime.startsWith("audio/") ? "No se pudo leer el audio local" : "No se pudo leer el video local"); }
  await response.body?.cancel();
  mediaDiagnostic({ event: "range-probe", url: inspection.url, httpStatus: response.status, contentType: response.headers.get("Content-Type"), acceptRanges: response.headers.get("Accept-Ranges"), contentRange: response.headers.get("Content-Range"), contentLength: response.headers.get("Content-Length") });
  if (response.status !== 206 || response.headers.get("Accept-Ranges") !== "bytes" || response.headers.get("Content-Type") !== inspection.mime || response.headers.get("Content-Range") !== `bytes 0-1/${inspection.actualSize}` || response.headers.get("Content-Length") !== "2") throw new Error("No se pudo leer el video local");
  return { url: inspection.url, name: resource.name, mimeType: inspection.mime, sizeBytes: inspection.expectedSize, ...(inspection.codecMime ? { codecMime: inspection.codecMime } : {}) };
}
