const PRIMARY_USER_ID_FIELDS = [
  "assignedUserId",
  "responsibleUid",
  "assignedToUid",
  "productionAssigneeUid",
  "assignedCollaboratorUid",
  "responsibleId",
];

const SUPPORT_USER_ID_FIELDS = [
  "supportUserId",
  "collaboratorUid",
  "collaboratorId",
  "supportCollaboratorUid",
  "productionSupportUid",
  "supportUid",
];

const SUPPORT_USER_ID_LIST_FIELDS = [
  "supportUserIds",
  "supportCollaboratorIds",
  "supportCollaborators",
  "collaboratorUids",
  "collaboratorIds",
];

function normalizeUserId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function firstUserId(request, fields) {
  for (const field of fields) {
    const userId = normalizeUserId(request?.[field]);
    if (userId) return userId;
  }
  return "";
}

function collectSupportUserIds(request) {
  const ids = [];
  const directId = firstUserId(request, SUPPORT_USER_ID_FIELDS);
  if (directId) ids.push(directId);

  for (const field of SUPPORT_USER_ID_LIST_FIELDS) {
    const values = Array.isArray(request?.[field]) ? request[field] : [];
    for (const value of values) {
      const userId = normalizeUserId(
        typeof value === "string"
          ? value
          : value?.uid || value?.id || value?.userId || value?.userUid || value?.supportUserId
      );
      if (userId) ids.push(userId);
    }
  }

  return ids.filter((userId, index, allIds) => allIds.indexOf(userId) === index);
}

export function normalizePrintRequestAssignments(request = {}) {
  const source = request && typeof request === "object" ? request : {};
  const assignedUserId = firstUserId(source, PRIMARY_USER_ID_FIELDS);
  const supportUserIds = collectSupportUserIds(source);

  return {
    assignedUserId,
    assignedUserName: String(source.assignedUserName || source.responsibleName || "").trim(),
    supportUserId: supportUserIds[0] || "",
    supportUserName: String(source.supportUserName || source.collaboratorName || "").trim(),
    supportUserIds,
  };
}

export function canManagePrintRequest(userId, request, isAdmin = false) {
  if (isAdmin) return true;

  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || !request) return false;

  const assignments = normalizePrintRequestAssignments(request);
  return assignments.assignedUserId === normalizedUserId ||
    assignments.supportUserIds.includes(normalizedUserId);
}

export function canManageRequestStudents(request, actor = {}, isAdmin = false) {
  if (isAdmin) return true;
  const assignments = normalizePrintRequestAssignments(request);
  const actorUid = normalizeUserId(actor?.uid);
  if (
    actorUid &&
    (assignments.assignedUserId === actorUid || assignments.supportUserIds.includes(actorUid))
  ) return true;
  if (assignments.assignedUserId || assignments.supportUserIds.length > 0) return false;
  const actorEmail = String(actor?.email || "").trim().toLowerCase();
  const assignedEmail = String(request?.responsibleEmail || request?.assignedUserEmail || "").trim().toLowerCase();
  return Boolean(actorEmail && assignedEmail && actorEmail === assignedEmail);
}

export function getPrintRequestMemberRole(userId, request, isAdmin = false) {
  if (isAdmin) return "admin";

  const normalizedUserId = normalizeUserId(userId);
  const assignments = normalizePrintRequestAssignments(request);
  if (normalizedUserId && assignments.assignedUserId === normalizedUserId) return "responsible";
  if (normalizedUserId && assignments.supportUserIds.includes(normalizedUserId)) return "collaborator";
  return "viewer";
}

export function buildCanonicalPrintRequestAssignment(
  assignedUserId,
  supportUserId,
  assignedUserName = "",
  supportUserName = ""
) {
  const primaryId = normalizeUserId(assignedUserId);
  const secondaryId = normalizeUserId(supportUserId);
  const primaryName = String(assignedUserName || "").trim();
  const secondaryName = String(supportUserName || "").trim();

  return {
    assignedUserId: primaryId,
    assignedUserName: primaryName,
    supportUserId: secondaryId,
    supportUserName: secondaryName,
    responsibleUid: primaryId,
    collaboratorUid: secondaryId,
  };
}
