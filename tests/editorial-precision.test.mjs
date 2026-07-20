import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEditorialBackground, backgroundPersistenceFields } from "../src/editorial/models/editorialBackground.js";
import { buildFontOptions, EDITORIAL_SAFE_FONTS, fontVariantKey } from "../src/editorial/models/editorialFonts.js";
import { normalizeTextStyle } from "../src/editorial/models/editorialTypography.js";
import { resolveDocumentDimensions, resizeEditorialElements } from "../src/editorial/utils/editorialDocumentSizing.js";
import { createEditorialPdfCoordinateAdapter, documentCoordinateToPdfPoints, pdfPointsToDocumentCoordinate } from "../src/editorial/utils/editorialPdfCoordinateAdapter.js";
import { getPdfPageSize } from "../src/editorial/utils/editorialPdfMeasurements.js";
import { buildEditorialRulerModel } from "../src/editorial/utils/editorialRulerModel.js";
import { buildSmartGuideTargets } from "../src/editorial/utils/editorialSmartGuides.js";
import { snapElementPosition, snapResizeBox, snapToleranceForZoom } from "../src/editorial/utils/editorialSnapping.js";
import { convertUnit, documentUnitToCanvasPx, canvasPxToDocumentUnit, documentUnitToPdfPoints } from "../src/editorial/utils/editorialUnitConversion.js";
import { createEditorialViewportGeometry } from "../src/editorial/utils/editorialViewportGeometry.js";
import { getFitZoom } from "../src/editorial/utils/editorialMeasurements.js";

const closeTo = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);

test("geometría conserva origen real con centrado, scroll, pan y resize", () => {
  const centered = createEditorialViewportGeometry({ workspaceRect: { left: 300, top: 100, width: 900, height: 700 }, pageRect: { left: 420, top: 150, width: 384, height: 480 }, scale: .5, scrollX: 0, scrollY: 0 });
  assert.equal(centered.pageOffsetX, 120);
  assert.equal(centered.pageOffsetY, 50);
  assert.equal(centered.pageX, 420);
  const moved = createEditorialViewportGeometry({ workspaceRect: { left: 300, top: 100, width: 700, height: 500 }, pageRect: { left: 350, top: 105, width: 768, height: 960 }, scale: 1, scrollX: 70, scrollY: 45, panX: 12, panY: -3 });
  assert.equal(moved.pageOffsetX, 62);
  assert.equal(moved.pageOffsetY, 2);
  assert.equal(moved.scrollX, 70);
  assert.equal(moved.viewportWidth, 700);
});

test("ajustar página y ancho derivan viewport, padding, pliego y resize", () => {
  const metrics = { stageWidth: 768, stageHeight: 960 };
  closeTo(getFitZoom({ viewportWidth: 1000, viewportHeight: 800, metrics, facing: false, mode: "page", insets: { left: 48, right: 48, top: 44, bottom: 44 } }), 712 / 960);
  closeTo(getFitZoom({ viewportWidth: 1000, viewportHeight: 800, metrics, facing: false, mode: "width", insets: { left: 48, right: 48 } }), 904 / 768);
  const facing = getFitZoom({ viewportWidth: 1600, viewportHeight: 1000, metrics, facing: true, mode: "width", insets: { left: 48, right: 48 }, spreadGap: 18, spreadMetrics: [metrics, metrics] });
  closeTo(facing, 1504 / (768 * 2 + 18));
});

test("conversiones físicas soportan in, cm, mm, px y pt sin deriva", () => {
  closeTo(convertUnit(8.5, "in", "cm"), 21.59);
  closeTo(convertUnit(convertUnit(convertUnit(8.5, "in", "cm"), "cm", "mm"), "mm", "in"), 8.5);
  closeTo(documentUnitToCanvasPx(1, "in", .25), 24);
  closeTo(canvasPxToDocumentUnit(48, "in", .5), 1);
  closeTo(documentUnitToPdfPoints(1, "in"), 72);
  closeTo(documentUnitToPdfPoints(96, "px"), 72);
  closeTo(documentUnitToPdfPoints(72, "pt"), 72);
});

test("Carta, A4, 8x10, horizontal y personalizado mantienen tamaño físico", () => {
  assert.deepEqual(resolveDocumentDimensions({ size: "8x10", orientation: "portrait" }), { widthIn: 8, heightIn: 10 });
  assert.deepEqual(resolveDocumentDimensions({ size: "letter", orientation: "landscape" }), { widthIn: 11, heightIn: 8.5 });
  const a4 = resolveDocumentDimensions({ size: "a4", orientation: "portrait" });
  closeTo(a4.widthIn, 210 / 25.4);
  closeTo(a4.heightIn, 297 / 25.4);
  assert.deepEqual(resolveDocumentDimensions({ size: "custom", widthIn: 12, heightIn: 7, orientation: "portrait" }), { widthIn: 7, heightIn: 12 });
  const centered = resizeEditorialElements([{ id: "a", x: 96, y: 96, width: 96, height: 96, unknown: true }], { widthIn: 8, heightIn: 10 }, { widthIn: 10, heightIn: 12 }, "center")[0];
  assert.deepEqual({ x: centered.x, y: centered.y, unknown: centered.unknown }, { x: 192, y: 192, unknown: true });
});

