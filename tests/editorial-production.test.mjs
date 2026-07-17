import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomaticIndexEntries, createAutomaticIndexElement, isAutomaticIndexStale, refreshAutomaticIndexElement, resolveAutomaticIndexElement } from "../src/editorial/utils/editorialAutomaticIndex.js";
import { getPdfPageSize } from "../src/editorial/utils/editorialPdfMeasurements.js";
import { renderEditorialPdf, resolveEditorialPageForOutput } from "../src/editorial/utils/editorialPdfRenderer.js";
import { selectEditorialPages } from "../src/editorial/utils/editorialPageSelection.js";
import { hasBlockingPreflight, runEditorialPreflight, summarizePreflight } from "../src/editorial/utils/editorialPreflight.js";
import { compareEditorialSnapshots, prepareEditorialRestoreDocument } from "../src/editorial/utils/editorialVersioning.js";
import { filterElementsForVariant } from "../src/editorial/utils/editorialAcademicVisibility.js";

const sections = [
  { id: "front", name: "Preliminares", type: "front_matter", order: 0 },
  { id: "unit-1", name: "Unidad 1", type: "unit", order: 1, unitNumber: 1 },
  { id: "chapter-1", name: "Capítulo 1", type: "chapter", order: 2 },
];
const pages = [
  { id: "p1", name: "Legal", order: 0, sectionId: "front", width: 8, height: 10 },
  { id: "p2", name: "Unidad", order: 1, sectionId: "unit-1", width: 8, height: 10 },
  { id: "p3", name: "Lección", order: 2, sectionId: "unit-1", width: 8, height: 10, academicMetadata: { academicType: "lesson", lessonTitle: "Saludos" } },
  { id: "p4", name: "Capítulo", order: 3, sectionId: "chapter-1", width: 8, height: 10 },
];
const numbering = new Map([["p1", { label: "iv" }], ["p2", { label: "1" }], ["p3", { label: "2" }], ["p4", { label: "3" }]]);

test("índice automático usa estructura y numeración calculada", () => {
  const input = { pages, sections, numbering };
  const entries = buildAutomaticIndexEntries({ ...input, config: { sectionTypes: ["unit", "chapter"], includeLessons: true } });
  assert.deepEqual(entries.map((item) => item.pageLabel), ["1", "2", "3"]);
  assert.equal(entries[1].level, 1);
  const element = createAutomaticIndexElement(input, 0, { sectionTypes: ["unit", "chapter"], includeLessons: true });
  assert.match(resolveAutomaticIndexElement(element, input).content, /Unidad 1/);
  const changed = { ...input, sections: sections.map((section) => section.id === "unit-1" ? { ...section, name: "Unidad renombrada" } : section) };
  assert.equal(isAutomaticIndexStale(element, changed), true);
  assert.equal(isAutomaticIndexStale(refreshAutomaticIndexElement(element, changed), changed), false);
});

test("preflight detecta categorías y bloquea imprenta", () => {
  const index = { ...createAutomaticIndexElement({ pages, sections, numbering }, 8), automaticIndex: { signature: "old" } };
  const text = { id: "text", name: "Texto", type: "text", x: 0, y: 0, width: 30, height: 5, visible: true, content: "{{missing.value}} contenido muy largo", style: { fontSize: 24, fontFamily: "MissingFont" } };
  const missingImage = { id: "missing", name: "Imagen", type: "image", x: 100, y: 100, width: 100, height: 100, visible: true };
  const lowImage = { id: "low", name: "Baja", type: "image", x: 200, y: 200, width: 500, height: 500, visible: true, assetUrl: "https://invalid.test/image.png", naturalWidth: 20, naturalHeight: 20 };
  const invalid = { id: "invalid", name: "Referencia", type: "shape", x: 100, y: 100, width: 40, height: 40, visible: true, styleId: "missing-style", componentId: "missing-component" };
  const qr = { id: "qr", name: "QR", type: "text", x: 100, y: 100, width: 40, height: 40, visible: true, content: "", academicBlockType: "qr_audio", style: { fontFamily: "Arial", fontSize: 12 } };
  const exercise = { id: "exercise", name: "Ejercicio", type: "text", x: 100, y: 100, width: 200, height: 30, visible: true, content: "Pregunta", style: { fontFamily: "Arial", fontSize: 12 }, academicGroupId: "exercise-group", exerciseData: { type: "multiple_choice", options: [], correctOption: -1 } };
  const snapshot = {
    project: { bleedIn: 0.125, margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } }, sections,
    pages: [
      { ...pages[1], background: "transparent", masterPageId: "missing-master", numberingEnabled: true, elements: [text, missingImage, lowImage, invalid, qr, exercise, index] },
      { ...pages[2], isBlank: false, numberingEnabled: true, elements: [] },
    ],
    numbering: new Map([["p2", { label: "1" }], ["p3", { label: "1" }]]), masters: [], components: [], styles: [], variables: [], reviewState: {},
  };
  const results = runEditorialPreflight(snapshot);
  const codes = new Set(results.map((item) => item.code));
  ["text_overflow", "outside_safe_area", "background_bleed", "missing_image", "low_resolution", "font_unavailable", "unresolved_variable", "empty_page", "missing_answer", "invalid_master", "invalid_component", "invalid_style", "empty_link", "duplicate_number", "stale_index"].forEach((code) => assert.ok(codes.has(code), code));
  assert.equal(hasBlockingPreflight(results), true);
  assert.ok(summarizePreflight(results).error > 0);
});

