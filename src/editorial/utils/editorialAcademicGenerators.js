import { createEditorialElementId, normalizeEditorialElement } from "../models/editorialElements.js";

const TEXT_STYLE = { fontFamily: "Arial", fontSize: 18, fontWeight: "normal", align: "left", lineHeight: 1.25, fill: "#142033" };
const ACCENT = "#1677eb";

function groupId(prefix = "academic") {
  return `${prefix}-${createEditorialElementId()}`;
}

function textElement({ name, content, x, y, width = 620, height = 34, zIndex = 0, style = {}, metadata = {} }) {
  return normalizeEditorialElement({
    id: createEditorialElementId(), name, type: "text", x, y, width, height,
    rotation: 0, opacity: 1, zIndex, locked: false, visible: true, content,
    style: { ...TEXT_STYLE, ...style }, visibilityMode: "both", ...metadata,
  }, zIndex);
}

function shapeElement({ name, x, y, width, height, zIndex = 0, style = {}, metadata = {} }) {
  return normalizeEditorialElement({
    id: createEditorialElementId(), name, type: "shape", x, y, width, height,
    rotation: 0, opacity: 1, zIndex, locked: false, visible: true, content: "",
    style: { fill: "#f5f9ff", borderColor: ACCENT, borderWidth: 1.5, cornerRadius: 8, ...style },
    visibilityMode: "both", ...metadata,
  }, zIndex);
}

function withGroup(elements, id, blockType, exerciseData) {
  return elements.map((element, index) => normalizeEditorialElement({
    ...element,
    zIndex: index,
    academicGroupId: id,
    academicBlockType: blockType,
    ...(index === 0 && exerciseData ? { exerciseData } : {}),
  }, index));
}

function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function answerElement(x, y, zIndex) {
  return textElement({ name: "Respuesta para maestro", content: "Respuesta del ejercicio", x, y, width: 620, height: 30, zIndex, metadata: { academicRole: "answer", visibilityMode: "teacher" }, style: { fontSize: 14, fontWeight: "bold", fill: "#a45b00" } });
}

export function createAcademicBlock(blockType, options = {}) {
  const id = groupId(blockType);
  const x = Number(options.x ?? 64);
  const y = Number(options.y ?? 64);
  const content = String(options.content || "");
  const common = { academicRole: "content" };
  let elements;

  if (blockType === "activity_header") elements = [
    shapeElement({ name: "Fondo de encabezado", x, y, width: 640, height: 58, metadata: { academicRole: "background" }, style: { fill: "#e9f3ff", borderWidth: 0 } }),
    textElement({ name: "Encabezado de actividad", content: content || "{{activity.number}} · Título de la actividad", x: x + 18, y: y + 14, width: 600, height: 34, zIndex: 1, metadata: common, style: { fontSize: 24, fontWeight: "bold", fill: ACCENT } }),
  ];
  else if (blockType === "exercise_number") elements = [
    shapeElement({ name: "Fondo de número", x, y, width: 38, height: 38, metadata: { academicRole: "background" }, style: { fill: ACCENT, borderWidth: 0, cornerRadius: 19 } }),
    textElement({ name: "Número de ejercicio", content: content || "{{activity.number}}", x, y: y + 7, width: 38, height: 24, zIndex: 1, metadata: common, style: { align: "center", fontSize: 18, fontWeight: "bold", fill: "#ffffff" } }),
  ];
  else if (["vocabulary_box", "word_bank", "grammar_box", "example_box", "teacher_note", "answers"].includes(blockType)) {
    const labels = { vocabulary_box: "Vocabulario", word_bank: "Banco de palabras", grammar_box: "Gramática", example_box: "Ejemplo", teacher_note: "Nota para maestro", answers: "Respuestas" };
    const teacherOnly = ["teacher_note", "answers"].includes(blockType);
    elements = [
      shapeElement({ name: `Caja · ${labels[blockType]}`, x, y, width: 640, height: 118, metadata: { academicRole: "background" }, style: { fill: teacherOnly ? "#fff8db" : "#f5f9ff" } }),
      textElement({ name: labels[blockType], content: labels[blockType], x: x + 16, y: y + 12, width: 610, height: 26, zIndex: 1, metadata: { academicRole: "label" }, style: { fontSize: 18, fontWeight: "bold", fill: ACCENT } }),
      textElement({ name: `Contenido · ${labels[blockType]}`, content: content || "Escribe el contenido", x: x + 16, y: y + 46, width: 610, height: 58, zIndex: 2, metadata: common }),
    ].map((element) => teacherOnly ? { ...element, visibilityMode: "teacher" } : element);
  }
  else if (blockType === "student_info") elements = [textElement({ name: "Datos del alumno", content: content || "Nombre: ____________________   Grupo: __________   Fecha: __________", x, y, width: 640, height: 34, metadata: common, style: { fontSize: 16 } })];
  else if (["writing_space", "answer_lines"].includes(blockType)) {
    const count = Math.max(2, Number(options.lines || 5));
    elements = Array.from({ length: count }, (_, index) => shapeElement({ name: `Línea ${index + 1}`, x, y: y + index * 30, width: 640, height: 2, zIndex: index, metadata: common, style: { fill: "#9ba8b8", borderWidth: 0, cornerRadius: 0 } }));
  }
  else if (blockType === "audio_reference") elements = [
    shapeElement({ name: "Referencia de audio", x, y, width: 180, height: 72, metadata: { academicRole: "background" } }),
    textElement({ name: "Audio", content: content || "Audio: escribe la referencia", x: x + 12, y: y + 22, width: 156, height: 34, zIndex: 1, metadata: common, style: { fontSize: 14, align: "center" } }),
  ];
  else if (["multiple_choice", "true_false", "matching", "fill_blanks", "comprehension"].includes(blockType)) {
    const aliases = { multiple_choice: "Opción múltiple", true_false: "Verdadero o falso", matching: "Relacionar columnas", fill_blanks: "Completar espacios", comprehension: "Preguntas de comprensión" };
    elements = [textElement({ name: aliases[blockType], content: content || aliases[blockType], x, y, width: 640, height: 38, metadata: common, style: { fontWeight: "bold" } })];
  }
  else elements = [textElement({ name: blockType === "instructions" ? "Instrucciones" : "Bloque académico", content: content || (blockType === "instructions" ? "Lee y realiza la actividad." : "Escribe el contenido"), x, y, width: 640, height: 48, metadata: common, style: { fontWeight: blockType === "instructions" ? "bold" : "normal" } })];

  return withGroup(elements, id, blockType);
}

