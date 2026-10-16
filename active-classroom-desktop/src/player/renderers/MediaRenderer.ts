import { BaseRenderer } from "./base.ts";
import type { PlayerCommand, RendererOptions, RendererSource, RendererState } from "../types.ts";
import { mediaDiagnostic, mediaErrorMessage, mediaTransportError } from "../media-diagnostics.ts";

export abstract class MediaRenderer extends BaseRenderer {
  abstract kind: "audio" | "video";
  media?: HTMLMediaElement;
  listeners: [string, EventListener][] = [];
  timeout?: ReturnType<typeof setTimeout>;
  private playback?: RendererState;
  private playPending = false;
  private reportFailure?: () => void;
  async mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    const media = document.createElement(this.kind); this.media = media;
    media.preload = "metadata"; media.controls = false; media.autoplay = false;
    media.volume = options.silent ? 0 : options.volume; media.muted = options.silent || options.muted;
    media.setAttribute("aria-label", source.name);
    const mime = source.mimeType.split(";")[0].trim().toLowerCase();
    const canPlayMime = media.canPlayType(mime);
    const canPlayH264Aac = media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    const canPlayCodec = source.codecMime ? media.canPlayType(source.codecMime) : canPlayH264Aac;
    const readableError = (message: string) => this.kind === "audio" ? message.replace("video", "audio") : message;
    const diagnostic = (event: string) => mediaDiagnostic({ event, kind: this.kind, mime, codecMime: source.codecMime || "", url: source.url, mediaErrorCode: media.error?.code || 0, mediaErrorMessage: media.error?.message || "", networkState: media.networkState, readyState: media.readyState, canPlayMime, canPlayCodec, canPlayH264Aac });
    for (const name of ["loadstart", "loadedmetadata", "canplay", "error", "stalled", "suspend", "seeked"]) {
      const listener = () => diagnostic(name); media.addEventListener(name, listener); this.listeners.push([name, listener]);
    }
    diagnostic("source");
    if (media instanceof HTMLVideoElement) { media.playsInline = true; media.className = "player-video"; }
    const update = () => this.notify({ playing: !media.paused && !media.ended, time: Number.isFinite(media.currentTime) ? media.currentTime : 0, duration: Number.isFinite(media.duration) ? media.duration : 0, volume: media.volume, muted: media.muted });
    for (const name of ["timeupdate", "durationchange", "play", "pause", "ended", "volumechange", "seeked"]) {
      media.addEventListener(name, update); this.listeners.push([name, update]);
    }
    const ready = () => { clearTimeout(this.timeout); this.notify({ loading: false, error: "" }); update(); if (this.playback) void this.applyPlayback(this.playback); };
    const error = () => {
      clearTimeout(this.timeout); media.pause();
      const code = media.error?.code || 0;
      this.notify({ loading: false, playing: false, error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, null, canPlayH264Aac)) });
      void mediaTransportError(source.url).then((localError) => { if (!this.disposed && localError) this.notify({ error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, localError, canPlayH264Aac)) }); });
    };
    this.reportFailure = () => { diagnostic("play-rejected"); error(); };
    media.addEventListener("loadedmetadata", ready); this.listeners.push(["loadedmetadata", ready]);
    media.addEventListener("error", error); this.listeners.push(["error", error]);
    this.notify({ loading: true, volume: options.volume, muted: options.muted });
    this.timeout = setTimeout(() => { diagnostic("timeout"); this.notify({ loading: false, error: readableError("No se pudo leer el video local") }); }, 20000);
    const label = document.createElement("p"); label.textContent = source.name; label.className = "player-audio-title";
    host.replaceChildren(...(this.kind === "audio" ? [label, media] : [media]));
    media.src = source.url; media.load();
  }
  async command(command: PlayerCommand): Promise<void> {
    const media = this.media;
    if (!media || this.disposed) return;
    switch (command) {
      case "PLAY_PAUSE":
        if (!media.paused) media.pause();
        else try { await media.play(); if (this.disposed) media.pause(); } catch { this.reportFailure?.(); }
        break;
      case "STOP": media.pause(); this.seek(0); break;
      case "SEEK_FORWARD": this.seek(media.currentTime + 10); break;
      case "SEEK_BACKWARD": this.seek(media.currentTime - 10); break;
      case "VOLUME_UP": this.setVolume(media.volume + 0.1); break;
      case "VOLUME_DOWN": this.setVolume(media.volume - 0.1); break;
      case "MUTE": if (!this.options?.silent) media.muted = !media.muted; this.notify({ muted: media.muted }); break;
    }
  }
  seek(seconds: number): void {
    const media = this.media;
    if (!media || !Number.isFinite(seconds) || !Number.isFinite(media.duration)) return;
    try { media.currentTime = Math.max(0, Math.min(media.duration, seconds)); this.notify({ time: media.currentTime }); } catch { /* Metadata may not be ready. */ }
  }
  setVolume(volume: number): void {
    if (this.media && Number.isFinite(volume)) { this.media.volume = this.options?.silent ? 0 : Math.max(0, Math.min(1, volume)); this.notify({ volume: this.media.volume }); }
  }
  async applyPlayback(state: RendererState): Promise<void> {
    this.playback = state;
    const media = this.media;
    if (!media || this.disposed || !this.options?.silent) return;
    media.muted = true; media.volume = 0;
    if (!Number.isFinite(media.duration)) return;
    if (Math.abs(media.currentTime - state.time) > 0.35 || !state.playing) this.seek(state.time);
    if (!state.playing) media.pause();
    else if (media.paused && !this.playPending && !this.state.error) {
      this.playPending = true;
      try { await media.play(); if (this.disposed || !this.playback?.playing) media.pause(); }
      catch { this.notify({ playing: false, error: "No se pudo reproducir video en el proyector." }); }
      finally { this.playPending = false; }
    }
  }
  destroy(): void {
    super.destroy(); clearTimeout(this.timeout);
    const media = this.media;
    if (media) { for (const [name, listener] of this.listeners) media.removeEventListener(name, listener); media.pause(); media.removeAttribute("src"); media.load(); media.remove(); }
    this.listeners = [];
    this.reportFailure = undefined;
  }
}
