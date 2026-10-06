import { convertFileSrc } from "@tauri-apps/api/core";
import type { LocalClassroom, RendererSource } from "./types.ts";

export function localAssetUrl(path: string): string {
  if (!path.startsWith("/") && !/^[a-z]:[\\/]/i.test(path)) throw new Error("El recurso no tiene una ruta local absoluta.");
  return convertFileSrc(path);
}

export function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && /^\d+$/.test(parsed.port) && /^\/media\/[a-f0-9]{64}$/.test(parsed.pathname) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) return;
  if ((parsed.protocol === "asset:" && parsed.hostname === "localhost") ||
      (["http:", "https:"].includes(parsed.protocol) && parsed.hostname === "asset.localhost" && !parsed.port && !parsed.username && !parsed.password)) return;
  throw new Error("El Player solo admite archivos del caché local.");
}

export function localSource(classroom: LocalClassroom, id: string, toUrl = localAssetUrl): RendererSource {
  const resource = classroom.manifest.resources.find((item) => item.resourceId === id);
  if (!resource) throw new Error("Recurso ausente en el manifest local.");
  const local = classroom.resolveResource(id);
  if (local.mimeType !== resource.download.mimeType) throw new Error("MIME local inconsistente con el manifest.");
  const url = toUrl(local.path);
  assertLocalUrl(url);
  return { url, mimeType: local.mimeType, name: local.name, sizeBytes: resource.download.sizeBytes };
}
