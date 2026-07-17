export const EDITORIAL_REVIEW_STATUSES = [
  ["draft", "Borrador"],
  ["content_review", "Revisión de contenido"],
  ["design_review", "Revisión de diseño"],
  ["corrections_requested", "Correcciones solicitadas"],
  ["approved", "Aprobado"],
  ["ready_for_print", "Listo para imprenta"],
  ["archived", "Archivado"],
];

export const EDITORIAL_PREFLIGHT_SEVERITIES = ["error", "warning", "info"];

export const EDITORIAL_CHECKLIST_DEFAULTS = [
  ["spelling", "Ortografía"],
  ["academic_content", "Contenido académico"],
  ["answers", "Respuestas"],
  ["design", "Diseño"],
  ["images", "Imágenes"],
  ["preflight", "Preflight"],
];

export const EDITORIAL_EXPORT_TYPES = ["review", "print", "partial", "images"];
export const EDITORIAL_EXPORT_VARIANTS = ["student", "teacher", "both"];

export function normalizeReviewState(value = {}) {
  const validStatuses = new Set(EDITORIAL_REVIEW_STATUSES.map(([status]) => status));
  return {
    status: validStatuses.has(value.status) ? value.status : "draft",
    assigneeUid: String(value.assigneeUid || ""),
    checklist: { ...Object.fromEntries(EDITORIAL_CHECKLIST_DEFAULTS.map(([id]) => [id, Boolean(value.checklist?.[id])])), ...(value.checklist || {}) },
    checklistLabels: { ...(value.checklistLabels || {}) },
    ignoredPreflight: { ...(value.ignoredPreflight || {}) },
  };
}

export function getReviewStatusLabel(status) {
  return EDITORIAL_REVIEW_STATUSES.find(([value]) => value === status)?.[1] || "Borrador";
}

export function reviewProgress(reviewState, pages = []) {
  const state = normalizeReviewState(reviewState);
  const checklistValues = Object.values(state.checklist);
  const checklistDone = checklistValues.filter(Boolean).length;
  const reviewedPages = pages.filter((page) => ["approved", "ready_for_print"].includes(page.reviewStatus)).length;
  const total = checklistValues.length + pages.length;
  return total ? Math.round(((checklistDone + reviewedPages) / total) * 100) : 0;
}

export function editorialUserId(user) {
  return String(user?.uid || user?.id || "");
}
