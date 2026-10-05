export function createUnitDraft(unit, resources) {
  return {
    name: unit.name, description: "", levelId: unit.parentId,
    status: unit.active === false ? "inactive" : "active",
    metadata: { code: "", language: "es", estimatedMinutes: 0, tags: [] },
    mainPresentationId: null,
    generalResourceIds: resources.filter((resource) => resource.folderId === unit.id && !resource.archived).map((resource) => resource.id),
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

export function needsOfficeProcessing(resource) {
  return /^(application\/(vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(presentationml\.presentation|wordprocessingml\.document)|msword|vnd\.google-apps\.(presentation|document)))$/.test(resource?.mimeType || "")
    || /\.(pptx?|docx?)$/i.test(resource?.sourceName || resource?.name || "");
}
export function documentProcessingLabel(resource) {
  if (!needsOfficeProcessing(resource)) return "";
  const processing = resource.processing;
  if (documentProcessingReady(resource)) return `✓ Procesada · ${processing.pageCount} ${resource.kind === "presentation" ? "diapositivas" : "páginas"}`;
  if (processing?.state === "failed") return "Error de procesamiento · Reintentar";
  if (processing?.state === "processing" || processing?.leaseUntil) return "Procesando…";
  return "Pendiente de procesar";
}
export function documentProcessingReady(resource) {
  return resource?.processing?.state === "ready" && (resource.mimeType !== "application/vnd.google-apps.presentation" || resource.processing.processorVersion === "google-slides-png-v1");
}
