import type { LocalClassroom } from "./types.ts";
import { SlideThumbnails } from "./slide-thumbnails.ts";

// Plain Node (tests) cannot load CSS; Vite bundles it for the app.
void import("./slide-navigator.css").catch(() => {});

export interface SlideNavigatorOptions {
  host: HTMLElement;
  classroom: LocalClassroom;
  thumbnails: SlideThumbnails;
  onSelect(index: number): void;
  onGalleryToggle?(open: boolean): void;
}

// Without IntersectionObserver the gallery loads only what is near the viewport (or a small window around the current slide).
const FALLBACK_WINDOW = 12;
const FALLBACK_MARGIN = 200;
const slideTitle = (classroom: LocalClassroom, index: number) => classroom.manifest.slides[index].title || `Diapositiva ${index + 1}`;

// One thumbnail slot. It only requests its image while visible and keeps no work running once it is not.
class Tile {
  index = -1;
  visible = false;
  readonly thumb = document.createElement("span");
  private fallback = document.createElement("span");
  private image?: HTMLImageElement;
  private pending = false;
  private requestId = 0;
  private thumbnails: SlideThumbnails;
  private priority: boolean;
  constructor(thumbnails: SlideThumbnails, priority: boolean) {
    this.thumbnails = thumbnails; this.priority = priority;
    this.thumb.className = "slide-thumb"; this.thumb.setAttribute("aria-hidden", "true");
    this.fallback.className = "slide-thumb-fallback"; this.thumb.append(this.fallback);
    this.show("empty");
  }
  setIndex(index: number): void {
    if (index === this.index) return;
    this.cancel(); this.index = index; this.clear();
    if (index < 0) { this.show("empty"); return; }
    this.show("loading");
    if (this.visible) this.load();
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.load(); else this.cancel();
  }
  load(): void {
    if (this.index < 0 || this.pending || this.thumb.dataset.state === "ready") return;
    const index = this.index;
    const cached = this.thumbnails.get(index);
    if (cached !== undefined) { this.showImage(cached); return; }
    const failed = this.thumbnails.failure(index);
    if (failed !== undefined) { this.show("error", failed); return; }
    this.pending = true; const id = ++this.requestId;
    void this.thumbnails.request(index, { priority: this.priority }).then(result => {
      if (id !== this.requestId) return;
      this.pending = false;
      if (result.status === "ready") this.showImage(result.url);
      else if (result.status === "error") this.show("error", result.message);
      else if (this.visible) this.show("loading");
    });
  }
  // Drops the displayed image once its object URL is revoked. It never reloads by itself (that would make tiles
  // evict each other on huge screens): it reloads when it becomes visible again or its slide changes.
  evicted(): void { this.clear(); this.show("loading"); }
  cancel(): void {
    if (!this.pending) return;
    this.pending = false; this.requestId++; this.thumbnails.cancel(this.index);
  }
  private clear(): void { this.image?.remove(); this.image = undefined; }
  private showImage(url: string): void {
    if (!this.image) { this.image = document.createElement("img"); this.image.alt = ""; this.image.decoding = "async"; this.image.draggable = false; this.thumb.prepend(this.image); }
    if (this.image.getAttribute("src") !== url) this.image.src = url;
    this.show("ready");
  }
  private show(state: "loading" | "ready" | "error" | "empty", message = ""): void {
    this.thumb.dataset.state = state;
    this.fallback.textContent = state === "error" ? "Vista previa no disponible" : state === "empty" ? "" : this.index >= 0 ? String(this.index + 1) : "";
    if (state === "error") this.thumb.title = message; else this.thumb.removeAttribute("title");
  }
}

export class SlideNavigator {
  private options: SlideNavigatorOptions;
  private root = document.createElement("div");
  private position = document.createElement("p");
  private previous = document.createElement("button");
  private next = document.createElement("button");
  private openButton = document.createElement("button");
  private previousLabel = document.createElement("span");
  private nextLabel = document.createElement("span");
  private previousTile: Tile;
  private nextTile: Tile;
  private stripObserver?: IntersectionObserver;
  private galleryObserver?: IntersectionObserver;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private owners = new WeakMap<Element, Tile>();
  private current: number | null | undefined;
  private dialog?: HTMLElement;
  private grid?: HTMLElement;
  private items: Array<{ button: HTMLButtonElement; tile: Tile }> = [];
  private closeButton?: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;
  private open = false;
  private destroyed = false;

