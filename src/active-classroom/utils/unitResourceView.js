import { needsOfficeProcessing, documentProcessingReady } from "./unitDraft.js";

export function normalizeString(str) {
  if (typeof str !== "string") {
    return "";
  }
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getFileTypeCategory(resource) {
  const mime = typeof resource?.mimeType === "string" ? resource.mimeType.toLowerCase() : "";
  const kind = typeof resource?.kind === "string" ? resource.kind.toLowerCase() : "";
  const name = typeof resource?.name === "string" ? resource.name.toLowerCase() : "";

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    kind === "presentation" ||
    mime === "application/vnd.google-apps.presentation" ||
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    name.endsWith(".pptx") ||
    name.endsWith(".ppt") ||
    name.endsWith(".odp")
  ) {
    return "presentation";
  }

  if (
    kind === "document" ||
    mime === "application/vnd.google-apps.document" ||
    mime.includes("wordprocessing") ||
    mime.includes("msword") ||
    mime.startsWith("text/") ||
    name.endsWith(".docx") ||
    name.endsWith(".doc") ||
    name.endsWith(".txt") ||
    name.endsWith(".rtf") ||
    name.endsWith(".odt")
  ) {
    return "document";
  }

  if (mime.startsWith("image/") || kind === "image" || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) {
    return "image";
  }

  if (mime.startsWith("audio/") || kind === "audio" || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) {
    return "audio";
  }

  if (mime.startsWith("video/") || kind === "video" || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) {
    return "video";
  }

  return "other";
}

export function getProcessingStatus(resource) {
  if (documentProcessingReady(resource)) {
    return "ready";
  }

  const rawState = typeof resource?.processing?.state === "string"
    ? resource.processing.state.toLowerCase()
    : "";

  if (rawState === "ready") {
    return needsOfficeProcessing(resource) ? "pending" : "ready";
  }
  if (rawState === "failed" || rawState === "error") {
    return "error";
  }
  if (rawState === "processing" || rawState === "running" || rawState === "queued") {
    return "processing";
  }
  if (rawState === "pending") {
    return "pending";
  }

  const mime = typeof resource?.mimeType === "string" ? resource.mimeType.toLowerCase() : "";
  if (mime === "application/vnd.google-apps.presentation" || needsOfficeProcessing(resource)) {
    return "pending";
  }

  return "none";
}

export function getFormatLabel(resource) {
  if (resource?.mimeType === "application/vnd.google-apps.presentation") return "Google Slides";
  if (resource?.mimeType === "application/vnd.google-apps.document") return "Google Docs";
  const name = typeof resource?.name === "string" ? resource.name : "";
  if (name.includes(".")) {
    const ext = name.split(".").pop().toUpperCase();
    if (ext && ext.length <= 5) {
      return ext;
    }
  }
  const mime = typeof resource?.mimeType === "string" ? resource.mimeType : "";
  if (mime) {
    const sub = mime.split("/")[1] || "";
    return sub.replace(/^vnd\./, "").slice(0, 6).toUpperCase();
  }
  return "";
}

export function getResourceStatus(resource, check) {
  if (check?.status === "unavailable") return { key: "unavailable", label: "Original no disponible", detail: "Selecciona un reemplazo de Nube AES." };
  if (check?.status === "changed") return { key: "changed", label: "Nueva versión disponible", detail: "Actualiza el archivo desde Nube AES." };
  if (check?.status === "error") return { key: "error", label: "Error de comprobación", detail: check.message || "No se pudo comprobar el original." };
  const state = getProcessingStatus(resource);
  if (state === "error") return { key: "error", label: "Error de procesamiento", detail: "Puedes reintentar el procesamiento." };
  if (state === "processing") return { key: "processing", label: "Procesando", detail: "El archivo se está procesando." };
  if (state === "pending") return { key: "pending", label: "Pendiente de procesar", detail: "Procesa el archivo para usarlo en la presentación." };
  if (state === "ready" && needsOfficeProcessing(resource)) return { key: "ready", label: "Procesada", detail: `${resource.processing.pageCount || 0} ${resource.kind === "presentation" ? "diapositivas" : "páginas"}` };
  return { key: "ready", label: "Actualizado", detail: "El archivo está disponible." };
}
