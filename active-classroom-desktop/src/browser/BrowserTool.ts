import { invoke, isTauri } from "@tauri-apps/api/core";
import { nativeProjectionBridge } from "../player/projection/ProjectionCoordinator.ts";
import { preferredMonitor, readMonitorPreference, type ProjectionMonitor } from "../player/projection/monitors.ts";
import { icon } from "../ui/icons.ts";
void import("./browser.css").catch(() => {});

export interface BrowserStatus { open: boolean; url: string; title: string; loading: boolean; presenting: boolean; projectionError?: string | null }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
// Every method resolves with the native status. The web content lives in a native child webview, never in this document.
export interface BrowserBridge {
  open(url: string, bounds: BrowserBounds): Promise<BrowserStatus>;
  navigate(url: string): Promise<BrowserStatus>;
  back(): Promise<BrowserStatus>;
  forward(): Promise<BrowserStatus>;
  reload(): Promise<BrowserStatus>;
  layout(bounds: BrowserBounds): Promise<BrowserStatus>;
  present(monitorId: string): Promise<BrowserStatus>;
  returnToHost(bounds: BrowserBounds): Promise<BrowserStatus>;
  status(): Promise<BrowserStatus>;
  close(): Promise<BrowserStatus>;
}
const call = (action: string, data?: unknown) => invoke<BrowserStatus>("classroom_browser", data === undefined ? { action } : { action, data });
export const nativeBrowserBridge: BrowserBridge = {
  open: (url, bounds) => call("open", { url, bounds }),
  navigate: (url) => call("navigate", { url }),
  back: () => call("back"),
  forward: () => call("forward"),
  reload: () => call("reload"),
  layout: (bounds) => call("layout", { bounds }),
  present: (monitorId) => call("present", { monitorId }),
  returnToHost: (bounds) => call("return", { bounds }),
  status: () => call("status"),
  close: () => call("close"),
};

export interface BrowserToolOptions {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  bridge?: BrowserBridge;
  // Defaults to the Tauri runtime; without it the overlay explains the limitation and never simulates a browser.
  available?: boolean;
  monitors?: () => Promise<ProjectionMonitor[]>;
  // Runs once each time the overlay opens (pause class media, hide the class projection).
  beforeOpen?: () => Promise<void> | void;
  pollMs?: number;
}

const BLOCKED_SCHEME = /^(javascript|data|file|blob|about|mailto|tel|vbscript|ftp|ws|wss):/i;
// Preliminary check only: the native side validates again. A bare host defaults to https.
export function normalizeBrowserUrl(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text || /\s/.test(text) || BLOCKED_SCHEME.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : null;
  } catch { return null; }
}
const emptyStatus = (): BrowserStatus => ({ open: false, url: "", title: "", loading: false, presenting: false });
const sameBounds = (a: BrowserBounds | null, b: BrowserBounds) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const monitorLabel = (monitor: ProjectionMonitor) => `${monitor.name} · ${monitor.primary ? "Principal" : "Secundario"} · ${monitor.width}×${monitor.height}`;
const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled)";

export class BrowserTool {
  private overlay: HTMLElement;
  private bridge: BrowserBridge;
  private available: boolean;
  private opts: BrowserToolOptions;
  private pollMs: number;
  private chain: Promise<void> = Promise.resolve();
  // Invalidates queued work and stale results whenever the overlay opens or closes.
  private epoch = 0;
  private isActive = false;
  private prepared = false;
  private disposed = false;
  private pending = 0;
  // opened: a native open was attempted and the backend may need a close. webOpen: the native page is usable.
  private opened = false;
  private webOpen = false;
  private status = emptyStatus();
  private error = "";
  private pollFailed = false;
  private monitors: ProjectionMonitor[] = [];
  private monitorSignature = "";
  private lastBounds: BrowserBounds | null = null;
  private layoutQueued = false;
  // True while the teacher is editing the address: backend updates must not overwrite what is being typed.
  private urlDirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private observer?: ResizeObserver;
  private onTrigger = () => { void this.open(); };
  private onSubmit = (event: Event) => { event.preventDefault(); void this.submit(); };
  private onKey = (event: KeyboardEvent) => this.key(event);
  private onResize = () => this.scheduleLayout();

