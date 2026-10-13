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
  private requestPlay?: () => void;
  private seekTarget?: number;
  private seekTimer?: ReturnType<typeof setTimeout>;
  private seekInFlight = false;
  private lastTimeUpdate = 0;
  private frameCallback?: number;
  async mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    const media = document.createElement(this.kind); this.media = media;
    const opened = performance.now(); let requested = 0;
    const buffered = () => Array.from({ length: media.buffered.length }, (_, index) => [media.buffered.start(index), media.buffered.end(index)]);
    media.preload = "auto"; media.controls = false; media.autoplay = false;
    media.volume = options.silent ? 0 : options.volume; media.muted = options.silent || options.muted;
    media.setAttribute("aria-label", source.name);
    const mime = source.mimeType.split(";")[0].trim().toLowerCase();
    const canPlayMime = media.canPlayType(mime);
    const canPlayH264Aac = media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    const canPlayCodec = source.codecMime ? media.canPlayType(source.codecMime) : canPlayH264Aac;
    const readableError = (message: string) => this.kind === "audio" ? message.replace("video", "audio") : message;
    const diagnostic = (event: string) => mediaDiagnostic({ event, elapsedMs: Math.round(performance.now() - opened), playElapsedMs: requested ? Math.round(performance.now() - requested) : null, currentTime: media.currentTime, seeking: media.seeking, buffered: buffered(), kind: this.kind, mime, codecMime: source.codecMime || "", url: source.url, mediaErrorCode: media.error?.code || 0, mediaErrorMessage: media.error?.message || "", networkState: media.networkState, readyState: media.readyState, canPlayMime, canPlayCodec, canPlayH264Aac });
    for (const name of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "seeking", "error", "stalled", "suspend", "seeked", "progress"]) {
      const listener = () => diagnostic(name); media.addEventListener(name, listener); this.listeners.push([name, listener]);
    }
    diagnostic("source");
    this.requestPlay = () => { requested = performance.now(); diagnostic("play-requested"); };
    if (media instanceof HTMLVideoElement && media.requestVideoFrameCallback) {
      const firstFrame = () => { if (!this.disposed) diagnostic("first-frame"); };
      this.frameCallback = media.requestVideoFrameCallback(firstFrame);
    }
    if (media instanceof HTMLVideoElement) { media.playsInline = true; media.className = "player-video"; }
    const update = () => {
      const time = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      // WebKitGTK may resume its clock after a seek without another playing or
      // canplay event (readyState can remain HAVE_CURRENT_DATA). Clock progress
      // clears a stale waiting flag so it cannot leave the projector paused.
      const resumed = !media.paused && !media.seeking && time > this.state.time + .01;
      this.notify({ playing: !media.paused && !media.ended, buffering: resumed ? false : this.state.buffering, seeking: media.seeking || this.seekInFlight || this.seekTarget !== undefined, time, duration: Number.isFinite(media.duration) ? media.duration : 0, volume: media.volume, muted: media.muted });
    };
    const timeUpdate = () => { const now = performance.now(); if (now - this.lastTimeUpdate >= 200) { this.lastTimeUpdate = now; update(); } };
    media.addEventListener("timeupdate", timeUpdate); this.listeners.push(["timeupdate", timeUpdate]);
    for (const name of ["durationchange", "play", "pause", "ended", "volumechange", "seeking"]) {
      media.addEventListener(name, update); this.listeners.push([name, update]);
    }
    const ready = () => { clearTimeout(this.timeout); this.notify({ loading: false, buffering: false, error: "" }); update(); if (this.playback) void this.applyPlayback(this.playback); };
    const waiting = () => this.notify({ buffering: true });
    const playing = () => this.notify({ buffering: false });
    const seeked = () => { this.seekInFlight = false; if (this.seekTarget !== undefined && !this.seekTimer) this.flushSeek(); update(); };
    for (const [name, listener] of [["waiting", waiting], ["playing", playing], ["seeked", seeked]] as [string, EventListener][]) { media.addEventListener(name, listener); this.listeners.push([name, listener]); }
    const error = () => {
      clearTimeout(this.timeout); media.pause();
      const code = media.error?.code || 0;
      this.notify({ loading: false, playing: false, error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, null, canPlayH264Aac)) });
      void mediaTransportError(source.url).then((localError) => { if (!this.disposed && localError) this.notify({ error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, localError, canPlayH264Aac)) }); });
    };
    this.reportFailure = () => { diagnostic("play-rejected"); error(); };
    media.addEventListener("canplay", ready); this.listeners.push(["canplay", ready]);
    media.addEventListener("error", error); this.listeners.push(["error", error]);
    this.notify({ loading: true, volume: options.volume, muted: options.muted });
    this.timeout = setTimeout(() => { diagnostic("timeout"); media.pause(); media.removeAttribute("src"); media.load(); this.notify({ loading: false, playing: false, error: readableError("No se pudo leer el video local") }); }, 20000);
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
        else try { this.requestPlay?.(); await media.play(); if (this.disposed) media.pause(); } catch { this.reportFailure?.(); }
        break;
      case "STOP": media.pause(); this.seek(0); break;
      case "SEEK_FORWARD": this.seek((this.seekTarget ?? media.currentTime) + 10); break;
      case "SEEK_BACKWARD": this.seek((this.seekTarget ?? media.currentTime) - 10); break;
      case "VOLUME_UP": this.setVolume(media.volume + 0.1); break;
      case "VOLUME_DOWN": this.setVolume(media.volume - 0.1); break;
      case "MUTE": if (!this.options?.silent) media.muted = !media.muted; this.notify({ muted: media.muted }); break;
    }
  }
  seek(seconds: number): void {
    const media = this.media;
    if (!media || !Number.isFinite(seconds) || !Number.isFinite(media.duration)) return;
    this.seekTarget = Math.max(0, Math.min(media.duration, seconds));
    this.notify({ seeking: true });
    // Fixed windows preserve responsiveness during held keys. Only the latest target
    // enters the decoder; further requests wait for seeked instead of stacking seeks.
    if (!this.seekTimer) this.seekTimer = setTimeout(() => { this.seekTimer = undefined; this.flushSeek(); }, 90);
  }
  private flushSeek(): void {
    const media = this.media;
    if (!media || this.disposed || this.seekInFlight || media.seeking || this.seekTarget === undefined) return;
    const target = this.seekTarget; this.seekTarget = undefined;
    if (Math.abs(media.currentTime - target) < 0.05) { this.notify({ seeking: false }); return; }
    try { this.seekInFlight = true; media.currentTime = target; this.notify({ time: target, seeking: true }); }
    catch { this.seekInFlight = false; this.notify({ seeking: false }); }
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
    // Never repeatedly seek an already aligned paused projector, nor chase the
    // teacher clock while its decoder is buffering/seeking.
    if (!state.seeking && !state.buffering && !media.seeking && !this.seekInFlight && this.seekTarget === undefined && Math.abs(media.currentTime - state.time) > 0.35) this.seek(state.time);
    if (!state.playing || state.seeking || state.buffering) media.pause();
    else if (media.paused && !this.playPending && !this.state.error) {
      this.playPending = true;
      try { this.requestPlay?.(); await media.play(); if (this.disposed || !this.playback?.playing || this.playback?.seeking || this.playback?.buffering) media.pause(); }
      catch (error) { if (!this.disposed && this.playback?.playing && !this.playback.seeking && !this.playback.buffering && !(error instanceof DOMException && error.name === "AbortError")) this.notify({ playing: false, error: "No se pudo reproducir video en el proyector." }); }
      finally { this.playPending = false; }
    }
  }
  destroy(): void {
    super.destroy(); clearTimeout(this.timeout); clearTimeout(this.seekTimer);
    const media = this.media;
    if (media) { if (media instanceof HTMLVideoElement && this.frameCallback !== undefined) media.cancelVideoFrameCallback?.(this.frameCallback); for (const [name, listener] of this.listeners) media.removeEventListener(name, listener); media.pause(); media.removeAttribute("src"); media.load(); media.remove(); }
    this.listeners = [];
    this.media = undefined; this.playback = undefined;
    this.reportFailure = undefined; this.requestPlay = undefined; this.seekTarget = undefined; this.seekInFlight = false;
  }
}
