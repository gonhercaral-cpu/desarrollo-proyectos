import { ClassSessionController } from "./ClassSessionController.ts";
import { ProjectionCoordinator, type ProjectionBridge } from "./projection/ProjectionCoordinator.ts";
import { localSource } from "./local-source.ts";
import { createRenderer } from "./renderers/factory.ts";
import { shortcutFor } from "./shortcuts.ts";
import { initialRendererState, rendererKind, type LocalClassroom, type LocalRenderer, type PlayerCommand, type RendererState, type RendererSource } from "./types.ts";
import { playerMarkup } from "../ui/player-view.ts";
import { icon, resourceIcon, fileDescription } from "../ui/icons.ts";
import { escapeHtml } from "../utils/dom.ts";
import { InteractionSurface } from "./InteractionSurface.ts";
import type { ResolvedLayer } from "./types.ts";
import { animatedSource, preloadAnimationImage } from "./animated-source.ts";

export interface PlayerDependencies {
  verifyResource(id: string): Promise<boolean>;
  prepareMediaSource?(id: string): Promise<RendererSource>;
  createRenderer?: typeof createRenderer;
  preloadAnimationImage?: typeof preloadAnimationImage;
  toUrl?: (path: string) => string;
  projectionBridge?: ProjectionBridge;
}
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export class ClassroomPlayer {
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
  // Independent audio channel: never touches the visual renderer, controller selection or projection snapshot.
  private audioRenderer?: LocalRenderer;
  private audioId = "";
  private audioState = initialRendererState();
  private audioSequence = 0;
  private audioReady = false;
  private audioMinimized = false;
  private audioPlayRequested = false;
  private audioVolume = 0.8;
  private audioMuted = false;
  private keyListener = (event: KeyboardEvent) => {
    const command = shortcutFor(event, this.controller.isPresentation && !["audio", "video"].includes(this.renderer?.kind || ""));
    if (!command || (event.repeat && ["PLAY_PAUSE", "MUTE", "FULLSCREEN", "ESCAPE"].includes(command))) return;
    event.preventDefault(); void this.dispatch(command);
  };

  constructor(root: HTMLElement, classroom: LocalClassroom, onExit: () => void, dependencies: PlayerDependencies) {
    this.controller = new ClassSessionController(classroom.manifest);
    this.projection = new ProjectionCoordinator(() => this.updateProjection(), dependencies.projectionBridge, dependencies.projectionBridge ? true : undefined);
    this.root = root; this.classroom = classroom; this.onExit = onExit; this.dependencies = dependencies;
    this.layout(); window.addEventListener("keydown", this.keyListener);
    this.projection.start(); void this.showResource();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private layout(): void {
    this.root.innerHTML = playerMarkup();
    this.element("[data-unit]").textContent = this.classroom.manifest.unit.name;
    this.element("[data-version]").textContent = `${this.classroom.manifest.unit.levelId} · Publicación v${this.classroom.manifest.version} · Sin servicios remotos durante la clase`;
    this.element("[data-exit]").onclick = () => this.exit();
    this.element("[data-presentation]").onclick = () => { this.controller.returnToPresentation(); void this.showResource(); };
    this.element("[data-slide-previous]").onclick = () => this.navigate(-1);
    this.element("[data-slide-next]").onclick = () => this.navigate(1);
    this.element("[data-stage-previous]").onclick = () => this.navigate(-1);
    this.element("[data-stage-next]").onclick = () => this.navigate(1);
    this.element("[data-renderer]").onclick = (event) => { if (this.controller.isPresentation && !this.state.loading && !this.state.error && !(event.target as HTMLElement).closest("button, input, select, a, video, audio")) void this.dispatch("ADVANCE"); };
    this.root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => { button.onclick = () => { void this.dispatch(button.dataset.command as PlayerCommand); }; });
    this.element<HTMLInputElement>("[data-seek]").oninput = (event) => this.renderer?.seek(Number((event.target as HTMLInputElement).value));
    this.element<HTMLInputElement>("[data-volume]").oninput = (event) => this.renderer?.setVolume(Number((event.target as HTMLInputElement).value));
    for (const [selector, label] of [["[data-slides]", "Diapositivas"], ["[data-associated]", "Recursos de la diapositiva"], ["[data-general]", "Recursos generales"]]) {
      const list = this.element(selector); list.classList.add("player-scroll-list"); list.tabIndex = 0; list.setAttribute("aria-label", label);
    }
    this.element<HTMLSelectElement>("[data-monitor]").onchange = (event) => { void this.projection.select((event.target as HTMLSelectElement).value); };
    this.element("[data-project]").onclick = () => { void this.projection.toggle(); };
    this.root.querySelectorAll<HTMLButtonElement>("[data-audio-cmd]").forEach((button) => { button.onclick = () => { void this.audioControl(button.dataset.audioCmd as "PLAY_PAUSE" | "STOP" | "MUTE" | "CLOSE"); }; });
    this.element("[data-audio-toggle]").onclick = () => { this.audioMinimized = !this.audioMinimized; this.updateAudioControls(); };
    this.element<HTMLInputElement>("[data-audio-seek]").oninput = (event) => { if (this.audioReady) this.audioRenderer?.seek(Number((event.target as HTMLInputElement).value)); };
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
    const status = this.element("[data-status]"); status.textContent = this.state.error || (this.state.loading ? "Abriendo archivo local…" : this.animationMessage); status.hidden = !status.textContent;
    status.setAttribute("role", this.state.error ? "alert" : "status");
    const media = this.renderer?.kind === "audio" || this.renderer?.kind === "video";
    this.element("[data-media]").hidden = !media;
    this.element("[data-command='PLAY_PAUSE']").innerHTML = `${icon(this.state.playing ? "pause" : "play")}${this.state.playing ? "Pausar" : "Reproducir"}`;
    this.element("[data-time]").textContent = `${timeLabel(this.state.time)} / ${timeLabel(this.state.duration)}`;
    const seek = this.element<HTMLInputElement>("[data-seek]"); seek.max = String(this.state.duration); seek.value = String(this.state.time); seek.disabled = !this.state.duration;
    this.element<HTMLInputElement>("[data-volume]").value = String(this.volume);
    this.element("[data-command='MUTE']").setAttribute("aria-pressed", String(this.muted));
    this.element("[data-command='MUTE']").innerHTML = `${icon(this.muted ? "mute" : "volume")}${this.muted ? "Activar sonido" : "Silenciar"}`;
    this.element("[data-notes]").textContent = controller.slideIndex === null ? "" : String(this.classroom.manifest.slides[controller.slideIndex].metadata.notes || "Sin notas.");
    controller.record({ ...this.state, volume: this.volume, muted: this.muted }, this.source);
    if (!this.source || !controller.isPresentation || this.state.error || (this.sourceSlide === controller.slideIndex && this.sourceBuild === controller.currentBuild)) this.projection.update(controller.snapshot());
  }
  private async showResource(): Promise<void> {
    if (this.disposed) return;
    const id = this.controller.selectedResourceId;
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
    this.source = undefined;
    this.state = { ...initialRendererState(), loading: true };
    const host = document.createElement("div"); host.className = "player-renderer-content";
    this.element("[data-renderer]").replaceChildren(host);
    const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id)!;
    this.element("[data-resource-name]").textContent = resource.name;
    this.updateState();
    try {
      const isMedia = ["audio", "video"].includes(rendererKind(resource.download.mimeType));
      const prepared = isMedia && this.dependencies.prepareMediaSource ? await this.dependencies.prepareMediaSource(id) : undefined;
      if (!prepared && !await this.dependencies.verifyResource(id)) throw new Error("Archivo local ausente o corrupto. Vuelve a Biblioteca para sincronizarlo de nuevo.");
      if (sequence !== this.sequence || this.disposed) return;
      const source = prepared || localSource(this.classroom, id, this.dependencies.toUrl);
      const renderer = await (this.dependencies.createRenderer || createRenderer)(rendererKind(source.mimeType));
      if (sequence !== this.sequence || this.disposed) { renderer.destroy(); return; }
      this.renderer = renderer; this.renderedId = id;
      this.source = source;
      await renderer.mount(host, source, {
        page: this.controller.page, volume: this.volume, muted: this.muted,
        onState: (state: RendererState) => {
          if (sequence !== this.sequence || this.disposed) return;
          const started = state.playing && !this.state.playing;
          this.state = state;
          if (renderer.kind === "audio" || renderer.kind === "video") { this.volume = state.volume; this.muted = state.muted; }
          this.updateState();
          // A video whose play() resolved late still wins over the audio channel.
          if (started && renderer.kind === "video") void this.pauseAudio();
        },
        onPage: (page: number) => { if (sequence === this.sequence && !this.disposed) { this.controller.pageChanged(page); this.updateLists(); } },
      });
      if (sequence !== this.sequence || this.disposed) return;
      if (this.controller.isPresentation) await this.showBuild();
    } catch (error) {
      if (sequence !== this.sequence || this.disposed) return;
      this.renderer?.destroy(); this.renderer = undefined; this.renderedId = "";
      this.state = { ...initialRendererState(), error: error instanceof Error ? error.message : "No se pudo abrir el recurso local." }; this.updateState();
    }
  }
  // Single route for every resource button: audio goes to the independent channel, the rest to the visual stage.
  private openResource(id: string): Promise<void> {
    const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id);
    const kind = resource ? rendererKind(resource.download.mimeType) : "unsupported";
    if (kind === "audio") return this.openAudio(id);
    this.controller.selectResource(id);
    if (kind === "video") void this.pauseAudio();
    return this.showResource();
  }
  private async openAudio(id: string): Promise<void> {
    if (this.disposed) return;
    this.audioMinimized = false;
    if (id === this.audioId && !this.audioState.error) { this.updateAudioControls(); return; }
    const sequence = ++this.audioSequence;
    this.audioRenderer?.destroy(); this.audioRenderer = undefined; this.audioReady = false; this.audioPlayRequested = false;
    this.audioId = id;
    this.audioState = { ...initialRendererState(), loading: true, volume: this.audioVolume, muted: this.audioMuted };
    this.element("[data-audio-host]").replaceChildren();
    this.updateAudioControls();
    try {
      const prepared = this.dependencies.prepareMediaSource ? await this.dependencies.prepareMediaSource(id) : undefined;
      if (!prepared && !await this.dependencies.verifyResource(id)) throw new Error("Audio local ausente o corrupto. Vuelve a Biblioteca para sincronizarlo de nuevo.");
      if (sequence !== this.audioSequence || this.disposed) return;
      const source = prepared || localSource(this.classroom, id, this.dependencies.toUrl);
      const renderer = await (this.dependencies.createRenderer || createRenderer)(rendererKind(source.mimeType));
      if (sequence !== this.audioSequence || this.disposed) { renderer.destroy(); return; }
      this.audioRenderer = renderer;
      await renderer.mount(this.element("[data-audio-host]"), source, {
        page: 1, volume: this.audioVolume, muted: this.audioMuted,
        onState: (state: RendererState) => {
          if (sequence !== this.audioSequence || this.disposed) return;
          const started = state.playing && !this.audioState.playing;
          this.audioState = state; this.audioVolume = state.volume; this.audioMuted = state.muted;
          this.updateAudioControls();
          if (!started) return;
          if (!this.audioPlayRequested) void this.pauseAudio(); else this.pauseVideo();
        },
        onPage: () => {},
      });
      if (sequence !== this.audioSequence || this.disposed) return;
      this.audioReady = true; this.updateAudioControls();
    } catch (error) {
      if (sequence !== this.audioSequence || this.disposed) return;
      this.audioRenderer?.destroy(); this.audioRenderer = undefined; this.audioReady = false;
      this.audioState = { ...initialRendererState(), volume: this.audioVolume, muted: this.audioMuted, error: error instanceof Error ? error.message : "No se pudo abrir el audio local." };
      this.updateAudioControls();
    }
  }
  private async audioCommand(command: PlayerCommand): Promise<void> {
    const renderer = this.audioRenderer, sequence = this.audioSequence;
    if (!renderer || !this.audioReady || this.disposed) return;
    try { await renderer.command(command); }
    catch { if (sequence === this.audioSequence && !this.disposed) { this.audioState = { ...this.audioState, error: "Este control de audio no está disponible." }; this.updateAudioControls(); } }
  }
  private async audioControl(command: "PLAY_PAUSE" | "STOP" | "MUTE" | "CLOSE"): Promise<void> {
    if (this.disposed) return;
    if (command === "CLOSE") {
      ++this.audioSequence; this.audioRenderer?.destroy(); this.audioRenderer = undefined; this.audioReady = false; this.audioPlayRequested = false;
      this.audioId = ""; this.audioState = initialRendererState(); this.element("[data-audio-host]").replaceChildren();
      this.updateAudioControls(); return;
    }
    if (!this.audioReady || this.audioState.loading || this.audioState.error) return;
    if (command === "PLAY_PAUSE") {
      // PLAY_PAUSE is a toggle: only send it when the reported state differs from the wanted one.
      if (this.audioState.playing) { this.audioPlayRequested = false; await this.audioCommand("PLAY_PAUSE"); return; }
      this.audioPlayRequested = true; this.pauseVideo();
      await this.audioCommand("PLAY_PAUSE"); return;
    }
    if (command === "STOP") this.audioPlayRequested = false;
    await this.audioCommand(command);
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
    dock.hidden = !this.audioId;
    // Mark the open audio in the lists without rebuilding them, so no visual/projection update is triggered.
    this.root.querySelectorAll<HTMLButtonElement>("[data-resource]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.resource === this.controller.selectedResourceId || (!!this.audioId && button.dataset.resource === this.audioId))));
    if (!this.audioId) return;
    const state = this.audioState, usable = this.audioReady && !state.loading && !state.error;
    this.element("[data-audio-title]").textContent = this.classroom.manifest.resources.find((item) => item.resourceId === this.audioId)?.name || "Audio";
    const status = this.element("[data-audio-status]"); status.textContent = state.error || (state.loading ? "Abriendo audio local…" : ""); status.hidden = !status.textContent;
    status.setAttribute("role", state.error ? "alert" : "status");
    dock.classList.toggle("is-minimized", this.audioMinimized);
    this.element("[data-audio-body]").hidden = this.audioMinimized;
    const toggle = this.element("[data-audio-toggle]"); toggle.setAttribute("aria-expanded", String(!this.audioMinimized));
    toggle.textContent = this.audioMinimized ? "Restaurar" : "Minimizar";
    const play = this.element<HTMLButtonElement>("[data-audio-cmd='PLAY_PAUSE']");
    play.innerHTML = `${icon(state.playing ? "pause" : "play")}${state.playing ? "Pausar" : "Reproducir"}`; play.disabled = !usable;
    this.element<HTMLButtonElement>("[data-audio-cmd='STOP']").disabled = !usable;
    this.element("[data-audio-time]").textContent = `${timeLabel(state.time)} / ${timeLabel(state.duration)}`;
    const seek = this.element<HTMLInputElement>("[data-audio-seek]"); seek.max = String(state.duration); seek.value = String(state.time); seek.disabled = !usable || !state.duration;
    this.element<HTMLInputElement>("[data-audio-volume]").value = String(this.audioVolume);
    const mute = this.element<HTMLButtonElement>("[data-audio-cmd='MUTE']");
    mute.disabled = !usable; mute.setAttribute("aria-pressed", String(this.audioMuted));
    mute.innerHTML = `${icon(this.audioMuted ? "mute" : "volume")}${this.audioMuted ? "Activar sonido" : "Silenciar"}`;
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
  async dispatch(command: PlayerCommand | "ESCAPE"): Promise<void> {
    if (this.disposed) return;
    try {
      if (command === "ESCAPE") {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (!this.controller.isPresentation) { this.controller.returnToPresentation(); await this.showResource(); }
        else this.exit();
      } else if (command === "FULLSCREEN") {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await this.element(".classroom-player").requestFullscreen();
      } else if (["ADVANCE", "BACK", "NEXT", "PREVIOUS"].includes(command) && this.controller.isPresentation) this.navigate(["ADVANCE", "NEXT"].includes(command) ? 1 : -1);
      else if (command === "PLAY_PAUSE" && this.controller.isPresentation && !["audio", "video"].includes(this.renderer?.kind || "")) this.navigate(1);
      else await this.renderer?.command(command);
    } catch { if (!this.disposed) { this.state.error = "Este control no está disponible en este equipo o archivo."; this.updateState(); } }
  }
  private exit(): void { this.destroy(); this.onExit(); }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.sequence; ++this.audioSequence;
    this.audioRenderer?.destroy(); this.audioRenderer = undefined; this.audioReady = false;
    ++this.buildSequence; this.surface?.destroy(); this.verifiedSources.clear();
    this.projection.destroy();
    window.removeEventListener("keydown", this.keyListener); this.renderer?.destroy(); this.renderer = undefined;
    if (document.fullscreenElement && this.root.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
    this.root.replaceChildren();
  }
}