  constructor(options: BrowserToolOptions) {
    this.opts = options; this.bridge = options.bridge ?? nativeBrowserBridge; this.pollMs = options.pollMs ?? 1000;
    this.available = options.available ?? isTauri();
    this.overlay = document.createElement("div");
    this.overlay.className = "browser-tool"; this.overlay.hidden = true; this.overlay.dataset.browserTool = "";
    this.overlay.setAttribute("role", "dialog"); this.overlay.setAttribute("aria-modal", "true"); this.overlay.setAttribute("aria-label", "Navegador web");
    this.overlay.innerHTML = `<header class="browser-toolbar">
      <div class="browser-nav"><button type="button" class="button button-outline" data-browser-back aria-label="Atrás">${icon("previous")}<span>Atrás</span></button><button type="button" class="button button-outline" data-browser-forward aria-label="Adelante">${icon("next")}<span>Adelante</span></button><button type="button" class="button button-outline" data-browser-reload aria-label="Recargar">${icon("refresh")}<span>Recargar</span></button></div>
      <form class="browser-address" data-browser-form novalidate><input data-browser-url type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" aria-label="Dirección web" /><button type="submit" class="button button-primary" data-browser-go>Ir</button></form>
      <div class="browser-screen"><label>Pantalla<select data-browser-monitor aria-label="Pantalla para mostrar la página"></select></label><button type="button" class="button button-primary" data-browser-present>${icon("projector")}<span>Duplicar en pantalla</span></button><button type="button" class="button button-outline" data-browser-return>Dejar de duplicar</button></div>
      <button type="button" class="button button-outline browser-close" data-browser-close>Cerrar y volver a clase</button>
    </header>
    <p class="browser-info"><strong data-browser-title></strong><span data-browser-address></span></p>
    <p class="browser-status" data-browser-status role="status" hidden></p>
    <div class="browser-host" data-browser-host><p class="browser-note" data-browser-note></p></div>`;
    (options.root.querySelector(".classroom-player") ?? options.root).append(this.overlay);
    options.trigger.addEventListener("click", this.onTrigger);
    this.overlay.querySelector("[data-browser-form]")!.addEventListener("submit", this.onSubmit);
    this.part("[data-browser-url]").addEventListener("input", () => { this.urlDirty = true; });
    const click = (selector: string, handler: () => void) => { this.part<HTMLButtonElement>(selector).onclick = handler; };
    click("[data-browser-back]", () => { void this.simple(() => this.bridge.back()); });
    click("[data-browser-forward]", () => { void this.simple(() => this.bridge.forward()); });
    click("[data-browser-reload]", () => { void this.simple(() => this.bridge.reload()); });
    click("[data-browser-present]", () => { void this.present(); });
    click("[data-browser-return]", () => { void this.simple(async () => { const bounds = this.bounds(); if (!bounds) throw new Error("El área del navegador no tiene tamaño visible."); const status = await this.bridge.returnToHost(bounds); this.lastBounds = bounds; return status; }); });
    click("[data-browser-close]", () => { void this.close(); });
    this.render();
  }