test("selección soporta rango, sección, unidad y manual", () => {
  assert.deepEqual(selectEditorialPages({ pages, sections, mode: "range", range: "2-3" }).map((item) => item.id), ["p2", "p3"]);
  assert.deepEqual(selectEditorialPages({ pages, sections, mode: "section", sectionId: "unit-1" }).map((item) => item.id), ["p2", "p3"]);
  assert.deepEqual(selectEditorialPages({ pages, sections, mode: "unit", unitNumber: 1 }).map((item) => item.id), ["p2", "p3"]);
  assert.deepEqual(selectEditorialPages({ pages, sections, mode: "manual", selectedIds: ["p4", "p1"] }).map((item) => item.id), ["p1", "p4"]);
});

test("comparación de versiones detecta estructura, metadata y elementos", () => {
  const previous = { pages: [{ id: "p1", name: "Uno", elements: [{ id: "e1", content: "A" }] }], sections: [{ id: "s1" }], academicMetadata: { levelId: "A1" } };
  const current = { pages: [{ id: "p1", name: "Uno", elements: [{ id: "e1", content: "B" }] }, { id: "p2", elements: [] }], sections: [{ id: "s2" }], academicMetadata: { levelId: "A2" } };
  const comparison = compareEditorialSnapshots(previous, current);
  assert.deepEqual(comparison.addedPages, ["p2"]);
  assert.equal(comparison.modifiedElements, 1);
  assert.equal(comparison.structureChanged, true);
  assert.equal(comparison.academicMetadataChanged, true);
});

test("restauración quita auditoría raíz y conserva metadata desconocida", () => {
  const restored = prepareEditorialRestoreDocument({ id: "page", updatedAt: "old", customField: { id: "nested", unknown: true }, answerData: { value: "A" } });
  assert.equal(restored.id, undefined);
  assert.equal(restored.updatedAt, undefined);
  assert.deepEqual(restored.customField, { id: "nested", unknown: true });
  assert.equal(restored.answerData.value, "A");
});

test("variantes no duplican páginas y respetan visibilidad", () => {
  const elements = [{ id: "student", visibilityMode: "student", visible: true }, { id: "teacher", visibilityMode: "teacher", visible: true }, { id: "both", visibilityMode: "both", visible: true }];
  assert.deepEqual(filterElementsForVariant(elements, "student").map((item) => item.id), ["student", "both"]);
  assert.deepEqual(filterElementsForVariant(elements, "teacher").map((item) => item.id), ["teacher", "both"]);
});

test("medidas PDF convierten pulgadas exactas con sangrado", () => {
  const size = getPdfPageSize({ width: 8, height: 10 }, 0.125);
  assert.equal(size.widthIn, 8.25);
  assert.equal(size.heightIn, 10.25);
  assert.equal(size.widthPt, 594);
  assert.equal(size.heightPt, 738);
});

test("PDF vectorial conserva MediaBox real", async () => {
  const page = { id: "pdf-page", name: "PDF", order: 0, sectionId: "unit-1", width: 8, height: 10, background: "#ffffff", elements: [{ id: "shape", name: "Figura", type: "shape", x: 96, y: 96, width: 192, height: 96, rotation: 12, opacity: 0.8, zIndex: 0, visible: true, style: { fill: "#ff0000" } }, { id: "answer", name: "Respuesta", type: "text", x: 96, y: 220, width: 200, height: 40, rotation: 0, opacity: 1, zIndex: 1, visible: true, visibilityMode: "teacher", content: "Respuesta", style: { fontFamily: "Arial", fontSize: 14 } }] };
  const snapshot = { project: { name: "Prueba", bleedIn: 0.125 }, document: { name: "Documento" }, pages: [page], sections, numbering: new Map([[page.id, { label: "1" }]]), masters: [], components: [], styles: [], variables: [] };
  assert.equal(resolveEditorialPageForOutput(snapshot, page, "student").some((item) => item.id === "answer"), false);
  assert.equal(resolveEditorialPageForOutput(snapshot, page, "teacher").some((item) => item.id === "answer"), true);
  const blob = await renderEditorialPdf({ snapshot, pages: [page], variant: "student", settings: { type: "print", bleedIn: 0.125 } });
  const source = new TextDecoder("latin1").decode(await blob.arrayBuffer());
  assert.match(source, /^%PDF-/);
  assert.match(source, /\/MediaBox \[0 0 594(?:\.0*)? 738(?:\.0*)?\]/);
  const reviewBlob = await renderEditorialPdf({ snapshot, pages: [page], variant: "teacher", settings: { type: "review", watermark: true } });
  const reviewSource = new TextDecoder("latin1").decode(await reviewBlob.arrayBuffer());
  assert.match(reviewSource, /\/MediaBox \[0 0 576(?:\.0*)? 720(?:\.0*)?\]/);
});
