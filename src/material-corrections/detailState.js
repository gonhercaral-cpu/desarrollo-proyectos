import {
  COLLABORATOR_STATUS_TRANSITIONS,
  MATERIAL_CORRECTION_STATUS_OPTIONS,
} from "./constants.js";

const DISTRIBUTION_KEYS = [
  "sourceFile",
  "inPersonDrive",
  "onlineDrive",
  "platform",
  "futurePrint",
];

export function inferMaterialCorrectionPublicationSettings(report) {
  if (report?.publicationSettings && typeof report.publicationSettings === "object") {
    const enabled = report.publicationSettings.enabled === true;
    return {
      enabled,
      collaboratorCanEdit: enabled
        && report.publicationSettings.collaboratorCanEdit === true,
    };
  }
  const distribution = report?.distribution;
  const enabled = Boolean(distribution) && DISTRIBUTION_KEYS.some((key) => {
    const destination = distribution?.[key];
    return destination?.required === true
      || ["pending", "in_progress", "completed"].includes(destination?.status);
  });
  return { enabled, collaboratorCanEdit: false };
}

export function getMaterialCorrectionDetailPermissions({
  report,
  isAdmin,
  currentUserId,
}) {
  const publicationSettings = inferMaterialCorrectionPublicationSettings(report);
  const isAssigned = Boolean(currentUserId)
    && report?.assignedTo?.uid === currentUserId;
  const canEditOperational = isAdmin || isAssigned;
  const canEditDistribution = isAdmin || (
    isAssigned
    && publicationSettings.enabled
    && publicationSettings.collaboratorCanEdit
  );
  const currentStatus = report?.status || "reported";
  const allowedTargets = isAdmin
    ? MATERIAL_CORRECTION_STATUS_OPTIONS.map((option) => option.value)
    : (
      isAssigned
        ? (COLLABORATOR_STATUS_TRANSITIONS[currentStatus] || []).filter((status) => (
          status !== "publishing"
          || (publicationSettings.enabled && publicationSettings.collaboratorCanEdit)
        ))
        : []
    );
  const statusValues = Array.from(new Set([currentStatus, ...allowedTargets]));

  return {
    publicationSettings,
    isAssigned,
    canEditOperational,
    canEditDistribution,
    canEditAdministration: isAdmin,
    canComment: isAdmin || isAssigned,
    statusOptions: MATERIAL_CORRECTION_STATUS_OPTIONS.filter((option) => (
      statusValues.includes(option.value)
    )),
  };
}

export function validateMaterialCorrectionClientUpdate({
  changes,
  action,
  permissions,
}) {
  if (!permissions) {
    throw new Error("No se pudo validar permiso para actualizar el reporte.");
  }
  if (permissions.canEditAdministration) return true;
  if (!permissions.canEditOperational) {
    throw new Error("Solo el responsable asignado puede modificar este reporte.");
  }
  if (action !== "update") {
    throw new Error("Esta acción está reservada para administradores.");
  }
  const adminOnlyFields = [
    "assignedTo",
    "confirmedClassification",
    "duplicateFolio",
    "manualOrder",
    "publicationSettings",
    "approvalComment",
  ];
  if (adminOnlyFields.some((field) => Object.hasOwn(changes, field))) {
    throw new Error("Intento de modificar campos administrativos.");
  }
  if (
    Object.hasOwn(changes, "status")
    && !permissions.statusOptions.some((option) => option.value === changes.status)
  ) {
    throw new Error("Transición de estado no permitida.");
  }
  if (Object.hasOwn(changes, "distribution") && !permissions.canEditDistribution) {
    throw new Error("Publicación gestionada únicamente por administradores.");
  }
  return true;
}

export function createMaterialCorrectionManagementDraft(report) {
  return {
    priority: report?.priority || "normal",
    status: report?.status || "reported",
    assignedUid: report?.assignedTo?.uid || "",
    reviewResult: report?.reviewResult || "",
    appliedSolution: report?.appliedSolution || "",
    correctedFileLink: report?.correctedFileLink || "",
    duplicateFolio: report?.duplicateFolio || "",
    approvalComment: report?.approvalComment || "",
    publicationSettings: inferMaterialCorrectionPublicationSettings(report),
    distribution: report?.distribution || {},
  };
}

export function createMaterialCorrectionClassificationDraft(report) {
  const classification = report?.confirmedClassification || report?.originalClassification || {};
  return {
    levelId: classification.levelId || report?.levelId || "",
    levelName: classification.levelName || report?.levelName || "",
    unitNumber: classification.unitNumber || report?.unitNumber || "",
    unitName: classification.unitName || report?.unitName || "",
    materialType: classification.materialType || report?.materialType || "other",
    pageNumber: classification.pageNumber || report?.pageNumber || "",
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

export function materialCorrectionDraftsMatch(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export function buildMaterialCorrectionDetailUpdate({
  form,
  classification,
  assignees,
  includeClassification,
  includeAdministration = false,
  includeDistribution = false,
}) {
  const assignedTo = assignees.find((assignee) => assignee.uid === form.assignedUid) || null;
  const changes = {
    priority: form.priority,
    status: form.status,
    reviewResult: form.reviewResult,
    appliedSolution: form.appliedSolution,
    correctedFileLink: form.correctedFileLink,
  };

  if (includeDistribution) {
    changes.distribution = form.distribution;
  }

  if (includeAdministration) {
    changes.assignedTo = assignedTo;
    changes.duplicateFolio = form.duplicateFolio;
    changes.approvalComment = form.approvalComment;
    changes.publicationSettings = form.publicationSettings;
  }

  if (includeClassification && includeAdministration) {
    changes.confirmedClassification = classification;
  }

  return {
    action: includeClassification ? "reclassify" : "update",
    changes,
  };
}
