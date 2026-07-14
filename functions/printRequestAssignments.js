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

function cleanUserId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstUserId(data, fields) {
  for (const field of fields) {
    const userId = cleanUserId(data?.[field]);
    if (userId) return userId;
  }
  return "";
}

function normalizePrintRequestAssignments(data = {}) {
  const assignedUserId = firstUserId(data, PRIMARY_USER_ID_FIELDS);
  const supportUserIds = [];
  const directSupportId = firstUserId(data, SUPPORT_USER_ID_FIELDS);
  if (directSupportId) supportUserIds.push(directSupportId);

  for (const field of SUPPORT_USER_ID_LIST_FIELDS) {
    const values = Array.isArray(data?.[field]) ? data[field] : [];
    for (const value of values) {
      const userId = cleanUserId(
        typeof value === "string"
          ? value
          : value?.uid || value?.id || value?.userId || value?.userUid || value?.supportUserId
      );
      if (userId && !supportUserIds.includes(userId)) supportUserIds.push(userId);
    }
  }

  return {
    assignedUserId,
    supportUserId: supportUserIds[0] || "",
    supportUserIds,
  };
}

function getOppositeSupportUserId(assignedUserId, config = {}) {
  const primaryId = cleanUserId(assignedUserId);
  const tonyUserId = cleanUserId(config.tonyUserId);
  const ernestoUserId = cleanUserId(config.ernestoUserId);
  if (primaryId && primaryId === tonyUserId) return ernestoUserId;
  if (primaryId && primaryId === ernestoUserId) return tonyUserId;
  return "";
}

function canManagePrintRequest(userId, requestData, isAdmin = false) {
  if (isAdmin) return true;
  const actorUserId = cleanUserId(userId);
  if (!actorUserId) return false;
  const assignments = normalizePrintRequestAssignments(requestData);
  return assignments.assignedUserId === actorUserId || assignments.supportUserIds.includes(actorUserId);
}

function getLocalDateParts(date = new Date(), timeZone = "America/Tijuana") {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    dateValue: `${parts.year}-${parts.month}-${parts.day}`,
    dayKey: String(parts.weekday || "").toLowerCase(),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

async function isUserOnShift(db, userId, creationDate = new Date()) {
  const { dateValue, dayKey, minute } = getLocalDateParts(creationDate);
  const adjustments = await db.collection("scheduleAdjustments").where("userId", "==", userId).get();
  const adjustment = adjustments.docs
    .map((snapshot) => snapshot.data())
    .filter((item) => item.isActive !== false)
    .find((item) => dateValue >= item.startDate && dateValue <= (item.endDate || item.startDate));

  if (["permission", "absence", "dayOff"].includes(adjustment?.publicStatus || adjustment?.type)) {
    return false;
  }

  let schedule = adjustment?.startTime && adjustment?.endTime ? adjustment : null;
  if (!schedule) {
    const scheduleId = `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${dayKey}`;
    const scheduleSnapshot = await db.collection("workSchedules").doc(scheduleId).get();
    schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() : null;
  }

  if (!schedule || schedule.isActive === false || schedule.isRestDay) return false;
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  return start !== null && end !== null && minute >= start && minute < end;
}

async function resolveAssignmentConfig(db, configuredIds = {}) {
  let tonyUserId = cleanUserId(configuredIds.tonyUserId);
  let ernestoUserId = cleanUserId(configuredIds.ernestoUserId);

  if (!tonyUserId || !ernestoUserId) {
    const settingsSnapshot = await db.collection("systemSettings").doc("printshopAssignments").get();
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
    tonyUserId ||= cleanUserId(settings.tonyUserId);
    ernestoUserId ||= cleanUserId(settings.ernestoUserId);
  }

  if (!tonyUserId || !ernestoUserId) {
    for (const field of ["printshopAssignmentRole", "printshopShiftRole", "printshopAssignmentKey"]) {
      const membersSnapshot = await db.collection("users")
        .where(field, "in", ["tony", "ernesto"])
        .get();
      membersSnapshot.docs.forEach((snapshot) => {
        const role = String(snapshot.data()[field] || "").trim().toLowerCase();
        if (role === "tony") tonyUserId ||= snapshot.id;
        if (role === "ernesto") ernestoUserId ||= snapshot.id;
      });
      if (tonyUserId && ernestoUserId) break;
    }
  }

  return { tonyUserId, ernestoUserId };
}

async function resolveShiftAssignment(db, config, creationDate = new Date()) {
  if (!config.tonyUserId || !config.ernestoUserId) return null;
  const [tonyOnShift, ernestoOnShift] = await Promise.all([
    isUserOnShift(db, config.tonyUserId, creationDate),
    isUserOnShift(db, config.ernestoUserId, creationDate),
  ]);

  if (tonyOnShift !== ernestoOnShift) {
    return tonyOnShift
      ? { assignedUserId: config.tonyUserId, supportUserId: config.ernestoUserId, source: "agenda" }
      : { assignedUserId: config.ernestoUserId, supportUserId: config.tonyUserId, source: "agenda" };
  }

  return {
    assignedUserId: config.tonyUserId,
    supportUserId: config.ernestoUserId,
    source: "fallback",
  };
}

async function getUserPresentation(db, userId) {
  if (!userId) return { name: "", email: "" };
  const snapshot = await db.collection("users").doc(userId).get();
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    name: String(data.name || data.displayName || data.fullName || "").trim(),
    email: String(data.email || "").trim(),
  };
}

