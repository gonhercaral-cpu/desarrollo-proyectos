import { documentCoordinateToInches } from "./editorialPdfCoordinateAdapter.js";

export const PDF_POINTS_PER_INCH = 72;

export function getPdfPageSize(page, bleedIn = 0) {
  const widthIn = Number(page.width || page.widthIn || 8);
  const heightIn = Number(page.height || page.heightIn || 10);
  const bleed = Math.max(0, Number(bleedIn || 0));
  return {
    widthIn: widthIn + bleed * 2,
    heightIn: heightIn + bleed * 2,
    trimWidthIn: widthIn,
    trimHeightIn: heightIn,
    bleedIn: bleed,
    widthPt: (widthIn + bleed * 2) * PDF_POINTS_PER_INCH,
    heightPt: (heightIn + bleed * 2) * PDF_POINTS_PER_INCH,
  };
}

export function editorUnitsToInches(value) {
  return documentCoordinateToInches(value);
}

export function effectiveImageDpi(element, page) {
  const widthIn = editorUnitsToInches(element.width, page);
  const heightIn = editorUnitsToInches(element.height, page);
  if (!widthIn || !heightIn) return 0;
  return Math.min(Number(element.naturalWidth || 0) / widthIn, Number(element.naturalHeight || 0) / heightIn);
}
