import { ACADEMIC_VISIBILITY_MODES } from "../models/editorialAcademic.js";

export function normalizeVisibilityMode(value) {
  return ACADEMIC_VISIBILITY_MODES.includes(value) ? value : "both";
}

export function getElementVisibilityState(element, variant = "student") {
  if (element?.visible === false) return { visible: false, reason: "manual" };
  const mode = normalizeVisibilityMode(element?.visibilityMode);
  if (mode !== "both" && mode !== variant) return { visible: false, reason: "variant" };
  return { visible: true, reason: "visible" };
}

export function isElementVisibleInVariant(element, variant) {
  return getElementVisibilityState(element, variant).visible;
}

export function filterElementsForVariant(elements = [], variant = "student") {
  return elements.filter((element) => isElementVisibleInVariant(element, variant));
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === true) return "Verdadero";
  if (value === false) return "Falso";
  return String(value ?? "");
}

export function resolveAcademicAnswerElements(elements = []) {
  const answers = new Map();
  elements.forEach((element) => {
    if (!element.answerData || !element.academicGroupId) return;
    const key = `${element.componentInstanceId || "local"}:${element.academicGroupId}`;
    const value = formatAnswer(element.answerData.value);
    if (value) answers.set(key, [...(answers.get(key) || []), value]);
  });
  return elements.map((element) => {
    if (element.academicRole !== "answer" || !element.academicGroupId) return element;
    const key = `${element.componentInstanceId || "local"}:${element.academicGroupId}`;
    return { ...element, resolvedContent: `Respuesta: ${(answers.get(key) || []).join(" · ") || "sin configurar"}` };
  });
}

export function resolveAcademicVariantContent(elements = [], variant = "student") {
  return elements.map((element) => {
    if (element.type !== "text" || (!element.studentContent && !element.teacherContent)) return element;
    const content = variant === "teacher"
      ? element.teacherContent || element.studentContent
      : element.studentContent || element.teacherContent;
    return { ...element, resolvedContent: content };
  });
}

export function resolveAcademicViewElements(elements = [], variant = "student", filter = true) {
  const resolved = resolveAcademicVariantContent(resolveAcademicAnswerElements(elements), variant);
  return filter ? filterElementsForVariant(resolved, variant) : resolved;
}
