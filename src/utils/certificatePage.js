export const CERTIFICATE_PAGE = Object.freeze({
  format: "letter",
  orientation: "portrait",
  widthIn: 8.5,
  heightIn: 11,
  widthPt: 612,
  heightPt: 792,
  renderDpi: 96,
  widthPx: 816,
  heightPx: 1056,
});

export const CERTIFICATE_PAGE_VERSION = 1;

export const CERTIFICATE_STAGE_STYLE = Object.freeze({
  "--certificate-page-width": `${CERTIFICATE_PAGE.widthPx}px`,
  "--certificate-page-height": `${CERTIFICATE_PAGE.heightPx}px`,
  aspectRatio: `${CERTIFICATE_PAGE.widthIn} / ${CERTIFICATE_PAGE.heightIn}`,
});

export function getPdfFirstPageSize(bytes) {
  if (!bytes) return null;

  const source = typeof bytes === "string"
    ? bytes
    : new TextDecoder("latin1").decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const mediaBox = source.match(
    /\/MediaBox\s*\[\s*(-?\d+(?:\.\d*)?)\s+(-?\d+(?:\.\d*)?)\s+(-?\d+(?:\.\d*)?)\s+(-?\d+(?:\.\d*)?)\s*\]/
  );

  if (!mediaBox) return null;

  const left = Number(mediaBox[1]);
  const bottom = Number(mediaBox[2]);
  const right = Number(mediaBox[3]);
  const top = Number(mediaBox[4]);

  if (![left, bottom, right, top].every(Number.isFinite)) return null;

  return {
    widthPt: Math.abs(right - left),
    heightPt: Math.abs(top - bottom),
  };
}

export function isLetterPortraitPdf(bytes, tolerancePt = 1) {
  const size = getPdfFirstPageSize(bytes);

  return Boolean(
    size &&
    Math.abs(size.widthPt - CERTIFICATE_PAGE.widthPt) <= tolerancePt &&
    Math.abs(size.heightPt - CERTIFICATE_PAGE.heightPt) <= tolerancePt
  );
}