export function generateMultipleChoice(input = {}, options = {}) {
  const id = options.groupId || groupId("multiple-choice");
  const choices = splitLines(input.options);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const correctIndex = Math.max(-1, Number(input.correctOption ?? -1));
  const x = Number(options.x ?? 64); const y = Number(options.y ?? 64);
  const elements = [textElement({ name: "Pregunta", content: input.question || "Pregunta", x, y, width: 640, height: 48, metadata: { academicRole: "question", answerData: { type: "multiple_choice", value: correctIndex >= 0 ? choices[correctIndex] || String(correctIndex) : "", acceptedValues: [], explanation: input.explanation || "" } }, style: { fontWeight: "bold" } })];
  choices.forEach((choice, index) => elements.push(textElement({ name: `Opción ${index + 1}`, content: `${input.showLetters === false ? "" : `${letters[index]}. `}${choice}`, x: x + 18 + (input.layout === "columns" ? (index % 2) * 310 : 0), y: y + 56 + (input.layout === "columns" ? Math.floor(index / 2) * 38 : index * 38), width: input.layout === "columns" ? 290 : 610, height: 30, zIndex: elements.length, metadata: { academicRole: "option", optionIndex: index } })));
  elements.push(answerElement(x + 18, y + 62 + (input.layout === "columns" ? Math.ceil(choices.length / 2) * 38 : choices.length * 38), elements.length));
  return withGroup(elements, id, "multiple_choice", { type: "multiple_choice", ...input, options: choices, correctOption: correctIndex });
}

export function generateFillBlanks(input = {}, options = {}) {
  const id = options.groupId || groupId("fill-blanks");
  const blanks = splitLines(input.blanks);
  const bank = splitLines(input.wordBank);
  const x = Number(options.x ?? 64); const y = Number(options.y ?? 64);
  const sourceText = String(input.text || "Texto con espacios");
  const display = blanks.reduce((result, answer) => result.replace(answer, "____________"), sourceText);
  const elements = [textElement({ name: "Completar espacios", content: display, x, y, width: 640, height: 110, metadata: { academicRole: "question", answerData: { type: "fill_blanks", value: blanks, acceptedValues: blanks, explanation: input.explanation || "" } } })];
  if (input.showWordBank !== false) elements.push(...createAcademicBlock("word_bank", { x, y: y + 124, content: bank.join(" · ") }).map((element) => ({ ...element, zIndex: elements.length + element.zIndex, academicRole: "word_bank" })));
  elements.push(answerElement(x, y + 252, elements.length));
  return withGroup(elements, id, "fill_blanks", { type: "fill_blanks", ...input, blanks, wordBank: bank, sourceText });
}

