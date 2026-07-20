// Fase 8 — Registro central de figuras geométricas. Modelo común basado en
// `shapeType`; compatible con los rectángulos existentes (shapeType ausente =
// "rectangle"). Geometría pura para render Konva y PDF (mismos puntos).

export const EDITORIAL_SHAPE_TYPES = [
  ["rectangle", "Rectángulo", "rect"],
  ["rounded_rectangle", "Rectángulo redondeado", "rect"],
  ["square", "Cuadrado", "rect"],
  ["circle", "Círculo", "ellipse"],
  ["ellipse", "Elipse", "ellipse"],
  ["triangle", "Triángulo", "polygon"],
  ["right_triangle", "Triángulo rectángulo", "polygon"],
  ["diamond", "Rombo", "polygon"],
  ["pentagon", "Pentágono", "polygon"],
  ["hexagon", "Hexágono", "polygon"],
  ["star", "Estrella", "polygon"],
  ["arrow", "Flecha", "arrow"],
  ["line", "Línea", "line"],
  ["double_arrow", "Flecha doble", "arrow"],
  ["speech_bubble", "Globo de diálogo", "polygon"],
  ["custom_polygon", "Polígono personalizado", "polygon"],
];

const SHAPE_KIND = new Map(EDITORIAL_SHAPE_TYPES.map(([type, , kind]) => [type, kind]));
const VALID_TYPES = new Set(EDITORIAL_SHAPE_TYPES.map(([type]) => type));

export const EDITORIAL_LINE_CAPS = ["none", "arrow", "circle", "square"];
export const EDITORIAL_BORDER_STYLES = [
  ["solid", "Sólido"],
  ["dotted", "Punteado"],
  ["dashed", "Segmentado"],
];

// shapeType válido; ausente/legacy = rectangle (rects existentes).
export function resolveShapeType(element) {
  const value = String(element?.shapeType || element?.style?.shapeType || "");
  return VALID_TYPES.has(value) ? value : "rectangle";
}

export function getShapeKind(shapeType) {
  return SHAPE_KIND.get(shapeType) || "rect";
}

export function getShapeLabel(shapeType) {
  return EDITORIAL_SHAPE_TYPES.find(([type]) => type === shapeType)?.[1] || "Figura";
}

// Traduce el estilo de borde a `dash` de Konva (array). solid = [].
export function borderDash(borderStyle, strokeWidth = 1) {
  const width = Math.max(1, Number(strokeWidth) || 1);
  if (borderStyle === "dotted") return [Math.max(1, width), Math.max(1, width * 1.6)];
  if (borderStyle === "dashed") return [width * 4, width * 3];
  return [];
}

function starPoints(width, height, spikes = 5) {
  const cx = width / 2;
  const cy = height / 2;
  const outerX = width / 2;
  const outerY = height / 2;
  const inner = 0.5;
  const points = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const radiusScale = i % 2 === 0 ? 1 : inner;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    points.push(cx + Math.cos(angle) * outerX * radiusScale, cy + Math.sin(angle) * outerY * radiusScale);
  }
  return points;
}

function regularPolygonPoints(width, height, sides) {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    points.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
  }
  return points;
}

export function scaleShapePoints(points, width, height) {
  const clean = normalizeShapePoints(points);
  if (clean.length < 4) return clean;
  const xs = clean.filter((_, index) => index % 2 === 0);
  const ys = clean.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const rangeX = Math.max(1, maxX - minX); const rangeY = Math.max(1, maxY - minY);
  return clean.map((value, index) => index % 2 === 0
    ? ((value - minX) / rangeX) * Math.max(1, Number(width) || 1)
    : ((value - minY) / rangeY) * Math.max(1, Number(height) || 1));
}

// Puntos absolutos (px, relativos a la caja width×height) para figuras poligonales.
export function buildShapePoints(shapeType, width, height, element = {}) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  switch (shapeType) {
    case "triangle":
      return [w / 2, 0, w, h, 0, h];
    case "right_triangle":
      return [0, 0, 0, h, w, h];
    case "diamond":
      return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];
    case "pentagon":
      return regularPolygonPoints(w, h, 5);
    case "hexagon":
      return regularPolygonPoints(w, h, 6);
    case "star":
      return starPoints(w, h, Number(element.spikes) || 5);
    case "speech_bubble":
      return [0, 0, w, 0, w, h * 0.72, w * 0.34, h * 0.72, w * 0.18, h, w * 0.18, h * 0.72, 0, h * 0.72];
    case "custom_polygon": {
      const custom = Array.isArray(element.points) ? element.points : null;
      if (custom && custom.length >= 6) return scaleShapePoints(custom, w, h);
      return regularPolygonPoints(w, h, 6);
    }
    default:
      return [0, 0, w, 0, w, h, 0, h];
  }
}

// Puntos de líneas/flechas. Horizontal por defecto, centro vertical.
export function buildLinePoints(width, height, element = {}) {
  const custom = Array.isArray(element.points) ? element.points : null;
  if (custom && custom.length >= 4) return scaleShapePoints(custom, width, height);
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  return [0, h / 2, w, h / 2];
}

// Sanea un array de puntos: números finitos, longitud par, sin undefined.
export function normalizeShapePoints(points) {
  if (!Array.isArray(points)) return [];
  const clean = points.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return clean.length % 2 === 0 ? clean : clean.slice(0, clean.length - 1);
}

// ¿Requiere radio de esquina? (sólo rectángulos redondeados / rect genérico).
export function shapeSupportsRadius(shapeType) {
  return shapeType === "rounded_rectangle" || shapeType === "rectangle" || shapeType === "square";
}

// Config por defecto de una figura nueva.
export function defaultShapeConfig(shapeType) {
  const resolvedType = VALID_TYPES.has(shapeType) ? shapeType : "rectangle";
  const kind = getShapeKind(resolvedType);
  const base = {
    shapeType: resolvedType,
    label: getShapeLabel(resolvedType),
    fill: "#dce9fb",
    stroke: "#1f6fd6",
    strokeWidth: 2,
    borderStyle: "solid",
    cornerRadius: resolvedType === "rounded_rectangle" ? 16 : resolvedType === "rectangle" ? 8 : 0,
  };
  if (kind === "line") return { ...base, fill: "", strokeWidth: 3, pointerStart: "none", pointerEnd: "none" };
  if (kind === "arrow") {
    return { ...base, fill: "", strokeWidth: 3, pointerStart: resolvedType === "double_arrow" ? "arrow" : "none", pointerEnd: "arrow" };
  }
  return base;
}
