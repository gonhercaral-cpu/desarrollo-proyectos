import { BlobTransfers, SyncEngine, type CacheStore, type RemoteStore, type Progress } from "./sync.ts";
import type { Manifest, Publication } from "./manifest.ts";

export interface StagingCache extends CacheStore { stage(manifest: Manifest): Promise<void>; pending(): Promise<Manifest[]> }
export interface DownloadTask { publication: Publication; state: "queued" | "downloading" | "staged" | "ready" | "failed"; progress?: Progress; error?: unknown; manifest?: Manifest }
export class DownloadQueue {
  readonly tasks = new Map<string, DownloadTask>();
  private workers: SyncEngine[];
  private running = new Set<SyncEngine>();
  protectedUnit = "";
  private closed = false;
  private installed = new Map<string, Manifest>();
  private cache: StagingCache;
  private changed: (task: DownloadTask) => void;
  constructor(cache: StagingCache, remote: RemoteStore, changed: (task: DownloadTask) => void, concurrency = 2) {
    this.cache = cache; this.changed = changed;
    const transfers = new BlobTransfers();
    // Initial verified versions are shared by workers, avoiding a full rescan of
    // every installed video for every Unit in a batch. Each blob/commit is verified.
    const installed = this.installed;
    let initial: Promise<void> | undefined;
    const workerCache = new Proxy(cache, { get(target, key) {
      if (key === "list") return async () => {
        initial ||= cache.list().then(manifests => { for (const manifest of manifests) installed.set(manifest.unit.unitId, manifest); });
        await initial; return [...installed.values()];
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    this.workers = Array.from({ length: Math.min(3, Math.max(1, concurrency)) }, () => new SyncEngine(workerCache, remote, transfers, async manifest => {
      if (manifest.unit.unitId === this.protectedUnit) { await cache.stage(manifest); if (manifest.unit.unitId !== this.protectedUnit) await cache.commit(manifest); }
      else await cache.commit(manifest);
      if (manifest.unit.unitId !== this.protectedUnit) installed.set(manifest.unit.unitId, manifest);
    }));
  }
  enqueue(publication: Publication): void {
    if (this.closed) return;
    const old = this.tasks.get(publication.unitId);
    if (old && old.publication.version >= publication.version && old.state !== "failed") return;
    // A newer catalog is reconciled after the running version finishes.
    if (old?.state === "downloading") return;
    const task: DownloadTask = { publication, state: "queued" };
    this.tasks.set(publication.unitId, task); this.changed(task); this.pump();
  }
  cancel(unitId: string): void {
    const task = this.tasks.get(unitId);
    const worker = this.workers.find(engine => engine.active?.unitId === unitId);
    if (worker) worker.cancel();
    else if (task?.state === "queued") { task.state = "failed"; this.changed(task); }
  }
  close(): void { this.closed = true; this.workers.forEach(worker => worker.cancel()); }
  async activatePending(): Promise<void> {
    for (const manifest of await this.cache.pending()) {
      if (manifest.unit.unitId === this.protectedUnit) continue;
      await this.cache.commit(manifest);
      this.installed.set(manifest.unit.unitId, manifest);
      const task = this.tasks.get(manifest.unit.unitId);
      if (task) { task.state = "ready"; task.manifest = manifest; this.changed(task); }
    }
  }
  private pump(): void {
    if (this.closed) return;
    for (const engine of this.workers) {
      if (this.running.has(engine)) continue;
      const task = [...this.tasks.values()].find(value => value.state === "queued");
      if (!task) break;
      this.running.add(engine); task.state = "downloading"; this.changed(task);
      void engine.sync(task.publication, progress => { task.progress = progress; this.changed(task); }).then(manifest => {
        task.manifest = manifest;
        task.state = manifest.unit.unitId === this.protectedUnit ? "staged" : "ready";
      }).catch(error => { task.state = "failed"; task.error = error; }).finally(() => {
        this.running.delete(engine); this.changed(task); this.pump();
      });
    }
  }
}