  // True from the moment the overlay opens until the teacher closes it: the player ignores its own shortcuts meanwhile.
  get active(): boolean { return this.isActive && !this.disposed; }
  private part<T extends HTMLElement = HTMLElement>(selector: string): T { return this.overlay.querySelector<T>(selector)!; }
  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }

  open(): Promise<void> {
    if (this.disposed || this.isActive) return Promise.resolve();
    this.isActive = true; const epoch = ++this.epoch;
    this.prepared = false; this.status = emptyStatus(); this.error = ""; this.pollFailed = false; this.layoutQueued = false; this.lastBounds = null; this.webOpen = false; this.urlDirty = false;
    this.overlay.hidden = false; this.render();
    window.addEventListener("keydown", this.onKey, true); window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") { this.observer = new ResizeObserver(() => this.scheduleLayout()); this.observer.observe(this.part("[data-browser-host]")); }
    this.part<HTMLInputElement>("[data-browser-url]").focus();
    if (!this.available) return Promise.resolve();
    // A previous close that failed is retried before anything new is opened.
    if (this.opened) void this.closeBackend();
    return this.act(async () => {
      try { await this.opts.beforeOpen?.(); } catch { throw new Error("No se pudo preparar la clase antes de abrir el navegador. Cierra y reintenta."); }
      if (!this.current(epoch)) return;
      this.prepared = true; this.render(); this.part<HTMLInputElement>("[data-browser-url]").focus();
      try { this.setMonitors(await (this.opts.monitors ?? (() => nativeProjectionBridge.status().then(status => status.monitors)))()); }
      catch { this.setMonitors([]); }
    });
  }

  close(): Promise<void> {
    if (this.disposed || !this.isActive) return Promise.resolve();
    this.isActive = false; ++this.epoch; this.layoutQueued = false;
    this.stopWatching(); this.overlay.hidden = true;
    this.status = emptyStatus(); this.webOpen = false; this.lastBounds = null;
    this.opts.trigger.focus(); this.render();
    return this.closeBackend();
  }

  // Idempotent and safe to call even when authorization is lost: it only needs the bridge to release the native webview.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.epoch; this.isActive = false;
    this.stopWatching();
    this.opts.trigger.removeEventListener("click", this.onTrigger);
    this.overlay.remove();
    if (this.opened) { const bridge = this.bridge; this.chain = this.chain.then(() => bridge.close().then(() => {}, () => {})); }
  }

  private stopWatching(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.observer?.disconnect(); this.observer = undefined;
    window.removeEventListener("keydown", this.onKey, true); window.removeEventListener("resize", this.onResize);
  }

  // Serializes every native call. Work queued for an earlier overlay session is skipped, so closing never reopens the view.
  private act(task: (epoch: number) => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    const run = this.chain.then(async () => {
      if (!this.current(epoch)) return;
      this.pending++; this.render();
      try { await task(epoch); }
      catch (error) { if (this.current(epoch)) { this.error = this.message(error); this.pollFailed = false; } }
      finally { this.pending--; if (!this.disposed) { this.render(); if (this.current(epoch) && !this.pending) this.schedulePoll(); } }
    });
    this.chain = run; return run;
  }
  private closeBackend(): Promise<void> {
    const run = this.chain.then(async () => {
      if (!this.opened) return;
      try { await this.bridge.close(); this.opened = false; }
      catch (error) { if (this.active) { this.error = this.message(error); this.render(); } }
    });
    this.chain = run; return run;
  }
  // Native errors are shown, never logged: they may carry the visited address.
  private message(error: unknown): string {
    const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    return text ? text.slice(0, 240) : "No se pudo completar la acción del navegador.";
  }
  private bounds(): BrowserBounds | null {
    const rect = this.part("[data-browser-host]").getBoundingClientRect();
    const bounds = { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
    return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null;
  }
  private apply(status: BrowserStatus, epoch: number): void {
    if (!this.current(epoch)) return;
    this.status = { open: !!status?.open, url: String(status?.url ?? ""), title: String(status?.title ?? ""), loading: !!status?.loading, presenting: !!status?.presenting };
    if (status?.projectionError) this.error = String(status.projectionError);
    if (this.webOpen && !this.status.open) { this.webOpen = false; this.opened = false; this.error = "La página se cerró. Escribe una dirección para abrirla de nuevo."; }
  }
  private async simple(task: () => Promise<BrowserStatus>): Promise<void> {
    await this.act(async epoch => { this.error = ""; if (this.webOpen) this.apply(await task(), epoch); });
  }
  private async submit(): Promise<void> {
    const input = this.part<HTMLInputElement>("[data-browser-url]");
    const url = normalizeBrowserUrl(input.value);
    if (!url) { this.error = "Escribe una dirección web http o https válida."; this.render(); return; }
    input.value = url; this.urlDirty = false;
    if (!this.available) return;
    if (!this.prepared) { this.error = "La clase aún no está preparada para abrir el navegador. Cierra y reintenta."; this.render(); return; }
    await this.act(async epoch => {
      this.error = "";
      if (this.webOpen) { this.apply(await this.bridge.navigate(url), epoch); return; }
      const bounds = this.bounds();
      if (!bounds) throw new Error("El área del navegador no tiene tamaño visible.");
      this.opened = true;
      try {
        const status = await this.bridge.open(url, bounds);
        if (!this.current(epoch)) return;
        this.webOpen = true; this.lastBounds = bounds; this.apply(status, epoch);
      } catch (error) {
        // Leave no half-open webview behind so the teacher can retry from a clean state.
        try { await this.bridge.close(); this.opened = false; } catch { /* closeBackend retries later */ }
        throw error;
      }
      if (this.current(epoch)) await this.layoutNow(epoch);
    });
  }
  private async present(): Promise<void> {
    const id = this.part<HTMLSelectElement>("[data-browser-monitor]").value;
    await this.act(async epoch => {
      this.error = "";
      if (!this.webOpen) return;
      try { this.setMonitors(await (this.opts.monitors ?? (() => nativeProjectionBridge.status().then(status => status.monitors)))()); } catch { /* the stale list is validated below */ }
      if (!this.monitors.some(monitor => monitor.id === id)) throw new Error("La pantalla seleccionada ya no está disponible.");
      this.apply(await this.bridge.present(id), epoch);
    });
  }
  private async layoutNow(epoch: number): Promise<void> {
    if (!this.current(epoch) || !this.webOpen) return;
    const bounds = this.bounds();
    if (!bounds || sameBounds(this.lastBounds, bounds)) return;
    this.apply(await this.bridge.layout(bounds), epoch); this.lastBounds = bounds;
  }
  private scheduleLayout(): void {
    if (!this.active || !this.webOpen || this.layoutQueued) return;
    this.layoutQueued = true;
    void this.act(async epoch => { this.layoutQueued = false; await this.layoutNow(epoch); });
  }
  // One timer at a time, armed only after the previous round finished: polls never overlap.
  private schedulePoll(): void {
    if (this.timer !== undefined || !this.active || !this.webOpen) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active || this.pending) return;
      void this.act(async epoch => {
        try { const status = await this.bridge.status(); this.apply(status, epoch); if (this.pollFailed) { this.pollFailed = false; this.error = status.projectionError ? String(status.projectionError) : ""; } }
        catch { if (this.current(epoch)) { this.error = "No se pudo consultar el estado del navegador."; this.pollFailed = true; } }
      });
    }, this.pollMs);
  }
  private setMonitors(monitors: ProjectionMonitor[]): void {
    const signature = JSON.stringify(monitors.map(monitor => [monitor.id, monitor.name, monitor.primary, monitor.width, monitor.height]));
    if (signature === this.monitorSignature) return;
    this.monitorSignature = signature; this.monitors = monitors;
    const select = this.part<HTMLSelectElement>("[data-browser-monitor]"), previous = select.value;
    select.replaceChildren();
    for (const monitor of monitors) { const option = document.createElement("option"); option.value = monitor.id; option.textContent = monitorLabel(monitor); select.append(option); }
    const keep = monitors.find(monitor => monitor.id === previous);
    select.value = (keep ?? preferredMonitor(monitors, readMonitorPreference()) ?? monitors.find(monitor => !monitor.primary) ?? monitors[0])?.id ?? "";
  }
  private key(event: KeyboardEvent): void {
    if (!this.active) return;
    if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); void this.close(); return; }
    if (event.key !== "Tab") return;
    const items = [...this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], focused = document.activeElement;
    if (!this.overlay.contains(focused) || (event.shiftKey && focused === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (!event.shiftKey && focused === last) { event.preventDefault(); first.focus(); }
  }
  private render(): void {
    if (this.disposed) return;
    const busy = this.pending > 0, web = this.webOpen, presenting = this.status.presenting, ready = this.available;
    const set = (selector: string, value: string) => { const node = this.part(selector); if (node.textContent !== value) node.textContent = value; };
    set("[data-browser-title]", this.status.title); set("[data-browser-address]", this.status.url);
    const input = this.part<HTMLInputElement>("[data-browser-url]");
    if (this.status.url && web && !this.urlDirty) input.value = this.status.url;
    input.disabled = !ready || !this.prepared;
    this.part<HTMLButtonElement>("[data-browser-go]").disabled = !ready || !this.prepared;
    for (const selector of ["[data-browser-back]", "[data-browser-forward]", "[data-browser-reload]"]) this.part<HTMLButtonElement>(selector).disabled = !web;
    const monitor = this.part<HTMLSelectElement>("[data-browser-monitor]");
    monitor.disabled = !ready || this.monitors.length < 2 || presenting;
    this.part<HTMLButtonElement>("[data-browser-present]").disabled = !web || presenting || this.monitors.length < 2 || busy;
    this.part<HTMLButtonElement>("[data-browser-return]").disabled = !presenting || busy;
    this.part("[data-browser-host]").setAttribute("aria-busy", String(busy || this.status.loading));
    const note = this.part("[data-browser-note]");
    const text = !ready ? "El navegador web solo está disponible en la aplicación de escritorio." : !web ? this.monitors.length < 2 ? "Escribe una dirección y pulsa Ir. Conecta una segunda pantalla para mostrarla al grupo." : "Escribe una dirección y pulsa Ir." : "";
    set("[data-browser-note]", text); note.hidden = !text;
    const message = this.error || (!ready ? "Navegador no disponible fuera de la aplicación de escritorio." : busy || this.status.loading ? "Cargando…" : presenting ? "Duplicando en pantalla externa" : "");
    const status = this.part("[data-browser-status]");
    set("[data-browser-status]", message); status.hidden = !this.active || !message; status.setAttribute("role", this.active && (this.error || !ready) ? "alert" : "status");
  }
}
