export function isStandaloneEditorialPage(page) {
  return ["cover", "back_cover"].includes(page?.pageType);
}

export function buildEditorialPhysicalSlots(pages, sections = []) {
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const seenSections = new Set();
  const slots = [];
  pages.forEach((page) => {
    const section = sectionMap.get(page.sectionId);
    const firstInSection = section && !seenSections.has(section.id);
    if (firstInSection) {
      seenSections.add(section.id);
      const nextOrdinal = slots.length + 1;
      if (section.startOnRight && nextOrdinal % 2 === 0) slots.push(null);
    }
    slots.push(page);
  });
  return slots;
}

export function getEditorialSpread(pages, activePageId, viewMode, sections = []) {
  const physicalSlots = buildEditorialPhysicalSlots(pages, sections);
  const activeIndex = Math.max(0, physicalSlots.findIndex((page) => page?.id === activePageId));
  const activePage = physicalSlots[activeIndex] || pages[0] || null;
  if (!activePage) return { pages: [], left: null, right: null, standalone: true };

  if (viewMode !== "facing" || isStandaloneEditorialPage(activePage)) {
    return { pages: [activePage], left: null, right: activePage, standalone: true };
  }

  const ordinal = activeIndex + 1;
  const leftIndex = ordinal % 2 === 0 ? activeIndex : activeIndex - 1;
  const rightIndex = leftIndex + 1;
  const left = leftIndex >= 0 ? physicalSlots[leftIndex] || null : null;
  const right = physicalSlots[rightIndex] || null;
  return { pages: [left, right].filter(Boolean), left, right, standalone: false };
}
