export const ACTIVE_CLASSROOM_SECTIONS = [
  { id: "library", label: "Biblioteca", icon: "library" },
  { id: "publications", label: "Publicaciones", icon: "publications" },
  { id: "teams", label: "Equipos", icon: "teams" },
  { id: "settings", label: "Ajustes", icon: "settings" },
];

export const ACTIVE_CLASSROOM_FUTURE_SECTIONS = [
  { id: "announcements", label: "Panel de anuncios", icon: "announcements" },
  { id: "observations", label: "Observaciones", icon: "observations" },
  { id: "suggestions", label: "Sugerencias", icon: "suggestions" },
];

export const ACTIVE_CLASSROOM_ACCEPTED_FILES = [
  "image/*",
  "audio/*",
  "video/*",
  ".pdf",
  ".ppt",
  ".pptx",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
].join(",");

export const ACTIVE_CLASSROOM_MAX_FILE_BYTES = 250 * 1024 * 1024;
