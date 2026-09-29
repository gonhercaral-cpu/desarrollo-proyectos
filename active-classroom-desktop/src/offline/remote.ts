import { SyncError, validHash, validId, type Publication, type Manifest, type PublishedResource } from "./manifest.ts";

export const API_BASE = "https://us-central1-sistema-desarrollo-proyectos.cloudfunctions.net";
type TokenProvider = (force: boolean) => Promise<string>;
export class PublicationApi {
  token: TokenProvider;
  fetcher: typeof fetch;
  timeout: number;
  constructor(token: TokenProvider, fetcher: typeof fetch = fetch, timeout = 540000) { this.token = token; this.fetcher = fetcher; this.timeout = timeout; }

  async request<T>(endpoint: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
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
          const token = await this.token(attempt === 1);
          controller.signal.throwIfAborted();
          const response = await this.fetcher(`${API_BASE}/${endpoint}`, { ...init, signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
          if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
          if (!response.ok) {
            await response.body?.cancel();
            throw new SyncError(String(response.status), response.status === 401 ? "Sesión expirada. Vuelve a iniciar sesión." : response.status === 403 ? "Tu cuenta no tiene permiso para este archivo o publicación." : response.status === 404 ? "Publicación o archivo no disponible." : `Error del servidor (${response.status}). Reintenta.`);
          }
          return await consume(response, controller.signal);
        }
        throw new SyncError("401", "Sesión expirada.");
      })()]);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      if (controller.signal.aborted) throw new SyncError(timedOut ? "timeout" : "cancelled", timedOut ? "Tiempo agotado. Reintenta." : "Descarga cancelada.");
      if (error instanceof Error && "code" in error && String(error.code).startsWith("auth/")) throw new SyncError("auth", "No se pudo renovar la sesión. Conecta Internet o vuelve a iniciar sesión.");
      throw new SyncError("network", "Sin conexión o conexión interrumpida. Tu clase local se conserva.");
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", rejectAbort); controller.abort();
    }
  }
  async call<T>(name: string, data: unknown, signal?: AbortSignal): Promise<T> {
    return this.request(name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }, async (response) => {
      const payload = await response.json();
      if (!payload.result) throw new SyncError("server", "Respuesta del servidor inválida.");
      return payload.result as T;
    }, signal);
  }
  async list(signal?: AbortSignal): Promise<Publication[]> {
    const result = new Map<string, Publication>();
    const visited = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { publications: Publication[]; nextCursor: string | null } = await this.call("listActiveClassroomPublications", { limit: 50, cursor }, signal);
      if (!Array.isArray(page.publications)) throw new SyncError("server", "Catálogo inválido.");
      for (const publication of page.publications) {
        if (!validId(publication.unitId) || !validId(publication.levelId) || typeof publication.name !== "string" || !validHash(publication.contentHash) || !Number.isSafeInteger(publication.version) || publication.version < 1) throw new SyncError("server", "Publicación inválida.");
        result.set(publication.unitId, publication);
      }
      cursor = page.nextCursor;
      if (cursor !== null && (!validId(cursor) || visited.has(cursor))) throw new SyncError("server", "Paginación inválida.");
      if (cursor) visited.add(cursor);
    } while (cursor);
    return [...result.values()];
  }
  async manifest(publication: Publication, signal?: AbortSignal): Promise<unknown> {
    return (await this.call<{ manifest: unknown }>("getActiveClassroomPublication", { unitId: publication.unitId, version: publication.version }, signal)).manifest;
  }
  async download(manifest: Manifest, resource: PublishedResource, write: (chunk: Uint8Array) => Promise<void>, signal: AbortSignal): Promise<void> {
    const params = new URLSearchParams({ unitId: manifest.unit.unitId, version: String(manifest.version), resourceId: resource.resourceId });
    await this.request(`activeClassroomPublicationFile?${params}`, {}, async (response, activeSignal) => {
      if (!response.body) throw new SyncError("network", "Respuesta sin archivo.");
      const length = response.headers.get("Content-Length");
      const hash = response.headers.get("X-Content-SHA256");
      if ((length !== null && Number(length) !== resource.download.sizeBytes) || (hash !== null && hash !== resource.download.checksums.sha256)) throw new SyncError("integrity", "El archivo entregado no coincide con el manifest.");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          activeSignal.throwIfAborted();
          for (let offset = 0; offset < value.length; offset += 65536) {
            activeSignal.throwIfAborted();
            await write(value.subarray(offset, offset + 65536));
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }, signal);
  }
}
