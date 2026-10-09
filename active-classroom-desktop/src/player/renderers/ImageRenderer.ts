import { BaseRenderer } from "./base.ts";
import type { RendererOptions, RendererSource } from "../types.ts";

export class ImageRenderer extends BaseRenderer {
  private change = 0;
  async setSource(source: RendererSource): Promise<void> {
    const change = ++this.change;
    if (!this.image || this.image.src === source.url) return;
    const next = new Image(); next.src = source.url;
    await next.decode();
    if (change === this.change && this.image) this.image.src = source.url;
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
    ++this.change;
    super.destroy(); clearTimeout(this.timeout);
    if (this.image) { this.image.onload = null; this.image.onerror = null; this.image.removeAttribute("src"); this.image.remove(); }
  }
}
