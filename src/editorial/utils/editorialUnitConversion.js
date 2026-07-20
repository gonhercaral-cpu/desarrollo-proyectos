export const CSS_PIXELS_PER_INCH = 96;
export const PDF_POINTS_PER_INCH = 72;

export const EDITORIAL_UNITS = [
  { value: "in", label: "Pulgadas" },
  { value: "cm", label: "Centímetros" },
  { value: "mm", label: "Milímetros" },
  { value: "px", label: "Píxeles" },
  { value: "pt", label: "Puntos" },
];

const INCHES_PER_UNIT = {
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  px: 1 / CSS_PIXELS_PER_INCH,
  pt: 1 / PDF_POINTS_PER_INCH,
};

export function normalizeEditorialUnit(unit) {
  return Object.hasOwn(INCHES_PER_UNIT, unit) ? unit : "in";
}

export function convertUnit(value, from, to) {
  const source = normalizeEditorialUnit(from);
  const target = normalizeEditorialUnit(to);
  return Number(value || 0) * INCHES_PER_UNIT[source] / INCHES_PER_UNIT[target];
}

export function documentUnitToCanvasPx(value, unit = "in", zoom = 1) {
  return convertUnit(value, unit, "in") * CSS_PIXELS_PER_INCH * Number(zoom || 1);
}

export function canvasPxToDocumentUnit(value, unit = "in", zoom = 1) {
  return convertUnit(Number(value || 0) / Math.max(0.0001, Number(zoom || 1)), "px", unit);
}

export function documentUnitToPdfPoints(value, unit = "in") {
  return convertUnit(value, unit, "in") * PDF_POINTS_PER_INCH;
}

export function formatDocumentUnit(value, unit = "in", maximumFractionDigits = 4) {
  const normalized = normalizeEditorialUnit(unit);
  return `${Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits })} ${normalized}`;
}
