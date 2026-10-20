import { BaseRenderer } from "./base.ts";
import type { PlayerCommand, RendererOptions, RendererSource, RendererState } from "../types.ts";
import { mediaDiagnostic, mediaErrorMessage, mediaTransportError } from "../media-diagnostics.ts";

export abstract class MediaRenderer extends BaseRenderer {
  // WebKit may defer collecting detached video elements and their native
  // surfaces. Retain at most one fully unloaded spare per document instead of
  // creating another native element for every resource. Checked-out elements
  // are removed from the pool; simultaneous renderers always remain distinct.
  private static retiredVideos = new WeakMap<Document, HTMLVideoElement>();
  abstract kind: "audio" | "video";
  media?: HTMLMediaElement;
  listeners: [string, EventListener][] = [];
  timeout?: ReturnType<typeof setTimeout>;
  private playback?: RendererState;
  private playbackReceivedAt = 0;
  private projectionSeekPending = false;
  private projectionSeekExplicit = false;
  private seekRevision = 0;
  private playPending = false;
  private playGeneration = 0;
  private reportFailure?: () => void;
  private requestPlay?: () => void;
  private seekTarget?: number;
  private seekTimer?: ReturnType<typeof setTimeout>;
  private seekInFlight = false;
  private lastTimeUpdate = 0;
  private frameCallback?: number;
  private diagnosticTimer?: ReturnType<typeof setInterval>;
  private presentedFrames = 0;
  private presentedMediaTime = 0;
  async mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    const document = host.ownerDocument;
    const spare = this.kind === "video" ? MediaRenderer.retiredVideos.get(document) : undefined;
    if (spare) MediaRenderer.retiredVideos.delete(document);
    const media = spare && !spare.isConnected && !spare.hasAttribute("src") ? spare : document.createElement(this.kind); this.media = media;
    const opened = performance.now(); let requested = 0;
    const diagnosticsEnabled = () => { try { return window.localStorage.getItem("active-classroom-media-diagnostics") === "true"; } catch { return false; } };
    let observeFrame: VideoFrameRequestCallback | undefined;
    const buffered = () => Array.from({ length: media.buffered.length }, (_, index) => [media.buffered.start(index), media.buffered.end(index)]);
    media.preload = "auto"; media.controls = false; media.autoplay = false;
    media.volume = options.silent ? 0 : options.volume; media.muted = options.silent || options.muted;
    media.setAttribute("aria-label", source.name);
    const mime = source.mimeType.split(";")[0].trim().toLowerCase();
    const canPlayMime = media.canPlayType(mime);
    const canPlayH264Aac = media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    const canPlayCodec = source.codecMime ? media.canPlayType(source.codecMime) : canPlayH264Aac;
    const readableError = (message: string) => this.kind === "audio" ? message.replace("video", "audio") : message;
    const diagnostic = (event: string) => {
      const quality = media instanceof HTMLVideoElement ? media.getVideoPlaybackQuality?.() : undefined;
      mediaDiagnostic({ event, elapsedMs: Math.round(performance.now() - opened), playElapsedMs: requested ? Math.round(performance.now() - requested) : null, currentTime: media.currentTime, seeking: media.seeking, seekRevision: this.seekRevision, buffered: buffered(), kind: this.kind, mime, codecMime: source.codecMime || "", url: source.url, frames: quality?.totalVideoFrames, droppedFrames: quality?.droppedVideoFrames, presentedFrames: observeFrame ? this.presentedFrames : null, presentedMediaTime: observeFrame ? this.presentedMediaTime : null, videos: document.querySelectorAll("video").length, audio: document.querySelectorAll("audio").length, mediaErrorCode: media.error?.code || 0, mediaErrorMessage: media.error?.message || "", networkState: media.networkState, readyState: media.readyState, canPlayMime, canPlayCodec, canPlayH264Aac });
    };
    this.diagnosticTimer = setInterval(() => {
      if (!diagnosticsEnabled()) return;
      if (media instanceof HTMLVideoElement && observeFrame && this.frameCallback === undefined) this.frameCallback = media.requestVideoFrameCallback(observeFrame);
      diagnostic("playback-sample");
    }, 1000);
    for (const name of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "seeking", "error", "stalled", "suspend", "seeked", "progress", "play", "pause", "ended"]) {
      const listener = () => diagnostic(name); media.addEventListener(name, listener); this.listeners.push([name, listener]);
    }
    diagnostic("source");
    this.requestPlay = () => { requested = performance.now(); diagnostic("play-requested"); };
    if (media instanceof HTMLVideoElement && media.requestVideoFrameCallback) {
      let first = true;
      const frame: VideoFrameRequestCallback = (_now, metadata) => {
        if (this.disposed) return;
        this.frameCallback = undefined;
        this.presentedFrames = metadata.presentedFrames; this.presentedMediaTime = metadata.mediaTime;
        if (first) { first = false; diagnostic("first-frame"); }
        // Only opt-in diagnostics observes submitted compositor frames. No DOM
        // or player state updates; distinguish decoder progress from repaint stalls.
        if (diagnosticsEnabled()) this.frameCallback = media.requestVideoFrameCallback(frame);
      };
      observeFrame = frame;
      this.frameCallback = media.requestVideoFrameCallback(frame);
    }
    if (media instanceof HTMLVideoElement) { media.playsInline = true; media.className = "player-video"; }
    const update = () => {
      const time = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      // WebKitGTK may resume its clock after a seek without another playing or
      // canplay event (readyState can remain HAVE_CURRENT_DATA). Clock progress
      // clears a stale waiting flag so it cannot leave the projector paused.
      const resumed = !media.paused && !media.seeking && time > this.state.time + .01;
      if (resumed || media.paused) this.playPending = false;
      this.notify({ playing: !media.paused && !media.ended, buffering: resumed ? false : this.state.buffering, seeking: media.seeking || this.seekInFlight || this.seekTarget !== undefined, seekRevision: this.seekRevision, time, duration: Number.isFinite(media.duration) ? media.duration : 0, volume: media.volume, muted: media.muted });
    };
    const timeUpdate = () => { const now = performance.now(); if (now - this.lastTimeUpdate >= 200) { this.lastTimeUpdate = now; update(); } };
    media.addEventListener("timeupdate", timeUpdate); this.listeners.push(["timeupdate", timeUpdate]);
    for (const name of ["durationchange", "play", "pause", "ended", "volumechange", "seeking"]) {
      media.addEventListener(name, update); this.listeners.push([name, update]);
    }
    const ready = () => { clearTimeout(this.timeout); this.notify({ loading: false, buffering: false, error: "" }); update(); if (this.playback) void this.applyPlayback(this.playback); };
    const waiting = () => this.notify({ buffering: true });
    const playing = () => { this.playPending = false; clearTimeout(this.timeout); this.notify({ loading: false, buffering: false }); };
    const seeked = () => { this.seekInFlight = false; if (this.seekTarget !== undefined && !this.seekTimer) this.flushSeek(); update(); };
    for (const [name, listener] of [["waiting", waiting], ["playing", playing], ["seeked", seeked]] as [string, EventListener][]) { media.addEventListener(name, listener); this.listeners.push([name, listener]); }
    const error = () => {
      const code = media.error?.code || 0;
      if (code === 1) { clearTimeout(this.timeout); this.notify({ loading: false, buffering: false }); return; }
      clearTimeout(this.timeout); media.pause();
      this.notify({ loading: false, playing: false, error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, null, canPlayH264Aac)) });
      void mediaTransportError(source.url).then((localError) => { if (!this.disposed && localError) this.notify({ error: readableError(mediaErrorMessage(code, canPlayMime, canPlayCodec, mime, localError, canPlayH264Aac)) }); });
    };
    this.reportFailure = () => { diagnostic("play-rejected"); error(); };
    for (const name of ["loadeddata", "canplay"]) { media.addEventListener(name, ready); this.listeners.push([name, ready]); }
    media.addEventListener("error", error); this.listeners.push(["error", error]);
    this.notify({ loading: true, volume: options.volume, muted: options.muted });
    // A slow decoder or remote seek is not a MediaError. WebKitGTK can play at
    // HAVE_CURRENT_DATA without emitting canplay; never tear down that pipeline
    // because a wall-clock deadline expired. Keep controls and retry/exit usable.
    this.timeout = setTimeout(() => { diagnostic("preparing-slow"); }, 20000);
    const label = document.createElement("p"); label.textContent = source.name; label.className = "player-audio-title";
    host.replaceChildren(...(this.kind === "audio" ? [label, media] : [media]));
    media.src = source.url; media.load();
  }
  private static playCallbacks(owner: WeakRef<MediaRenderer>, element: WeakRef<HTMLMediaElement>, generation: number): [() => void, (error: unknown) => void] {
    // Keep callbacks in a separate scope: a never-settling engine promise must
    // not retain the renderer, its detached element or the decoder graph.
    return [
      () => {
        const renderer = owner.deref(); const media = element.deref();
        if (!renderer || renderer.disposed || renderer.media !== media) return;
        if (generation !== renderer.playGeneration) return;
        renderer.playPending = false;
        if (renderer.options?.silent && !renderer.playback?.playing) media?.pause();
      },
      error => {
        const renderer = owner.deref();
        if (!renderer || renderer.disposed || renderer.media !== element.deref() || generation !== renderer.playGeneration) return;
        renderer.playPending = false;
        if ((error as { name?: string })?.name === "AbortError") return;
        if (renderer.options?.silent) renderer.notify({ playing: false, error: "No se pudo reproducir video en el proyector." });
        else renderer.reportFailure?.();
      },
    ];
  }
  private startPlayback(): void {
    const media = this.media;
    if (!media || this.disposed || this.playPending) return;
    this.playPending = true;
    const callbacks = MediaRenderer.playCallbacks(new WeakRef(this), new WeakRef(media), ++this.playGeneration);
    try { this.requestPlay?.(); void Promise.resolve(media.play()).then(...callbacks); }
    catch (error) { callbacks[1](error); }
  }
  private pausePlayback(): void {
    ++this.playGeneration; this.playPending = false; this.media?.pause();
  }
  async command(command: PlayerCommand): Promise<void> {
    const media = this.media;
    if (!media || this.disposed) return;
    switch (command) {
      case "PLAY_PAUSE":
        if (!media.paused || this.playPending) this.pausePlayback();
        else this.startPlayback();
        break;
      case "STOP": this.pausePlayback(); this.seek(0); break;
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
    // The teacher already coalesces keyboard/slider input. Apply its committed
    // destination synchronously in the follower: even a zero-delay timer waited
    // behind WebKit tasks, adding measurable picture lag in the dual-view test.
    // flushSeek keeps one operation in flight and only the latest pending target.
    if (this.options?.silent) { this.flushSeek(); return; }
    // Fixed windows preserve responsiveness during held keys in the teacher.
    if (!this.seekTimer) this.seekTimer = setTimeout(() => { this.seekTimer = undefined; this.flushSeek(); }, 90);
  }
  private flushSeek(): void {
    const media = this.media;
    if (!media || this.disposed || this.seekInFlight || media.seeking || this.seekTarget === undefined) return;
    const target = this.seekTarget; this.seekTarget = undefined;
    if (Math.abs(media.currentTime - target) < 0.05) { this.notify({ seeking: false }); return; }
    try { this.seekInFlight = true; ++this.seekRevision; media.currentTime = target; this.notify({ time: target, seeking: true, seekRevision: this.seekRevision }); }
    catch { this.seekInFlight = false; this.notify({ seeking: false }); }
  }
  setVolume(volume: number): void {
    if (this.media && Number.isFinite(volume)) { this.media.volume = this.options?.silent ? 0 : Math.max(0, Math.min(1, volume)); this.notify({ volume: this.media.volume }); }
  }
  async applyPlayback(state: RendererState): Promise<void> {
    const previous = this.playback;
    const now = performance.now();
    const previousTime = previous ? previous.time + (previous.playing && !previous.seeking && !previous.buffering ? Math.max(0, now - this.playbackReceivedAt) / 1000 : 0) : state.time;
    // Clock samples must not become decoder seeks. WebKit's muted video clock
    // can lag the teacher by >350 ms: chasing that lag caused 73 seeks for 11
    // teacher seeks on Zorin, continuously flushing the projection decoder.
    // Play/resume is not a position command. Extrapolating the initial clock
    // into a 60-90 ms seek flushed an already prepared decoder on Zorin and
    // introduced a new delay at every resume. Align entry/paused positions and
    // explicit seek revisions, never the playing edge itself.
    // Remember explicit transports even when the bridge skips intermediate
    // seeking=true snapshots. Older snapshots use edges/discontinuities only.
    const explicitSeek = state.seekRevision !== undefined && (previous ? state.seekRevision !== previous.seekRevision : state.seekRevision > 0);
    if (!previous || explicitSeek ||
      (state.seekRevision === undefined && state.seeking && !previous.seeking) ||
      (!state.playing && state.time !== previous.time) ||
      (state.seekRevision === undefined && Math.abs(state.time - previousTime) > 1)) this.projectionSeekPending = true;
    this.projectionSeekExplicit ||= explicitSeek;
    this.playback = state;
    this.playbackReceivedAt = now;
    const media = this.media;
    if (!media || this.disposed || !this.options?.silent) return;
    media.muted = true; media.volume = 0;
    if (!Number.isFinite(media.duration)) return;
    // A revision is sent with the committed target, before the teacher's seek
    // finishes. Preroll both decoders in parallel: waiting for teacher seeked
    // added its latency to the audience latency (about 300 ms on physical Zorin).
    // Legacy snapshots/entry still wait for a settled target. Neither seeked
    // confirmations nor normal clock samples trigger an additional correction.
    if (this.projectionSeekPending && (this.projectionSeekExplicit || (!state.seeking && !state.buffering))) {
      this.projectionSeekPending = false;
      this.projectionSeekExplicit = false;
      if (Math.abs(media.currentTime - state.time) > 0.05) {
        mediaDiagnostic({ event: "projection-seek", kind: this.kind, time: state.time, seekRevision: state.seekRevision ?? null, drift: state.time - media.currentTime });
        this.seek(state.time);
      }
    }
    // A seek is not a transport pause. Repeated pause/play during a playing
    // teacher seek can leave WebKitGTK's muted decoder waiting indefinitely.
    // Keep it running; correct only to the settled teacher target above.
    if (!state.playing) { if (!media.paused || this.playPending) this.pausePlayback(); }
    else if (media.paused && !this.state.error) this.startPlayback();
  }
  destroy(): void {
    super.destroy(); ++this.playGeneration; this.playPending = false; clearTimeout(this.timeout); clearTimeout(this.seekTimer); clearInterval(this.diagnosticTimer);
    const media = this.media;
    if (media) {
      if (media instanceof HTMLVideoElement && this.frameCallback !== undefined) media.cancelVideoFrameCallback?.(this.frameCallback);
      for (const [name, listener] of this.listeners) media.removeEventListener(name, listener);
      const retire = () => {
        if (!media.isConnected && !media.hasAttribute("src") && !MediaRenderer.retiredVideos.has(media.ownerDocument)) MediaRenderer.retiredVideos.set(media.ownerDocument, media as HTMLVideoElement);
      };
      // load() resets DOM state synchronously, but the native decoder releases
      // its resource asynchronously. Never hand it to a new owner before the
      // browser acknowledges that teardown with emptied.
      const waitForEmpty = this.kind === "video" && media.readyState > 0;
      if (waitForEmpty) media.addEventListener("emptied", retire, { once: true });
      media.pause(); media.removeAttribute("src"); media.load(); media.remove();
      if (this.kind === "video" && !waitForEmpty) retire();
    }
    this.listeners = [];
    this.frameCallback = undefined;
    this.media = undefined; this.playback = undefined;
    this.projectionSeekPending = false;
    this.projectionSeekExplicit = false;
    this.reportFailure = undefined; this.requestPlay = undefined; this.seekTarget = undefined; this.seekInFlight = false;
  }
}
