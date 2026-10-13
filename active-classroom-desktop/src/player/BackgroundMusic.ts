import type { Manifest } from "../offline/manifest.ts";
import type { RendererSource } from "./types.ts";
import { escapeHtml } from "../utils/dom.ts";
import { assertLocalUrl } from "./local-source.ts";

// Session owner: instantiated only by ClassroomPlayer, never ProjectionPlayer.
export class BackgroundMusic {
  readonly tracks: NonNullable<Manifest["backgroundMusic"]>;
  index = 0;
  volume = 0.35;
  pauseReason: "manual" | "class-media" | "" = "manual";
  readonly audio: HTMLAudioElement;
  private sequence = 0;
  private loadedId = "";
  private disposed = false;
  private message = "";
  private pending = false;
  private source?: RendererSource;
  private host: HTMLElement;
  private prepare: (id: string) => Promise<RendererSource>;
  private canPlay: () => boolean;
  private release?: (source: RendererSource) => void;
  private changed = () => this.render();
  constructor(host: HTMLElement, manifest: Manifest, prepare: (id: string) => Promise<RendererSource>, canPlay: () => boolean = () => true, release?: (source: RendererSource) => void) {
    this.host = host; this.prepare = prepare; this.canPlay = canPlay; this.release = release;
    this.tracks = manifest.backgroundMusic || [];
    this.audio = document.createElement("audio"); this.audio.preload = "none"; this.audio.volume = this.volume;
    for (const event of ["play", "pause", "ended", "error"]) this.audio.addEventListener(event, this.changed);
    this.audio.addEventListener("error", this.error);
    host.innerHTML = '<details class="player-background-music"><summary>♪ Música ambiente</summary><div data-music-controls></div></details>';
    if (this.tracks.length) host.append(this.audio); this.render();
  }
  private error = () => { this.message = "No se pudo reproducir esta pista. Reintenta."; this.pending = false; this.render(); };
  private render(): void {
    if (this.disposed) return;
    const controls = this.host.querySelector<HTMLElement>("[data-music-controls]")!;
    if (!this.tracks.length) { controls.innerHTML = "<p>Sin música configurada</p>"; return; }
    const track = this.tracks[this.index];
    controls.innerHTML = `<strong>${escapeHtml(track.title)}</strong><div class="ui-cluster">${this.tracks.length > 1 ? '<button data-music-previous aria-label="Pista anterior">⏮</button>' : ""}<button data-music-play ${this.pending ? "disabled" : ""}>${!this.audio.paused ? "Pausar" : this.pending ? "Abriendo…" : "Reproducir"}</button>${this.tracks.length > 1 ? '<button data-music-next aria-label="Pista siguiente">⏭</button>' : ""}<small>${this.index + 1} / ${this.tracks.length}</small></div><label>Volumen de música<input type="range" data-music-volume aria-label="Volumen de música ambiente" min="0" max="1" step="0.05" value="${this.volume}"/></label><p role="status">${escapeHtml(this.message || (this.pauseReason === "class-media" ? "Pausada por audio/video de clase" : ""))}</p>`;
    controls.querySelector<HTMLButtonElement>("[data-music-play]")!.onclick = () => { void this.toggle(); };
    controls.querySelector<HTMLButtonElement>("[data-music-next]")?.addEventListener("click", () => { void this.move(1); });
    controls.querySelector<HTMLButtonElement>("[data-music-previous]")?.addEventListener("click", () => { void this.move(-1); });
    controls.querySelector<HTMLInputElement>("[data-music-volume]")!.oninput = event => this.setVolume(Number((event.target as HTMLInputElement).value));
  }
  async toggle(): Promise<void> {
    if (this.disposed || !this.tracks.length || this.pending) return;
    if (!this.audio.paused) { this.pause("manual"); return; }
    if (!this.canPlay()) { this.pauseReason = "class-media"; this.render(); return; }
    const sequence = ++this.sequence; this.pending = true; this.message = ""; this.render();
    try {
      const track = this.tracks[this.index];
      if (this.audio.error) { this.audio.removeAttribute("src"); this.audio.load(); this.loadedId = ""; if (this.source) this.release?.(this.source); this.source = undefined; }
      if (this.loadedId !== track.id) {
        const source = await this.prepare(track.resourceId);
        if (this.disposed || sequence !== this.sequence) { this.release?.(source); return; }
        this.source = source;
        assertLocalUrl(source.url);
        if (!source.mimeType.startsWith("audio/")) throw new Error("Música ambiente requiere audio local verificado.");
        this.audio.src = source.url; this.loadedId = track.id; this.audio.load();
      }
      if (this.disposed || sequence !== this.sequence || !this.canPlay()) { this.pause("class-media"); return; }
      await this.audio.play();
      if (this.disposed || sequence !== this.sequence) this.audio.pause(); else this.pauseReason = "";
    } catch { if (!this.disposed && sequence === this.sequence) this.message = "No se pudo reproducir esta pista. Reintenta."; }
    finally { if (sequence === this.sequence) { this.pending = false; this.render(); } }
  }
  pause(reason: "manual" | "class-media"): void {
    if (reason === "class-media" && this.audio.paused && !this.pending) return;
    ++this.sequence; this.pending = false; this.pauseReason = reason; this.audio.pause(); this.render();
  }
  async move(direction: number): Promise<void> {
    if (this.disposed || this.tracks.length < 2) return;
    const resume = !this.audio.paused; this.pause("manual");
    this.audio.removeAttribute("src"); this.audio.load(); this.loadedId = "";
    if (this.source) this.release?.(this.source); this.source = undefined;
    this.index = (this.index + direction + this.tracks.length) % this.tracks.length;
    this.message = ""; this.render(); if (resume) await this.toggle();
  }
  setVolume(value: number): void { if (Number.isFinite(value)) { this.volume = Math.max(0, Math.min(1, value)); this.audio.volume = this.volume; } }
  destroy(): void {
    this.disposed = true; ++this.sequence;
    if (!this.tracks.length) { this.host.replaceChildren(); return; }
    for (const event of ["play", "pause", "ended", "error"]) this.audio.removeEventListener(event, this.changed);
    this.audio.removeEventListener("error", this.error); this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); this.audio.remove(); this.host.replaceChildren();
    if (this.source) this.release?.(this.source); this.source = undefined;
  }
}
