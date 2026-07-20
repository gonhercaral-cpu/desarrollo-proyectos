export const BATCH_STATUS = Object.freeze({
  PENDING_ASSIGNMENT: "Pendiente de asignación",
  PLANNED: "Planeado",
  PRINTING: "En impresión",
  BINDING: "En encuadernado",
  QUALITY_REVIEW: "En revisión de calidad",
  APPROVED: "Aprobado",
  APPROVED_WITH_NOTES: "Aprobado con observaciones",
  INVENTORIED: "Ingresado a inventario",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
});

export const QUALITY_STATUS = Object.freeze({
  PENDING: "Pendiente",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobado",
  APPROVED_WITH_NOTES: "Aprobado con observaciones",
  REJECTED: "Rechazado",
});

const STATUS_ALIASES = Object.freeze({
  "En encuadernación": BATCH_STATUS.BINDING,
  "En encuadernacion": BATCH_STATUS.BINDING,
  "En revisión de calidad": BATCH_STATUS.QUALITY_REVIEW,
  "En revision de calidad": BATCH_STATUS.QUALITY_REVIEW,
  Finalizado: BATCH_STATUS.INVENTORIED,
});

export const productionBatchStatuses = Object.freeze([
  BATCH_STATUS.PENDING_ASSIGNMENT,
  BATCH_STATUS.PLANNED,
  BATCH_STATUS.PRINTING,
  BATCH_STATUS.BINDING,
  BATCH_STATUS.QUALITY_REVIEW,
  BATCH_STATUS.APPROVED,
  BATCH_STATUS.APPROVED_WITH_NOTES,
  BATCH_STATUS.INVENTORIED,
  BATCH_STATUS.CLOSED,
  BATCH_STATUS.CANCELLED,
]);

export const productionResponsibleStatuses = Object.freeze([
  BATCH_STATUS.PRINTING,
  BATCH_STATUS.BINDING,
  BATCH_STATUS.QUALITY_REVIEW,
]);

export const qualityStatuses = Object.freeze(Object.values(QUALITY_STATUS));

export function normalizeProductionBatchStatus(status) {
  return STATUS_ALIASES[status] || status || BATCH_STATUS.PLANNED;
}

export function getBatchStatusForQuality(qualityStatus, currentStatus) {
  if (qualityStatus === QUALITY_STATUS.APPROVED) return BATCH_STATUS.APPROVED;
  if (qualityStatus === QUALITY_STATUS.APPROVED_WITH_NOTES) {
    return BATCH_STATUS.APPROVED_WITH_NOTES;
  }
  if (qualityStatus === QUALITY_STATUS.REJECTED) return BATCH_STATUS.QUALITY_REVIEW;
  return normalizeProductionBatchStatus(currentStatus);
}

export function isSuccessfulQualityResult(status) {
  return status === QUALITY_STATUS.APPROVED || status === QUALITY_STATUS.APPROVED_WITH_NOTES;
}

export function isFinishedQualityResult(status) {
  return isSuccessfulQualityResult(status) || status === QUALITY_STATUS.REJECTED;
}

export function getProductionBatchProgress(batch) {
  const normalizedStatus = normalizeProductionBatchStatus(batch?.status);
  if ([BATCH_STATUS.APPROVED, BATCH_STATUS.APPROVED_WITH_NOTES,
    BATCH_STATUS.INVENTORIED, BATCH_STATUS.CLOSED].includes(normalizedStatus)) return 100;
  if (normalizedStatus === BATCH_STATUS.CANCELLED) return 0;
  const explicitProgress = Number(batch?.progress);
  if (Number.isFinite(explicitProgress) && explicitProgress >= 0) {
    return Math.min(100, explicitProgress);
  }

  const statusProgress = {
    [BATCH_STATUS.PENDING_ASSIGNMENT]: 0,
    [BATCH_STATUS.PLANNED]: 10,
    [BATCH_STATUS.PRINTING]: 35,
    [BATCH_STATUS.BINDING]: 55,
    [BATCH_STATUS.QUALITY_REVIEW]: 75,
    [BATCH_STATUS.APPROVED]: 100,
    [BATCH_STATUS.APPROVED_WITH_NOTES]: 100,
    [BATCH_STATUS.INVENTORIED]: 100,
    [BATCH_STATUS.CLOSED]: 100,
    [BATCH_STATUS.CANCELLED]: 0,
  };

  return statusProgress[normalizedStatus] ?? 0;
}

export function isBatchQualityApproved(batch) {
  const result = batch?.qualityStatus || batch?.qualityResult || QUALITY_STATUS.PENDING;
  const completed = batch?.qualityCompleted === true
    || Boolean(batch?.qualityFinishedAt)
    || (isSuccessfulQualityResult(result) && Boolean(batch?.qualityReviewedAt));
  return completed && isSuccessfulQualityResult(result);
}

export function canBatchEnterInventory(batch) {
  const status = normalizeProductionBatchStatus(batch?.status);
  const alreadyApplied = batch?.inventoryApplied === true || status === BATCH_STATUS.INVENTORIED;

  return !alreadyApplied
    && status !== BATCH_STATUS.CANCELLED
    && Number(batch?.producedQuantity || 0) > 0
    && getProductionBatchProgress(batch) === 100
    && isBatchQualityApproved(batch);
}

export function isResponsibleStatusTransitionAllowed(previousStatus, nextStatus, qualityStatus) {
  const previous = normalizeProductionBatchStatus(previousStatus);
  const next = normalizeProductionBatchStatus(nextStatus);
  if (previous === next && productionResponsibleStatuses.includes(next)) return true;
  if ([BATCH_STATUS.PLANNED, BATCH_STATUS.PENDING_ASSIGNMENT].includes(previous)) {
    return next === BATCH_STATUS.PRINTING;
  }
  if (previous === BATCH_STATUS.PRINTING) return next === BATCH_STATUS.BINDING;
  if (previous === BATCH_STATUS.BINDING) return next === BATCH_STATUS.QUALITY_REVIEW;
  return previous === BATCH_STATUS.QUALITY_REVIEW
    && qualityStatus === QUALITY_STATUS.REJECTED
    && next === BATCH_STATUS.PRINTING;
}
