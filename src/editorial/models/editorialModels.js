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

export const PAGE_SIZE_PRESETS = [
  { value: "8x10", label: "8 × 10 pulgadas", widthIn: 8, heightIn: 10 },
  { value: "letter", label: "Carta · 8.5 × 11 pulgadas", widthIn: 8.5, heightIn: 11 },
  { value: "a4", label: "A4 · 210 × 297 mm", widthIn: 8.2677, heightIn: 11.6929 },
  { value: "square", label: "Cuadrado · 8 × 8 pulgadas", widthIn: 8, heightIn: 8 },
];

export const DEFAULT_EDITORIAL_CONFIG = {
  name: "",
  type: "book",
  size: "8x10",
  orientation: "portrait",
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
  return PAGE_SIZE_PRESETS.find((item) => item.value === size) || PAGE_SIZE_PRESETS[0];
}

export function getOrientedDimensions(size, orientation) {
  const preset = getPageSizePreset(size);
  const portrait = orientation !== "landscape";

  return {
    widthIn: portrait ? preset.widthIn : preset.heightIn,
    heightIn: portrait ? preset.heightIn : preset.widthIn,
  };
}

export function getEditorialProjectConfig(project = {}) {
  return {
    name: project.name || "",
    type: project.type || DEFAULT_EDITORIAL_CONFIG.type,
    size: project.size || DEFAULT_EDITORIAL_CONFIG.size,
    orientation: project.orientation || DEFAULT_EDITORIAL_CONFIG.orientation,
    margins: {
      ...DEFAULT_EDITORIAL_CONFIG.margins,
      ...(project.margins || {}),
    },
    bleedIn: Number(project.bleedIn ?? DEFAULT_EDITORIAL_CONFIG.bleedIn),
  };
}

export function formatInches(value) {
  return `${Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 4,
  })} pulg`;
}
