import assert from "node:assert/strict";
import test from "node:test";
import { createShapeElement, createTextElement, normalizeEditorialElement } from "../src/editorial/models/editorialElements.js";
import { EDITORIAL_SHAPE_TYPES, buildLinePoints, buildShapePoints, getShapeKind, scaleShapePoints } from "../src/editorial/models/editorialShapes.js";
import { applyTextTransform, estimateTextHeight, konvaFontStyle, konvaTextDecoration, normalizeTextStyle, textOverflowsFixedBox, toggleDecoration } from "../src/editorial/models/editorialTypography.js";
import { buildCustomFontRecord, buildFontOptions, findFontVariant, fontRecordVariant, fontVariantKey, resolveFontVariant, resolvePdfFont } from "../src/editorial/models/editorialFonts.js";
import { buildBackgroundFromAsset, computeBackgroundLayout, getBackgroundTileOrigins, normalizeBackgroundImage } from "../src/editorial/models/editorialBackground.js";
import { resolveInlineTextCommand, resolveInlineTextGeometry } from "../src/editorial/models/editorialInlineText.js";
import { commitTransientHistory, replaceHistoryPresent } from "../src/editorial/hooks/useEditorialHistory.js";
import { createMasterOverride, resolveComponentElement, resolveMasterElements } from "../src/editorial/utils/editorialInheritance.js";
import { renderEditorialPdf, resolveEditorialPageSurface, resolvePdfFontSelection } from "../src/editorial/utils/editorialPdfRenderer.js";
import { runEditorialPreflight } from "../src/editorial/utils/editorialPreflight.js";
import { rotateShapePoints } from "../src/editorial/utils/editorialPdfTypography.js";
import { normalizeImageBorder, normalizeShadow } from "../src/editorial/models/editorialEffects.js";

test("registro contiene 16 figuras y todas producen geometría redimensionable", () => {
  assert.equal(EDITORIAL_SHAPE_TYPES.length, 16);
  const names = new Set(EDITORIAL_SHAPE_TYPES.map(([type]) => type));
  ["rectangle", "rounded_rectangle", "square", "circle", "ellipse", "triangle", "right_triangle", "diamond", "pentagon", "hexagon", "star", "arrow", "line", "double_arrow", "speech_bubble", "custom_polygon"].forEach((type) => assert.ok(names.has(type)));
  EDITORIAL_SHAPE_TYPES.forEach(([type]) => {
    const element = createShapeElement(0, type);
    const points = ["line", "arrow"].includes(getShapeKind(type)) ? buildLinePoints(element.width, element.height, element) : buildShapePoints(type, element.width, element.height, element);
    if (getShapeKind(type) !== "rect" && getShapeKind(type) !== "ellipse") assert.ok(points.length >= 4, type);
    assert.equal(normalizeEditorialElement(element).shapeType, type);
  });
  assert.deepEqual(scaleShapePoints([10, 10, 20, 10, 20, 20], 200, 100), [0, 0, 200, 0, 200, 100]);
  const rotated = rotateShapePoints([0, 0, 100, 0, 100, 50], 90).map((value) => Math.round(value));
  assert.deepEqual(rotated, [0, 0, 0, 100, -50, 100]);
});

test("defaults legacy conservan campos y normalizan rectángulo, opacidad y caja", () => {
  const legacyShape = normalizeEditorialElement({ id: "s", type: "shape", width: 80, height: 40, opacity: 3, custom: { keep: true }, style: { fill: "#fff" } });
  assert.equal(legacyShape.shapeType, "rectangle");
  assert.equal(legacyShape.opacity, 1);
  assert.deepEqual(legacyShape.custom, { keep: true });
  const legacyText = normalizeEditorialElement({ id: "t", type: "text", width: 100, height: 20, content: "texto", style: { fontSize: 12 } });
  assert.equal(legacyText.style.boxMode, "fixed_box");
  assert.equal(createTextElement(0).style.boxMode, "auto_size");
});

