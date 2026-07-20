export const EDITORIAL_PROJECT_TYPES = [
  { value: "book", label: "Libro" },
  { value: "booklet", label: "Cuadernillo" },
  { value: "activity_sheet", label: "Hoja de actividades" },
  { value: "song_sheet", label: "Letra de canción" },
  { value: "exam", label: "Examen" },
  { value: "teacher_guide", label: "Guía docente" },
  { value: "extra_material", label: "Material extra" },
  { value: "custom", label: "Personalizado" },
];

export const PAGE_SIZE_PRESETS = DOCUMENT_SIZE_PRESETS;

export const DEFAULT_EDITORIAL_CONFIG = {
  name: "",
  type: "book",
  size: "8x10",
  unit: "in",
  orientation: "portrait",
  widthIn: 8,
  heightIn: 10,
  margins: {
    top: 0.5,
    right: 0.5,
    bottom: 0.5,
    left: 0.5,
  },
  bleedIn: 0.125,
};

export function getProjectTypeLabel(type) {
  return EDITORIAL_PROJECT_TYPES.find((item) => item.value === type)?.label || "Personalizado";
}

export function getPageSizePreset(size) {
  return getDocumentSizePreset(size);
}

export function getOrientedDimensions(sizeOrConfig, orientation) {
  return resolveDocumentDimensions(typeof sizeOrConfig === "object" ? sizeOrConfig : { size: sizeOrConfig, orientation });
}

export function getEditorialProjectConfig(project = {}) {
  const sizing = normalizeDocumentSizing({ ...DEFAULT_EDITORIAL_CONFIG, ...project });
  return {
    name: project.name || "",
    type: project.type || DEFAULT_EDITORIAL_CONFIG.type,
    size: sizing.size,
    unit: sizing.unit,
    orientation: sizing.orientation,
    widthIn: sizing.widthIn,
    heightIn: sizing.heightIn,
    margins: {
      ...DEFAULT_EDITORIAL_CONFIG.margins,
      ...(project.margins || {}),
    },
    bleedIn: Number(project.bleedIn ?? DEFAULT_EDITORIAL_CONFIG.bleedIn),
    resizeMode: "preserve",
  };
}

export function formatInches(value) {
  return `${Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 4,
  })} pulg`;
}
import { DOCUMENT_SIZE_PRESETS, getDocumentSizePreset, normalizeDocumentSizing, resolveDocumentDimensions } from "../utils/editorialDocumentSizing.js";
