export const EDITORIAL_DPI = 96;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;

export function inchesToPixels(inches) {
  return Math.max(0, Number(inches || 0)) * EDITORIAL_DPI;
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

export function getFitZoom({ viewportWidth, viewportHeight, metrics, facing, mode }) {
  const horizontalPadding = 92;
  const verticalPadding = 76;
  const spreadGap = facing ? 18 : 0;
  const contentWidth = metrics.stageWidth * (facing ? 2 : 1) + spreadGap;
  const widthZoom = (viewportWidth - horizontalPadding) / contentWidth;

  if (mode === "width") {
    return clampZoom(widthZoom);
  }

  const heightZoom = (viewportHeight - verticalPadding) / metrics.stageHeight;
  return clampZoom(Math.min(widthZoom, heightZoom));
}

export function roundEditorValue(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}
