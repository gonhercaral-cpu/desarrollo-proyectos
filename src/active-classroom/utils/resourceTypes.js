const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "key"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mov", "mp4", "mpeg", "webm"]);
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

export function getFileExtension(name = "") {
  const cleanName = String(name).trim().toLowerCase();
  const separatorIndex = cleanName.lastIndexOf(".");

  return separatorIndex >= 0 ? cleanName.slice(separatorIndex + 1) : "";
}

export function detectResourceKind(fileOrName, mimeType = "") {
  const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name || "";
  const type = typeof fileOrName === "string" ? mimeType : fileOrName?.type || mimeType;
  const extension = getFileExtension(name);

  if (PRESENTATION_EXTENSIONS.has(extension)) return "presentation";
  if (String(type).startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (String(type).startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  if (String(type).startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";

  return "document";
}

export function getResourceKindLabel(kind, name = "") {
  const extension = getFileExtension(name);

  if (extension === "pdf") return "PDF";
  if (["xls", "xlsx"].includes(extension)) return "Hoja de cálculo";
  if (["doc", "docx"].includes(extension)) return "Documento de texto";

  return {
    presentation: "Presentación",
    audio: "Audio",
    video: "Video",
    image: "Imagen",
    document: "Documento",
  }[kind] || "Archivo";
}

export function getResourceIcon(kind, name = "") {
  if (getFileExtension(name) === "pdf") return "PDF";

  return {
    presentation: "P",
    audio: "♫",
    video: "▶",
    image: "IMG",
    document: "DOC",
  }[kind] || "FILE";
}

export function formatFileSize(bytes = 0) {
  const safeBytes = Number(bytes) || 0;

  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${Math.max(1, Math.round(safeBytes / 1024))} KB`;
  if (safeBytes < 1024 * 1024 * 1024) return `${(safeBytes / 1024 / 1024).toFixed(1)} MB`;

  return `${(safeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatResourceDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);

  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function sortFolders(a, b) {
  const firstPosition = Number.isFinite(a?.position) ? a.position : 999;
  const secondPosition = Number.isFinite(b?.position) ? b.position : 999;

  return firstPosition - secondPosition || String(a?.name || "").localeCompare(String(b?.name || ""), "es");
}

export function isPreviewablePdf(resource) {
  return resource?.mimeType === "application/pdf" || getFileExtension(resource?.name) === "pdf";
}
