import { PlayerController } from "./controller.ts";
import { localSource } from "./local-source.ts";
import { createRenderer } from "./renderers/factory.ts";
import { shortcutFor } from "./shortcuts.ts";
import { initialRendererState, rendererKind, type LocalClassroom, type LocalRenderer, type PlayerCommand, type RendererState } from "./types.ts";

export interface PlayerDependencies {
  verifyResource(id: string): Promise<boolean>;
  createRenderer?: typeof createRenderer;
  toUrl?: (path: string) => string;
}
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export class ClassroomPlayer {
  readonly controller: PlayerController;
  private root: HTMLElement;
  private classroom: LocalClassroom;
  private dependencies: PlayerDependencies;
  private onExit: () => void;
  private renderer?: LocalRenderer;
  private renderedId = "";
  private sequence = 0;
  private disposed = false;
  private state = initialRendererState();
  private volume = 0.8;
  private muted = false;
  private keyListener = (event: KeyboardEvent) => {
    const command = shortcutFor(event);
    if (!command || (event.repeat && ["PLAY_PAUSE", "MUTE", "FULLSCREEN", "ESCAPE"].includes(command))) return;
    event.preventDefault(); void this.dispatch(command);
  };

  constructor(root: HTMLElement, classroom: LocalClassroom, onExit: () => void, dependencies: PlayerDependencies) {
    this.controller = new PlayerController(classroom.manifest);
    this.root = root; this.classroom = classroom; this.onExit = onExit; this.dependencies = dependencies;
    this.layout(); window.addEventListener("keydown", this.keyListener);
    void this.showResource();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private layout(): void {
    this.root.innerHTML = `<main class="classroom-player"><header class="player-header"><div><p class="section-kicker">Active Classroom · <span data-local>Solo archivos locales</span></p><h1 data-unit></h1><small data-version></small></div><button class="button button-outline" data-exit>Volver a Biblioteca</button></header><div class="player-layout"><section class="player-main"><header class="player-content-title"><div><h2 data-resource-name></h2><p data-position></p></div><button class="button button-outline" data-presentation>Volver a presentación</button></header><div class="player-stage"><div data-renderer class="player-renderer"></div><p data-status role="status" class="player-status"></p></div><section class="player-controls" aria-label="Controles de clase"><div class="ui-cluster"><button class="button button-outline" data-slide-previous>← Anterior</button><progress data-slide-progress max="1" value="0" aria-label="Progreso de la clase"></progress><button class="button button-outline" data-slide-next>Siguiente →</button><button class="button button-outline" data-command="FULLSCREEN">Pantalla completa</button></div><div data-media class="player-media-controls"><div class="ui-cluster"><button class="button button-primary" data-command="PLAY_PAUSE">Reproducir</button><button class="button button-outline" data-command="STOP">Detener</button><button class="button button-outline" data-command="SEEK_BACKWARD">−10 s</button><button class="button button-outline" data-command="SEEK_FORWARD">+10 s</button><span data-time>0:00 / 0:00</span></div><label class="player-range">Reproducción<input data-seek type="range" min="0" max="0" step="0.1" value="0" /></label><div class="ui-cluster"><label class="player-range">Volumen<input data-volume type="range" min="0" max="1" step="0.05" value="0.8" /></label><button class="button button-outline" data-command="MUTE" aria-pressed="false">Silenciar</button></div></div><small>← → diapositivas · Espacio reproducir · J/L ±10 s · ↑ ↓ volumen · M silencio · F pantalla completa · Esc volver</small></section></section><aside class="player-resources"><section class="ui-card"><h2>Diapositivas</h2><nav data-slides aria-label="Diapositivas"></nav></section><section class="ui-card"><h2>Recursos de la diapositiva</h2><div data-associated></div></section><section class="ui-card"><h2>Recursos generales</h2><div data-general></div></section></aside></div></main>`;
    this.element("[data-unit]").textContent = this.classroom.manifest.unit.name;
    this.element("[data-version]").textContent = `${this.classroom.manifest.unit.levelId} · Publicación v${this.classroom.manifest.version} · Sin servicios remotos durante la clase`;
    this.element("[data-exit]").onclick = () => this.exit();
    this.element("[data-presentation]").onclick = () => { this.controller.returnToPresentation(); void this.showResource(); };
    this.element("[data-slide-previous]").onclick = () => this.navigate(-1);
    this.element("[data-slide-next]").onclick = () => this.navigate(1);
    this.root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => { button.onclick = () => { void this.dispatch(button.dataset.command as PlayerCommand); }; });
    this.element<HTMLInputElement>("[data-seek]").oninput = (event) => this.renderer?.seek(Number((event.target as HTMLInputElement).value));
    this.element<HTMLInputElement>("[data-volume]").oninput = (event) => this.renderer?.setVolume(Number((event.target as HTMLInputElement).value));
    this.updateLists(); this.updateState();
  }
  private updateLists(): void {
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
        button.textContent = resource?.name || "Recurso ausente"; button.disabled = !resource;
        button.setAttribute("aria-pressed", String(id === this.controller.selectedResourceId));
        button.onclick = () => { this.controller.selectResource(id); void this.showResource(); }; list.append(button);
      }
    }
    this.updateState();
  }
  private updateState(): void {
    if (this.disposed) return;
    const controller = this.controller;
    const count = this.classroom.manifest.slides.length;
    this.element("[data-position]").textContent = `${controller.slideIndex === null ? "Página sin diapositiva asociada" : `Diapositiva ${controller.slideIndex + 1} / ${count}`}${this.renderer?.kind === "pdf" ? ` · PDF ${this.state.page} / ${this.state.pages || "…"}` : ""}`;
    this.element<HTMLButtonElement>("[data-slide-previous]").disabled = controller.slideIndex === 0;
    this.element<HTMLButtonElement>("[data-slide-next]").disabled = controller.slideIndex === count - 1;
    this.element<HTMLProgressElement>("[data-slide-progress]").max = count;
    this.element<HTMLProgressElement>("[data-slide-progress]").value = controller.slideIndex === null ? 0 : controller.slideIndex + 1;
    this.element("[data-presentation]").hidden = controller.isPresentation;
    const status = this.element("[data-status]"); status.textContent = this.state.error || (this.state.loading ? "Abriendo archivo local…" : ""); status.hidden = !status.textContent;
    status.setAttribute("role", this.state.error ? "alert" : "status");
    const media = this.renderer?.kind === "audio" || this.renderer?.kind === "video";
    this.element("[data-media]").hidden = !media;
    this.element("[data-command='PLAY_PAUSE']").textContent = this.state.playing ? "Pausar" : "Reproducir";
    this.element("[data-time]").textContent = `${timeLabel(this.state.time)} / ${timeLabel(this.state.duration)}`;
    const seek = this.element<HTMLInputElement>("[data-seek]"); seek.max = String(this.state.duration); seek.value = String(this.state.time); seek.disabled = !this.state.duration;
    this.element<HTMLInputElement>("[data-volume]").value = String(this.volume);
    this.element("[data-command='MUTE']").setAttribute("aria-pressed", String(this.muted));
    this.element("[data-command='MUTE']").textContent = this.muted ? "Activar sonido" : "Silenciar";
  }
  private async showResource(): Promise<void> {
    if (this.disposed) return;
    const id = this.controller.selectedResourceId;
    this.updateLists();
    if (this.renderedId === id && this.renderer && !this.state.error) {
      try { await this.renderer.setPage(this.controller.page); } catch { this.state.error = "No se pudo abrir esta página."; this.updateState(); }
      return;
    }
    const sequence = ++this.sequence;
    this.renderer?.destroy(); this.renderer = undefined; this.renderedId = "";
    this.state = { ...initialRendererState(), loading: true };
    const host = document.createElement("div"); host.className = "player-renderer-content";
    this.element("[data-renderer]").replaceChildren(host);
    const resource = this.classroom.manifest.resources.find((item) => item.resourceId === id)!;
    this.element("[data-resource-name]").textContent = resource.name;
    this.updateState();
    try {
      if (!await this.dependencies.verifyResource(id)) throw new Error("Archivo local ausente o corrupto. Vuelve a Biblioteca para sincronizarlo de nuevo.");
      if (sequence !== this.sequence || this.disposed) return;
      const source = localSource(this.classroom, id, this.dependencies.toUrl);
      const renderer = await (this.dependencies.createRenderer || createRenderer)(rendererKind(source.mimeType));
      if (sequence !== this.sequence || this.disposed) { renderer.destroy(); return; }
      this.renderer = renderer; this.renderedId = id;
      await renderer.mount(host, source, {
        page: this.controller.page, volume: this.volume, muted: this.muted,
        onState: (state: RendererState) => {
          if (sequence !== this.sequence || this.disposed) return;
          this.state = state;
          if (renderer.kind === "audio" || renderer.kind === "video") { this.volume = state.volume; this.muted = state.muted; }
          this.updateState();
        },
        onPage: (page: number) => { if (sequence === this.sequence && !this.disposed) { this.controller.pageChanged(page); this.updateLists(); } },
      });
    } catch (error) {
      if (sequence !== this.sequence || this.disposed) return;
      this.renderer?.destroy(); this.renderer = undefined; this.renderedId = "";
      this.state = { ...initialRendererState(), error: error instanceof Error ? error.message : "No se pudo abrir el recurso local." }; this.updateState();
    }
  }
  private navigate(direction: number): void { this.controller.moveSlide(direction); void this.showResource(); }
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
      } else if ((command === "NEXT" || command === "PREVIOUS") && this.controller.isPresentation) this.navigate(command === "NEXT" ? 1 : -1);
      else await this.renderer?.command(command);
    } catch { if (!this.disposed) { this.state.error = "Este control no está disponible en este equipo o archivo."; this.updateState(); } }
  }
  private exit(): void { this.destroy(); this.onExit(); }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.sequence;
    window.removeEventListener("keydown", this.keyListener); this.renderer?.destroy(); this.renderer = undefined;
    if (document.fullscreenElement && this.root.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
    this.root.replaceChildren();
  }
}
