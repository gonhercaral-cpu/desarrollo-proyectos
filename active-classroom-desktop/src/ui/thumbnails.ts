import { isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { localAssetUrl } from "../player/local-source.ts";
import { sha256, validHash, type Manifest } from "../offline/manifest.ts";

// Previews are disposable UI images, never new cache objects or publications.
// Bound PDF/image decoding independently of the publication/download limit.
const maxPreviewBytes = 32 * 1024 * 1024;
export class LocalThumbnails {
  private sequence = 0;
  private owner = "";
  private observer?: IntersectionObserver;
  private aborts = new Set<AbortController>();
  private previews = new Map<string, string>();
  private pdfTasks = new Set<{ destroy(): Promise<void> }>();
  pause(): void {
    this.sequence++; this.observer?.disconnect();
    this.aborts.forEach(controller => controller.abort()); this.aborts.clear();
    this.pdfTasks.forEach(task => { void task.destroy().catch(() => {}); }); this.pdfTasks.clear();
  }
  async mount(root: HTMLElement, owner: string, manifests: Manifest[]): Promise<void> {
    if (!isTauri()) return;
    if (this.owner !== owner) {
      this.previews.forEach(url => URL.revokeObjectURL(url)); this.previews.clear(); this.owner = owner;
    }
    const sequence = this.sequence;
    const cacheRoot = await join(await appDataDir(), "offline-v1", "users", await sha256(new TextEncoder().encode(owner)), "objects").catch(() => "");
    if (!cacheRoot || sequence !== this.sequence) return;
    const queue: Array<() => Promise<void>> = []; let running = false;
    const drain = async () => {
      if (running) return; running = true;
      while (queue.length && sequence === this.sequence) await queue.shift()!();
      running = false;
    };
    const entries = new Map<Element, () => Promise<void>>();
    root.querySelectorAll<HTMLElement>("[data-thumbnail]").forEach(host => {
      const manifest = manifests.find(item => item.unit.unitId === host.dataset.thumbnail);
      if (!manifest) return;
      const coverId = manifest.slides?.[0]?.metadata.presentationResourceId || manifest.mainPresentationId;
      const resource = manifest.resources.find(item => item.resourceId === coverId);
      if (!resource || !validHash(resource.download.checksums.sha256) || resource.download.sizeBytes > maxPreviewBytes
          || !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(resource.download.mimeType)) return;
      const key = resource.download.checksums.sha256;
      const display = (url: string) => {
        if (!host.isConnected || sequence !== this.sequence) return;
        const image = document.createElement("img"); image.className = "unit-cover-image"; image.alt = `Vista previa de ${manifest.unit.name}`; image.src = url;
        host.querySelector(".unit-cover-fallback")?.replaceWith(image);
      };
      if (this.previews.has(key)) { display(this.previews.get(key)!); return; }
      entries.set(host, async () => {
        const controller = new AbortController(); this.aborts.add(controller);
        let pdfTask: { destroy(): Promise<void> } | undefined;
        try {
          const path = await join(cacheRoot, key);
          const response = await fetch(localAssetUrl(path), { signal: controller.signal, redirect: "error" });
          if (!response.ok) return;
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== resource.download.sizeBytes || await sha256(bytes) !== key || sequence !== this.sequence) return;
          let blob: Blob;
          if (resource.download.mimeType === "application/pdf") {
            const { loadPdf } = await import("../player/renderers/Presentation/pdf-runtime.ts");
            const task = loadPdf(bytes); pdfTask = task; this.pdfTasks.add(task);
            const pdf = await task.promise;
            const page = await pdf.getPage(1);
            const original = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(480 / original.width, 300 / original.height) });
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvas, viewport }).promise;
            blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Vista previa no disponible")), "image/webp"));
          } else blob = new Blob([bytes], { type: resource.download.mimeType });
          if (sequence !== this.sequence) return;
          const url = URL.createObjectURL(blob); this.previews.set(key, url); display(url);
          if (this.previews.size > 24) { const oldest = this.previews.keys().next().value!; URL.revokeObjectURL(this.previews.get(oldest)!); this.previews.delete(oldest); }
        } catch { /* A preview failure never prevents downloading/opening the class. */ }
        finally { if (pdfTask) { this.pdfTasks.delete(pdfTask); await pdfTask.destroy().catch(() => {}); } this.aborts.delete(controller); }
      });
    });
    if (typeof IntersectionObserver === "undefined") { queue.push(...entries.values()); void drain(); return; }
    this.observer = new IntersectionObserver(visible => {
      for (const entry of visible) if (entry.isIntersecting && entries.has(entry.target)) {
        queue.push(entries.get(entry.target)!); entries.delete(entry.target); this.observer?.unobserve(entry.target);
      }
      void drain();
    }, { root: root.querySelector(".offline-content"), rootMargin: "100px" });
    entries.forEach((_load, host) => this.observer!.observe(host));
  }
}
