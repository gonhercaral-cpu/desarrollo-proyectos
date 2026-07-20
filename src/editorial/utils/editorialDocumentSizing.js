import { convertUnit, normalizeEditorialUnit } from "./editorialUnitConversion.js";

export const DOCUMENT_SIZE_PRESETS = [
  { value: "8x10", label: "8 × 10 in", widthIn: 8, heightIn: 10 },
  { value: "letter", label: "Carta · 8.5 × 11 in", widthIn: 8.5, heightIn: 11 },
  { value: "a4", label: "A4 · 210 × 297 mm", widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
  { value: "a5", label: "A5 · 148 × 210 mm", widthIn: 148 / 25.4, heightIn: 210 / 25.4 },
  { value: "half_letter", label: "Media carta · 5.5 × 8.5 in", widthIn: 5.5, heightIn: 8.5 },
  { value: "legal", label: "Legal · 8.5 × 14 in", widthIn: 8.5, heightIn: 14 },
  { value: "custom", label: "Personalizado", widthIn: 8, heightIn: 10 },
];

export function getDocumentSizePreset(size) {
  return DOCUMENT_SIZE_PRESETS.find((item) => item.value === size) || DOCUMENT_SIZE_PRESETS[0];
}

export function resolveDocumentDimensions(config = {}) {
  const orientation = config.orientation === "landscape" ? "landscape" : "portrait";
  const preset = getDocumentSizePreset(config.size);
  const rawWidth = config.size === "custom" ? Number(config.widthIn || preset.widthIn) : preset.widthIn;
  const rawHeight = config.size === "custom" ? Number(config.heightIn || preset.heightIn) : preset.heightIn;
  const short = Math.min(rawWidth, rawHeight);
  const long = Math.max(rawWidth, rawHeight);
  return orientation === "landscape"
    ? { widthIn: long, heightIn: short }
    : { widthIn: short, heightIn: long };
}

export function normalizeDocumentSizing(project = {}) {
  const size = getDocumentSizePreset(project.size).value;
  const unit = normalizeEditorialUnit(project.unit);
  const orientation = project.orientation === "landscape" ? "landscape" : "portrait";
  const fallback = resolveDocumentDimensions({ size, orientation });
  return {
    size,
    unit,
    orientation,
    widthIn: Math.max(0.1, Number(project.widthIn || fallback.widthIn)),
    heightIn: Math.max(0.1, Number(project.heightIn || fallback.heightIn)),
  };
}

export function sizeValueForUnit(inches, unit) {
  return convertUnit(inches, "in", unit);
}

export function sizeValueFromUnit(value, unit) {
  return convertUnit(value, unit, "in");
}

export function physicalSizeChanged(previous = {}, next = {}, tolerance = 0.0001) {
  return Math.abs(Number(previous.widthIn) - Number(next.widthIn)) > tolerance
    || Math.abs(Number(previous.heightIn) - Number(next.heightIn)) > tolerance;
}

function scaleStyle(style = {}, factor) {
  const padding = style.padding ? Object.fromEntries(Object.entries(style.padding).map(([key, value]) => [key, Number(value || 0) * factor])) : style.padding;
  return {
    ...style,
    ...(Number.isFinite(Number(style.fontSize)) ? { fontSize: Number(style.fontSize) * factor } : {}),
    ...(Number.isFinite(Number(style.letterSpacing)) ? { letterSpacing: Number(style.letterSpacing) * factor } : {}),
    ...(Number.isFinite(Number(style.borderWidth)) ? { borderWidth: Number(style.borderWidth) * factor } : {}),
    ...(Number.isFinite(Number(style.cornerRadius)) ? { cornerRadius: Number(style.cornerRadius) * factor } : {}),
    ...(padding ? { padding } : {}),
  };
}

export function resizeEditorialElements(elements = [], previousSize = {}, nextSize = {}, mode = "preserve") {
  const previousWidth = Math.max(0.1, Number(previousSize.widthIn || 1)) * 96;
  const previousHeight = Math.max(0.1, Number(previousSize.heightIn || 1)) * 96;
  const nextWidth = Math.max(0.1, Number(nextSize.widthIn || 1)) * 96;
  const nextHeight = Math.max(0.1, Number(nextSize.heightIn || 1)) * 96;
  if (mode === "preserve") return elements.map((element) => ({ ...element }));
  if (mode === "center") {
    const offsetX = (nextWidth - previousWidth) / 2;
    const offsetY = (nextHeight - previousHeight) / 2;
    return elements.map((element) => ({ ...element, x: Number(element.x || 0) + offsetX, y: Number(element.y || 0) + offsetY }));
  }
  const scaleX = nextWidth / previousWidth;
  const scaleY = nextHeight / previousHeight;
  const uniform = Math.min(scaleX, scaleY);
  return elements.map((element) => ({
    ...element,
    x: Number(element.x || 0) * scaleX,
    y: Number(element.y || 0) * scaleY,
    width: Number(element.width || 0) * scaleX,
    height: Number(element.height || 0) * scaleY,
    style: scaleStyle(element.style, uniform),
    ...(element.shadow ? { shadow: { ...element.shadow, blur: Number(element.shadow.blur || 0) * uniform, offsetX: Number(element.shadow.offsetX || 0) * scaleX, offsetY: Number(element.shadow.offsetY || 0) * scaleY } } : {}),
    ...(element.imageBorder ? { imageBorder: { ...element.imageBorder, width: Number(element.imageBorder.width || 0) * uniform, radius: Number(element.imageBorder.radius || 0) * uniform } } : {}),
  }));
}
