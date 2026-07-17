import { resolveEditorialVariables } from "./editorialVariables.js";

export function validateAcademicElements(elements = [], variableValues = {}) {
  const warnings = [];
  const groups = new Map();
  elements.forEach((element) => {
    if (element.academicGroupId) groups.set(element.academicGroupId, [...(groups.get(element.academicGroupId) || []), element]);
    if (element.answerData && (element.answerData.value === "" || element.answerData.value === null || element.answerData.value === undefined || (Array.isArray(element.answerData.value) && !element.answerData.value.length))) warnings.push({ code: "missing_answer", elementId: element.id, message: `${element.name}: ejercicio sin respuesta.` });
    if (element.answerData && !element.academicGroupId && element.visibilityMode !== "teacher") warnings.push({ code: "missing_teacher_answer", elementId: element.id, message: `${element.name}: falta contenido exclusivo para maestro.` });
    if (element.type === "text" && /\{\{[^}]+\}\}/.test(element.content || "")) {
      resolveEditorialVariables(element.content, variableValues, (key) => {
        warnings.push({ code: "missing_variable", elementId: element.id, message: `${element.name}: variable {{${key}}} sin valor.` });
        return "";
      });
    }
  });
  groups.forEach((items) => {
    const root = items.find((item) => item.exerciseData)?.exerciseData;
    if (!root) return;
    if (!items.some((item) => item.answerData)) warnings.push({ code: "missing_answer", groupId: items[0].academicGroupId, message: "Ejercicio sin respuesta configurada." });
    if (root.type === "multiple_choice" && !root.options?.length) warnings.push({ code: "missing_options", groupId: items[0].academicGroupId, message: "Pregunta de opción múltiple sin opciones." });
    if (root.type === "multiple_choice" && (Number(root.correctOption) < 0 || Number(root.correctOption) >= (root.options?.length || 0))) warnings.push({ code: "missing_correct_option", groupId: items[0].academicGroupId, message: "Opción múltiple sin respuesta correcta." });
    if (root.type === "fill_blanks" && root.showWordBank !== false && !root.wordBank?.length) warnings.push({ code: "empty_word_bank", groupId: items[0].academicGroupId, message: "Banco de palabras vacío." });
    if (items.some((item) => item.answerData) && !items.some((item) => item.visibilityMode === "teacher" || item.teacherContent)) warnings.push({ code: "missing_teacher_answer", groupId: items[0].academicGroupId, message: "El ejercicio tiene respuesta pero no contenido exclusivo para maestro." });
  });
  return warnings.filter((warning, index, all) => all.findIndex((item) => item.code === warning.code && item.elementId === warning.elementId && item.groupId === warning.groupId) === index);
}

export function validateAcademicLink(metadata = {}) {
  if (["activity", "worksheet", "song", "exam", "extra_material", "answer_key"].includes(metadata.academicType) && !metadata.bookId && !metadata.unitNumber && !metadata.lessonNumber) return [{ code: "missing_academic_link", message: "El material requiere vínculo con libro, unidad o lección." }];
  return [];
}