async function repairPrintRequestAssignment(db, requestRef, configuredIds = {}, fieldValue) {
  const config = await resolveAssignmentConfig(db, configuredIds);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) return false;

    const data = snapshot.data();
    const current = normalizePrintRequestAssignments(data);
    let assignedUserId = current.assignedUserId;
    let supportUserId = current.supportUserId;
    let assignmentSource = data.assignmentSource || "historical-normalization";

    if (!assignedUserId) {
      const createdAt = data.createdAt?.toDate?.() || new Date(data.assignmentEvaluatedAt || Date.now());
      const automatic = await resolveShiftAssignment(db, config, createdAt);
      if (!automatic) return false;
      assignedUserId = automatic.assignedUserId;
      supportUserId = automatic.supportUserId;
      assignmentSource = automatic.source;
    } else if (!supportUserId) {
      supportUserId = getOppositeSupportUserId(assignedUserId, config);
    }

    const needsCanonicalPrimary = !cleanUserId(data.assignedUserId) && assignedUserId;
    const needsCanonicalSupport = !cleanUserId(data.supportUserId) && supportUserId;
    if (!needsCanonicalPrimary && !needsCanonicalSupport) return false;

    const [primary, support] = await Promise.all([
      getUserPresentation(db, assignedUserId),
      getUserPresentation(db, supportUserId),
    ]);
    const update = {
      assignedUserId,
      responsibleUid: assignedUserId,
      responsibleName: primary.name || data.responsibleName || "",
      responsibleEmail: primary.email || data.responsibleEmail || "",
      supportUserId,
      collaboratorUid: supportUserId,
      collaboratorName: support.name || data.collaboratorName || "",
      collaboratorEmail: support.email || data.collaboratorEmail || "",
      responsibleAutoAssigned: data.responsibleAutoAssigned === true || !current.assignedUserId,
      assignmentPending: false,
      assignmentSource,
      assignmentRepairedAt: fieldValue.serverTimestamp(),
    };

    transaction.update(requestRef, update);
    return true;
  });
}

async function repairAllPrintRequestAssignments(db, configuredIds, fieldValue) {
  const resolvedConfig = await resolveAssignmentConfig(db, configuredIds);
  const snapshot = await db.collection("printRequests").get();
  let repaired = 0;
  for (let offset = 0; offset < snapshot.docs.length; offset += 20) {
    const chunk = snapshot.docs.slice(offset, offset + 20);
    const results = await Promise.all(
      chunk.map((requestSnapshot) =>
        repairPrintRequestAssignment(db, requestSnapshot.ref, resolvedConfig, fieldValue)
      )
    );
    repaired += results.filter(Boolean).length;
  }
  return { scanned: snapshot.size, repaired };
}

module.exports = {
  canManagePrintRequest,
  getOppositeSupportUserId,
  normalizePrintRequestAssignments,
  repairAllPrintRequestAssignments,
  repairPrintRequestAssignment,
  resolveShiftAssignment,
};
