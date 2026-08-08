const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";
const DRIVE_FOLDER_MIME_TYPE = `${GOOGLE_NATIVE_PREFIX}folder`;

const GOOGLE_EXPORTS = Object.freeze({
  [`${GOOGLE_NATIVE_PREFIX}document`]: {
    deliveredMimeType: DOCX_MIME_TYPE,
    extension: "docx",
    fileType: "docx",
    previewable: true,
    editable: true,
  },
  [`${GOOGLE_NATIVE_PREFIX}spreadsheet`]: {
    deliveredMimeType: XLSX_MIME_TYPE,
    extension: "xlsx",
    fileType: "sheet",
    previewable: false,
    editable: false,
  },
  [`${GOOGLE_NATIVE_PREFIX}presentation`]: {
    deliveredMimeType: PPTX_MIME_TYPE,
    extension: "pptx",
    fileType: "presentation",
    previewable: false,
    editable: false,
  },
  [`${GOOGLE_NATIVE_PREFIX}drawing`]: {
    deliveredMimeType: "application/pdf",
    extension: "pdf",
    fileType: "pdf",
    previewable: true,
    editable: false,
  },
});

function createContentError(code, message, status = 415) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function extensionFromName(name = "") {
  const match = String(name).trim().toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || "";
}

function ensureExtension(name, extension) {
  const cleanName = String(name || "archivo").trim() || "archivo";
  return extensionFromName(cleanName) === extension ? cleanName : `${cleanName}.${extension}`;
}

function detectFileType(mimeType = "", name = "") {
  const mime = String(mimeType).toLowerCase();
  const extension = extensionFromName(name);
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime)) return "text";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === DOCX_MIME_TYPE || extension === "docx") return "docx";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  return "unsupported";
}

function isPreviewable(fileType) {
  return ["pdf", "image", "text", "video", "audio", "docx"].includes(fileType);
}

function getDriveContentDescriptor(item = {}) {
  const originalMimeType = String(item.mimeType || "application/octet-stream");
  const originalName = String(item.name || "archivo");

  if (originalMimeType === DRIVE_FOLDER_MIME_TYPE) {
    throw createContentError("unsupported-format", "Las carpetas no tienen contenido descargable.");
  }

  if (originalMimeType.startsWith(GOOGLE_NATIVE_PREFIX)) {
    const exportConfig = GOOGLE_EXPORTS[originalMimeType];
    if (!exportConfig) {
      throw createContentError(
        "unsupported-export",
        "Este tipo de archivo nativo de Google no tiene una exportaciÃ³n compatible."
      );
    }
    return {
      id: String(item.id || ""),
      originalName,
      deliveredName: ensureExtension(originalName, exportConfig.extension),
      originalMimeType,
      deliveredMimeType: exportConfig.deliveredMimeType,
      fileType: exportConfig.fileType,
      originalSize: null,
      size: null,
      exported: true,
      previewable: exportConfig.previewable,
      editable: exportConfig.editable,
      capabilities: { ...(item.capabilities || {}) },
    };
  }

  const fileType = detectFileType(originalMimeType, originalName);
  const size = Number.isFinite(Number(item.size)) ? Number(item.size) : null;
  return {
    id: String(item.id || ""),
    originalName,
    deliveredName: originalName,
    originalMimeType,
    deliveredMimeType: originalMimeType,
    fileType,
    originalSize: size,
    size,
    exported: false,
    previewable: isPreviewable(fileType),
    editable: fileType === "docx",
    capabilities: { ...(item.capabilities || {}) },
  };
}

function headerValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

function getDriveContentHeaders(descriptor, deliveredSize = null) {
  const size = Number.isFinite(Number(deliveredSize)) ? Number(deliveredSize) : descriptor.size;
  return {
    "Content-Type": descriptor.deliveredMimeType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(descriptor.deliveredName)}`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Nube-File-Name": headerValue(descriptor.deliveredName),
    "X-Nube-Original-Name": headerValue(descriptor.originalName),
    "X-Nube-Original-Mime-Type": headerValue(descriptor.originalMimeType),
    "X-Nube-Delivered-Mime-Type": headerValue(descriptor.deliveredMimeType),
    "X-Nube-File-Type": descriptor.fileType,
    "X-Nube-Exported": String(descriptor.exported),
    "X-Nube-Previewable": String(descriptor.previewable),
    "X-Nube-Editable": String(descriptor.editable),
    ...(size !== null ? { "Content-Length": String(size) } : {}),
  };
}

function mapDriveContentError(error = {}) {
  const googleStatus = Number(error?.response?.status || error?.status || error?.code);
  if (error?.code === "unauthenticated" || String(error?.code || "").startsWith("auth/")) {
    return { status: 401, code: "unauthenticated", message: "Tu sesión no es válida. Inicia sesión nuevamente." };
  }
  if (error?.code === "permission-denied" || googleStatus === 403) {
    return { status: 403, code: "permission-denied", message: "No tienes permiso para acceder a este archivo." };
  }
  if (error?.code === "not-found" || googleStatus === 404) {
    return { status: 404, code: "not-found", message: "El archivo no existe o ya no está disponible." };
  }
  if (error?.code === "unsupported-format" || error?.code === "unsupported-export") {
    return { status: 415, code: error.code, message: error.message };
  }
  if (error?.code === "invalid-argument" || googleStatus === 400) {
    return { status: 400, code: "invalid-request", message: "La solicitud del archivo no es válida." };
  }
  if (error?.contentOperation === "export") {
    return { status: 502, code: "export-failed", message: "Drive no pudo exportar el documento nativo." };
  }
  return { status: 500, code: "drive-error", message: "No se pudo obtener el archivo desde Drive." };
}

const DRIVE_CONTENT_EXPOSE_HEADERS = [
  "Content-Disposition",
  "Content-Length",
  "Content-Type",
  "X-Nube-File-Name",
  "X-Nube-Original-Name",
  "X-Nube-Original-Mime-Type",
  "X-Nube-Delivered-Mime-Type",
  "X-Nube-File-Type",
  "X-Nube-Exported",
  "X-Nube-Previewable",
  "X-Nube-Editable",
].join(", ");

module.exports = {
  DOCX_MIME_TYPE,
  DRIVE_CONTENT_EXPOSE_HEADERS,
  DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_NATIVE_PREFIX,
  detectFileType,
  ensureExtension,
  getDriveContentDescriptor,
  getDriveContentHeaders,
  mapDriveContentError,
};
