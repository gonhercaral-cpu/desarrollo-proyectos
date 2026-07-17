export const BUILTIN_EDITORIAL_VARIABLES = [
  "project.name", "project.type", "document.name", "section.name", "section.number",
  "unit.number", "unit.title", "page.number", "page.label",
];

export function resolveEditorialVariables(content, values, fallback = (key) => `⟦${key}: sin valor⟧`) {
  return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = values?.[key];
    return value === undefined || value === null || value === "" ? fallback(key) : String(value);
  });
}

export function buildEditorialVariableValues({ project, document, page, section, sections = [], numbering, customVariables = [] }) {
  const sectionIndex = section ? sections.findIndex((item) => item.id === section.id) : -1;
  const units = sections.filter((item) => item.type === "unit");
  const unitIndex = section?.type === "unit" ? units.findIndex((item) => item.id === section.id) : -1;
  const pageNumber = numbering?.get?.(page?.id);
  const values = {
    "project.name": project?.name,
    "project.type": project?.type,
    "document.name": document?.name,
    "section.name": section?.name,
    "section.number": sectionIndex >= 0 ? sectionIndex + 1 : undefined,
    "unit.number": unitIndex >= 0 ? unitIndex + 1 : undefined,
    "unit.title": section?.type === "unit" ? section.name : undefined,
    "page.number": pageNumber?.value,
    "page.label": pageNumber?.label,
  };
  customVariables.forEach((variable) => {
    if (variable.key) values[variable.key] = variable.value;
  });
  return values;
}
