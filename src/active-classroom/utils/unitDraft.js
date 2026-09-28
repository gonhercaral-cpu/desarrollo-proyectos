export function createUnitDraft(unit, resources) {
  return {
    name: unit.name, description: "", levelId: unit.parentId,
    status: unit.active === false ? "inactive" : "active",
    metadata: { code: "", language: "es", estimatedMinutes: 0, tags: [] },
    mainPresentationId: null,
    generalResourceIds: resources.filter((resource) => resource.folderId === unit.id).map((resource) => resource.id),
    slides: [],
  };
}
export function canBeMainPresentation(resource) {
  return resource?.source === "drive" && (resource.kind === "presentation" || resource.mimeType === "application/pdf" || /\.pdf$/i.test(resource.name));
}
export function reorderSlides(slides, slideId, direction) {
  const next = [...slides];
  const index = next.findIndex((slide) => slide.slideId === slideId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return slides;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((slide, position) => ({ ...slide, index: position }));
}
