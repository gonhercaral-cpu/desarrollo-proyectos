import { convertUnit, documentUnitToCanvasPx, normalizeEditorialUnit } from "./editorialUnitConversion.js";

const STEPS = {
  in: { major: 1, minor: 0.125 },
  cm: { major: 1, minor: 0.1 },
  mm: { major: 10, minor: 1 },
  px: { major: 100, minor: 10 },
  pt: { major: 72, minor: 9 },
};

export function buildEditorialRulerModel({ lengthIn, unit = "in", scale = 1 } = {}) {
  const normalizedUnit = normalizeEditorialUnit(unit);
  const length = Math.max(0, convertUnit(lengthIn, "in", normalizedUnit));
  const config = STEPS[normalizedUnit];
  let minor = config.minor;
  while (documentUnitToCanvasPx(minor, normalizedUnit, scale) < 4) minor *= 2;
  const count = Math.floor(length / minor + 0.000001);
  const ticks = [];
  for (let index = 0; index <= count; index += 1) {
    const value = index * minor;
    const majorRatio = value / config.major;
    const major = Math.abs(majorRatio - Math.round(majorRatio)) < 0.00001;
    ticks.push({
      value,
      major,
      positionPx: documentUnitToCanvasPx(value, normalizedUnit, scale),
      label: major ? Number(value.toFixed(4)).toLocaleString("es-MX") : "",
    });
  }
  return {
    unit: normalizedUnit,
    length,
    lengthPx: documentUnitToCanvasPx(length, normalizedUnit, scale),
    majorStep: config.major,
    minorStep: minor,
    ticks,
  };
}
