export function selectEditorialPages({ pages = [], sections = [], mode = "all", pageId = "", range = "", sectionId = "", unitNumber = "", selectedIds = [] }) {
  const ordered = [...pages].sort((left, right) => left.order - right.order);
  if (mode === "current") return ordered.filter((page) => page.id === pageId);
  if (mode === "section") return ordered.filter((page) => page.sectionId === sectionId);
  if (mode === "unit") {
    const matchingSections = new Set(sections.filter((section) => String(section.unitNumber || section.academicMetadata?.unitNumber || "") === String(unitNumber)).map((section) => section.id));
    return ordered.filter((page) => matchingSections.has(page.sectionId) || String(page.unitNumber || page.academicMetadata?.unitNumber || "") === String(unitNumber));
  }
  if (mode === "manual") return ordered.filter((page) => selectedIds.includes(page.id));
  if (mode === "range") {
    const [startValue, endValue] = String(range).split("-").map((value) => Number(value.trim()));
    const start = Math.max(1, Number.isFinite(startValue) ? startValue : 1);
    const end = Math.min(ordered.length, Number.isFinite(endValue) ? endValue : start);
    return ordered.slice(Math.min(start, end) - 1, Math.max(start, end));
  }
  return ordered;
}

export function describePageSelection(pages, allPages) {
  if (!pages.length) return "Sin páginas";
  if (pages.length === allPages.length) return "Documento completo";
  return pages.map((page) => page.name).join(", ");
}
