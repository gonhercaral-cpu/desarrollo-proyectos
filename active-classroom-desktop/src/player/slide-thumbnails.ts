import { localSource } from "./local-source.ts";
import { rendererKind, type LocalClassroom } from "./types.ts";

// Thumbnails are disposable UI images built only from the verified local cache: they never download remote data,
// never create cache objects and never touch the audio, video or projection pipelines.
export const MAX_THUMBNAIL_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_THUMBNAIL_CACHE = 48;
export const MAX_IMAGE_SOURCE_PIXELS = 40 * 1024 * 1024;
export const PDF_OPEN_TIMEOUT_MS = 20000;
export const CANCEL_GRACE_MS = 1500;
export const THUMBNAIL_BOX = { width: 320, height: 200 };

export interface PdfThumbnailDocument {
  render(page: number, signal: AbortSignal): Promise<Blob>;
  destroy(): void | Promise<void>;
}
export type ThumbnailResult = { status: "ready"; url: string } | { status: "error"; message: string } | { status: "cancelled" };
export interface SlideThumbnailOptions {
  classroom: LocalClassroom;
  verifyResource(id: string): Promise<boolean>;
  toUrl?: (path: string) => string;
  // Reads a local URL as bytes; must reject when the signal aborts or the payload exceeds maxBytes.
  fetchBytes?: (url: string, signal: AbortSignal, maxBytes: number) => Promise<Uint8Array>;
  // The signal aborts when loading is abandoned (timeout, dispose, document switch): implementations must release the task.
  openPdf?: (bytes: Uint8Array, signal: AbortSignal) => Promise<PdfThumbnailDocument>;
  // Test hook: turns a source image into a small thumbnail blob. Defaults to rasterizeImage (canvas, max 320x200).
  rasterizeImage?: (blob: Blob, signal: AbortSignal) => Promise<Blob>;
  objectUrls?: { create(blob: Blob): string; revoke(url: string): void };
  maxCacheEntries?: number;
  maxSourceBytes?: number;
  maxImagePixels?: number;
  // Time allowed to read and open a PDF, and to let a cancelled render wind down before the queue moves on.
  openTimeoutMs?: number;
  cancelGraceMs?: number;
}
interface Job { index: number; refs: number; controller: AbortController; promise: Promise<ThumbnailResult>; settle(result: ThumbnailResult): void }

export async function fetchLocalBytes(url: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) throw new Error("Archivo local no disponible.");
  const tooLarge = () => new Error("Archivo demasiado grande para una vista previa.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw tooLarge();
    return bytes;
  }
  // The limit is enforced while streaming so an oversized or lying response is never fully buffered.
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function openPdfThumbnails(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfThumbnailDocument> {
  const { loadPdf } = await import("./renderers/Presentation/pdf-runtime.ts");
  const task = loadPdf(bytes);
  let abandon!: (error: Error) => void;
  const abandoned = new Promise<never>((_resolve, reject) => { abandon = reject; });
  abandoned.catch(() => {});
  // Password-protected files cannot be previewed: refuse instead of waiting for a password that never comes.
  task.onPassword = () => abandon(new Error("PDF protegido con contraseña."));
  const onAbort = () => abandon(new Error("cancelled"));
  if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
  let pdf;
  try { pdf = await Promise.race([task.promise, abandoned]); }
  catch (error) {
    void Promise.resolve(task.destroy()).catch(() => {});
    throw error instanceof Error && /password|Password/.test(error.name + error.message) ? new Error("PDF protegido con contraseña.") : error;
  } finally { signal?.removeEventListener("abort", onAbort); }
  return {
    async render(pageNumber, renderSignal) {
      const page = await pdf.getPage(pageNumber);
      try {
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(THUMBNAIL_BOX.width / original.width, THUMBNAIL_BOX.height / original.height) });
        const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const render = page.render({ canvas, viewport });
        const cancel = () => render.cancel(); renderSignal.addEventListener("abort", cancel, { once: true });
        try { await render.promise; } finally { renderSignal.removeEventListener("abort", cancel); }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Vista previa no disponible.")), "image/webp", 0.82));
        canvas.width = 0; canvas.height = 0;
        return blob;
      } finally { page.cleanup(); }
    },
    destroy: () => task.destroy(),
  };
}

