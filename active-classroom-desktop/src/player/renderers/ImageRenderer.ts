import { BaseRenderer } from "./base.ts";
import type { RendererOptions, RendererSource } from "../types.ts";

export class ImageRenderer extends BaseRenderer {
  private change = 0;
  private pending?: HTMLImageElement;
  private discardPending(): void {
    const stale = this.pending; this.pending = undefined;
    if (stale) { stale.onload = null; stale.onerror = null; stale.removeAttribute("src"); }
  }
  async setSource(source: RendererSource): Promise<void> {
    const change = ++this.change;
    this.discardPending();
    if (this.disposed || !this.image || this.image.src === source.url) return;
    const next = new Image(); this.pending = next; next.src = source.url;
    try { await next.decode(); }
    catch (error) { if (change === this.change && !this.disposed) throw error; return; } // superseded/destroyed: not an error
    finally { if (this.pending === next) this.discardPending(); else { next.onload = null; next.onerror = null; next.removeAttribute("src"); } }
    if (change === this.change && !this.disposed && this.image) this.image.src = source.url;
  }
  kind = "image" as const;
  image?: HTMLImageElement;
  timeout?: ReturnType<typeof setTimeout>;
  async mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    const image = document.createElement("img"); this.image = image;
    image.alt = source.name; image.className = "player-image";
    image.onload = () => { clearTimeout(this.timeout); this.notify({ loading: false }); };
    image.onerror = () => { clearTimeout(this.timeout); this.notify({ loading: false, error: "Imagen local ausente, corrupta o incompatible." }); };
    this.notify({ loading: true });
    this.timeout = setTimeout(() => this.notify({ loading: false, error: "No se pudo cargar la imagen local." }), 20000);
    host.replaceChildren(image); image.src = source.url;
  }
  destroy(): void {
    this.disposed = true; ++this.change; this.discardPending();
    super.destroy(); clearTimeout(this.timeout);
    if (this.image) { this.image.onload = null; this.image.onerror = null; this.image.removeAttribute("src"); this.image.remove(); }
  }
}
