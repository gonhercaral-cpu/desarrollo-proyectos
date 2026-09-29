import { BaseRenderer } from "./base.ts";
import { ImageRenderer } from "./ImageRenderer.ts";
import { AudioRenderer } from "./AudioRenderer.ts";
import { VideoRenderer } from "./VideoRenderer.ts";
import type { LocalRenderer, RendererKind, RendererOptions, RendererSource } from "../types.ts";

class UnsupportedRenderer extends BaseRenderer {
  kind = "unsupported" as const;
  async mount(_host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    this.notify({ error: `Formato no compatible con el Player: ${source.mimeType}. PPT/PPTX y documentos Office requieren un hito posterior. Puedes usar los demás recursos locales.` });
  }
}
export async function createRenderer(kind: RendererKind): Promise<LocalRenderer> {
  switch (kind) {
    case "pdf": return new (await import("./Presentation/PdfRenderer.ts")).PdfRenderer();
    case "image": return new ImageRenderer();
    case "audio": return new AudioRenderer();
    case "video": return new VideoRenderer();
    default: return new UnsupportedRenderer();
  }
}
