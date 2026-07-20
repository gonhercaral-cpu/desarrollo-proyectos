// Fase 8 — Registro central de fuentes editoriales. Fuentes seguras del sistema
// (no se descargan de internet) + fuentes personalizadas autorizadas (cargadas
// por el usuario a Storage y registradas en editorialAssets type:"font").

// Fuentes seguras y disponibles (system/web-safe). `pdf` = fuente estándar de
// jsPDF a la que se mapea (helvetica/times/courier) para incrustación real.
export const EDITORIAL_SAFE_FONTS = [
  { family: "Arial", stack: "Arial, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Helvetica", stack: "Helvetica, Arial, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Times New Roman", stack: "'Times New Roman', Times, serif", pdf: "times", category: "Serif" },
  { family: "Georgia", stack: "Georgia, serif", pdf: "times", category: "Serif" },
  { family: "Verdana", stack: "Verdana, Geneva, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Tahoma", stack: "Tahoma, Geneva, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Courier New", stack: "'Courier New', Courier, monospace", pdf: "courier", category: "Monospace" },
  { family: "Arial Narrow", stack: "'Arial Narrow', Arial, sans-serif", pdf: "helvetica", category: "Sans serif" },
  { family: "Impact", stack: "Impact, Haettenschweiler, sans-serif", pdf: "helvetica", category: "Display" },
  { family: "Comic Sans MS", stack: "'Comic Sans MS', 'Comic Sans', cursive", pdf: "helvetica", category: "Display" },
];

const SAFE_BY_FAMILY = new Map(EDITORIAL_SAFE_FONTS.map((font) => [font.family, font]));

export const FONT_STATUS = ["available", "loading", "unavailable", "not_embeddable"];
export const EMBEDDABLE_FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"];
// jsPDF sólo incrusta TTF/OTF de forma fiable; WOFF/WOFF2 no.
export const PDF_EMBEDDABLE_EXTENSIONS = ["ttf", "otf"];

export function isSafeFont(family) {
  return SAFE_BY_FAMILY.has(String(family || ""));
}

// Mapea una familia a la fuente estándar de jsPDF (para peso/itálica reales).
export function resolvePdfFont(family) {
  return SAFE_BY_FAMILY.get(String(family || ""))?.pdf || "helvetica";
}

// CSS font stack con fallback visible.
export function resolveFontStack(family, customFonts = []) {
  if (SAFE_BY_FAMILY.has(family)) return SAFE_BY_FAMILY.get(family).stack;
  const custom = customFonts.find((font) => font.family === family);
  if (custom) return `'${family}', ${custom.fallbackStack || "Arial, sans-serif"}`;
  return `'${family}', Arial, sans-serif`;
}

// Resuelve la variante concreta (weight/style) de una fuente.
export function resolveFontVariant({ weight = 400, italic = false } = {}) {
  const numeric = Number(weight);
  const isBold = weight === "bold" || (Number.isFinite(numeric) && numeric >= 600);
  if (isBold && italic) return "bolditalic";
  if (isBold) return "bold";
  if (italic) return "italic";
  return "normal";
}

export function fontVariantKey(family, variant = "normal") {
  return `${String(family || "").trim()}::${variant}`;
}

export function fontRecordVariant(font = {}) {
  return resolveFontVariant({ weight: font.weight, italic: font.style === "italic" });
}

export function findFontVariant(fonts = [], family, variant = "normal") {
  return fonts.find((font) => font.family === family && fontRecordVariant(font) === variant) || null;
}

export function fontFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function isEmbeddableFontFile(name) {
  return EMBEDDABLE_FONT_EXTENSIONS.includes(fontFileExtension(name));
}

export function isPdfEmbeddableFontFile(name) {
  return PDF_EMBEDDABLE_EXTENSIONS.includes(fontFileExtension(name));
}

// Modelo de fuente personalizada para persistir en editorialAssets.
export function buildCustomFontRecord({ file = {}, family, weight = 400, style = "normal", license = "", storagePath = "", url = "", user = {} } = {}) {
  const cleanFamily = String(family || "").trim();
  if (!cleanFamily) throw new Error("La fuente necesita un nombre familiar.");
  const extension = fontFileExtension(file.name || "");
  if (!EMBEDDABLE_FONT_EXTENSIONS.includes(extension)) {
    throw new Error("Formato de fuente no soportado. Usa TTF, OTF, WOFF o WOFF2.");
  }
  return {
    type: "font",
    family: cleanFamily,
    weight: Number(weight) || 400,
    style: style === "italic" ? "italic" : "normal",
    extension,
    pdfEmbeddable: PDF_EMBEDDABLE_EXTENSIONS.includes(extension),
    license: String(license || ""),
    storagePath: String(storagePath || ""),
    url: String(url || ""),
    fileName: String(file.name || cleanFamily),
    ownerUid: String(user.uid || user.id || ""),
    ownerName: String(user.name || user.email || "Usuario"),
  };
}

// Lista combinada de opciones para el selector (seguras + personalizadas
// cargadas). Sólo se puede seleccionar una fuente disponible.
export function buildFontOptions(customFonts = [], loadedVariants = new Set(), requestedVariant = "normal", failedVariants = new Set()) {
  const safe = EDITORIAL_SAFE_FONTS.map((font) => ({
    family: font.family,
    kind: "safe",
    status: "available",
    selectable: true,
    category: font.category,
  }));
  const families = [...new Set((Array.isArray(customFonts) ? customFonts : []).map((font) => font.family).filter(Boolean))];
  const custom = families.map((family) => {
    const records = customFonts.filter((font) => font.family === family);
    const loaded = loadedVariants.has(fontVariantKey(family, requestedVariant));
    return {
      family,
      kind: "custom",
      status: loaded ? "available" : failedVariants.has(fontVariantKey(family, requestedVariant)) ? "unavailable" : "loading",
      selectable: loaded,
      category: "Personalizada",
      pdfEmbeddable: records.some((font) => font.pdfEmbeddable),
      variants: records.map(fontRecordVariant),
    };
  });
  return [...safe, ...custom];
}