  constructor(options: SlideNavigatorOptions) {
    this.options = options;
    const { host, thumbnails } = options;
    this.previousTile = new Tile(thumbnails, true); this.nextTile = new Tile(thumbnails, true);
    this.root.className = "slide-navigator";
    this.position.className = "slide-navigator-position"; this.position.setAttribute("aria-live", "polite");
    const strip = document.createElement("div"); strip.className = "slide-navigator-strip";
    for (const [button, tile, label, name] of [[this.previous, this.previousTile, this.previousLabel, "Anterior"], [this.next, this.nextTile, this.nextLabel, "Siguiente"]] as const) {
      button.type = "button"; button.className = "slide-navigator-card"; button.dataset.slideNav = name === "Anterior" ? "previous" : "next";
      label.className = "slide-navigator-card-label";
      button.append(tile.thumb, label); strip.append(button);
    }
    this.previous.onclick = () => { if (this.current != null && this.current > 0) options.onSelect(this.current - 1); };
    this.next.onclick = () => { if (this.current != null && this.current < this.count - 1) options.onSelect(this.current + 1); };
    this.openButton.type = "button"; this.openButton.className = "button button-outline slide-navigator-all"; this.openButton.dataset.slideGalleryOpen = "";
    this.openButton.textContent = "Ver todas"; this.openButton.setAttribute("aria-haspopup", "dialog");
    this.openButton.onclick = () => this.openGallery();
    this.root.append(this.position, strip, this.openButton);
    host.replaceChildren(this.root);
    if (typeof IntersectionObserver !== "undefined") {
      this.stripObserver = new IntersectionObserver(entries => this.observed(entries));
      this.stripObserver.observe(this.previousTile.thumb); this.stripObserver.observe(this.nextTile.thumb);
      this.owners.set(this.previousTile.thumb, this.previousTile); this.owners.set(this.nextTile.thumb, this.nextTile);
    } else { this.previousTile.setVisible(true); this.nextTile.setVisible(true); }
    const tiles = () => [this.previousTile, this.nextTile, ...this.items.map(item => item.tile)];
    thumbnails.retain = index => tiles().some(tile => tile.index === index && tile.visible);
    thumbnails.onEvict = index => { for (const tile of tiles()) if (tile.index === index) tile.evicted(); };
  }

  get galleryOpen(): boolean { return this.open; }
  private get count(): number { return this.options.classroom.manifest.slides.length; }

  // Incremental: only the position text, two strip cards and the gallery's current marker change.
  update(slideIndex: number | null): void {
    if (this.destroyed || slideIndex === this.current) return;
    const before = this.current; this.current = slideIndex;
    const count = this.count, { classroom } = this.options;
    this.position.textContent = slideIndex === null ? "Página sin diapositiva asociada" : `Diapositiva ${slideIndex + 1} de ${count}`;
    const previous = slideIndex !== null && slideIndex > 0 ? slideIndex - 1 : -1;
    const next = slideIndex !== null && slideIndex < count - 1 ? slideIndex + 1 : -1;
    for (const [button, tile, label, target, edge, name] of [[this.previous, this.previousTile, this.previousLabel, previous, "Primera diapositiva", "Anterior"], [this.next, this.nextTile, this.nextLabel, next, "Última diapositiva", "Siguiente"]] as const) {
      tile.setIndex(target); button.disabled = target < 0;
      label.replaceChildren(); const title = document.createElement("small"); title.textContent = name; label.append(title, target < 0 ? edge : `${target + 1}. ${slideTitle(classroom, target)}`);
      button.setAttribute("aria-label", target < 0 ? `${name}: ${edge.toLowerCase()}` : `${name}: diapositiva ${target + 1}, ${slideTitle(classroom, target)}`);
    }
    if (this.items.length) {
      if (before != null) this.mark(before, false);
      if (slideIndex !== null) this.mark(slideIndex, true);
    }
  }

