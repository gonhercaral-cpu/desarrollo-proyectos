// Fase 8 — Utilidades de tipografía (formato completo por cuadro). Modelo sobre
// `style`. Compatible con legacy: fontWeight "normal"/"bold", align existente.
// NOTA: formato parcial (textRuns) NO se implementa en esta iteración por riesgo
// con edición/plantillas/variables/PDF; el formato es por cuadro completo.

export const HORIZONTAL_ALIGNS = ["left", "center", "right", "justify"];
export const VERTICAL_ALIGNS = ["top", "middle", "bottom"];
export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"];
export const TEXT_DECORATIONS = ["underline", "line-through"]; // subrayado, tachado
export const TEXT_BOX_MODES = ["auto_size", "fixed_box"];

export function isBold(style = {}) {
  const weight = style.fontWeight;
  return weight === "bold" || Number(weight) >= 600;
}

export function isItalic(style = {}) {
  return style.fontStyle === "italic";
}

// fontStyle de Konva combina peso + itálica: "bold", "italic", "bold italic".
export function konvaFontStyle(style = {}) {
  const parts = [];
  if (isBold(style)) parts.push("bold");
  if (isItalic(style)) parts.push("italic");
  return parts.join(" ") || "normal";
}

// textDecoration de Konva: "underline", "line-through" o ambas separadas por espacio.
export function konvaTextDecoration(style = {}) {
  const list = Array.isArray(style.textDecoration) ? style.textDecoration : [];
  return list.filter((value) => TEXT_DECORATIONS.includes(value)).join(" ");
}

export function hasDecoration(style = {}, decoration) {
  return Array.isArray(style.textDecoration) && style.textDecoration.includes(decoration);
}

// Alterna una decoración devolviendo el nuevo array (inmutable).
export function toggleDecoration(style = {}, decoration) {
  const current = Array.isArray(style.textDecoration) ? style.textDecoration : [];
  return current.includes(decoration)
    ? current.filter((value) => value !== decoration)
    : [...current, decoration];
}

// Aplica transformación de mayúsculas al texto para render/PDF (no muta modelo).
export function applyTextTransform(text, transform) {
  const value = String(text ?? "");
  switch (transform) {
    case "uppercase":
      return value.toUpperCase();
    case "lowercase":
      return value.toLowerCase();
    case "capitalize":
      return value.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
    default:
      return value;
  }
}

// Defaults tipográficos (rellenan sin sobrescribir valores existentes).
export function normalizeTextStyle(style = {}) {
  return {
    ...style,
    fill: style.fill || style.color || "#111111",
    fontFamily: style.fontFamily || "Arial",
    fontSize: Number(style.fontSize || 24),
    fontWeight: style.fontWeight || "normal",
    fontStyle: style.fontStyle || "normal",
    align: HORIZONTAL_ALIGNS.includes(style.align) ? style.align : "left",
    verticalAlign: VERTICAL_ALIGNS.includes(style.verticalAlign) ? style.verticalAlign : "top",
    textDecoration: Array.isArray(style.textDecoration) ? style.textDecoration : [],
    textTransform: TEXT_TRANSFORMS.includes(style.textTransform) ? style.textTransform : "none",
    lineHeight: Number(style.lineHeight || 1.2),
    letterSpacing: Number(style.letterSpacing || 0),
    boxMode: TEXT_BOX_MODES.includes(style.boxMode) ? style.boxMode : "auto_size",
    padding: normalizePadding(style.padding),
  };
}

export function normalizePadding(padding) {
  const value = padding || {};
  return {
    top: Number(value.top || 0),
    right: Number(value.right || 0),
    bottom: Number(value.bottom || 0),
    left: Number(value.left || 0),
  };
}

// Resaltado (fondo detrás del texto).
export function normalizeHighlight(highlight) {
  if (!highlight || !highlight.enabled) return { enabled: false };
  return {
    enabled: true,
    color: highlight.color || "#fff2ac",
    opacity: clamp01(highlight.opacity ?? 1),
    padding: Number(highlight.padding || 2),
    radius: Number(highlight.radius || 2),
  };
}

export function normalizeTextStroke(stroke) {
  if (!stroke?.enabled) return { enabled: false };
  return {
    enabled: true,
    color: stroke.color || "#ffffff",
    width: Math.max(0, Number(stroke.width ?? 1)),
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value ?? 1)));
}

// ¿El texto desborda una caja de altura fija? (estimación por líneas).
export function estimateTextOverflow({ text = "", width, height, fontSize = 24, lineHeight = 1.2, avgCharWidth = 0.5 }) {
  if (!(height > 0) || !(width > 0)) return false;
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * avgCharWidth)));
  const lines = String(text).split("\n").reduce((total, paragraph) => {
    return total + Math.max(1, Math.ceil(paragraph.length / charsPerLine));
  }, 0);
  const neededHeight = lines * fontSize * lineHeight;
  return neededHeight > height;
}

export function estimateTextHeight({ text = "", width, fontSize = 24, lineHeight = 1.2, letterSpacing = 0, padding = {} }) {
  const inset = normalizePadding(padding);
  const contentWidth = Math.max(1, Number(width || 1) - inset.left - inset.right);
  const averageWidth = Math.max(1, Number(fontSize) * 0.52 + Number(letterSpacing || 0));
  const charsPerLine = Math.max(1, Math.floor(contentWidth / averageWidth));
  const lines = String(text).split("\n").reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / charsPerLine)), 0);
  return inset.top + inset.bottom + lines * Number(fontSize) * Number(lineHeight);
}

export function textContentBox(element = {}) {
  const style = normalizeTextStyle(element.style);
  const padding = style.padding;
  return {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, Number(element.width || 1) - padding.left - padding.right),
    height: Math.max(1, Number(element.height || 1) - padding.top - padding.bottom),
  };
}

export function textOverflowsFixedBox(element = {}) {
  const style = normalizeTextStyle(element.style);
  if (style.boxMode !== "fixed_box") return false;
  const box = textContentBox(element);
  return estimateTextOverflow({
    text: element.content,
    width: box.width,
    height: box.height,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    avgCharWidth: 0.52 + Math.max(0, style.letterSpacing) / Math.max(1, style.fontSize),
  });
}