export function generateTrueFalse(input = {}, options = {}) {
  const id = options.groupId || groupId("true-false");
  const statements = (Array.isArray(input.statements) ? input.statements : splitLines(input.statements).map((text) => ({ text, answer: null }))).map((item) => typeof item === "string" ? { text: item, answer: null } : item);
  const x = Number(options.x ?? 64); const y = Number(options.y ?? 64);
  const elements = statements.map((statement, index) => textElement({ name: `Afirmación ${index + 1}`, content: `${index + 1}. ${statement.text}     V / F`, x, y: y + index * 42, width: 640, height: 34, zIndex: index, metadata: { academicRole: "statement", answerData: { type: "true_false", value: statement.answer, acceptedValues: [], explanation: statement.explanation || "" } } }));
  elements.push(answerElement(x, y + statements.length * 42 + 4, elements.length));
  return withGroup(elements, id, "true_false", { type: "true_false", statements });
}

export function generateMatching(input = {}, options = {}) {
  const id = options.groupId || groupId("matching");
  const leftItems = splitLines(input.leftItems); const rightItems = splitLines(input.rightItems);
  const answers = input.answers && typeof input.answers === "object" ? input.answers : {};
  const x = Number(options.x ?? 64); const y = Number(options.y ?? 64);
  const elements = [];
  leftItems.forEach((item, index) => elements.push(textElement({ name: `Columna A ${index + 1}`, content: `${index + 1}. ${item}`, x, y: y + index * 38, width: 290, height: 30, zIndex: elements.length, metadata: { academicRole: "left_item", answerData: { type: "matching", value: answers[index] ?? "", acceptedValues: [], explanation: "" } } })));
  rightItems.forEach((item, index) => elements.push(textElement({ name: `Columna B ${index + 1}`, content: `${String.fromCharCode(65 + index)}. ${item}`, x: x + 350, y: y + index * 38, width: 290, height: 30, zIndex: elements.length, metadata: { academicRole: "right_item" } })));
  elements.push(answerElement(x, y + Math.max(leftItems.length, rightItems.length) * 38 + 4, elements.length));
  return withGroup(elements, id, "matching", { type: "matching", leftItems, rightItems, answers });
}

export function generateOpenQuestions(input = {}, options = {}) {
  const id = options.groupId || groupId("open-questions");
  const questions = splitLines(input.questions); const lineCount = Math.max(1, Number(input.answerLines || 3));
  const x = Number(options.x ?? 64); let y = Number(options.y ?? 64); const elements = [];
  questions.forEach((question, index) => {
    elements.push(textElement({ name: `Pregunta abierta ${index + 1}`, content: `${index + 1}. ${question}`, x, y, width: 640, height: 38, zIndex: elements.length, metadata: { academicRole: "question", answerData: { type: "open_question", value: "", acceptedValues: [], explanation: "" } }, style: { fontWeight: "bold" } }));
    for (let line = 0; line < lineCount; line += 1) elements.push(shapeElement({ name: `Línea ${index + 1}.${line + 1}`, x, y: y + 46 + line * 28, width: 640, height: 2, zIndex: elements.length, metadata: { academicRole: "answer_line" }, style: { fill: "#9ba8b8", borderWidth: 0, cornerRadius: 0 } }));
    y += 56 + lineCount * 28;
  });
  elements.push(answerElement(x, y + 4, elements.length));
  return withGroup(elements, id, "open_questions", { type: "open_questions", questions, answerLines: lineCount });
}

export function generateAcademicExercise(type, input, options = {}) {
  if (type === "multiple_choice") return generateMultipleChoice(input, options);
  if (type === "fill_blanks") return generateFillBlanks(input, options);
  if (type === "true_false") return generateTrueFalse(input, options);
  if (type === "matching") return generateMatching(input, options);
  if (type === "open_questions") return generateOpenQuestions(input, options);
  throw new Error("Tipo de ejercicio no compatible.");
}
