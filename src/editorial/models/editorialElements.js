import { roundEditorValue } from "../utils/editorialMeasurements.js";
import { defaultShapeConfig, normalizeShapePoints, resolveShapeType } from "./editorialShapes.js";
import { estimateTextHeight, normalizeTextStyle } from "./editorialTypography.js";

export const EDITORIAL_ELEMENT_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  SHAPE: "shape",
};

const COMMON_STYLE = {
  fill: "#142033",
};

export function createEditorialElementId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `element-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createBaseElement(type, zIndex, overrides = {}) {
  const id = overrides.id || createEditorialElementId();
  return {
    id,
    name: overrides.name || getDefaultElementName(type),
    type,
    x: 48,
    y: 48,
    width: 240,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    content: "",
    style: { ...COMMON_STYLE },
    ...overrides,
  };
}

export function createTextElement(zIndex) {
  return createBaseElement(EDITORIAL_ELEMENT_TYPES.TEXT, zIndex, {
    name: "Texto",
    width: 300,
    height: 74,
    content: "Escribe aquí",
    style: {
      ...COMMON_STYLE,
      fontFamily: "Arial",
      fontSize: 28,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: [],
      textTransform: "none",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
      boxMode: "auto_size",
    },
  });
}

const LEGACY_SHAPE_STYLE = {
  fill: "#e2f0ff",
  borderColor: "#1677eb",
  borderWidth: 2,
  cornerRadius: 8,
};

// Crea una figura de cualquier tipo del registro (compatibilidad: sin argumento
// = rectángulo, como antes).
export function createShapeElement(zIndex, shapeType = "rectangle") {
  const config = defaultShapeConfig(shapeType);
  const constrained = ["square", "circle"].includes(config.shapeType);
  const linear = ["line", "arrow", "double_arrow"].includes(config.shapeType);
  return createBaseElement(EDITORIAL_ELEMENT_TYPES.SHAPE, zIndex, {
    name: config.label,
    width: 220,
    height: constrained ? 220 : linear ? 40 : 140,
    shapeType: config.shapeType,
    style: {
      ...LEGACY_SHAPE_STYLE,
      fill: config.fill,
      borderColor: config.stroke,
      borderWidth: config.strokeWidth,
      borderStyle: config.borderStyle,
      cornerRadius: config.cornerRadius,
      ...(config.pointerStart ? { pointerStart: config.pointerStart } : {}),
      ...(config.pointerEnd ? { pointerEnd: config.pointerEnd } : {}),
    },
  });
}

export function createImageElement(zIndex, asset) {
  const naturalWidth = Number(asset?.width || 1);
  const naturalHeight = Number(asset?.height || 1);
  const width = Math.min(340, naturalWidth || 340);
  const height = naturalWidth > 0 ? width * (naturalHeight / naturalWidth) : 220;

  return createBaseElement(EDITORIAL_ELEMENT_TYPES.IMAGE, zIndex, {
    name: asset?.name || "Imagen",
    width,
    height: Math.max(80, Math.min(320, height)),
    assetId: asset?.id || "",
    assetUrl: asset?.url || "",
    storagePath: asset?.storagePath || "",
    naturalWidth,
    naturalHeight,
    style: {
      fit: "cover",
      maintainAspect: true,
    },
  });
}

export function getDefaultElementName(type) {
  if (type === EDITORIAL_ELEMENT_TYPES.TEXT) return "Texto";
  if (type === EDITORIAL_ELEMENT_TYPES.IMAGE) return "Imagen";
  return "Rectángulo";
}

export function normalizeEditorialElement(element, fallbackIndex = 0) {
  const type = Object.values(EDITORIAL_ELEMENT_TYPES).includes(element?.type)
    ? element.type
    : EDITORIAL_ELEMENT_TYPES.SHAPE;

  const style = type === EDITORIAL_ELEMENT_TYPES.TEXT
    ? normalizeTextStyle({ ...(element?.style || {}), boxMode: element?.style?.boxMode || "fixed_box" })
    : { ...(element?.style || {}) };
  const width = Math.max(10, roundEditorValue(element?.width || 100));
  const sourceHeight = Math.max(10, roundEditorValue(element?.height || 60));
  const shapeType = type === EDITORIAL_ELEMENT_TYPES.SHAPE ? resolveShapeType(element) : "";
  const height = type === EDITORIAL_ELEMENT_TYPES.SHAPE && ["square", "circle"].includes(shapeType)
    ? width
    : type === EDITORIAL_ELEMENT_TYPES.TEXT && style.boxMode === "auto_size"
    ? Math.max(10, roundEditorValue(estimateTextHeight({ text: element?.content, width, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, padding: style.padding })))
    : sourceHeight;

  return {
    ...element,
    id: String(element?.id || createEditorialElementId()),
    name: String(element?.name || getDefaultElementName(type)),
    type,
    x: roundEditorValue(element?.x),
    y: roundEditorValue(element?.y),
    width,
    height,
    rotation: roundEditorValue(element?.rotation),
    opacity: Math.min(1, Math.max(0, Number(element?.opacity ?? 1))),
    zIndex: Number.isFinite(Number(element?.zIndex)) ? Number(element.zIndex) : fallbackIndex,
    locked: Boolean(element?.locked),
    visible: element?.visible !== false,
    content: String(element?.content || ""),
    style,
    // Fase 8: figura conserva shapeType (legacy rect sin shapeType = "rectangle").
    ...(type === EDITORIAL_ELEMENT_TYPES.SHAPE ? { shapeType } : {}),
    ...(Array.isArray(element?.points) ? { points: normalizeShapePoints(element.points) } : {}),
    ...(element?.assetId ? { assetId: element.assetId } : {}),
    ...(element?.assetUrl ? { assetUrl: element.assetUrl } : {}),
    ...(element?.storagePath ? { storagePath: element.storagePath } : {}),
    ...(element?.naturalWidth ? { naturalWidth: Number(element.naturalWidth) } : {}),
    ...(element?.naturalHeight ? { naturalHeight: Number(element.naturalHeight) } : {}),
  };
}

export function normalizeElementOrder(elements) {
  return [...elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element, index) => ({ ...element, zIndex: index }));
}

export function cloneElement(element, zIndex) {
  return normalizeEditorialElement({
    ...element,
    id: createEditorialElementId(),
    name: `${element.name || getDefaultElementName(element.type)} copia`,
    x: Number(element.x || 0) + 16,
    y: Number(element.y || 0) + 16,
    zIndex,
  });
}

export function serializeEditorialElements(elements) {
  return JSON.stringify(normalizeElementOrder(elements));
}
