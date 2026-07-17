import test from "node:test";
import assert from "node:assert/strict";
import { ACADEMIC_BLOCKS, normalizeAcademicMetadata, toAcademicPersistenceFields } from "../src/editorial/models/editorialAcademic.js";
import { cloneDesignElements } from "../src/editorial/models/editorialDesign.js";
import { createAcademicBlock, generateAcademicExercise } from "../src/editorial/utils/editorialAcademicGenerators.js";
import { validateAcademicElements, validateAcademicLink } from "../src/editorial/utils/editorialAcademicValidation.js";
import { filterElementsForVariant, getElementVisibilityState, resolveAcademicViewElements } from "../src/editorial/utils/editorialAcademicVisibility.js";
import { createSongSheet, parseSongSections } from "../src/editorial/utils/editorialSongGenerator.js";
import { buildEditorialVariableValues, resolveEditorialVariables } from "../src/editorial/utils/editorialVariables.js";

test("normaliza metadata académica opcional sin borrar campos desconocidos", () => {
  const metadata = normalizeAcademicMetadata({ academicMetadata: { seriesId: "s1", levelName: "A2" }, unitNumber: 3, unknown: true });
  assert.deepEqual(metadata, { seriesId: "s1", levelName: "A2", unitNumber: 3 });
  const persisted = toAcademicPersistenceFields(metadata);
  assert.equal(persisted.seriesId, "s1");
  assert.equal(persisted.lessonTitle, "");
});

test("todos los bloques académicos generan elementos Konva editables agrupados", () => {
  ACADEMIC_BLOCKS.forEach(({ value }) => {
    const elements = createAcademicBlock(value, { content: "Contenido" });
    assert.ok(elements.length > 0, value);
    assert.equal(new Set(elements.map((element) => element.academicGroupId)).size, 1, value);
    elements.forEach((element) => assert.ok(["text", "shape", "image"].includes(element.type)));
  });
});

test("genera los cinco ejercicios con IDs nuevos y respuesta fuera del texto visual", () => {
  const cases = {
    multiple_choice: { question: "Capital", options: ["A", "B"], correctOption: 1, showLetters: true, layout: "list" },
    fill_blanks: { text: "Hello world", blanks: ["world"], wordBank: ["world"], showWordBank: true },
    true_false: { statements: [{ text: "La Tierra gira", answer: true }] },
    matching: { leftItems: ["uno"], rightItems: ["one"], answers: { 0: 0 } },
    open_questions: { questions: ["Explica"], answerLines: 2 },
  };
  Object.entries(cases).forEach(([type, input]) => {
    const first = generateAcademicExercise(type, input);
    const second = generateAcademicExercise(type, input);
    assert.ok(first.length > 0);
    assert.equal(first[0].exerciseData.type, type);
    assert.notEqual(first[0].id, second[0].id);
    assert.notEqual(first[0].academicGroupId, second[0].academicGroupId);
    assert.ok(first.some((element) => element.answerData));
  });
});

test("visibilidad distingue ocultamiento manual de variante", () => {
  const elements = [
    { id: "both", visible: true, visibilityMode: "both" },
    { id: "teacher", visible: true, visibilityMode: "teacher" },
    { id: "manual", visible: false, visibilityMode: "both" },
  ];
  assert.deepEqual(filterElementsForVariant(elements, "student").map((item) => item.id), ["both"]);
  assert.deepEqual(filterElementsForVariant(elements, "teacher").map((item) => item.id), ["both", "teacher"]);
  assert.equal(getElementVisibilityState(elements[1], "student").reason, "variant");
  assert.equal(getElementVisibilityState(elements[2], "teacher").reason, "manual");
});

test("valida respuestas, bancos, vínculos y variables faltantes", () => {
  const elements = generateAcademicExercise("multiple_choice", { question: "Q", options: [], correctOption: -1 });
  elements[0].content = "{{lesson.title}}";
  const warnings = validateAcademicElements(elements, {});
  assert.ok(warnings.some((warning) => warning.code === "missing_answer"));
  assert.ok(warnings.some((warning) => warning.code === "missing_options"));
  assert.ok(warnings.some((warning) => warning.code === "missing_correct_option"));
  assert.ok(warnings.some((warning) => warning.code === "missing_variable"));
  assert.equal(validateAcademicLink({ academicType: "worksheet" }).length, 1);
  assert.equal(validateAcademicLink({ academicType: "worksheet", bookId: "b1" }).length, 0);
});

test("resuelve variables académicas conservando placeholders originales", () => {
  const page = { id: "p1", academicMetadata: { seriesName: "Explore", levelName: "A2", bookName: "Student Book", unitNumber: 4, unitTitle: "Travel", lessonNumber: 2, lessonTitle: "Tickets", activityNumber: 6 } };
  const values = buildEditorialVariableValues({ project: { name: "Libro" }, document: { name: "Doc" }, page, section: null, numbering: new Map([["p1", { value: 8, label: "8" }]]), variant: "teacher" });
  assert.equal(resolveEditorialVariables("{{series.name}} · {{unit.title}} · {{lesson.number}} · {{student.version}}", values), "Explore · Travel · 2 · Maestro");
  const source = "{{unit.title}}";
  resolveEditorialVariables(source, values);
  assert.equal(source, "{{unit.title}}");
  const inherited = buildEditorialVariableValues({ project: { academicMetadata: { seriesName: "Explore" } }, page: { seriesName: "" } });
  assert.equal(inherited["series.name"], "Explore");
});

test("hoja de canción divide secciones y conserva respuestas para maestro", () => {
  const sections = parseSongSections("[verse: Verse 1]\nHello world\n[chorus]\nHello again");
  assert.equal(sections.length, 2);
  const elements = createSongSheet({ title: "Song", lyrics: "[verse]\nHello world", blankWords: ["Hello"], showWordBank: true });
  assert.ok(elements.some((element) => element.visibilityMode === "teacher"));
  assert.ok(elements.some((element) => element.answerData?.type === "song_blanks"));
  assert.equal(elements.filter((element) => element.answerData?.type === "song_blanks").length, 1);
  const studentLyrics = resolveAcademicViewElements(elements, "student").find((element) => element.songSectionType === "verse" && element.academicRole === "content");
  const teacherLyrics = resolveAcademicViewElements(elements, "teacher").find((element) => element.songSectionType === "verse" && element.academicRole === "content");
  assert.match(studentLyrics.resolvedContent, /_{4}/);
  assert.match(teacherLyrics.resolvedContent, /Hello world/);
  assert.equal(elements[0].songData.blankWords[0], "Hello");
});

test("clonar componente conserva respuestas y genera IDs nuevos", () => {
  const source = generateAcademicExercise("true_false", { statements: [{ text: "A", answer: true }] });
  const clone = cloneDesignElements(source);
  assert.notEqual(clone[0].id, source[0].id);
  assert.deepEqual(clone[0].answerData, source[0].answerData);
  assert.equal(clone[0].visibilityMode, source[0].visibilityMode);
  source[0].styleId = "style-academic";
  assert.equal(cloneDesignElements(source, { preserveStyleLinks: true })[0].styleId, "style-academic");
});