test("reglas usan tamaño y unidad reales con marcas mayores y menores", () => {
  const inches = buildEditorialRulerModel({ lengthIn: 8.5, unit: "in", scale: 1 });
  closeTo(inches.lengthPx, 816);
  assert.equal(inches.ticks[0].label, "0");
  assert.ok(inches.ticks.some((tick) => tick.major && tick.label === "8"));
  assert.ok(inches.ticks.some((tick) => !tick.major));
  const millimeters = buildEditorialRulerModel({ lengthIn: 210 / 25.4, unit: "mm", scale: .5 });
  closeTo(millimeters.length, 210);
  assert.equal(millimeters.unit, "mm");
  assert.ok(millimeters.ticks.some((tick) => tick.label === "200"));
});

test("snapping alinea bordes, centros, página y márgenes con tolerancia visual", () => {
  const elements = [{ id: "target", x: 200, y: 300, width: 100, height: 80, visible: true }];
  const targets = buildSmartGuideTargets({ elements, movingId: "moving", pageWidth: 768, pageHeight: 960, margins: { left: 48, right: 48, top: 48, bottom: 48 } });
  const centered = snapElementPosition({ moving: { x: 247, y: 337, width: 100, height: 80 }, targets, zoom: 1 });
  assert.equal(centered.x, 250);
  assert.equal(centered.y, 340);
  const pageCenter = snapElementPosition({ moving: { x: 331, y: 438, width: 100, height: 80 }, targets, zoom: .5 });
  assert.equal(pageCenter.x, 334);
  assert.equal(pageCenter.y, 440);
  const margin = snapElementPosition({ moving: { x: 44, y: 44, width: 20, height: 20 }, targets, zoom: 1 });
  assert.equal(margin.x, 48);
  assert.equal(margin.y, 48);
  const ignored = snapElementPosition({ moving: { x: 44, y: 44, width: 20, height: 20 }, targets, zoom: 1, ignore: true });
  assert.deepEqual(ignored, { x: 44, y: 44, guides: [] });
  assert.equal(snapToleranceForZoom(.5), 12);
  assert.equal(snapToleranceForZoom(2), 3);
  const resized = snapResizeBox({ box: { x: 0, y: 0, width: 197, height: 80 }, targets, activeAnchor: "middle-right", zoom: 1 });
  assert.equal(resized.width, 200);
});

test("adaptador PDF ignora zoom: 1 pulgada son 72 pt en Carta y A4", () => {
  const letter = createEditorialPdfCoordinateAdapter({ width: 8.5, height: 11 });
  const a4 = createEditorialPdfCoordinateAdapter({ width: 210 / 25.4, height: 297 / 25.4 });
  closeTo(letter.lengthIn(96), 1);
  closeTo(a4.lengthIn(96), 1);
  closeTo(documentCoordinateToPdfPoints(96), 72);
  closeTo(documentCoordinateToPdfPoints(16), 12);
  closeTo(pdfPointsToDocumentCoordinate(12), 16);
  assert.equal(letter.scaleIn, 1 / 96);
  assert.equal(a4.scaleIn, 1 / 96);
  const letterSize = getPdfPageSize({ width: 8.5, height: 11 });
  assert.deepEqual({ widthPt: letterSize.widthPt, heightPt: letterSize.heightPt }, { widthPt: 612, heightPt: 792 });
  const eightByTen = getPdfPageSize({ width: 8, height: 10 });
  assert.deepEqual({ widthPt: eightByTen.widthPt, heightPt: eightByTen.heightPt }, { widthPt: 576, heightPt: 720 });
});

test("fondos color e imagen persisten con compatibilidad legacy", () => {
  const legacy = normalizeEditorialBackground("#123456", { assetId: "asset", url: "https://example.test/bg.png", fit: "cover" });
  assert.equal(legacy.type, "image");
  assert.equal(legacy.color, "#123456");
  const color = normalizeEditorialBackground({ type: "color", color: "#abcdef", opacity: .4, extra: true });
  assert.deepEqual(backgroundPersistenceFields(color), { background: color, backgroundImage: null });
  const none = normalizeEditorialBackground({ type: "none", color: "#fff" });
  assert.equal(none.type, "none");
});

test("catálogo devuelve lista completa, estados y color inline seguro", () => {
  const custom = [{ family: "AES Sans", weight: 400, style: "normal", pdfEmbeddable: true }];
  const loading = buildFontOptions(custom, new Set(), "normal");
  assert.equal(loading.length, EDITORIAL_SAFE_FONTS.length + 1);
  assert.equal(loading.find((font) => font.family === "AES Sans").status, "loading");
  const failed = buildFontOptions(custom, new Set(), "normal", new Set([fontVariantKey("AES Sans", "normal")]));
  assert.equal(failed.find((font) => font.family === "AES Sans").status, "unavailable");
  assert.equal(failed.find((font) => font.family === "AES Sans").selectable, false);
  assert.equal(normalizeTextStyle({ color: "#e11d48" }).fill, "#e11d48");
  assert.equal(normalizeTextStyle({}).fill, "#111111");
});
