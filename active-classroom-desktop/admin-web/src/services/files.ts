import type { Resource, ResourceKind } from "../models";

export function detectKind(file: File): ResourceKind {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pptx") return "presentation";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return "document";
}

export function createLocalResource(file: File, folderId: string): Resource {
  return {
    id: `file-${crypto.randomUUID()}`,
    folderId,
    name: file.name,
    kind: detectKind(file),
    size: formatSize(file.size),
    byteSize: file.size,
    updated: "Ahora",
    published: false,
    url: URL.createObjectURL(file),
    mimeType: file.type || undefined,
    persisted: false,
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function readImageDimensions(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(`${image.naturalWidth} × ${image.naturalHeight}`);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

export function resourceIcon(kind: ResourceKind): string {
  return ({ presentation: "P", audio: "♫", video: "▶", document: "PDF", image: "IMG" })[kind];
}

export function kindLabel(kind: ResourceKind, name = ""): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "PDF";
  if (extension === "xlsx" || extension === "xls") return "Hoja de cálculo";
  if (extension === "docx" || extension === "doc") return "Documento";
  return ({ presentation: "Presentación", audio: "Audio", video: "Video", document: "Documento", image: "Imagen" })[kind];
}
