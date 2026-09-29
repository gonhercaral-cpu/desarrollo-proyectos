import { BaseRenderer } from "./base.ts";
import type { RendererOptions, RendererSource } from "../types.ts";

export class ImageRenderer extends BaseRenderer {
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
    super.destroy(); clearTimeout(this.timeout);
    if (this.image) { this.image.onload = null; this.image.onerror = null; this.image.removeAttribute("src"); this.image.remove(); }
  }
}
