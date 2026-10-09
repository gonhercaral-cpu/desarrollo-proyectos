import type { ResolvedLayer } from "./types.ts";
// Coordinates are percentages of the rendered slide, excluding letterboxing.
export class InteractionSurface {
  private overlay = document.createElement("div");
  private observer?: ResizeObserver;
  private onLoad = () => this.layout();
  private host: HTMLElement;
  private layers: ResolvedLayer[] = [];
  private nodes = new Map<string, HTMLElement>();
  constructor(host: HTMLElement) {
    this.host = host; this.overlay.className = "interaction-surface";
    host.append(this.overlay);
    if (typeof ResizeObserver !== "undefined") { this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(host); }
    host.addEventListener("load", this.onLoad, true);
  }
  update(layers: ResolvedLayer[] = []): void {
    this.layers = layers;
    const retained = new Map<string, HTMLElement>();
    for (const [index, layer] of layers.entries()) {
      const key = `${index}:${JSON.stringify(layer)}`;
      const node = this.nodes.get(key) || document.createElement(layer.type === "image" ? "img" : "span");
      if (!this.nodes.has(key)) {
        if (node.tagName === "IMG") { (node as HTMLImageElement).src = layer.url!; (node as HTMLImageElement).alt = ""; }
        else node.textContent = layer.text || "";
      }
      Object.assign(node.style, { position: "absolute", left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, color: layer.color || "#102954", whiteSpace: "pre-wrap", overflowWrap: "anywhere", objectFit: "contain" });
      this.overlay.append(node);
      retained.set(key, node);
    }
    for (const [key, node] of this.nodes) if (!retained.has(key)) node.remove();
    this.nodes = retained;
    this.host.append(this.overlay); this.layout();
  }
  private layout(): void {
    const image = this.host.querySelector<HTMLImageElement>("img.player-image"); const canvas = this.host.querySelector("canvas");
    const ratio = image?.naturalWidth ? image.naturalWidth / image.naturalHeight : canvas && canvas.height ? canvas.width / canvas.height : 16 / 9;
    const width = Math.min(this.host.clientWidth, this.host.clientHeight * ratio); const height = width / ratio;
    const rectangle = canvas?.getBoundingClientRect(); const hostRectangle = this.host.getBoundingClientRect();
    const bounds = rectangle?.width ? { width: rectangle.width, height: rectangle.height, left: rectangle.left - hostRectangle.left, top: rectangle.top - hostRectangle.top } : { width, height, left: (this.host.clientWidth - width) / 2, top: (this.host.clientHeight - height) / 2 };
    Object.assign(this.overlay.style, Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, `${value}px`])));
    Array.from(this.overlay.children).forEach((node, index) => { (node as HTMLElement).style.fontSize = `${bounds.width * (this.layers[index].fontSize || 3) / 100}px`; });
  }
  destroy(): void { this.observer?.disconnect(); this.host.removeEventListener("load", this.onLoad, true); this.overlay.remove(); }
}
