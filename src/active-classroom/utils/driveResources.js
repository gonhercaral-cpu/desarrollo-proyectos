const GOOGLE_TYPES = {
  "application/vnd.google-apps.presentation": "presentation",
  "application/vnd.google-apps.document": "document",
};
const EXTENSION_TYPES = {
  ppt: "presentation", pptx: "presentation", pdf: "document",
  doc: "document", docx: "document", txt: "document",
  mp3: "audio", wav: "audio", m4a: "audio",
  mp4: "video", webm: "video", jpg: "image", jpeg: "image", png: "image", webp: "image",
};

export function getDriveResourceKind(file) {
  if (GOOGLE_TYPES[file.mimeType]) return GOOGLE_TYPES[file.mimeType];
  if (String(file.mimeType).startsWith("application/vnd.google-apps.")) return null;
  return EXTENSION_TYPES[String(file.name || "").toLowerCase().split(".").pop()] || null;
}

export function isDriveResource(resource) {
  return resource?.source === "drive";
}
