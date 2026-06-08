// src/utils/progressUtils.js

// Avance máximo por cada componente:
// Estatus: 40 puntos
// Evidencias aprobadas: 40 puntos
// Revisión administrativa: 20 puntos
// Total máximo: 100 puntos

export const STATUS_PROGRESS_POINTS = {
  // Valores técnicos
  pending: 0,
  in_progress: 20,
  paused: 20,
  ready_for_review: 35,
  changes_required: 30,
  completed: 40,
  cancelled: 0,

  // Valores en español
  "Pendiente": 0,
  "En proceso": 20,
  "En pausa": 20,
  "Listo para revisión": 35,
  "Correcciones solicitadas": 30,
  "Requiere cambios": 30,
  "Finalizado": 40,
  "Cancelado": 0,
};

export const REVIEW_PROGRESS_POINTS = {
  // Valores técnicos
  none: 0,
  in_review: 5,
  changes_requested: 8,
  partially_approved: 15,
  approved_for_closure: 20,

  // Valores en español
  "Sin revisión": 0,
  "En revisión": 5,
  "Cambios solicitados": 8,
  "Correcciones solicitadas": 8,
  "Aprobado parcialmente": 15,
  "Aprobado para cierre": 20,
};

export function normalizeText(value) {
  if (!value) return "";

  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isCompletedStatus(status) {
  const normalizedStatus = normalizeText(status);

  return (
    normalizedStatus === "completed" ||
    normalizedStatus === "finalizado" ||
    normalizedStatus === "terminado" ||
    normalizedStatus === "cerrado"
  );
}

export function isCancelledStatus(status) {
  const normalizedStatus = normalizeText(status);

  return (
    normalizedStatus === "cancelled" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelado" ||
    normalizedStatus === "cancelada"
  );
}

export function getStatusProgressPoints(status) {
  if (!status) return 0;

  if (isCompletedStatus(status)) return 40;
  if (isCancelledStatus(status)) return 0;

  if (Object.prototype.hasOwnProperty.call(STATUS_PROGRESS_POINTS, status)) {
    return STATUS_PROGRESS_POINTS[status];
  }

  const normalizedStatus = normalizeText(status);

  const normalizedStatusPoints = {
    pendiente: 0,
    pending: 0,

    "en proceso": 20,
    "en progreso": 20,
    in_progress: 20,

    "en pausa": 20,
    pausado: 20,
    paused: 20,

    "listo para revision": 35,
    "lista para revision": 35,
    ready_for_review: 35,

    "correcciones solicitadas": 30,
    "requiere cambios": 30,
    "cambios solicitados": 30,
    changes_required: 30,

    finalizado: 40,
    terminado: 40,
    cerrado: 40,
    completed: 40,

    cancelado: 0,
    cancelada: 0,
    cancelled: 0,
    canceled: 0,
  };

  return normalizedStatusPoints[normalizedStatus] ?? 0;
}

export function getReviewProgressPoints(reviewStatus) {
  if (!reviewStatus) return 0;

  if (Object.prototype.hasOwnProperty.call(REVIEW_PROGRESS_POINTS, reviewStatus)) {
    return REVIEW_PROGRESS_POINTS[reviewStatus];
  }

  const normalizedReviewStatus = normalizeText(reviewStatus);

  const normalizedReviewPoints = {
    none: 0,
    "sin revision": 0,

    in_review: 5,
    "en revision": 5,

    changes_requested: 8,
    "cambios solicitados": 8,
    "correcciones solicitadas": 8,

    partially_approved: 15,
    "aprobado parcialmente": 15,
    "aprobada parcialmente": 15,

    approved_for_closure: 20,
    "aprobado para cierre": 20,
    "aprobada para cierre": 20,
    aprobado: 20,
    aprobada: 20,
  };

  return normalizedReviewPoints[normalizedReviewStatus] ?? 0;
}

export function getEvidenceProgressPoints(approvedEvidenceCount = 0) {
  const pointsPerEvidence = 10;
  const maxEvidencePoints = 40;

  const count = Number(approvedEvidenceCount) || 0;

  return Math.min(count * pointsPerEvidence, maxEvidencePoints);
}

export function isApprovedEvidence(item) {
  if (!item) return false;

  const reviewStatus = normalizeText(item.reviewStatus);
  const status = normalizeText(item.status);

  return (
    reviewStatus === "approved" ||
    reviewStatus === "aprobado" ||
    reviewStatus === "aprobada" ||
    status === "approved" ||
    status === "aprobado" ||
    status === "aprobada" ||
    item.approved === true ||
    item.isApproved === true
  );
}

export function getEvidenceList(project) {
  if (!project) return [];

  if (Array.isArray(project.evidence)) {
    return project.evidence;
  }

  if (Array.isArray(project.evidences)) {
    return project.evidences;
  }

  if (Array.isArray(project.evidenceFiles)) {
    return project.evidenceFiles;
  }

  if (Array.isArray(project.attachments)) {
    return project.attachments;
  }

  return [];
}

export function getApprovedEvidenceCount(project) {
  const evidenceList = getEvidenceList(project);

  return evidenceList.filter((item) => isApprovedEvidence(item)).length;
}

export function getProjectReviewStatus(project) {
  if (!project) return "none";

  return (
    project.adminReview?.status ||
    project.reviewStatus ||
    project.administrativeReviewStatus ||
    "none"
  );
}

export function calculateAutomaticProgress(project) {
  if (!project) return 0;

  const status = project.status || "pending";

  // Si el proyecto está finalizado, siempre debe marcar 100%.
  if (isCompletedStatus(status)) return 100;

  // Si el proyecto está cancelado, no debe contar avance.
  if (isCancelledStatus(status)) return 0;

  const statusPoints = getStatusProgressPoints(status);

  const approvedEvidenceCount = getApprovedEvidenceCount(project);
  const evidencePoints = getEvidenceProgressPoints(approvedEvidenceCount);

  const reviewStatus = getProjectReviewStatus(project);
  const reviewPoints = getReviewProgressPoints(reviewStatus);

  const total = statusPoints + evidencePoints + reviewPoints;

  return Math.min(total, 100);
}

export function getProgressBreakdown(project) {
  if (!project) {
    return {
      statusPoints: 0,
      evidencePoints: 0,
      reviewPoints: 0,
      approvedEvidenceCount: 0,
      total: 0,
    };
  }

  const status = project.status || "pending";

  if (isCompletedStatus(status)) {
    return {
      statusPoints: 40,
      evidencePoints: 40,
      reviewPoints: 20,
      approvedEvidenceCount: getApprovedEvidenceCount(project),
      total: 100,
    };
  }

  if (isCancelledStatus(status)) {
    return {
      statusPoints: 0,
      evidencePoints: 0,
      reviewPoints: 0,
      approvedEvidenceCount: 0,
      total: 0,
    };
  }

  const statusPoints = getStatusProgressPoints(status);

  const approvedEvidenceCount = getApprovedEvidenceCount(project);
  const evidencePoints = getEvidenceProgressPoints(approvedEvidenceCount);

  const reviewStatus = getProjectReviewStatus(project);
  const reviewPoints = getReviewProgressPoints(reviewStatus);

  const total = Math.min(statusPoints + evidencePoints + reviewPoints, 100);

  return {
    statusPoints,
    evidencePoints,
    reviewPoints,
    approvedEvidenceCount,
    total,
  };
}

export function getProgressLabel(progress) {
  const value = Number(progress) || 0;

  if (value >= 100) return "Finalizado";
  if (value >= 85) return "Casi terminado";
  if (value >= 60) return "Avance alto";
  if (value >= 30) return "En desarrollo";
  if (value > 0) return "Inicio";
  return "Sin avance";
}