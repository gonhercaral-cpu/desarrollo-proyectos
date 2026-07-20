import { CSS_PIXELS_PER_INCH, canvasPxToDocumentUnit, convertUnit, documentUnitToCanvasPx, documentUnitToPdfPoints } from "./editorialUnitConversion.js";

export const EDITORIAL_DPI = CSS_PIXELS_PER_INCH;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;

export function inchesToPixels(inches) {
  return documentUnitToCanvasPx(Math.max(0, Number(inches || 0)), "in", 1);
}

export function pixelsToInches(pixels) {
  return Number(pixels || 0) / EDITORIAL_DPI;
}

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom || 1)));
}

export function getPageMetrics(project) {
  const trimWidth = inchesToPixels(project?.widthIn || 8);
  const trimHeight = inchesToPixels(project?.heightIn || 10);
  const bleed = inchesToPixels(project?.bleedIn || 0);
  const margins = {
    top: inchesToPixels(project?.margins?.top || 0),
    right: inchesToPixels(project?.margins?.right || 0),
    bottom: inchesToPixels(project?.margins?.bottom || 0),
    left: inchesToPixels(project?.margins?.left || 0),
  };

  return {
    trimWidth,
    trimHeight,
    bleed,
    margins,
    stageWidth: trimWidth + bleed * 2,
    stageHeight: trimHeight + bleed * 2,
  };
}

export function getFitZoom({ viewportWidth, viewportHeight, metrics, facing, mode, spreadMetrics = [], insets = {}, spreadGap = 18 }) {
  const horizontalPadding = Number(insets.left || 0) + Number(insets.right || 0);
  const verticalPadding = Number(insets.top || 0) + Number(insets.bottom || 0);
  const effectiveSpreadGap = facing ? Number(spreadGap || 0) : 0;
  const visibleMetrics = spreadMetrics.length ? spreadMetrics : [metrics];
  const contentWidth = visibleMetrics.reduce((total, item) => total + item.stageWidth, 0) + effectiveSpreadGap;
  const widthZoom = Math.max(1, viewportWidth - horizontalPadding) / Math.max(1, contentWidth);

  if (mode === "width") {
    return clampZoom(widthZoom);
  }

  const contentHeight = Math.max(...visibleMetrics.map((item) => item.stageHeight));
  const heightZoom = Math.max(1, viewportHeight - verticalPadding) / Math.max(1, contentHeight);
  return clampZoom(Math.min(widthZoom, heightZoom));
}

export { canvasPxToDocumentUnit, convertUnit, documentUnitToCanvasPx, documentUnitToPdfPoints };

export function roundEditorValue(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}
