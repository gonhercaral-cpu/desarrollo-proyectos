export const FILE_KINDS = {
  FOLDER: "folder",
  PDF: "pdf",
  IMAGE: "image",
  TEXT: "text",
  VIDEO: "video",
  AUDIO: "audio",
  DOCX: "docx",
  SHEET: "sheet",
  PRESENTATION: "presentation",
  UNSUPPORTED: "unsupported",
};

export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  log: "text/plain",
  js: "text/javascript",
  jsx: "text/jsx",
  ts: "text/typescript",
  tsx: "text/tsx",
  css: "text/css",
  html: "text/html",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  docx: DOCX_MIME_TYPE,
};

const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "md", "json", "xml", "log", "js", "jsx", "ts", "tsx",
  "css", "html", "htm", "yaml", "yml", "ini", "sql", "sh", "ps1",
]);

export function getFileExtension(name = "") {
  const cleanName = String(name || "").trim().toLowerCase();
  const dotIndex = cleanName.lastIndexOf(".");
  return dotIndex > -1 && dotIndex < cleanName.length - 1 ? cleanName.slice(dotIndex + 1) : "";
}

export function resolveFileMimeType(mimeType = "", name = "") {
  const cleanMimeType = String(mimeType || "").trim().toLowerCase();
  if (cleanMimeType) return cleanMimeType;
  return MIME_BY_EXTENSION[getFileExtension(name)] || "application/octet-stream";
}

export function detectFileKind(file = {}) {
  const safeFile = file || {};
  const mimeType = resolveFileMimeType(safeFile.mimeType || safeFile.contentType || safeFile.type, safeFile.name);
  const extension = getFileExtension(safeFile.name);

  if (mimeType === DRIVE_FOLDER_MIME_TYPE) return FILE_KINDS.FOLDER;
  if (mimeType === "application/pdf" || extension === "pdf") return FILE_KINDS.PDF;
  if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) return FILE_KINDS.IMAGE;
  if (mimeType.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension)) return FILE_KINDS.VIDEO;
  if (mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(extension)) return FILE_KINDS.AUDIO;
  if (mimeType === DOCX_MIME_TYPE || mimeType === GOOGLE_DOC_MIME_TYPE || extension === "docx") return FILE_KINDS.DOCX;
  if (mimeType.startsWith("text/") || ["application/json", "application/xml"].includes(mimeType) || TEXT_EXTENSIONS.has(extension)) return FILE_KINDS.TEXT;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FILE_KINDS.SHEET;
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return FILE_KINDS.PRESENTATION;
  return FILE_KINDS.UNSUPPORTED;
}

export function isInternallyPreviewable(file) {
  return [
    FILE_KINDS.PDF,
    FILE_KINDS.IMAGE,
    FILE_KINDS.TEXT,
    FILE_KINDS.VIDEO,
    FILE_KINDS.AUDIO,
    FILE_KINDS.DOCX,
  ].includes(detectFileKind(file));
}

export function isEditorialImportable(file) {
  return detectFileKind(file) === FILE_KINDS.DOCX;
}