  openGallery(): void {
    if (this.destroyed || this.open) return;
    this.buildGallery();
    this.open = true; this.returnFocus = (document.activeElement as HTMLElement | null) || this.openButton;
    this.dialog!.hidden = false;
    if (typeof IntersectionObserver !== "undefined") {
      this.galleryObserver = new IntersectionObserver(entries => this.observed(entries), { root: this.grid, rootMargin: "200px" });
      for (const { tile } of this.items) this.galleryObserver.observe(tile.thumb);
    } else this.grid!.addEventListener("scroll", this.scheduleFallback, { passive: true });
    window.addEventListener("keydown", this.galleryKey, true);
    const target = this.items[this.current ?? 0]?.button;
    target?.scrollIntoView?.({ block: "center" });
    if (typeof IntersectionObserver === "undefined") this.refreshFallback();
    (target ?? this.closeButton)?.focus();
    this.options.onGalleryToggle?.(true);
  }
  // Closing keeps the current slide, the built grid and its scroll position; focus goes back to where it was.
  closeGallery(): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener("keydown", this.galleryKey, true);
    this.galleryObserver?.disconnect(); this.galleryObserver = undefined;
    this.stopFallback();
    for (const { tile } of this.items) tile.setVisible(false);
    this.dialog!.hidden = true;
    const focus = this.returnFocus?.isConnected ? this.returnFocus : this.openButton;
    this.returnFocus = null; focus.focus();
    this.options.onGalleryToggle?.(false);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.galleryKey, true);
    this.stripObserver?.disconnect(); this.galleryObserver?.disconnect(); this.stopFallback();
    this.open = false;
    this.options.thumbnails.dispose();
    this.dialog?.remove(); this.root.remove();
    this.items = [];
  }

  private scheduleFallback = (): void => {
    if (this.fallbackTimer === undefined) this.fallbackTimer = setTimeout(() => { this.fallbackTimer = undefined; this.refreshFallback(); }, 80);
  };
  private stopFallback(): void {
    this.grid?.removeEventListener("scroll", this.scheduleFallback);
    if (this.fallbackTimer !== undefined) { clearTimeout(this.fallbackTimer); this.fallbackTimer = undefined; }
  }
  private refreshFallback(): void {
    if (this.destroyed || !this.open || !this.grid) return;
    const area = this.grid.getBoundingClientRect(), laidOut = area.height > 0;
    const start = Math.max(0, (this.current ?? 0) - FALLBACK_WINDOW / 2);
    this.items.forEach(({ button, tile }, index) => {
      if (laidOut) { const box = button.getBoundingClientRect(); tile.setVisible(box.bottom >= area.top - FALLBACK_MARGIN && box.top <= area.bottom + FALLBACK_MARGIN); }
      else tile.setVisible(index >= start && index < start + FALLBACK_WINDOW);
    });
  }
  private observed(entries: IntersectionObserverEntry[]): void {
    if (this.destroyed) return;
    for (const entry of entries) this.owners.get(entry.target)?.setVisible(entry.isIntersecting);
  }
  private mark(index: number, current: boolean): void {
    const button = this.items[index]?.button; if (!button) return;
    if (current) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current");
  }
  private buildGallery(): void {
    if (this.dialog) return;
    const { classroom, host } = this.options;
    const dialog = this.dialog = document.createElement("div");
    dialog.className = "slide-gallery"; dialog.hidden = true; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    const titleId = `slide-gallery-title-${Math.random().toString(36).slice(2, 8)}`; dialog.setAttribute("aria-labelledby", titleId);
    const panel = document.createElement("div"); panel.className = "slide-gallery-panel";
    const head = document.createElement("header"); head.className = "slide-gallery-head";
    const title = document.createElement("h2"); title.id = titleId; title.textContent = "Todas las diapositivas";
    const total = document.createElement("span"); total.textContent = `${this.count} diapositivas`;
    const close = this.closeButton = document.createElement("button"); close.type = "button"; close.className = "button button-outline slide-gallery-close"; close.dataset.slideGalleryClose = ""; close.textContent = "Cerrar";
    close.onclick = () => this.closeGallery();
    head.append(title, total, close);
    const grid = this.grid = document.createElement("ol"); grid.className = "slide-gallery-grid";
    classroom.manifest.slides.forEach((_slide, index) => {
      const item = document.createElement("li"), button = document.createElement("button"), tile = new Tile(this.options.thumbnails, false), label = document.createElement("span");
      button.type = "button"; button.className = "slide-gallery-item"; button.dataset.slideIndex = String(index);
      const name = slideTitle(classroom, index);
      button.setAttribute("aria-label", `Diapositiva ${index + 1}: ${name}`);
      label.className = "slide-gallery-label"; const number = document.createElement("b"); number.textContent = String(index + 1); label.append(number, name);
      tile.setIndex(index); this.owners.set(tile.thumb, tile);
      if (index === this.current) button.setAttribute("aria-current", "true");
      button.onclick = () => { this.closeGallery(); this.options.onSelect(index); };
      button.append(tile.thumb, label); item.append(button); grid.append(item);
      this.items.push({ button, tile });
    });
    panel.append(head, grid); dialog.append(panel);
    dialog.addEventListener("mousedown", event => { if (event.target === dialog) this.closeGallery(); });
    (host.closest(".classroom-player") || host).append(dialog);
  }
  // Capture phase on window: while the gallery is open Escape only closes it and no class shortcut ever sees the key.
  private galleryKey = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); this.closeGallery(); return; }
    const target = event.target as HTMLElement | null;
    const position = this.items.findIndex(item => item.button === target);
    if (event.key === "Tab") {
      const first = this.closeButton!, last = this.items[this.items.length - 1]?.button ?? first;
      if (!this.dialog!.contains(target)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && target === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && target === last) { event.preventDefault(); first.focus(); }
      event.stopImmediatePropagation(); return;
    }
    if (position >= 0 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const top = this.items[0].button.offsetTop, columns = Math.max(1, this.items.filter(item => item.button.offsetTop === top).length);
      const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[event.key];
      const destination = event.key === "Home" ? 0 : event.key === "End" ? this.items.length - 1 : Math.max(0, Math.min(this.items.length - 1, position + step));
      event.preventDefault(); event.stopImmediatePropagation(); this.items[destination].button.focus(); return;
    }
    // Enter and Space keep activating the focused button natively; nothing else reaches the player.
    event.stopImmediatePropagation();
  };
}
