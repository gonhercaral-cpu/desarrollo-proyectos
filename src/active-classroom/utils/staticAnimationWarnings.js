// Page warnings that mean a slide was kept as a static image although its source had a GIF or reveal.
export const STATIC_ANIMATION_WARNINGS = [
  "animation-export-too-large-manual",
  "animation-export-complexity-manual",
  "animation-export-unavailable-manual",
  "states-limit-static",
  "unsupported-animation",
  "gif-static-fallback",
  "gif-invalid-static",
  "gif-over-budget-static",
  "gif-analysis-static-fallback",
];

// Names of completed resources of one unit that have at least one page with a static-fallback warning.
// Failed or pending resources are not listed: their own error state stays the source of truth.
export function staticAnimationResources(resources, unitId) {
  return (Array.isArray(resources) ? resources : [])
    .filter(resource => resource?.folderId === unitId && !resource.archived && resource.processing?.state === "ready" && Array.isArray(resource.processing.pages))
    .filter(resource => resource.processing.pages.some(page => Array.isArray(page?.warnings) && page.warnings.some(warning => STATIC_ANIMATION_WARNINGS.includes(warning) || typeof warning === "string" && warning.startsWith("gif-static:"))))
    .map(resource => resource.name || "Recurso");
}
