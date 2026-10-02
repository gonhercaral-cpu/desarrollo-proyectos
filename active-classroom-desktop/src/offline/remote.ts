import { SyncError, validHash, validId, type Publication, type Manifest, type PublishedResource } from "./manifest.ts";
import type { DeviceLabel } from "./device-label.ts";
import { connectionError, diagnose } from "./connection.ts";
import { syncDiagnostic } from "./sync-diagnostics.ts";
export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export const API_BASE = "https://us-central1-sistema-desarrollo-proyectos.cloudfunctions.net";
type TokenProvider = (force: boolean) => Promise<string>;
export class PublicationApi {
  token: TokenProvider;
  fetcher: typeof fetch;
  timeout: number;
  onDenied?: () => Promise<void>;
  onDevice?: (device: DeviceLabel) => Promise<void>;
  constructor(token: TokenProvider, fetcher: typeof fetch = fetch, timeout = 540000) {
    this.token = token;
    // Window.fetch requires a Window receiver. Calling an unbound native function
    // as this.fetcher throws before networking in WebKit/Chromium (Node masks it).
    this.fetcher = fetcher.bind(globalThis);
    this.timeout = timeout;
  }

  async request<T>(endpoint: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const endpointName = endpoint.split("?")[0];
    let httpStatus: number | undefined;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, this.timeout);
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new SyncError(timedOut ? "timeout" : "cancelled", timedOut ? "La descarga agotó el tiempo. Reintenta." : "Descarga cancelada."));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    try {
      return await Promise.race([aborted, (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          httpStatus = undefined;
          const token = await this.token(attempt === 1);
          controller.signal.throwIfAborted();
          const response = await this.fetcher(`${API_BASE}/${endpoint}`, { ...init, signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
          httpStatus = response.status;
          if (endpointName === "activeClassroomPublicationFile") syncDiagnostic(`DOWNLOAD_HTTP_${response.status}`, { httpStatus: response.status });
          if (endpointName === "getActiveClassroomPublication" && !response.ok) {
            const status = response.status;
            syncDiagnostic(status === 401 ? "MANIFEST_401" : status === 403 ? "MANIFEST_403" : status === 404 ? "MANIFEST_404" : status >= 500 ? "MANIFEST_5XX" : "MANIFEST_ERROR", { httpStatus: status });
          }
          if (response.status === 401 && attempt === 0) { diagnose("publications", "refresh-id-token", "401", { endpoint: endpointName, httpStatus }); await response.body?.cancel(); continue; }
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401 || response.status === 403) await this.onDenied?.();
            throw new SyncError(String(response.status), response.status === 401 ? "No se pudo renovar la conexión del equipo. Reintenta." : response.status === 403 ? "El equipo no tiene autorización para esta publicación." : response.status === 404 ? "Publicación o archivo no disponible." : "El servidor no pudo completar la solicitud. Reintenta.");
          }
          return await consume(response, controller.signal);
        }
        throw new SyncError("401", "Sesión expirada.");
      })()]);
    } catch (error) {
      const failure = error instanceof SyncError ? error : controller.signal.aborted
        ? new SyncError(timedOut ? "timeout" : "cancelled", timedOut ? "Tiempo agotado. Reintenta." : "Descarga cancelada.")
        : connectionError(error, "publications");
      diagnose("publications", "failed", failure.code, { endpoint: endpointName, httpStatus });
      throw failure;
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", rejectAbort); controller.abort();
    }
  }
  async call<T>(name: string, data: unknown, signal?: AbortSignal): Promise<T> {
    return this.request(name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }, async (response) => {
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || !payload.result || typeof payload.result !== "object") throw new SyncError("response", "No se pudo leer la respuesta del servidor.");
      return payload.result as T;
    }, signal);
  }
  async list(signal?: AbortSignal): Promise<Publication[]> {
    const result = new Map<string, Publication>();
    const visited = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { publications: Publication[]; nextCursor: string | null; device?: DeviceLabel } = await this.call("listActiveClassroomPublications", { limit: 50, cursor }, signal);
      if (page.device) await this.onDevice?.(page.device);
      if (!Array.isArray(page.publications)) throw this.invalidCatalog();
      for (const publication of page.publications) {
        if (!publication || !validId(publication.unitId) || !validId(publication.levelId) || typeof publication.name !== "string" || !validHash(publication.contentHash) || !Number.isSafeInteger(publication.version) || publication.version < 1) throw this.invalidCatalog();
        result.set(publication.unitId, publication);
      }
      cursor = page.nextCursor;
      if (cursor !== null && (!validId(cursor) || visited.has(cursor))) throw this.invalidCatalog();
      if (cursor) visited.add(cursor);
    } while (cursor);
    syncDiagnostic("LIST_OK");
    return [...result.values()];
  }
  private invalidCatalog(): SyncError {
    diagnose("publications", "failed", "response", { endpoint: "listActiveClassroomPublications", httpStatus: 200 });
    return new SyncError("response", "No se pudo leer la biblioteca recibida. Solicita asistencia técnica.");
  }
  async manifest(publication: Publication, signal?: AbortSignal): Promise<unknown> {
    const result = await this.call<{ manifest: unknown; device?: DeviceLabel }>("getActiveClassroomPublication", { unitId: publication.unitId, version: publication.version }, signal);
    if (result.device) await this.onDevice?.(result.device);
    if (!result.manifest || typeof result.manifest !== "object" || Array.isArray(result.manifest)) {
      diagnose("publications", "failed", "response", { endpoint: "getActiveClassroomPublication", httpStatus: 200 });
      throw new SyncError("response", "No se pudo leer la publicación recibida. Solicita asistencia técnica.");
    }
    return result.manifest;
  }
  async download(manifest: Manifest, resource: PublishedResource, write: (chunk: Uint8Array) => Promise<void>, signal: AbortSignal): Promise<void> {
    const params = new URLSearchParams({ unitId: manifest.unit.unitId, version: String(manifest.version), resourceId: resource.resourceId });
    const size = resource.download.sizeBytes;
    syncDiagnostic("DOWNLOAD_START", { bytes: size });
    for (let start = 0; start < size || (size === 0 && start === 0); start += DOWNLOAD_CHUNK_BYTES) {
      const ranged = size > DOWNLOAD_CHUNK_BYTES;
      const end = Math.min(start + DOWNLOAD_CHUNK_BYTES, size) - 1;
      const expected = ranged ? end - start + 1 : size;
      await this.request(`activeClassroomPublicationFile?${params}`, ranged ? { headers: { Range: `bytes=${start}-${end}` } } : {}, async (response, activeSignal) => {
        if (!response.body) throw new SyncError("response", "Respuesta sin archivo.");
        if (ranged && (response.status !== 206 || response.headers.get("Content-Range") !== `bytes ${start}-${end}/${size}`)) throw new SyncError("response", "El servidor no permite descargar este archivo por bloques. Solicita actualizar el backend.");
        const length = response.headers.get("Content-Length");
        const hash = response.headers.get("X-Content-SHA256");
        if ((length !== null && Number(length) !== expected) || (hash !== null && hash !== resource.download.checksums.sha256)) throw new SyncError("integrity", "El archivo entregado no coincide con el manifest.");
        const reader = response.body.getReader();
        let received = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            if (received > expected) throw new SyncError("integrity", "Bloque de archivo demasiado grande.");
            activeSignal.throwIfAborted();
            for (let offset = 0; offset < value.length; offset += 65536) {
              activeSignal.throwIfAborted();
              await write(value.subarray(offset, offset + 65536));
            }
          }
          if (received !== expected) throw new SyncError("integrity", "Archivo incompleto. Reintenta la descarga.");
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }, signal);
      if (!ranged) break;
    }
  }
}