test("tipografía cubre alineación, decoraciones, transformación, padding y overflow", () => {
  const style = normalizeTextStyle({ fontWeight: 700, fontStyle: "italic", verticalAlign: "bottom", align: "justify", padding: { top: 4, right: 5, bottom: 6, left: 7 } });
  assert.equal(konvaFontStyle(style), "bold italic");
  const underlined = { ...style, textDecoration: toggleDecoration(style, "underline") };
  const decorated = { ...underlined, textDecoration: toggleDecoration(underlined, "line-through") };
  assert.equal(konvaTextDecoration(decorated), "underline line-through");
  assert.equal(applyTextTransform("hola mundo", "capitalize"), "Hola Mundo");
  assert.ok(estimateTextHeight({ text: "uno dos tres", width: 40, fontSize: 12, lineHeight: 1.2, padding: style.padding }) > 20);
  assert.equal(textOverflowsFixedBox({ content: "contenido muy largo", width: 40, height: 10, style: { ...style, boxMode: "fixed_box", fontSize: 14 } }), true);
  assert.equal(textOverflowsFixedBox({ content: "contenido muy largo", width: 40, height: 10, style: { ...style, boxMode: "auto_size", fontSize: 14 } }), false);
});

test("registro de fuentes resuelve variantes, carga selectiva y fallback PDF", () => {
  const normal = buildCustomFontRecord({ file: { name: "AES.ttf" }, family: "AES Sans", license: "Licencia interna", url: "https://example.test/a.ttf" });
  const boldItalic = buildCustomFontRecord({ file: { name: "AES-BI.otf" }, family: "AES Sans", weight: 700, style: "italic", license: "Licencia interna" });
  assert.equal(fontRecordVariant(boldItalic), "bolditalic");
  assert.equal(resolveFontVariant({ weight: "bold", italic: true }), "bolditalic");
  assert.equal(findFontVariant([normal, boldItalic], "AES Sans", "bolditalic"), boldItalic);
  const loaded = new Set([fontVariantKey("AES Sans", "normal")]);
  const normalOption = buildFontOptions([normal, boldItalic], loaded, "normal").find((font) => font.family === "AES Sans");
  const boldOption = buildFontOptions([normal, boldItalic], loaded, "bolditalic").find((font) => font.family === "AES Sans");
  assert.equal(normalOption.selectable, true);
  assert.equal(boldOption.selectable, false);
  assert.equal(resolvePdfFont("Georgia"), "times");
  assert.deepEqual(resolvePdfFontSelection({ style: { fontFamily: "No cargada" } }, new Set()), { family: "helvetica", variant: "normal", fallback: true });
  assert.deepEqual(resolvePdfFontSelection({ style: { fontFamily: "AES Sans" } }, loaded), { family: "AES Sans", variant: "normal", fallback: false });
});

test("fondos normalizan asset, fits, tile y límites de escala/opacidad", () => {
  const background = buildBackgroundFromAsset({ id: "asset", url: "https://example.test/bg.png", storagePath: "editorial/bg.png" }, { fit: "tile", scale: 0, opacity: 2, positionX: 12, positionY: -4 });
  assert.equal(background.assetId, "asset");
  assert.equal(background.opacity, 1);
  assert.equal(background.scale, 1);
  const layout = computeBackgroundLayout({ background, box: { width: 100, height: 80 }, natural: { width: 20, height: 10 } });
  assert.equal(layout.mode, "tile");
  assert.ok(getBackgroundTileOrigins(layout, { width: 100, height: 80 }).length > 1);
  assert.equal(normalizeBackgroundImage({}), null);
  assert.deepEqual(normalizeImageBorder({ enabled: false, radius: 18 }), { enabled: false, color: "#1f2937", width: 1, radius: 18 });
  assert.equal(normalizeShadow({ enabled: true, opacity: 4 }).opacity, 1);
});

test("edición inline resuelve comandos, zoom, rotación y alineación vertical", () => {
  assert.equal(resolveInlineTextCommand({ key: "Escape" }), "cancel");
  assert.equal(resolveInlineTextCommand({ key: "Enter", ctrlKey: true }), "commit");
  assert.equal(resolveInlineTextCommand({ key: "Enter" }), "input");
  const geometry = resolveInlineTextGeometry({
    rect: { left: 100, top: 50 }, zoom: 2, value: "Hola",
    element: { width: 200, height: 100, rotation: 90, style: { fontSize: 16, boxMode: "fixed_box", verticalAlign: "bottom", padding: { left: 10, top: 5, right: 10, bottom: 5 } } },
  });
  assert.equal(geometry.width, 360);
  assert.ok(geometry.left < 100);
  assert.ok(geometry.top > 50);
});

test("historial transitorio agrupa múltiples cambios en una entrada", () => {
  const original = [{ id: "a", opacity: 1 }];
  const state = { loaded: true, past: [], present: original, future: [[{ id: "future" }]] };
  const live1 = replaceHistoryPresent(state, [{ id: "a", opacity: .8 }]);
  const live2 = replaceHistoryPresent(live1, [{ id: "a", opacity: .4 }]);
  assert.equal(live2.past.length, 0);
  const committed = commitTransientHistory(live2, original, 50);
  assert.equal(committed.past.length, 1);
  assert.deepEqual(committed.past[0], original);
  assert.equal(committed.future.length, 0);
});

