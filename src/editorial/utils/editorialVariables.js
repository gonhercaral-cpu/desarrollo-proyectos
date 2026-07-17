import { normalizeAcademicMetadata } from "../models/editorialAcademic.js";

export const BUILTIN_EDITORIAL_VARIABLES = [
  "project.name", "project.type", "document.name", "section.name", "section.number",
  "unit.number", "unit.title", "page.number", "page.label", "series.name", "level.name",
  "book.name", "lesson.number", "lesson.title", "activity.number", "student.version",
];

export function resolveEditorialVariables(content, values, fallback = (key) => `⟦${key}: sin valor⟧`) {
  return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = values?.[key];
    return value === undefined || value === null || value === "" ? fallback(key) : String(value);
  });
}

export function buildEditorialVariableValues({ project, document, page, section, sections = [], numbering, customVariables = [], variant = "student" }) {
  const sectionIndex = section ? sections.findIndex((item) => item.id === section.id) : -1;
  const units = sections.filter((item) => item.type === "unit");
  const unitIndex = section?.type === "unit" ? units.findIndex((item) => item.id === section.id) : -1;
  const pageNumber = numbering?.get?.(page?.id);
  const academic = {
    ...normalizeAcademicMetadata(project),
    ...normalizeAcademicMetadata(document),
    ...normalizeAcademicMetadata(section),
    ...normalizeAcademicMetadata(page),
  };
  const values = {
    "project.name": project?.name,
    "project.type": project?.type,
    "document.name": document?.name,
    "section.name": section?.name,
    "section.number": sectionIndex >= 0 ? sectionIndex + 1 : undefined,
    "unit.number": academic.unitNumber ?? (unitIndex >= 0 ? unitIndex + 1 : undefined),
    "unit.title": academic.unitTitle ?? (section?.type === "unit" ? section.name : undefined),
    "page.number": pageNumber?.value,
    "page.label": pageNumber?.label,
    "series.name": academic.seriesName,
    "level.name": academic.levelName,
    "book.name": academic.bookName,
    "lesson.number": academic.lessonNumber,
    "lesson.title": academic.lessonTitle,
    "activity.number": academic.activityNumber,
    "student.version": variant === "teacher" ? "Maestro" : "Alumno",
  };
  customVariables.forEach((variable) => {
    if (variable.key) values[variable.key] = variable.value;
  });
  return values;
}