// Size that fits the thumbnail box without ever upscaling.
export function fitThumbnail(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, THUMBNAIL_BOX.width / width, THUMBNAIL_BOX.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Reads the pixel size from the file header (PNG, GIF, JPEG, WebP) so a decompression bomb is refused before decoding.
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = (i: number) => bytes[i];
  const ascii = (from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length));
  if (bytes.length >= 24 && at(0) === 0x89 && ascii(1, 3) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ascii(0, 3) === "GIF") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8X") return { width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
    if (kind === "VP8L") { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (bytes.length > 4 && at(0) === 0xff && at(1) === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (at(offset) !== 0xff) { offset++; continue; }
      const marker = at(offset + 1);
      if (marker === 0xff) { offset++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

export interface RasterDeps {
  createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?(): void }>;
  createCanvas?: (width: number, height: number) => { draw(source: unknown, width: number, height: number): void; toBlob(): Promise<Blob>; release(): void };
  loadImage?: (blob: Blob) => Promise<{ source: unknown; width: number; height: number; release(): void }>;
  maxPixels?: number;
}
const domCanvas: NonNullable<RasterDeps["createCanvas"]> = (width, height) => {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  return {
    draw(source, w, h) { if (!context) throw new Error("Vista previa no disponible."); context.drawImage(source as CanvasImageSource, 0, 0, w, h); },
    toBlob: () => new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Vista previa no disponible.")), "image/webp", 0.82)),
    release() { canvas.width = 0; canvas.height = 0; },
  };
};
const domImage: NonNullable<RasterDeps["loadImage"]> = async blob => {
  const url = URL.createObjectURL(blob), image = new Image();
  const release = () => { image.removeAttribute("src"); URL.revokeObjectURL(url); };
  try { image.decoding = "async"; image.src = url; await image.decode(); }
  catch { release(); throw new Error("Imagen no válida para una vista previa."); }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release };
};

// Rasterizes an image to at most 320x200 so the cache never keeps the original (possibly huge) file alive.
export async function rasterizeImage(blob: Blob, deps: RasterDeps = {}): Promise<Blob> {
  const maxPixels = deps.maxPixels ?? MAX_IMAGE_SOURCE_PIXELS, tooBig = () => new Error("Imagen demasiado grande para una vista previa.");
  const header = imageDimensions(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
  if (header && header.width * header.height > maxPixels) throw tooBig();
  const makeBitmap = deps.createImageBitmap ?? (typeof createImageBitmap === "function" ? (b: Blob) => createImageBitmap(b) : undefined);
  const createCanvas = deps.createCanvas ?? domCanvas;
  let source: unknown, width: number, height: number, release: () => void;
  if (makeBitmap) {
    let bitmap;
    try { bitmap = await makeBitmap(blob); } catch { throw new Error("Imagen no válida para una vista previa."); }
    source = bitmap; width = bitmap.width; height = bitmap.height; release = () => bitmap.close?.();
  } else {
    const loaded = await (deps.loadImage ?? domImage)(blob);
    ({ source, width, height, release } = loaded);
  }
  try {
    if (!width || !height || width * height > maxPixels) throw tooBig();
    const size = fitThumbnail(width, height), canvas = createCanvas(size.width, size.height);
    try { canvas.draw(source, size.width, size.height); return await canvas.toBlob(); } finally { canvas.release(); }
  } finally { release(); }
}

export class SlideThumbnails {
  // Called when a cached thumbnail is dropped (its object URL is already revoked), so views can release or reload it.
  onEvict?: (index: number) => void;
  // Thumbnails on screen are never evicted (the cache bound is soft by the visible count), so a view never thrashes.
  retain?: (index: number) => boolean;
  private options: SlideThumbnailOptions;
  private cache = new Map<number, string>();
  private failures = new Map<number, string>();
  private jobs = new Map<number, Job>();
  private queue: Job[] = [];
  private running = false;
  private disposed = false;
  private verified = new Map<string, Promise<void>>();
  // One PDF document at a time: switching to another presentation resource destroys the previous one.
  private pdf?: { id: string; handle: Promise<PdfThumbnailDocument>; abort: AbortController };
  // A PDF that failed to open (corrupt, protected, timed out) fails fast for its other pages until a retry.
  private pdfFailures = new Map<string, string>();

  constructor(options: SlideThumbnailOptions) { this.options = options; }

  get pendingCount(): number { return this.jobs.size; }
  get cachedCount(): number { return this.cache.size; }
  get hasOpenPdf(): boolean { return !!this.pdf; }

  // Presentation image or PDF page that represents a slide, following the same rules as the player.
  reference(index: number): { resourceId: string; page: number } | null {
    const manifest = this.options.classroom.manifest, slide = manifest.slides[index];
    if (!slide) return null;
    const resourceId = String(slide.interaction?.initialResourceId || slide.metadata?.presentationResourceId || manifest.mainPresentationId);
    const resource = manifest.resources.find(item => item.resourceId === resourceId);
    if (!resource) return null;
    const page = rendererKind(resource.download.mimeType) === "pdf" ? Number(slide.metadata?.pageNumber ?? index + 1) : 1;
    return { resourceId, page: Number.isInteger(page) && page >= 1 ? page : index + 1 };
  }
  get(index: number): string | undefined {
    const url = this.cache.get(index);
    if (url !== undefined) { this.cache.delete(index); this.cache.set(index, url); }
    return url;
  }
  failure(index: number): string | undefined { return this.failures.get(index); }

  // Each request pairs with at most one cancel; the job is aborted only when every requester has cancelled.
  request(index: number, options: { priority?: boolean; retry?: boolean } = {}): Promise<ThumbnailResult> {
    if (this.disposed) return Promise.resolve({ status: "cancelled" });
    const cached = this.get(index);
    if (cached !== undefined) return Promise.resolve({ status: "ready", url: cached });
    if (options.retry) { this.failures.delete(index); const ref = this.reference(index); if (ref) this.pdfFailures.delete(ref.resourceId); }
    const failed = this.failures.get(index);
    if (failed !== undefined) return Promise.resolve({ status: "error", message: failed });
    const existing = this.jobs.get(index);
    // An aborted job is still winding down: start over once it has settled instead of sharing its cancellation.
    if (existing?.controller.signal.aborted) return existing.promise.then(() => this.request(index, options));
    if (existing) {
      existing.refs++;
      const position = this.queue.indexOf(existing);
      if (options.priority && position > 0) { this.queue.splice(position, 1); this.queue.unshift(existing); }
      return existing.promise;
    }
    let settle!: (result: ThumbnailResult) => void;
    const promise = new Promise<ThumbnailResult>(resolve => { settle = resolve; });
    const job: Job = { index, refs: 1, controller: new AbortController(), promise, settle };
    this.jobs.set(index, job);
    if (options.priority) this.queue.unshift(job); else this.queue.push(job);
    void this.drain();
    return promise;
  }
  cancel(index: number): void {
    const job = this.jobs.get(index);
    if (!job || --job.refs > 0) return;
    job.controller.abort();
    const position = this.queue.indexOf(job);
    if (position >= 0) { this.queue.splice(position, 1); this.jobs.delete(index); job.settle({ status: "cancelled" }); }
  }
  cancelAll(): void {
    for (const job of this.jobs.values()) job.controller.abort();
    for (const job of this.queue) { this.jobs.delete(job.index); job.settle({ status: "cancelled" }); }
    this.queue = [];
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.onEvict = undefined; this.retain = undefined;
    this.cancelAll(); this.closePdf();
    for (const url of this.cache.values()) this.revoke(url);
    this.cache.clear(); this.failures.clear(); this.verified.clear(); this.pdfFailures.clear();
  }

  private revoke(url: string): void { try { (this.options.objectUrls?.revoke ?? URL.revokeObjectURL)(url); } catch { /* Revoking is best effort. */ } }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { while (!this.disposed && this.queue.length) await this.run(this.queue.shift()!); }
    finally { this.running = false; }
  }
  private async run(job: Job): Promise<void> {
    const signal = job.controller.signal;
    let result: ThumbnailResult;
    const work = this.produce(job.index, signal);
    work.catch(() => {});
    try {
      // Abort wins immediately: a stuck load or render never keeps the job (or dispose) waiting.
      const blob = await this.untilAborted(work, signal);
      if (signal.aborted || this.disposed) result = { status: "cancelled" };
      else {
        const url = (this.options.objectUrls?.create ?? URL.createObjectURL)(blob);
        this.store(job.index, url); result = { status: "ready", url };
      }
    } catch (error) {
      if (signal.aborted || this.disposed) result = { status: "cancelled" };
      else {
        const message = error instanceof Error && error.message ? error.message : "Vista previa no disponible.";
        this.failures.set(job.index, message); result = { status: "error", message };
      }
    }
    this.jobs.delete(job.index); job.settle(result);
    // A cancelled render gets a short grace period to release the canvas; past it the document is dropped so the queue moves on.
    if (signal.aborted && !this.disposed) {
      const grace = this.options.cancelGraceMs ?? CANCEL_GRACE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = await Promise.race([work.then(() => false, () => false), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), grace); })]);
      clearTimeout(timer);
      if (expired) this.closePdf();
    }
  }
  private untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error("cancelled"));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error("cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
  private store(index: number, url: string): void {
    this.failures.delete(index); this.cache.set(index, url);
    const limit = Math.max(1, this.options.maxCacheEntries ?? MAX_THUMBNAIL_CACHE);
    for (const candidate of [...this.cache.keys()]) {
      if (this.cache.size <= limit) break;
      if (candidate === index || this.retain?.(candidate)) continue;
      this.revoke(this.cache.get(candidate)!); this.cache.delete(candidate); this.onEvict?.(candidate);
    }
  }
  private async produce(index: number, signal: AbortSignal): Promise<Blob> {
    const reference = this.reference(index);
    if (!reference) throw new Error("La diapositiva no tiene imagen asociada.");
    const resource = this.options.classroom.manifest.resources.find(item => item.resourceId === reference.resourceId)!;
    const kind = rendererKind(resource.download.mimeType);
    const maxBytes = this.options.maxSourceBytes ?? MAX_THUMBNAIL_SOURCE_BYTES;
    if (kind !== "pdf" && kind !== "image") throw new Error("Este formato no tiene vista previa.");
    if (resource.download.sizeBytes > maxBytes) throw new Error("Archivo demasiado grande para una vista previa.");
    await this.verify(reference.resourceId);
    if (signal.aborted) throw new Error("cancelled");
    if (kind === "pdf") {
      const document = await this.document(reference.resourceId, resource.download.sizeBytes, maxBytes);
      if (signal.aborted) throw new Error("cancelled");
      return document.render(reference.page, signal);
    }
    const bytes = await this.read(reference.resourceId, resource.download.sizeBytes, maxBytes, signal);
    const source = new Blob([bytes as BlobPart], { type: resource.download.mimeType });
    if (this.options.rasterizeImage) return this.options.rasterizeImage(source, signal);
    return rasterizeImage(source, { maxPixels: this.options.maxImagePixels });
  }
  // Streams at most the manifest size (never more than maxBytes) and requires the cached file to match it.
  private async read(id: string, declared: number, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
    const expected = Number.isFinite(declared) && declared > 0 ? declared : 0;
    const bytes = await (this.options.fetchBytes ?? fetchLocalBytes)(this.localUrl(id), signal, expected ? Math.min(expected, maxBytes) : maxBytes);
    if (bytes.length > maxBytes) throw new Error("Archivo demasiado grande para una vista previa.");
    if (expected && bytes.length !== expected) throw new Error("Archivo local con tamaño distinto al del manifiesto.");
    return bytes;
  }
  private localUrl(id: string): string { return localSource(this.options.classroom, id, this.options.toUrl).url; }
  private verify(id: string): Promise<void> {
    let pending = this.verified.get(id);
    if (!pending) {
      pending = this.options.verifyResource(id).then(valid => { if (!valid) throw new Error("Archivo local ausente o dañado."); });
      this.verified.set(id, pending);
      pending.catch(() => { if (this.verified.get(id) === pending) this.verified.delete(id); });
    }
    return pending;
  }
  private document(id: string, declared: number, maxBytes: number): Promise<PdfThumbnailDocument> {
    if (this.pdf?.id === id) return this.pdf.handle;
    const known = this.pdfFailures.get(id);
    if (known !== undefined) return Promise.reject(new Error(known));
    this.closePdf();
    const abort = new AbortController(), timeoutMs = this.options.openTimeoutMs ?? PDF_OPEN_TIMEOUT_MS;
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const handle = (async () => {
      const bytes = await this.read(id, declared, maxBytes, abort.signal);
      const opening = (this.options.openPdf ?? openPdfThumbnails)(bytes, abort.signal);
      // Whatever happens to the race, a document that opens after the load was abandoned is destroyed, never leaked.
      opening.then(document => { if (abort.signal.aborted) void Promise.resolve(document.destroy()).catch(() => {}); }, () => {});
      return this.untilAborted(opening, abort.signal);
    })().then(document => { clearTimeout(timer); return document; }, error => {
      clearTimeout(timer);
      const timedOut = abort.signal.aborted && this.pdf?.abort === abort && !this.disposed;
      throw timedOut ? new Error("Tiempo agotado al abrir el PDF.") : error;
    });
    const entry = { id, handle, abort }; this.pdf = entry;
    handle.catch(error => {
      if (this.pdf === entry) this.pdf = undefined;
      if (!this.disposed && !(error instanceof Error && error.message === "cancelled")) this.pdfFailures.set(id, error instanceof Error ? error.message : "PDF no disponible.");
    });
    return handle;
  }
  private closePdf(): void {
    const entry = this.pdf; this.pdf = undefined;
    if (!entry) return;
    entry.abort.abort();
    entry.handle.then(document => document.destroy(), () => {}).catch(() => {});
  }
}