test("herencia conserva figura, efectos y overrides sin borrar datos", () => {
  const masterElement = { id: "shape", type: "shape", name: "Estrella", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, shapeType: "star", points: [0, 0, 100, 0, 50, 100], shadow: { enabled: true }, style: { fill: "#f00" } };
  const component = { id: "component", elements: [masterElement] };
  const instance = { ...masterElement, id: "instance", shapeType: "rectangle", componentId: "component", componentElementId: "shape", componentBase: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 }, componentOverrides: { style: { fill: "#0f0" } } };
  const resolved = resolveComponentElement(instance, new Map([["component", component]]));
  assert.equal(resolved.shapeType, "star");
  assert.equal(resolved.style.fill, "#0f0");
  assert.equal(resolved.shadow.enabled, true);
  const override = createMasterOverride({ unknown: true }, { style: { fill: "#00f" } });
  assert.equal(override.unknown, true);
  assert.equal(resolveMasterElements([masterElement], { shape: override })[0].style.fill, "#00f");
});

test("preflight Fase 8 detecta fondo, variante, fallback, opacidad y figura", () => {
  const page = {
    id: "p", name: "Página", width: 8, height: 10, background: "#ffffff", backgroundImage: { assetId: "missing" }, numberingEnabled: false,
    elements: [
      { id: "shape", type: "shape", width: 0, height: 20, x: 100, y: 100, visible: true, style: {} },
      { id: "hidden", type: "shape", width: 20, height: 20, x: 100, y: 100, visible: true, opacity: 0, style: {} },
      { id: "text", type: "text", width: 80, height: 20, x: 100, y: 100, visible: true, content: "Texto", style: { fontFamily: "Custom", fontWeight: "bold", fill: "#ffffff", boxMode: "fixed_box" } },
    ],
  };
  const results = runEditorialPreflight({ project: {}, pages: [page], sections: [], numbering: new Map(), masters: [], components: [], styles: [], variables: [], fonts: [{ family: "Custom", weight: 400, style: "normal", extension: "woff", pdfEmbeddable: false, url: "https://example.test/font.woff" }] });
  const codes = new Set(results.map((result) => result.code));
  ["background_missing", "invalid_shape", "opacity_zero", "low_contrast", "font_not_embeddable", "font_variant_unavailable"].forEach((code) => assert.ok(codes.has(code), code));
});

test("PDF renderiza las 16 figuras y conserva fondo heredado o local", async () => {
  const shapes = EDITORIAL_SHAPE_TYPES.map(([type], index) => ({
    ...createShapeElement(index, type),
    x: 24 + (index % 4) * 170,
    y: 24 + Math.floor(index / 4) * 150,
    width: 110,
    height: type === "square" || type === "circle" ? 110 : 80,
    rotation: index % 3 === 0 ? 12 : 0,
    opacity: 0.75,
    style: { fill: "#75aadb", borderColor: "#17324d", borderWidth: 2, borderStyle: index % 2 ? "dashed" : "solid" },
    shadow: { enabled: true, color: "#000000", blur: 3, offsetX: 2, offsetY: 2, opacity: 0.2 },
  }));
  const master = { id: "master", background: "#eef3f8", backgroundImage: { assetId: "master-bg" } };
  const page = { id: "shapes", name: "Figuras", order: 0, width: 8, height: 10, masterPageId: master.id, elements: shapes };
  assert.equal(resolveEditorialPageSurface({ masters: [master] }, page).background.color, "#eef3f8");
  assert.equal(resolveEditorialPageSurface({ masters: [master] }, page).backgroundImage.assetId, "master-bg");
  assert.equal(resolveEditorialPageSurface({ masters: [master] }, { ...page, backgroundImage: { assetId: "local-bg" } }).backgroundImage.assetId, "local-bg");
  const snapshot = { project: { name: "Fase 8" }, document: { name: "Figuras" }, pages: [page], sections: [], numbering: new Map(), masters: [master], components: [], styles: [], variables: [], fonts: [] };
  const blob = await renderEditorialPdf({ snapshot, pages: [page], settings: { type: "review" } });
  const source = new TextDecoder("latin1").decode(await blob.arrayBuffer());
  assert.match(source, /^%PDF-/);
  assert.ok(blob.size > 1000);
});
