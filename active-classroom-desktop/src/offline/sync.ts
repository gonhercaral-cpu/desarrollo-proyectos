import { SyncError, validateManifest, type Manifest, type Publication, type PublishedResource } from "./manifest.ts";
import { syncDiagnostic } from "./sync-diagnostics.ts";

export function unitSyncMessage(error: unknown): string {
  const failure = error instanceof SyncError ? error : undefined;
  if (failure?.code === "cancelled") return "Descarga cancelada. La versión local anterior se conserva.";
  if (failure?.code === "disk-full") return "Sin espacio disponible. Libera espacio y reintenta.";
  if (failure?.code === "integrity") return "Archivo corrupto o incompleto. Reintenta la descarga.";
  if (failure?.stage === "cache" || failure?.stage === "activate") return "No se pudo guardar la clase local. Revisa espacio y permisos.";
  if (failure?.stage === "manifest" || failure?.code === "manifest") return "No se pudo obtener el manifest. Reintenta o solicita revisión de la publicación.";
  if (failure?.stage === "download") return "No se pudo descargar un archivo. Reintenta o solicita asistencia.";
  return failure?.message || "No se pudo sincronizar esta clase. Reintenta.";
}

export interface CacheStore {
  list(): Promise<Manifest[]>;
  has(hash: string, size: number): Promise<boolean>;
  begin(hash: string): Promise<void>;
  append(hash: string, offset: number, chunk: Uint8Array): Promise<void>;
  finish(hash: string, size: number): Promise<void>;
  discard(hash: string): Promise<void>;
  commit(manifest: Manifest): Promise<void>;
  open(unitId: string, version: number): Promise<{ manifest: Manifest; paths: Record<string, string> }>;
}
export interface RemoteStore {
  manifest(publication: Publication, signal?: AbortSignal): Promise<unknown>;
  download(manifest: Manifest, resource: PublishedResource, write: (chunk: Uint8Array) => Promise<void>, signal: AbortSignal): Promise<void>;
}
export interface Progress { unitId: string; bytes: number; total: number; fileName: string; phase: "download" | "verify" | "activate" }
export class SyncEngine {
  cache: CacheStore;
  remote: RemoteStore;
  active?: { unitId: string; controller: AbortController; promise: Promise<Manifest> };
  constructor(cache: CacheStore, remote: RemoteStore) { this.cache = cache; this.remote = remote; }
  private async cached<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError("cache", "No se pudo acceder al caché local.");
      failure.stage = operation === "commit" ? "activate" : "cache";
      syncDiagnostic(failure.code === "integrity" ? "HASH_MISMATCH" : "CACHE_WRITE_ERROR", { operation });
      throw failure;
    }
  }
  cancel(): void { this.active?.controller.abort(); }
  sync(publication: Publication, progress: (value: Progress) => void = () => {}): Promise<Manifest> {
    if (this.active) return this.active.unitId === publication.unitId ? this.active.promise : Promise.reject(new SyncError("busy", "Termina o cancela la descarga actual."));
    const controller = new AbortController();
    const promise = this.perform(publication, controller.signal, progress).finally(() => { this.active = undefined; });
    this.active = { unitId: publication.unitId, controller, promise };
    return promise;
  }
  async perform(publication: Publication, signal: AbortSignal, progress: (value: Progress) => void): Promise<Manifest> {
    const checkCancelled = () => { if (signal.aborted) throw new SyncError("cancelled", "Descarga cancelada. Versión anterior conservada."); };
    let manifest: Manifest;
    try {
      manifest = await validateManifest(await this.remote.manifest(publication, signal));
      if (manifest.unit.unitId !== publication.unitId || manifest.version !== publication.version || manifest.integrity.contentHash !== publication.contentHash) throw new SyncError("manifest", "La publicación recibida no coincide con la seleccionada.");
      syncDiagnostic("MANIFEST_OK", { version: manifest.version });
    } catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError("manifest", "No se pudo validar el manifest.");
      failure.stage = "manifest";
      syncDiagnostic("MANIFEST_ERROR");
      throw failure;
    }
    checkCancelled();
    const existing = (await this.cached("list", () => this.cache.list())).find((item) => item.unit.unitId === publication.unitId);
    if (existing && existing.version > manifest.version) throw new SyncError("version", "Ya tienes una versión local más reciente. Actualiza el catálogo.");
    const unique = [...new Map(manifest.resources.map((resource) => [resource.download.checksums.sha256, resource])).values()];
    const total = unique.reduce((sum, resource) => sum + resource.download.sizeBytes, 0);
    let bytes = 0;
    for (const resource of unique) {
      checkCancelled();
      const hash = resource.download.checksums.sha256;
      const size = resource.download.sizeBytes;
      if (await this.cached("has", () => this.cache.has(hash, size))) { bytes += size; progress({ unitId: publication.unitId, bytes, total, fileName: resource.name, phase: "verify" }); continue; }
      let received = 0;
      try {
        await this.cached("begin", () => this.cache.begin(hash));
        await this.remote.download(manifest, resource, async (chunk) => {
          checkCancelled();
          if (received + chunk.length > size) throw new SyncError("integrity", "Tamaño descargado superior al publicado.");
          await this.cached("append", () => this.cache.append(hash, received, chunk));
          received += chunk.length;
          progress({ unitId: publication.unitId, bytes: bytes + received, total, fileName: resource.name, phase: "download" });
        }, signal);
        checkCancelled();
        if (received !== size) throw new SyncError("integrity", "Archivo incompleto. Reintenta la descarga.");
        progress({ unitId: publication.unitId, bytes: bytes + received, total, fileName: resource.name, phase: "verify" });
        await this.cached("finish", () => this.cache.finish(hash, size));
        bytes += received;
      } catch (error) {
        const failure = error instanceof SyncError ? error : new SyncError("download", "No se pudo descargar un archivo.");
        if (!failure.stage) failure.stage = failure.code === "integrity" ? "verify" : "download";
        if (failure.code === "integrity") syncDiagnostic("HASH_MISMATCH");
        else if (failure.stage === "download") syncDiagnostic("DOWNLOAD_ERROR");
        await this.cache.discard(hash).catch(() => {});
        throw failure;
      }
    }
    checkCancelled();
    progress({ unitId: publication.unitId, bytes, total, fileName: "", phase: "activate" });
    // Commit is the atomic boundary; cancellation after it begins cannot revoke a completed version.
    await this.cached("commit", () => this.cache.commit(manifest));
    syncDiagnostic("VERSION_ACTIVATED", { version: manifest.version });
    return manifest;
  }
}

// Player boundary: local manifest + verified paths, no Firebase/Drive knowledge.
export async function openLocalClass(cache: CacheStore, unitId: string, version: number) {
  const local = await cache.open(unitId, version);
  const manifest = await validateManifest(local.manifest);
  return { manifest, resolveResource(resourceId: string) {
    const resource = manifest.resources.find((item) => item.resourceId === resourceId);
    if (!resource || !local.paths[resourceId]) throw new SyncError("cache", "Recurso local no disponible.");
    return { path: local.paths[resourceId], mimeType: resource.download.mimeType, kind: resource.kind, name: resource.download.name };
  } };
}
