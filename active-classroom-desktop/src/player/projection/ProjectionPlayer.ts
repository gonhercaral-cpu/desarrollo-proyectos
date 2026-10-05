import { createRenderer } from "../renderers/factory.ts";
import { rendererKind, type LocalRenderer } from "../types.ts";
import { assertLocalUrl } from "../local-source.ts";
import { isProjectionSnapshot, type ProjectionSnapshot } from "../ClassSessionController.ts";

// Read-only follower. No shortcuts, session controller, auth or remote APIs.
export class ProjectionPlayer {
  private renderer?: LocalRenderer;
  private snapshot?: ProjectionSnapshot;
  private key = "";
  private generation = 0;
  private disposed = false;
  private page = 0;
  private tick: ReturnType<typeof setInterval>;
  private host: HTMLElement;
  private factory: typeof createRenderer;
  constructor(host: HTMLElement, factory = createRenderer) { this.host = host; this.factory = factory; this.host.className = "projection-content"; this.tick = setInterval(() => this.followPlayback(), 250); }
  async receive(snapshot: ProjectionSnapshot | null): Promise<void> {
    if (this.disposed) return;
    if (!snapshot) { this.snapshot = undefined; this.clear(); return; }
    if (!isProjectionSnapshot(snapshot)) { this.clear(); return; }
    if (this.snapshot?.sessionId === snapshot.sessionId && snapshot.revision <= this.snapshot.revision) return;
    this.snapshot = snapshot;
    if (!snapshot.source || snapshot.playback.error) { this.clear(); return; }
    const source = snapshot.source;
    try { assertLocalUrl(source.url); } catch { this.clear(); return; }
    const key = `${snapshot.sessionId}:${snapshot.resourceId}:${source.url}`;
    if (key === this.key) { if (snapshot.page !== this.page) { this.page = snapshot.page; void Promise.resolve(this.renderer?.setPage(snapshot.page)).catch(() => this.clear()); } this.followPlayback(); return; }
    this.clear(); this.key = key; const generation = this.generation;
    const kind = rendererKind(source.mimeType);
    // Teacher alone owns audio, including video sound. Audio projection has no media element.
    if (kind === "audio") { this.host.textContent = "♪"; return; }
    if (kind === "unsupported") return;
    try {
      const renderer = await this.factory(kind);
      if (generation !== this.generation || this.disposed) { renderer.destroy(); return; }
      this.renderer = renderer; this.page = snapshot.page;
      await renderer.mount(this.host, { ...source, name: "" }, { page: snapshot.page, volume: 0, muted: true, silent: true, onPage: () => {}, onState: () => {} });
      if (generation !== this.generation || this.disposed) return;
      const latest = this.snapshot!; if (latest.page !== this.page) { this.page = latest.page; await renderer.setPage(latest.page); }
      this.followPlayback();
    } catch { if (generation === this.generation) this.clear(); }
  }
  private followPlayback(): void {
    const snapshot = this.snapshot; if (!snapshot || !this.renderer?.applyPlayback || this.disposed) return;
    const time = snapshot.playback.time + (snapshot.playback.playing ? Math.max(0, Date.now() - snapshot.updatedAt) / 1000 : 0);
    void Promise.resolve(this.renderer.applyPlayback({ ...snapshot.playback, time: Math.min(snapshot.playback.duration || time, time), muted: true, volume: 0 })).catch(() => this.clear());
  }
  private clear(): void { ++this.generation; this.renderer?.destroy(); this.renderer = undefined; this.key = ""; this.page = 0; this.host.replaceChildren(); }
  destroy(): void { this.disposed = true; clearInterval(this.tick); this.clear(); }
}
