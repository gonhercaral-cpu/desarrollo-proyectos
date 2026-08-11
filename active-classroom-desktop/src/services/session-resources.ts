import type { ResourceKind } from "../models/content";
import type { InternalPresentation } from "../models/presentation";
import { resourceIcon } from "../components/teacher-sidebar";
import { escapeHtml } from "../utils/dom";

export interface ImportedSessionResource {
  id: string;
  name: string;
  size: number;
  kind: ResourceKind;
  url?: string;
  nativePath?: string;
  presentation?: InternalPresentation;
  extension: string;
}

export async function importSessionResource(file: File): Promise<ImportedSessionResource | string> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let kind: ResourceKind | null = null;
  if (["ppt", "pptx"].includes(extension)) kind = "presentation";
  else if (extension === "pdf" || file.type === "application/pdf") kind = "document";
  else if (file.type.startsWith("video/")) kind = "video";
  else if (file.type.startsWith("audio/")) kind = "audio";
  else if (file.type.startsWith("image/")) kind = "image";

  if (!kind) return `${file.name}: formato no compatible.`;
  if (file.size === 0) return `${file.name}: el archivo está vacío.`;
  if (file.size > 512 * 1024 * 1024) return `${file.name}: supera el límite de 512 MB por archivo.`;
  if (["ppt", "pptx"].includes(extension) && !(await hasPresentationSignature(file, extension))) {
    return `${file.name}: la firma del archivo no corresponde a una presentación ${extension.toUpperCase()}.`;
  }
  return { id: crypto.randomUUID(), name: file.name, size: file.size, kind, extension, url: URL.createObjectURL(file) };
}

export function renderResourceList(target: HTMLElement, resources: ImportedSessionResource[], activeId: string | null): void {
  if (resources.length === 0) {
    target.innerHTML = `<div class="resource-empty"><span>⇧</span><strong>Aún no hay materiales</strong><small>Importa un PPTX, PDF, video, audio o imagen.</small></div>`;
    return;
  }
  target.innerHTML = resources.map((resource, index) => `
    <button class="resource-row${resource.id === activeId ? " is-selected" : ""}" data-resource-id="${resource.id}">
      <span class="resource-icon resource-${resource.kind}">${resourceIcon(resource.kind)}</span>
      <span class="resource-info"><strong>${escapeHtml(resource.name)}</strong><small>${resourceLabel(resource)} · ${resource.presentation ? `${resource.presentation.slides.length} diapositivas` : formatFileSize(resource.size)}</small></span>
      <span class="resource-order">${String(index + 1).padStart(2, "0")}</span>
    </button>`).join("");
}

export function resourceLabel(resource: ImportedSessionResource): string {
  if (resource.kind === "presentation") return resource.extension === "pptx" ? "PowerPoint PPTX" : "PowerPoint PPT";
  return ({ video: "Video", audio: "Audio", image: "Imagen", document: "Documento PDF" })[resource.kind];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function hasPresentationSignature(file: File, extension: string): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const expected = extension === "pptx" ? [0x50, 0x4b, 0x03, 0x04] : [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return expected.every((value, index) => bytes[index] === value);
}
