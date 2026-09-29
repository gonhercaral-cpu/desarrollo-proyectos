import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { BaseRenderer } from "../base.ts";
import { assertLocalUrl } from "../../local-source.ts";
import type { PlayerCommand, RendererOptions, RendererSource } from "../../types.ts";

type PdfLoader = (data: Uint8Array) => Promise<PDFDocumentLoadingTask>;
const defaultLoader: PdfLoader = async (data) => (await import("./pdf-runtime.ts")).loadPdf(data);

export class PdfRenderer extends BaseRenderer {
  kind = "pdf" as const;
  private loader: PdfLoader;
  private document?: PDFDocumentProxy;
  private task?: PDFDocumentLoadingTask;
  private rendering?: RenderTask;
  private abort = new AbortController();
  private observer?: ResizeObserver;
  private area?: HTMLElement;
  private toolbar?: HTMLElement;
  private sequence = 0;
  private requestedPage = 1;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(loader: PdfLoader = defaultLoader) { super(); this.loader = loader; }

  async mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void> {
    this.options = options;
    this.requestedPage = options.page;
    this.notify({ loading: true, page: options.page });
    this.area = document.createElement("div"); this.area.className = "player-pdf-area";
    this.toolbar = document.createElement("div"); this.toolbar.className = "player-pdf-toolbar";
    host.classList.add("player-pdf"); host.replaceChildren(this.area, this.toolbar);
    this.timeout = setTimeout(() => { this.abort.abort(); void this.task?.destroy().catch(() => {}); this.fail("Tiempo agotado al abrir el PDF local."); }, 30000);
    try {
      assertLocalUrl(source.url);
      const response = await fetch(source.url, { signal: this.abort.signal, redirect: "error" });
      if (!response.ok) throw new Error("PDF local ausente.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== source.sizeBytes) throw new Error("PDF local incompleto o corrupto.");
      if (this.disposed || this.abort.signal.aborted) return;
      this.task = await this.loader(bytes);
      if (this.disposed || this.abort.signal.aborted) { await this.task.destroy(); return; }
      this.task.onPassword = () => { this.fail("PDF protegido con contraseña: no compatible en este hito."); void this.task?.destroy().catch(() => {}); };
      this.document = await this.task.promise;
      clearTimeout(this.timeout);
      if (this.disposed || this.abort.signal.aborted) return;
      this.notify({ pages: this.document.numPages });
      this.observer = new ResizeObserver(() => { void this.setPage(this.state.page); });
      this.observer.observe(this.area);
      await this.setPage(this.requestedPage);
    } catch (error) { if (!this.disposed && !this.abort.signal.aborted) this.fail(error instanceof Error ? `No se pudo abrir el PDF local: ${error.message}` : "PDF local corrupto."); }
  }

  private fail(message: string): void { clearTimeout(this.timeout); this.notify({ loading: false, error: message }); }
  async setPage(pageNumber: number): Promise<void> {
    this.requestedPage = pageNumber;
    const pdf = this.document; const area = this.area;
    if (!pdf || !area || this.disposed) return;
    const sequence = ++this.sequence;
    this.rendering?.cancel();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      area.replaceChildren(); this.notify({ page: pageNumber }); this.buttons();
      this.fail(`Página ${pageNumber} ausente en el PDF (${pdf.numPages} páginas).`); return;
    }
    this.notify({ page: pageNumber, loading: true, error: "" }); this.buttons();
    try {
      const page = await pdf.getPage(pageNumber);
      if (sequence !== this.sequence || this.disposed) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.05, Math.min((area.clientWidth || 800) / base.width, (area.clientHeight || 500) / base.height));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (base.width * base.height * scale * scale)));
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      // Each render owns a canvas; a cancelled render can never overwrite a newer page.
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${viewport.width / pixelRatio}px`; canvas.style.height = `${viewport.height / pixelRatio}px`;
      canvas.setAttribute("aria-label", `Página ${pageNumber} de ${pdf.numPages}`);
      this.rendering = page.render({ canvas, viewport });
      await this.rendering.promise;
      if (sequence !== this.sequence || this.disposed) return;
      area.replaceChildren(canvas); this.notify({ loading: false });
    } catch (error) {
      if (sequence === this.sequence && !this.disposed && (error as Error)?.name !== "RenderingCancelledException") this.fail("No se pudo dibujar esta página. El PDF puede estar corrupto.");
    }
  }
  private buttons(): void {
    if (!this.toolbar) return;
    this.toolbar.replaceChildren();
    const previous = document.createElement("button"); previous.className = "button button-outline"; previous.textContent = "Página anterior"; previous.disabled = this.state.page <= 1;
    previous.onclick = () => { void this.command("PREVIOUS"); };
    const label = document.createElement("span"); label.textContent = `PDF ${this.state.page} / ${this.state.pages}`;
    const next = document.createElement("button"); next.className = "button button-outline"; next.textContent = "Página siguiente"; next.disabled = this.state.page >= this.state.pages;
    next.onclick = () => { void this.command("NEXT"); };
    this.toolbar.append(previous, label, next);
  }
  async command(command: PlayerCommand): Promise<void> {
    if (command !== "NEXT" && command !== "PREVIOUS") return;
    const page = this.state.page + (command === "NEXT" ? 1 : -1);
    if (page < 1 || page > this.state.pages) return;
    this.options?.onPage(page); await this.setPage(page);
  }
  destroy(): void {
    super.destroy(); ++this.sequence; clearTimeout(this.timeout); this.abort.abort();
    this.observer?.disconnect(); this.rendering?.cancel();
    void this.task?.destroy().catch(() => {});
    this.area?.replaceChildren(); this.toolbar?.replaceChildren();
  }
}
