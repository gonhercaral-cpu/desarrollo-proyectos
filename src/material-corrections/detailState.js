export function createMaterialCorrectionManagementDraft(report) {
  return {
    priority: report?.priority || "normal",
    status: report?.status || "reported",
    assignedUid: report?.assignedTo?.uid || "",
    reviewResult: report?.reviewResult || "",
    appliedSolution: report?.appliedSolution || "",
    correctedFileLink: report?.correctedFileLink || "",
    duplicateFolio: report?.duplicateFolio || "",
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
}) {
  const assignedTo = assignees.find((assignee) => assignee.uid === form.assignedUid) || null;
  const changes = {
    priority: form.priority,
    status: form.status,
    assignedTo,
    reviewResult: form.reviewResult,
    appliedSolution: form.appliedSolution,
    correctedFileLink: form.correctedFileLink,
    duplicateFolio: form.duplicateFolio,
    distribution: form.distribution,
  };

  if (includeClassification) {
    changes.confirmedClassification = classification;
  }

  return {
    action: includeClassification ? "reclassify" : "update",
    changes,
  };
}
