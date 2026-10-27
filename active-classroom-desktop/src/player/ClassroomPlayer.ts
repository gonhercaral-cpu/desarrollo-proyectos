import { ClassSessionController } from "./ClassSessionController.ts";
import { ProjectionCoordinator, type ProjectionBridge } from "./projection/ProjectionCoordinator.ts";
import { localSource } from "./local-source.ts";
import { createRenderer } from "./renderers/factory.ts";
import { shortcutFor, readShortcuts, shortcutLabel, SHORTCUT_ACTIONS, type ShortcutCommand } from "./shortcuts.ts";
import { initialRendererState, rendererKind, type LocalClassroom, type LocalRenderer, type PlayerCommand, type RendererState, type RendererSource } from "./types.ts";
import { playerMarkup } from "../ui/player-view.ts";
import { icon, resourceIcon, fileDescription } from "../ui/icons.ts";
import { escapeHtml } from "../utils/dom.ts";
import { InteractionSurface } from "./InteractionSurface.ts";
import type { ResolvedLayer } from "./types.ts";
import { BackgroundMusic } from "./BackgroundMusic.ts";
import { selectUnitMusic } from "./unit-music.ts";
import { desktopSettings } from "../settings/preferences.ts";
import { animatedSource, preloadAnimationImage } from "./animated-source.ts";

export interface PlayerDependencies {
  ambientMusic?: { tracks: NonNullable<import("../offline/manifest.ts").Manifest["backgroundMusic"]>; defaultTrackIds?: string[]; prepare(id: string): Promise<RendererSource> };
  verifyResource(id: string): Promise<boolean>;
  prepareMediaSource?(id: string): Promise<RendererSource>;
  releaseMediaSource?(source: RendererSource): void;
  createRenderer?: typeof createRenderer;
  preloadAnimationImage?: typeof preloadAnimationImage;
  toUrl?: (path: string) => string;
  projectionBridge?: ProjectionBridge;
}
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const setText = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

export class ClassroomPlayer {
  private music: BackgroundMusic;
  readonly controller: ClassSessionController;
  private projection: ProjectionCoordinator;
  private source?: RendererSource;
  private surface?: InteractionSurface;
  private buildSequence = 0;
  private sourceSlide: number | null = null;
  private sourceBuild = 0;
  private verifiedSources = new Map<string, Promise<RendererSource>>();
  private root: HTMLElement;
  private classroom: LocalClassroom;
  private dependencies: PlayerDependencies;
  private onExit: () => void;
  private renderer?: LocalRenderer;
  private renderedId = "";
  private sequence = 0;
  private disposed = false;
  private state = initialRendererState();
  private animationMessage = "";
  private volume = 0.8;
  private muted = false;
  private playbackPlaying?: boolean;
  private playbackMuted?: boolean;
  // Independent audio channel: never touches the visual renderer, controller selection or projection snapshot.
  private audioRenderer?: LocalRenderer;
  // Prepared grant owned by the channel; released exactly once when the audio is replaced, closed, destroyed or obsolete.
  private audioSource?: RendererSource;
  private audioId = "";
  private audioState = initialRendererState();
  private audioSequence = 0;
  private audioReady = false;
  private audioMinimized = false;
  private audioPlayRequested = false;
  private audioPlayPending = false;
  private audioVolume = 0.8;
  private audioMuted = false;
  private audioMarkedId?: string;
  private audioPlayShown?: boolean;
  private audioMuteShown?: boolean;
  // Absolute destination of the last keyboard seek, so held keys accumulate before the renderer reports the new time.
  private audioSeekPending?: { target: number; at: number };
  // True once the teacher explicitly plays the audio while a video is open; a video that is opened or plays takes the seek back.
  private audioOverVideo = false;
  private refreshShortcuts = () => {
    const host = this.root?.querySelector(".player-shortcuts"); if (!host) return;
    const map = readShortcuts();
    host.innerHTML = '<strong>Atajos de teclado:</strong>' + (["BACK", "ADVANCE", "PLAY_PAUSE", "MUTE", "FULLSCREEN", "ESCAPE"] as ShortcutCommand[]).map(command => `<span><kbd>${escapeHtml(map[command].map(shortcutLabel).join(" / ") || "Sin asignar")}</kbd><small>${escapeHtml(SHORTCUT_ACTIONS[command].label)}</small></span>`).join("");
  };
  private keyListener = (event: KeyboardEvent) => {
    const command = shortcutFor(event, this.controller.isPresentation && !["audio", "video"].includes(this.renderer?.kind || ""), this.audioOwnsSeek());
    if (!command || (event.repeat && ["PLAY_PAUSE", "BACKGROUND_MUSIC_PLAY_PAUSE", "MUTE", "FULLSCREEN", "ESCAPE"].includes(command))) return;
    event.preventDefault(); void this.dispatch(command);
  };

