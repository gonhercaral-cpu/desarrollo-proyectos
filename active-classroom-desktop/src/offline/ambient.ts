import { canonical, sha256, SyncError, validHash } from "./manifest.ts";
import publicationLimits from "../../../drive/activeClassroomPublicationLimits.json" with { type: "json" };
import { rendererKind } from "../player/types.ts";
import type { NativeCache } from "./native-cache.ts";
import type { PublicationApi } from "./remote.ts";
import { BlobTransfers } from "./sync.ts";
export interface AmbientTrack { id: string; title: string; mime: string; size: number; sha256: string; storagePath: string; generation: string; order: number; active: boolean; sourceType: "file"; duration?: number }
export interface AmbientCatalog { schemaVersion: number; ambientCatalogVersion: number; tracks: AmbientTrack[]; playlists: { id: string; title: string; trackIds: string[] }[]; integrity: { algorithm: string; contentHash: string } }
export async function validateAmbient(input: unknown): Promise<AmbientCatalog> {
  const catalog = input as AmbientCatalog;
  const require = (condition: unknown) => { if (!condition) throw new SyncError("integrity", "Catálogo de música inválido."); };
  require(catalog && catalog.schemaVersion === 1 && Number.isSafeInteger(catalog.ambientCatalogVersion) && catalog.ambientCatalogVersion >= 0 && Array.isArray(catalog.tracks) && catalog.tracks.length <= 200 && Array.isArray(catalog.playlists) && catalog.playlists.length <= 50);
  const ids = new Set<string>();
  catalog.tracks.forEach((track, index) => {
    require(track && validHash(track.sha256) && track.id === track.sha256 && !ids.has(track.id) && typeof track.title === "string" && track.title.trim() && track.title.length <= 160 && rendererKind(track.mime) === "audio" && typeof track.active === "boolean" && track.sourceType === "file" && track.order === index && Number.isSafeInteger(track.size) && track.size >= 0 && track.size <= publicationLimits.maxFileBytes && /^active-classroom\/publications\/files\/[a-f0-9]{64}$/.test(track.storagePath) && /^\d+$/.test(track.generation)); ids.add(track.id);
  });
  const playlists = new Set<string>();
  for (const playlist of catalog.playlists) { require(playlist && /^[a-zA-Z0-9_-]{1,200}$/.test(playlist.id) && !playlists.has(playlist.id) && typeof playlist.title === "string" && playlist.title.length <= 160 && Array.isArray(playlist.trackIds) && playlist.trackIds.every(id => ids.has(id)) && new Set(playlist.trackIds).size === playlist.trackIds.length); playlists.add(playlist.id); }
  require(catalog.integrity?.algorithm === "sha256" && validHash(catalog.integrity.contentHash) && await sha256(new TextEncoder().encode(canonical({ schemaVersion: 1, tracks: catalog.tracks, playlists: catalog.playlists }))) === catalog.integrity.contentHash);
  return catalog;
}
export class AmbientLibrary {
  catalog: AmbientCatalog | null = null;
  private loading?: Promise<AmbientCatalog | null>;
  private syncing?: Promise<void>;
  private cancel = new AbortController();
  private cache: NativeCache;
  private api: PublicationApi;
  private transfers: BlobTransfers;
  constructor(cache: NativeCache, api: PublicationApi, transfers = new BlobTransfers()) { this.cache = cache; this.api = api; this.transfers = transfers; }
  restore(): Promise<AmbientCatalog | null> {
    return this.loading ||= Promise.resolve().then(() => this.cache.call<AmbientCatalog | null>("ambient-read")).then(async input => { this.catalog = input ? await validateAmbient(input) : null; return this.catalog; }).catch(() => null);
  }
  sync(): Promise<void> { return this.syncing ||= this.perform().finally(() => { this.syncing = undefined; }); }
  close(): void { this.cancel.abort(); }
  private async perform(): Promise<void> {
    const local = await this.restore(); const signal = this.cancel.signal;
    const result = await this.api.call<{ catalog: unknown }>("getActiveClassroomAmbientCatalog", {}, signal); const catalog = await validateAmbient(result.catalog);
    if (!catalog.ambientCatalogVersion || local && local.ambientCatalogVersion > catalog.ambientCatalogVersion) return;
    for (const track of catalog.tracks.filter(track => track.active)) {
      await this.transfers.run(track.sha256, signal, async () => {
        signal.throwIfAborted(); if (await this.cache.has(track.sha256, track.size)) return;
        let offset = 0;
        try {
          await this.cache.begin(track.sha256);
          await this.api.downloadAmbient(catalog.ambientCatalogVersion, track, async chunk => { signal.throwIfAborted(); await this.cache.append(track.sha256, offset, chunk); offset += chunk.length; }, signal);
          if (offset !== track.size) throw new SyncError("integrity", "Audio incompleto."); signal.throwIfAborted(); await this.cache.finish(track.sha256, track.size);
        } catch (error) { await this.cache.discard(track.sha256).catch(() => {}); throw error; }
      });
    }
    signal.throwIfAborted(); await this.cache.call("ambient-commit", catalog); this.catalog = catalog; this.loading = Promise.resolve(catalog);
  }
}
