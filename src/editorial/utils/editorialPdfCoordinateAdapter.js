import { CSS_PIXELS_PER_INCH, documentUnitToPdfPoints } from "./editorialUnitConversion.js";

export const DOCUMENT_COORDINATES_PER_INCH = CSS_PIXELS_PER_INCH;

export function documentCoordinateToInches(value) {
  return Number(value || 0) / DOCUMENT_COORDINATES_PER_INCH;
}

export function documentCoordinateToPdfPoints(value) {
  return documentUnitToPdfPoints(documentCoordinateToInches(value), "in");
}

export function documentFontSizeToPdfPoints(value) {
  return documentCoordinateToPdfPoints(value);
}

export function pdfPointsToDocumentCoordinate(value) {
  return Number(value || 0) * DOCUMENT_COORDINATES_PER_INCH / 72;
}

export function createEditorialPdfCoordinateAdapter(page = {}, bleedIn = 0) {
  const widthIn = Number(page.width || page.widthIn || 8);
  const heightIn = Number(page.height || page.heightIn || 10);
  const bleed = Math.max(0, Number(bleedIn || 0));
  return {
    widthIn,
    heightIn,
    bleedIn: bleed,
    canvasWidth: widthIn * DOCUMENT_COORDINATES_PER_INCH,
    canvasHeight: heightIn * DOCUMENT_COORDINATES_PER_INCH,
    scaleIn: 1 / DOCUMENT_COORDINATES_PER_INCH,
    xIn: (value) => bleed + documentCoordinateToInches(value),
    yIn: (value) => bleed + documentCoordinateToInches(value),
    lengthIn: documentCoordinateToInches,
    lengthPt: documentCoordinateToPdfPoints,
  };
}
