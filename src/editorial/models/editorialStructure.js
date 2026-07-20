export const EDITORIAL_SECTION_TYPES = [
  { value: "cover", label: "Portada" },
  { value: "front_matter", label: "Preliminares" },
  { value: "index", label: "Índice" },
  { value: "unit", label: "Unidad" },
  { value: "chapter", label: "Capítulo" },
  { value: "resources", label: "Recursos" },
  { value: "back_cover", label: "Contraportada" },
  { value: "custom", label: "Personalizada" },
];

export const NUMBERING_STYLES = [
  { value: "none", label: "Sin numeración" },
  { value: "arabic", label: "Arábiga · 1, 2, 3" },
  { value: "roman_lower", label: "Romana · i, ii, iii" },
  { value: "roman_upper", label: "Romana · I, II, III" },
];

export const NUMBERING_MODES = [
  { value: "continue", label: "Continuar sección anterior" },
  { value: "restart", label: "Reiniciar en esta sección" },
];

export const BOOK_INITIAL_STRUCTURE = [
  { name: "Portada", type: "cover", numberingStyle: "none", pageType: "cover" },
  { name: "Portadilla", type: "front_matter", numberingStyle: "none", pageType: "title_page" },
  { name: "Página legal", type: "front_matter", numberingStyle: "roman_lower", numberingMode: "restart", numberingStart: 1, pageType: "legal" },
  { name: "Bienvenida", type: "front_matter", numberingStyle: "roman_lower", numberingMode: "continue", pageType: "content" },
  { name: "Índice", type: "index", numberingStyle: "roman_lower", numberingMode: "continue", pageType: "index" },
  { name: "Unidad 1", type: "unit", numberingStyle: "arabic", numberingMode: "restart", numberingStart: 1, startOnRight: true, pageType: "content" },
  { name: "Recursos", type: "resources", numberingStyle: "arabic", numberingMode: "continue", pageType: "content" },
  { name: "Contraportada", type: "back_cover", numberingStyle: "none", pageType: "back_cover" },
];

export function normalizeEditorialPage(page = {}, index = 0, project = {}) {
  const order = Number(page.order ?? page.position ?? index);
  const width = Number(page.width ?? page.widthIn ?? project.widthIn ?? 8);
  const height = Number(page.height ?? page.heightIn ?? project.heightIn ?? 10);
  const pageType = page.pageType || "content";

  return {
    ...page,
    id: page.id || "",
    name: String(page.name || `Página ${index + 1}`),
    order: Number.isFinite(order) ? order : index,
    sectionId: page.sectionId || "",
    pageType,
    width,
    height,
    orientation: page.orientation || (width > height ? "landscape" : "portrait"),
    background: page.background ?? "#ffffff",
    isBlank: page.isBlank === true,
    numberingEnabled: page.numberingEnabled !== false && !["cover", "back_cover"].includes(pageType),
    masterPageId: page.masterPageId || "",
    masterOverrides: { ...(page.masterOverrides || {}) },
    academicMetadata: { ...(page.academicMetadata || {}) },
  };
}

export function normalizeEditorialPages(pages = [], project = {}) {
  return [...pages]
    .map((page, index) => normalizeEditorialPage(page, index, project))
    .sort((left, right) => left.order - right.order)
    .map((page, index) => ({ ...page, order: index }));
}

export function normalizeEditorialSection(section = {}, index = 0) {
  const order = Number(section.order ?? section.position ?? index);
  return {
    ...section,
    id: section.id || "",
    name: String(section.name || `Sección ${index + 1}`),
    type: section.type || "custom",
    order: Number.isFinite(order) ? order : index,
    numberingStyle: section.numberingStyle || "arabic",
    numberingMode: section.numberingMode || "continue",
    numberingStart: Math.max(1, Number(section.numberingStart || 1)),
    startOnRight: section.startOnRight === true,
    collapsed: section.collapsed === true,
    academicMetadata: { ...(section.academicMetadata || {}) },
  };
}

export function normalizeEditorialSections(sections = []) {
  return [...sections]
    .map(normalizeEditorialSection)
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({ ...section, order: index }));
}

export function getSectionTypeLabel(type) {
  return EDITORIAL_SECTION_TYPES.find((item) => item.value === type)?.label || "Personalizada";
}
