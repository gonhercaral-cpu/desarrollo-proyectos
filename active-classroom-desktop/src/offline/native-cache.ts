import { invoke } from "@tauri-apps/api/core";
import { SyncError, type Manifest } from "./manifest.ts";
import type { CacheStore } from "./sync.ts";

export class NativeCache implements CacheStore {
  owner: string;
  constructor(owner: string) { this.owner = owner; }
  async call<T>(action: string, data: unknown = {}): Promise<T> {
    try { return await invoke<T>("classroom_cache", { owner: this.owner, action, data }); }
    catch (error) {
      const message = String(error);
      throw new SyncError(message.split(":")[0] || "cache", message.includes(":") ? message.slice(message.indexOf(":") + 1).trim() : "Caché nativa no disponible. Abre la aplicación Desktop instalada.");
    }
  }
  list() { return this.call<Manifest[]>("list"); }
  has(hash: string, size: number) { return this.call<boolean>("has", { hash, size }); }
  begin(hash: string) { return this.call<void>("begin", { hash }); }
  append(hash: string, offset: number, chunk: Uint8Array) { return this.call<void>("append", { hash, offset, chunk: Array.from(chunk) }); }
  finish(hash: string, size: number) { return this.call<void>("finish", { hash, size }); }
  discard(hash: string) { return this.call<void>("discard", { hash }); }
  commit(manifest: Manifest) { return this.call<void>("commit", manifest); }
  open(unitId: string, version: number) { return this.call<{ manifest: Manifest; paths: Record<string, string> }>("open", { unitId, version }); }
}