  constructor(root: HTMLElement, classroom: LocalClassroom, onExit: () => void, dependencies: PlayerDependencies) {
    this.controller = new ClassSessionController(classroom.manifest);
    this.projection = new ProjectionCoordinator(() => this.updateProjection(), dependencies.projectionBridge, dependencies.projectionBridge ? true : undefined);
    this.root = root; this.classroom = classroom; this.onExit = onExit; this.dependencies = dependencies;
    this.layout();
    const music = selectUnitMusic(classroom.manifest, dependencies.ambientMusic);
    this.music = new BackgroundMusic(this.element("[data-background-music]"), music.tracks, async id => {
      if (music.global && dependencies.ambientMusic) return dependencies.ambientMusic.prepare(id);
      if (dependencies.prepareMediaSource) return dependencies.prepareMediaSource(id);
      if (!await dependencies.verifyResource(id)) throw new Error("Audio local ausente o dañado.");
      return localSource(classroom, id, dependencies.toUrl);
    }, () => !(desktopSettings().pauseBackgroundMusic && (this.audioActive() || this.state.playing && ["audio", "video"].includes(this.renderer?.kind || ""))), dependencies.releaseMediaSource);
    this.refreshShortcuts(); window.addEventListener("keydown", this.keyListener); window.addEventListener("classroom-shortcuts-changed", this.refreshShortcuts);
    this.projection.start(); void this.showResource();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private layout(): void {
    this.root.innerHTML = playerMarkup();
    this.element("[data-unit]").textContent = this.classroom.manifest.unit.name;
    this.element("[data-version]").textContent = `${this.classroom.manifest.unit.levelId} · Publicación v${this.classroom.manifest.version} · Sin servicios remotos durante la clase`;
    this.element("[data-exit]").onclick = () => this.exit();
    this.element("[data-presentation]").onclick = () => { this.controller.returnToPresentation(); void this.showResource(); };
    this.element("[data-media-retry]").onclick = () => { void this.showResource(); };
    this.element("[data-media-return]").onclick = () => { this.controller.returnToPresentation(); void this.showResource(); };
    this.element("[data-slide-previous]").onclick = () => { void this.dispatch("BACK"); };
    this.element("[data-slide-next]").onclick = () => { void this.dispatch("ADVANCE"); };
    this.element("[data-stage-previous]").onclick = () => { void this.dispatch("BACK"); };
    this.element("[data-stage-next]").onclick = () => { void this.dispatch("ADVANCE"); };
    this.element("[data-renderer]").onclick = (event) => { if (this.controller.isPresentation && !this.state.loading && !this.state.error && !(event.target as HTMLElement).closest("button, input, select, a, video, audio")) void this.dispatch("ADVANCE"); };
    this.root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => { button.onclick = () => { void this.dispatch(button.dataset.command as PlayerCommand); }; });
    this.element<HTMLInputElement>("[data-seek]").oninput = (event) => this.renderer?.seek(Number((event.target as HTMLInputElement).value));
    this.element<HTMLInputElement>("[data-volume]").oninput = (event) => this.renderer?.setVolume(Number((event.target as HTMLInputElement).value));
    for (const [selector, label] of [["[data-slides]", "Diapositivas"], ["[data-associated]", "Recursos de la diapositiva"], ["[data-general]", "Recursos generales"]]) {
      const list = this.element(selector); list.classList.add("player-scroll-list"); list.tabIndex = 0; list.setAttribute("aria-label", label);
    }
    this.element<HTMLSelectElement>("[data-monitor]").onchange = (event) => { void this.projection.select((event.target as HTMLSelectElement).value); };
    this.element("[data-project]").onclick = () => { void this.dispatch("PROJECT"); };
    this.root.querySelectorAll<HTMLButtonElement>("[data-audio-cmd]").forEach((button) => { button.onclick = () => { void this.audioControl(button.dataset.audioCmd as "PLAY_PAUSE" | "STOP" | "MUTE" | "CLOSE"); }; });
    this.element("[data-audio-toggle]").onclick = () => { this.audioMinimized = !this.audioMinimized; this.updateAudioControls(); };
    this.element<HTMLInputElement>("[data-audio-seek]").oninput = (event) => { if (this.audioReady) { this.audioSeekPending = undefined; this.audioRenderer?.seek(Number((event.target as HTMLInputElement).value)); } };
    this.element<HTMLInputElement>("[data-audio-volume]").oninput = (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      this.audioVolume = Math.max(0, Math.min(1, value));
      if (this.audioReady) this.audioRenderer?.setVolume(this.audioVolume); else this.updateAudioControls();
    };
    this.updateProjection(); this.updateLists(); this.updateState(); this.updateAudioControls();
  }
  private updateProjection(): void {
    if (this.disposed) return;
    const projection = this.projection;
    const select = this.element<HTMLSelectElement>("[data-monitor]"); select.replaceChildren();
    for (const monitor of projection.monitors) {
      const option = document.createElement("option"); option.value = monitor.id;
      option.textContent = `${monitor.name} · ${monitor.primary ? "Principal" : "Secundario"} · ${monitor.width}×${monitor.height} · (${monitor.x}, ${monitor.y})`;
      select.append(option);
    }
    select.value = projection.selected?.id || ""; select.disabled = projection.monitors.length < 2;
    this.element("[data-projector-status]").textContent = projection.message + (projection.projecting ? " · Proyectando" : "");
    const connection = this.element("[data-projector-connected]");
    connection.innerHTML = `${icon(projection.monitors.length > 1 ? "check" : "projector")}<span>${projection.monitors.length > 1 ? "Segunda pantalla conectada" : "Segunda pantalla desconectada"}</span>`;
    connection.classList.toggle("is-connected", projection.monitors.length > 1);
    const button = this.element<HTMLButtonElement>("[data-project]"); button.disabled = projection.monitors.length < 2;
    button.innerHTML = `${icon("projector")}<span>${projection.projecting ? "Detener proyección" : projection.message.includes("Restaurar") ? "Restaurar proyección" : "Proyectar"}</span>`;
    this.controller.projector = { projecting: projection.projecting, connected: projection.monitors.length > 1, message: projection.message };
    this.updateState();
  }
  private updateLists(): void {
    const positions = ["[data-slides]", "[data-associated]", "[data-general]"].map(selector => [selector, this.element(selector).scrollTop] as const);
    const slides = this.element("[data-slides]"); slides.replaceChildren();
    this.classroom.manifest.slides.forEach((slide, index) => {
      const button = document.createElement("button"); button.className = "button player-list-button";
      button.textContent = `${index + 1}. ${slide.title || `Diapositiva ${index + 1}`}`;
      button.setAttribute("aria-current", String(index === this.controller.slideIndex));
      button.onclick = () => { this.controller.goSlide(index); void this.showResource(); };
      slides.append(button);
    });
    for (const [selector, ids] of [["[data-associated]", this.controller.associatedIds], ["[data-general]", this.classroom.manifest.generalResourceIds]] as const) {
      const list = this.element(selector); list.replaceChildren();
      if (!ids.length) { const empty = document.createElement("p"); empty.textContent = "Sin recursos asociados."; list.append(empty); }
      for (const id of ids) {
        const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id);
        const button = document.createElement("button"); button.className = "button player-list-button"; button.dataset.resource = id;
        const name = resource?.name || "Recurso ausente";
        const kind = resourceIcon(resource?.download.mimeType);
        button.innerHTML = `<span class="resource-type-icon is-${kind}">${icon(kind)}</span><span class="resource-label"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(resource ? fileDescription(name, resource.download.mimeType, resource.download.sizeBytes) : "No disponible")}</small></span>`;
        button.title = name; button.disabled = !resource;
        button.setAttribute("aria-pressed", String(id === this.controller.selectedResourceId || id === this.audioId));
        button.onclick = () => { void this.openResource(id); };
        const row = document.createElement("div"); row.className = "player-resource-row";
        const menu = document.createElement("details"); menu.className = "resource-action";
        menu.innerHTML = `<summary aria-label="Acciones de ${escapeHtml(name)}">${icon("more")}</summary><button type="button" ${!resource ? "disabled" : ""}>${icon("play")}Abrir recurso</button>`;
        menu.querySelector("button")!.onclick = () => { button.click(); };
        row.append(button, menu); list.append(row);
      }
    }
    for (const [selector, position] of positions) this.element(selector).scrollTop = position;
    this.updateState();
  }
  private updateState(): void {
    if (this.disposed) return;
    const controller = this.controller;
    const count = this.classroom.manifest.slides.length;
    const position = `${controller.slideIndex === null ? "—" : controller.slideIndex + 1} / ${count}`;
    for (const selector of ["[data-counter]", "[data-stage-counter]", "[data-slide-count]"]) this.element(selector).textContent = position;
    this.element("[data-associated-count]").textContent = `${controller.associatedIds.length} archivos`;
    this.element("[data-general-count]").textContent = `${this.classroom.manifest.generalResourceIds.length} archivos`;
    const buildIndicator = this.element("[data-build]"); buildIndicator.hidden = !controller.isPresentation || !controller.buildCount;
    buildIndicator.textContent = `Paso ${controller.currentBuild} / ${controller.buildCount}`;
    this.element("[data-view-title]").hidden = controller.isPresentation;
    this.element(".player-stage").dataset.mediaKind = this.renderer?.kind || "";
    this.element("[data-position]").textContent = `${controller.slideIndex === null ? "Página sin diapositiva asociada" : `Diapositiva ${controller.slideIndex + 1} / ${count}`}${this.renderer?.kind === "pdf" ? ` · PDF ${this.state.page} / ${this.state.pages || "…"}` : ""}`;
    this.element<HTMLButtonElement>("[data-slide-previous]").disabled = controller.slideIndex === 0 && controller.currentBuild === 0;
    this.element<HTMLButtonElement>("[data-slide-next]").disabled = controller.slideIndex === count - 1 && controller.currentBuild === controller.buildCount;
    this.element<HTMLButtonElement>("[data-stage-previous]").disabled = controller.slideIndex === 0 && controller.currentBuild === 0;
    this.element<HTMLButtonElement>("[data-stage-next]").disabled = controller.slideIndex === count - 1 && controller.currentBuild === controller.buildCount;
    this.element("[data-stage-previous]").hidden = !controller.isPresentation;
    this.element("[data-stage-next]").hidden = !controller.isPresentation;
    this.element("[data-progress-thumb]").style.left = `${controller.slideIndex === null ? 0 : 100 * (controller.slideIndex + 1) / count}%`;
    this.element<HTMLProgressElement>("[data-slide-progress]").max = count;
    this.element<HTMLProgressElement>("[data-slide-progress]").value = controller.slideIndex === null ? 0 : controller.slideIndex + 1;
    this.element("[data-presentation]").hidden = controller.isPresentation;
    this.element("[data-notes]").textContent = controller.slideIndex === null ? "" : String(this.classroom.manifest.slides[controller.slideIndex].metadata.notes || "Sin notas.");
    this.updatePlaybackState();
  }
  private updatePlaybackState(): void {
    if (this.disposed) return;
    const controller = this.controller;
    const status = this.element("[data-status]"); const message = this.state.error || (this.state.loading ? this.renderer?.kind === "video" ? "Preparando video…" : "Abriendo archivo local…" : this.state.buffering ? "Cargando…" : this.animationMessage); if (status.textContent !== message) status.textContent = message; if (status.hidden !== !message) status.hidden = !message;
    status.setAttribute("role", this.state.error ? "alert" : "status");
    this.element("[data-media-error-actions]").hidden = !this.state.error;
    if (this.state.error && this.renderer?.kind === "video") status.textContent = `No se pudo reproducir este video. ${this.state.error}`;
    const media = this.renderer?.kind === "audio" || this.renderer?.kind === "video";
    if (this.element("[data-media]").hidden !== !media) this.element("[data-media]").hidden = !media;
    if (this.playbackPlaying !== this.state.playing) { this.playbackPlaying = this.state.playing; this.element("[data-command='PLAY_PAUSE']").innerHTML = `${icon(this.state.playing ? "pause" : "play")}${this.state.playing ? "Pausar" : "Reproducir"}`; }
    this.element<HTMLButtonElement>("[data-command='PLAY_PAUSE']").disabled = this.state.loading;
    const time = `${timeLabel(this.state.time)} / ${timeLabel(this.state.duration)}`; if (this.element("[data-time]").textContent !== time) this.element("[data-time]").textContent = time;
    const seek = this.element<HTMLInputElement>("[data-seek]"); seek.max = String(this.state.duration); seek.value = String(this.state.time); seek.disabled = !this.state.duration;
    this.element<HTMLInputElement>("[data-volume]").value = String(this.volume);
    this.element("[data-command='MUTE']").setAttribute("aria-pressed", String(this.muted));
    if (this.playbackMuted !== this.muted) { this.playbackMuted = this.muted; this.element("[data-command='MUTE']").innerHTML = `${icon(this.muted ? "mute" : "volume")}${this.muted ? "Activar sonido" : "Silenciar"}`; }
    controller.record({ ...this.state, volume: this.volume, muted: this.muted }, this.source);
    if (!this.source || !controller.isPresentation || this.state.error || (this.sourceSlide === controller.slideIndex && this.sourceBuild === controller.currentBuild)) this.projection.update(controller.snapshot());
  }
  private async showResource(): Promise<void> {
    if (this.disposed) return;
    const id = this.controller.selectedResourceId;
    const previousSource = this.source;
    if (this.renderedId !== id) this.source = undefined;
    this.updateLists();
    if (this.renderedId === id && this.renderer && !this.state.error) {
      try { await this.renderer.setPage(this.controller.page); await this.showBuild(); } catch { this.state.error = "No se pudo abrir esta página o paso local."; this.updateState(); }
      return;
    }
    const sequence = ++this.sequence;
    this.animationMessage = "";
    ++this.buildSequence; this.surface?.destroy(); this.surface = undefined;
    this.renderer?.destroy(); this.renderer = undefined; this.renderedId = "";
    if (previousSource) this.dependencies.releaseMediaSource?.(previousSource);
    this.source = undefined;
    this.state = { ...initialRendererState(), loading: true };
    const host = document.createElement("div"); host.className = "player-renderer-content";
    this.element("[data-renderer]").replaceChildren(host);
    const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id)!;
    this.element("[data-resource-name]").textContent = resource.name;
    this.updateState();
    let prepared: RendererSource | undefined;
    let installed = false;
    try {
      const isMedia = ["audio", "video"].includes(rendererKind(resource.download.mimeType));
      prepared = isMedia && this.dependencies.prepareMediaSource ? await this.dependencies.prepareMediaSource(id) : undefined;
      if (!prepared && !await this.dependencies.verifyResource(id)) throw new Error("Archivo local ausente o corrupto. Vuelve a Biblioteca para sincronizarlo de nuevo.");
      if (sequence !== this.sequence || this.disposed) { if (prepared) this.dependencies.releaseMediaSource?.(prepared); return; }
      const source = prepared || localSource(this.classroom, id, this.dependencies.toUrl);
      const renderer = await (this.dependencies.createRenderer || createRenderer)(rendererKind(source.mimeType));
      if (sequence !== this.sequence || this.disposed) { renderer.destroy(); if (prepared) this.dependencies.releaseMediaSource?.(prepared); return; }
      this.renderer = renderer; this.renderedId = id;
      this.source = source;
      installed = true; this.updateState();
      await renderer.mount(host, source, {
        page: this.controller.page, volume: this.volume, muted: this.muted,
        onState: (state: RendererState) => {
          if (sequence !== this.sequence || this.disposed) return;
          const started = state.playing && !this.state.playing;
          this.state = state;
          if (state.playing && desktopSettings().pauseBackgroundMusic && ["audio", "video"].includes(renderer.kind)) this.music.pause("class-media");
          if (renderer.kind === "audio" || renderer.kind === "video") { this.volume = state.volume; this.muted = state.muted; }
          if (["audio", "video"].includes(renderer.kind)) this.updatePlaybackState(); else this.updateState();
          // A video whose play() resolved late still wins over the audio channel.
          if (started && renderer.kind === "video") { this.audioOverVideo = false; void this.pauseAudio(); }
        },
        onPage: (page: number) => { if (sequence === this.sequence && !this.disposed) { this.controller.pageChanged(page); this.updateLists(); } },
      });
      if (sequence !== this.sequence || this.disposed) return;
      if (this.controller.isPresentation) await this.showBuild();
    } catch (error) {
      if (sequence !== this.sequence || this.disposed) { if (prepared && !installed) this.dependencies.releaseMediaSource?.(prepared); return; }
      this.renderer?.destroy(); this.renderer = undefined; this.renderedId = "";
      if (this.source || prepared) this.dependencies.releaseMediaSource?.(this.source || prepared!); this.source = undefined;
      this.state = { ...initialRendererState(), error: error instanceof Error ? error.message : "No se pudo abrir el recurso local." }; this.updateState();
    }
  }
  // Single route for every resource button: audio goes to the independent channel, the rest to the visual stage.
  private openResource(id: string): Promise<void> {
    const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id);
    const kind = resource ? rendererKind(resource.download.mimeType) : "unsupported";
    if (kind === "audio") return this.openAudio(id);
    this.controller.selectResource(id);
    if (kind === "video") { this.audioOverVideo = false; void this.pauseAudio(); }
    return this.showResource();
  }
  private async openAudio(id: string): Promise<void> {
    if (this.disposed) return;
    this.audioMinimized = false;
    if (id === this.audioId && !this.audioState.error) { this.updateAudioControls(); return; }
    const sequence = ++this.audioSequence;
    this.discardAudio();
    this.audioId = id;
    this.audioState = { ...initialRendererState(), loading: true, volume: this.audioVolume, muted: this.audioMuted };
    this.element("[data-audio-host]").replaceChildren();
    this.updateAudioControls();
    let prepared: RendererSource | undefined;
    let owned = false;
    try {
      prepared = this.dependencies.prepareMediaSource ? await this.dependencies.prepareMediaSource(id) : undefined;
      if (!prepared && !await this.dependencies.verifyResource(id)) throw new Error("Audio local ausente o corrupto. Vuelve a Biblioteca para sincronizarlo de nuevo.");
      if (sequence !== this.audioSequence || this.disposed) { if (prepared) this.dependencies.releaseMediaSource?.(prepared); return; }
      // From here on, whoever replaces, closes or destroys the channel releases the grant.
      this.audioSource = prepared; owned = !!prepared;
      const source = prepared || localSource(this.classroom, id, this.dependencies.toUrl);
      const renderer = await (this.dependencies.createRenderer || createRenderer)(rendererKind(source.mimeType));
      if (sequence !== this.audioSequence || this.disposed) { renderer.destroy(); return; }
      this.audioRenderer = renderer;
      await renderer.mount(this.element("[data-audio-host]"), source, {
        page: 1, volume: this.audioVolume, muted: this.audioMuted,
        onState: (state: RendererState) => {
          if (sequence !== this.audioSequence || this.disposed) return;
          const wasPlaying = this.audioState.playing, started = state.playing && !wasPlaying;
          this.audioState = state; this.audioVolume = state.volume; this.audioMuted = state.muted;
          if (!state.seeking) this.audioSeekPending = undefined;
          // A pause, the end of the track or an error cancels the intent, so the ambient music is never blocked forever.
          if (state.error || (wasPlaying && !state.playing)) this.audioPlayRequested = false;
          if (state.playing && this.audioPlayRequested) this.pauseAmbient();
          this.updateAudioControls();
          if (!started) return;
          if (!this.audioPlayRequested) void this.pauseAudio(); else this.pauseVideo();
        },
        onPage: () => {},
      });
      if (sequence !== this.audioSequence || this.disposed) return;
      this.audioReady = true; this.updateAudioControls();
    } catch (error) {
      if (prepared && !owned) this.dependencies.releaseMediaSource?.(prepared);
      if (sequence !== this.audioSequence || this.disposed) return;
      this.discardAudio();
      this.audioState = { ...initialRendererState(), volume: this.audioVolume, muted: this.audioMuted, error: error instanceof Error ? error.message : "No se pudo abrir el audio local." };
      this.updateAudioControls();
    }
  }
  // Stops the channel without touching the sequence: the renderer goes first, then its grant is returned once.
  private discardAudio(): void {
    this.audioRenderer?.destroy(); this.audioRenderer = undefined; this.audioReady = false; this.audioPlayRequested = false; this.audioPlayPending = false; this.audioSeekPending = undefined; this.audioOverVideo = false;
    const source = this.audioSource; this.audioSource = undefined;
    if (source) this.dependencies.releaseMediaSource?.(source);
  }
  private audioActive(): boolean { return !!this.audioRenderer && (this.audioPlayRequested || this.audioState.playing); }
  // Only pauses: the ambient music is never resumed automatically, and the mix stays when the setting is off.
  private pauseAmbient(): void { if (desktopSettings().pauseBackgroundMusic) this.music?.pause("class-media"); }
  private async audioCommand(command: PlayerCommand): Promise<void> {
    const renderer = this.audioRenderer, sequence = this.audioSequence;
    if (!renderer || !this.audioReady || this.disposed) return;
    try { await renderer.command(command); }
    catch { if (sequence === this.audioSequence && !this.disposed) { this.audioPlayRequested = false; this.audioState = { ...this.audioState, error: "Este control de audio no está disponible." }; this.updateAudioControls(); } }
  }
  private async audioControl(command: "PLAY_PAUSE" | "STOP" | "MUTE" | "CLOSE"): Promise<void> {
    if (this.disposed) return;
    if (command === "CLOSE") {
      ++this.audioSequence; this.discardAudio();
      this.audioId = ""; this.audioState = initialRendererState(); this.element("[data-audio-host]").replaceChildren();
      this.updateAudioControls(); return;
    }
    if (!this.audioReady || this.audioState.loading || this.audioState.error) return;
    if (command === "PLAY_PAUSE") {
      if (this.audioPlayPending) return;
      // PLAY_PAUSE is a toggle: only send it when the reported state differs from the wanted one.
      if (this.audioState.playing) { this.audioPlayRequested = false; await this.audioCommand("PLAY_PAUSE"); return; }
      const sequence = this.audioSequence;
      this.audioPlayPending = true; this.audioPlayRequested = true; this.audioOverVideo = true; this.pauseVideo(); this.pauseAmbient(); this.updateAudioControls();
      try { await this.audioCommand("PLAY_PAUSE"); }
      finally { if (sequence === this.audioSequence && !this.disposed) { this.audioPlayPending = false; this.updateAudioControls(); } }
      return;
    }
    if (command === "STOP") this.audioPlayRequested = false;
    await this.audioCommand(command);
  }
  // The independent audio can take a keyboard seek only when it is loaded and usable.
  private audioSeekReady(): boolean {
    const state = this.audioState;
    return !this.disposed && !!this.audioRenderer && this.audioReady && !state.loading && !state.error && Number.isFinite(state.duration) && state.duration > 0;
  }
  // Presentation, PDF or image: the audio owns the seek. An open video keeps it unless the audio was explicitly played over it.
  private audioOwnsSeek(): boolean { return this.audioSeekReady() && (this.renderer?.kind !== "video" || this.audioOverVideo); }
  // Relative seek by the audio's own interval; never changes play/pause, slide, build or projection. Destination is clamped to 0..duration.
  private audioSeek(command: "SEEK_FORWARD" | "SEEK_BACKWARD"): void {
    const renderer = this.audioRenderer, sequence = this.audioSequence;
    if (!renderer || !this.audioSeekReady()) return;
    const settings = desktopSettings(), pending = this.audioSeekPending;
    const base = pending && performance.now() - pending.at < 1000 ? pending.target : this.audioState.time;
    const target = Math.max(0, Math.min(this.audioState.duration, base + (command === "SEEK_FORWARD" ? settings.audioSeekForwardSeconds : -settings.audioSeekBackwardSeconds)));
    this.audioSeekPending = { target, at: performance.now() };
    try { renderer.seek(target); }
    catch { if (sequence === this.audioSequence && !this.disposed) { this.audioSeekPending = undefined; this.audioState = { ...this.audioState, error: "Este control de audio no está disponible." }; this.updateAudioControls(); } }
  }
  private async pauseAudio(): Promise<void> {
    this.audioPlayRequested = false;
    if (this.audioState.playing) await this.audioCommand("PLAY_PAUSE");
  }
  private pauseVideo(): void {
    const renderer = this.renderer;
    if (renderer?.kind !== "video" || !this.state.playing) return;
    try { void Promise.resolve(renderer.command("PLAY_PAUSE")).catch(() => {}); } catch { /* The video stays as it was. */ }
  }
  private updateAudioControls(): void {
    if (this.disposed) return;
    const dock = this.element("[data-audio-dock]");
    if (dock.hidden !== !this.audioId) dock.hidden = !this.audioId;
    // Mark the open audio in the lists without rebuilding them, so no visual/projection update is triggered.
    if (this.audioMarkedId !== this.audioId) {
      this.audioMarkedId = this.audioId;
      this.root.querySelectorAll<HTMLButtonElement>("[data-resource]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.resource === this.controller.selectedResourceId || (!!this.audioId && button.dataset.resource === this.audioId))));
    }
    if (!this.audioId) return;
    const state = this.audioState, usable = this.audioReady && !state.loading && !state.error;
    setText(this.element("[data-audio-title]"), this.classroom.manifest.resources.find((item) => item.resourceId === this.audioId)?.name || "Audio");
    const status = this.element("[data-audio-status]"), message = state.error || (state.loading ? "Abriendo audio local…" : state.buffering ? "Cargando…" : "");
    setText(status, message); if (status.hidden !== !message) status.hidden = !message;
    status.setAttribute("role", state.error ? "alert" : "status");
    dock.classList.toggle("is-minimized", this.audioMinimized);
    this.element("[data-audio-body]").hidden = this.audioMinimized;
    const toggle = this.element("[data-audio-toggle]"); toggle.setAttribute("aria-expanded", String(!this.audioMinimized));
    setText(toggle, this.audioMinimized ? "Restaurar" : "Minimizar");
    const play = this.element<HTMLButtonElement>("[data-audio-cmd='PLAY_PAUSE']");
    if (this.audioPlayShown !== state.playing) { this.audioPlayShown = state.playing; play.innerHTML = `${icon(state.playing ? "pause" : "play")}${state.playing ? "Pausar" : "Reproducir"}`; }
    play.disabled = !usable || this.audioPlayPending;
    this.element<HTMLButtonElement>("[data-audio-cmd='STOP']").disabled = !usable;
    setText(this.element("[data-audio-time]"), `${timeLabel(state.time)} / ${timeLabel(state.duration)}`);
    const seek = this.element<HTMLInputElement>("[data-audio-seek]"); seek.max = String(state.duration); seek.value = String(state.time); seek.disabled = !usable || !state.duration;
    this.element<HTMLInputElement>("[data-audio-volume]").value = String(this.audioVolume);
    const mute = this.element<HTMLButtonElement>("[data-audio-cmd='MUTE']");
    mute.disabled = !usable; mute.setAttribute("aria-pressed", String(this.audioMuted));
    if (this.audioMuteShown !== this.audioMuted) { this.audioMuteShown = this.audioMuted; mute.innerHTML = `${icon(this.audioMuted ? "mute" : "volume")}${this.audioMuted ? "Activar sonido" : "Silenciar"}`; }
  }
  private async buildSource(id: string): Promise<RendererSource> {
    if (!this.verifiedSources.has(id)) {
      const prepared = this.dependencies.verifyResource(id).then(valid => { if (!valid) throw new Error("Asset del revelado ausente o dañado. Sincroniza la Unit de nuevo."); return localSource(this.classroom, id, this.dependencies.toUrl); });
      this.verifiedSources.set(id, prepared);
      void prepared.catch(() => this.verifiedSources.delete(id));
    }
    return this.verifiedSources.get(id)!;
  }
  private async showBuild(): Promise<void> {
    if (!this.controller.isPresentation || this.controller.slideIndex === null || !this.renderer) return;
    const generation = ++this.buildSequence;
    const slide = this.classroom.manifest.slides[this.controller.slideIndex];
    if (!this.controller.buildCount) {
      if (this.renderer.kind === "image") {
        const base = localSource(this.classroom, this.controller.presentationId, this.dependencies.toUrl);
        const source = await animatedSource(this.classroom, this.controller.presentationId, base, id => this.buildSource(id), this.dependencies.preloadAnimationImage);
        if (generation !== this.buildSequence || this.disposed) return;
        this.animationMessage = source === base && this.classroom.manifest.resources.find(resource => resource.resourceId === this.controller.presentationId)?.animation ? "Animación no disponible; se muestra imagen estática." : "";
        if (this.source && this.source.url !== source.url) await this.renderer.setSource?.(source);
        if (generation !== this.buildSequence || this.disposed) return;
        this.source = source;
        if (source.layers?.length) { this.surface ||= new InteractionSurface(this.element(".player-renderer-content")); this.surface.update(source.layers); }
        else { this.surface?.destroy(); this.surface = undefined; }
      } else {
        this.surface?.destroy(); this.surface = undefined;
        if (this.source) this.source = { ...this.source, layers: undefined };
      }
      this.sourceSlide = this.controller.slideIndex; this.sourceBuild = 0; this.updateState(); return;
    }
    if (!this.surface) this.surface = new InteractionSurface(this.element(".player-renderer-content"));
    const current = this.controller.currentBuild;
    // Verify and preload the complete sequence once, so clicking never fetches remote content.
    const ids = [...new Set((slide.builds || []).flatMap(step => [step.resourceId, ...(step.layers || []).map(layer => layer.resourceId)].filter((id): id is string => !!id)))];
    await Promise.all(ids.map(id => this.buildSource(id)));
    if (generation !== this.buildSequence || this.disposed) return;
    const raster = current ? slide.builds?.[current - 1]?.resourceId : undefined;
    const base = await this.buildSource(raster || this.controller.presentationId);
    const source = raster ? base : await animatedSource(this.classroom, this.controller.presentationId, base, id => this.buildSource(id), this.dependencies.preloadAnimationImage);
    const layers: ResolvedLayer[] = [...(source.layers || [])];
    for (const step of (slide.builds || []).slice(0, current)) for (const layer of step.layers || []) layers.push({ ...layer, ...(layer.resourceId ? { url: (await this.buildSource(layer.resourceId)).url } : {}) });
    if (generation !== this.buildSequence || this.disposed) return;
    if (this.renderer.kind === "image") await this.renderer.setSource?.(source);
    if (generation !== this.buildSequence || this.disposed) return;
    this.source = { ...source, layers }; this.sourceSlide = this.controller.slideIndex; this.sourceBuild = current; this.surface.update(layers); this.updateState();
  }
  private navigate(direction: number): void { if (!this.controller.isPresentation) this.controller.moveSlide(direction); else if (direction > 0) this.controller.advance(); else this.controller.back(); void this.showResource(); }
  async dispatch(command: ShortcutCommand): Promise<void> {
    if (this.disposed) return;
    if (command === "BACKGROUND_MUSIC_PLAY_PAUSE") { await this.music.toggle(); return; }
    if (command === "BACKGROUND_MUSIC_NEXT") { await this.music.move(1); return; }
    if (command === "BACKGROUND_MUSIC_PREVIOUS") { await this.music.move(-1); return; }
    if (command === "PROJECT") { await this.projection.toggle(); return; }
    // One action per event: either the audio or the visual renderer handles the seek, never both.
    if ((command === "SEEK_FORWARD" || command === "SEEK_BACKWARD") && this.audioOwnsSeek()) { this.audioSeek(command); return; }
    if (command === "OPEN_RESOURCE") { const id = this.classroom.manifest.slides[this.controller.slideIndex ?? 0]?.resourceIds[0]; if (id) await this.openResource(id); return; }
    if (this.disposed) return;
    try {
      if (command === "ESCAPE") {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (!this.controller.isPresentation) { this.controller.returnToPresentation(); await this.showResource(); }
        else this.exit();
      } else if (command === "FULLSCREEN") {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await this.element(".classroom-player").requestFullscreen();
      } else if (["ADVANCE", "BACK"].includes(command) || ["NEXT", "PREVIOUS"].includes(command) && this.controller.isPresentation) this.navigate(["ADVANCE", "NEXT"].includes(command) ? 1 : -1);
      else if (command === "PLAY_PAUSE" && this.controller.isPresentation && !["audio", "video"].includes(this.renderer?.kind || "")) this.navigate(1);
      else await this.renderer?.command(command);
    } catch { if (!this.disposed) { this.state.error = "Este control no está disponible en este equipo o archivo."; this.updateState(); } }
  }
  private exit(): void { this.destroy(); this.onExit(); }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.music.destroy(); ++this.sequence; ++this.audioSequence;
    this.discardAudio();
    ++this.buildSequence; this.surface?.destroy(); this.verifiedSources.clear();
    this.projection.destroy();
    if (this.source) this.dependencies.releaseMediaSource?.(this.source); this.source = undefined;
    window.removeEventListener("keydown", this.keyListener); window.removeEventListener("classroom-shortcuts-changed", this.refreshShortcuts); this.renderer?.destroy(); this.renderer = undefined;
    if (document.fullscreenElement && this.root.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
    this.root.replaceChildren();
  }
}
