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

const ASSIGNMENT_FIELDS = [
  ...PRIMARY_USER_ID_FIELDS,
  ...SUPPORT_USER_ID_FIELDS,
  ...SUPPORT_USER_ID_LIST_FIELDS,
  "assignedUserName",
  "supportUserName",
  "responsibleName",
  "responsibleEmail",
  "collaboratorName",
  "collaboratorEmail",
  "assignmentSource",
  "assignmentFallbackReason",
  "assignmentPending",
  "responsibleAutoAssigned",
  "assignmentEvaluatedAt",
  "assignmentRepairedAt",
];

const BLOCKING_ADJUSTMENT_STATUSES = ["permission", "absence", "dayOff"];
const PRINTSHOP_TIME_ZONE = "America/Tijuana";

function cleanUserId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentityText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    assignedUserName: cleanText(data.assignedUserName || data.responsibleName),
    supportUserId: supportUserIds[0] || "",
    supportUserName: cleanText(data.supportUserName || data.collaboratorName),
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

function getLocalDateParts(date = new Date(), timeZone = PRINTSHOP_TIME_ZONE) {
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

function isMinuteInsideRange(minute, startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || start === end) return false;
  return end > start
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const millis = new Date(value || 0).getTime();
  return Number.isNaN(millis) ? 0 : millis;
}

function snapshotIdentity(docId, data = {}) {
  const userId = cleanUserId(data.uid || data.authUid || data.firebaseUid || docId);
  const name = cleanText(data.name || data.displayName || data.fullName || data.nombre || data.userName);
  return {
    userId,
    name,
    email: cleanText(data.email || data.userEmail),
    aliases: [...new Set([
      userId,
      cleanUserId(docId),
      cleanUserId(data.agendaUserId),
      cleanUserId(data.collaboratorId),
      cleanUserId(data.userId),
    ].filter(Boolean))],
    data,
  };
}

function identityMatchesAliases(identity, aliases) {
  const normalizedName = normalizeIdentityText(identity?.name);
  if (!normalizedName) return false;
  const words = normalizedName.split(" ");
  return aliases.some((alias) => {
    const normalizedAlias = normalizeIdentityText(alias);
    return normalizedAlias && (
      normalizedName === normalizedAlias ||
      words.includes(normalizedAlias) ||
      normalizedName.includes(` ${normalizedAlias} `)
    );
  });
}

function findIdentityByAliases(identities, aliases) {
  for (const alias of aliases) {
    const identity = identities.find((item) => identityMatchesAliases(item, [alias]));
    if (identity) return identity;
  }
  return null;
}

function mergeIdentity(existing, candidate) {
  if (!existing) return candidate;
  return {
    ...existing,
    name: existing.name || candidate.name,
    email: existing.email || candidate.email,
    aliases: [...new Set([...(existing.aliases || []), ...(candidate.aliases || [])])],
    data: { ...(candidate.data || {}), ...(existing.data || {}) },
  };
}

async function getUserPresentation(db, userId) {
  if (!userId) return { name: "", email: "" };
  let snapshot = await db.collection("users").doc(userId).get();
  if (!snapshot.exists) {
    for (const field of ["uid", "authUid", "firebaseUid"]) {
      const querySnapshot = await db.collection("users").where(field, "==", userId).limit(1).get();
      if (!querySnapshot.empty) {
        [snapshot] = querySnapshot.docs;
        break;
      }
    }
  }
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    name: cleanText(data.name || data.displayName || data.fullName || data.nombre),
    email: cleanText(data.email),
  };
}

async function resolveAssignmentConfig(db, configuredIds = {}) {
  if (configuredIds.tony?.userId && configuredIds.ernesto?.userId) {
    return configuredIds;
  }
  const settingsSnapshot = await db.collection("systemSettings").doc("printshopAssignments").get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  let tonyUserId = cleanUserId(configuredIds.tonyUserId || settings.tonyUserId);
  let ernestoUserId = cleanUserId(configuredIds.ernestoUserId || settings.ernestoUserId);
  const identitiesById = new Map();
  const inactiveUserIds = new Set();

  const usersSnapshot = await db.collection("users").get();
  usersSnapshot.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const identity = snapshotIdentity(snapshot.id, data);
    if (data.active === false || data.deleted === true || data.archived === true) {
      identity.aliases.forEach((userId) => inactiveUserIds.add(userId));
      return;
    }
    if (!identity.userId) return;
    identitiesById.set(identity.userId, mergeIdentity(identitiesById.get(identity.userId), identity));
  });

  const schedulesSnapshot = await db.collection("workSchedules").get();
  schedulesSnapshot.docs.forEach((snapshot) => {
    const data = snapshot.data();
    if (data.isActive === false || !data.userId || inactiveUserIds.has(data.userId)) return;
    const agendaIdentity = snapshotIdentity(data.userId, data);
    const matchedProfile = [...identitiesById.values()].find((identity) =>
      identity.aliases.some((alias) => agendaIdentity.aliases.includes(alias))
    );
    const stableIdentity = mergeIdentity(matchedProfile || agendaIdentity, agendaIdentity);
    identitiesById.set(stableIdentity.userId, mergeIdentity(identitiesById.get(stableIdentity.userId), stableIdentity));
  });

  const identities = [...identitiesById.values()];
  if (inactiveUserIds.has(tonyUserId)) tonyUserId = "";
  if (inactiveUserIds.has(ernestoUserId)) ernestoUserId = "";
  for (const identity of identities) {
    const role = normalizeIdentityText(
      identity.data.printshopAssignmentRole ||
      identity.data.printshopShiftRole ||
      identity.data.printshopAssignmentKey
    );
    if (!tonyUserId && role === "tony") tonyUserId = identity.userId;
    if (!ernestoUserId && role === "ernesto") ernestoUserId = identity.userId;
  }

  const tonyAliases = ["tony", "antonio", ...(Array.isArray(settings.tonyAliases) ? settings.tonyAliases : [])];
  const ernestoAliases = ["ernesto", ...(Array.isArray(settings.ernestoAliases) ? settings.ernestoAliases : [])];
  if (!tonyUserId) tonyUserId = findIdentityByAliases(identities, tonyAliases)?.userId || "";
  if (!ernestoUserId) ernestoUserId = findIdentityByAliases(identities, ernestoAliases)?.userId || "";

  if (!tonyUserId || !ernestoUserId || tonyUserId === ernestoUserId) {
    throw new Error("No se pudieron resolver UIDs estables y distintos para Tony y Ernesto.");
  }

  async function completeIdentity(userId, fallbackName) {
    const identity = identities.find((item) => item.userId === userId || item.aliases.includes(userId));
    const profile = await getUserPresentation(db, userId);
    return {
      userId: identity?.userId || userId,
      name: profile.name || identity?.name || fallbackName,
      email: profile.email || identity?.email || "",
      agendaUserIds: [...new Set([userId, ...(identity?.aliases || [])])],
    };
  }

  const [tony, ernesto] = await Promise.all([
    completeIdentity(tonyUserId, cleanText(settings.tonyUserName) || "Tony"),
    completeIdentity(ernestoUserId, cleanText(settings.ernestoUserName) || "Ernesto"),
  ]);
  if (tony.userId === ernesto.userId) {
    throw new Error("Tony y Ernesto resolvieron al mismo UID estable.");
  }
  return {
    tonyUserId: tony.userId,
    ernestoUserId: ernesto.userId,
    tony,
    ernesto,
  };
}

async function getMatchingAdjustments(db, agendaUserIds, dateValue) {
  const snapshots = await Promise.all(
    agendaUserIds.map((userId) =>
      db.collection("scheduleAdjustments").where("userId", "==", userId).get()
    )
  );
  const byId = new Map();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
    const data = item.data();
    if (
      data.isActive !== false &&
      dateValue >= cleanText(data.startDate) &&
      dateValue <= cleanText(data.endDate || data.startDate)
    ) {
      byId.set(item.id, { id: item.id, ...data });
    }
  }));
  return [...byId.values()].sort((a, b) =>
    timestampMillis(b.updatedAt || b.approvedAt || b.requestedAt) -
    timestampMillis(a.updatedAt || a.approvedAt || a.requestedAt)
  );
}

async function getBaseSchedule(db, agendaUserIds, dayKey) {
  for (const userId of agendaUserIds) {
    const scheduleId = `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${dayKey}`;
    const snapshot = await db.collection("workSchedules").doc(scheduleId).get();
    if (snapshot.exists) return snapshot.data();
  }

  for (const userId of agendaUserIds) {
    const snapshot = await db.collection("workSchedules")
      .where("userId", "==", userId)
      .get();
    const matchingSchedule = snapshot.docs.find((item) => item.data().dayOfWeek === dayKey);
    if (matchingSchedule) return matchingSchedule.data();
  }
  return null;
}

async function getUserShiftState(db, identity, creationDate = new Date()) {
  const { dateValue, dayKey, minute } = getLocalDateParts(creationDate);
  const adjustments = await getMatchingAdjustments(db, identity.agendaUserIds, dateValue);
  const adjustment = adjustments[0] || null;
  if (adjustment) {
    const publicStatus = adjustment.publicStatus || adjustment.type;
    if (BLOCKING_ADJUSTMENT_STATUSES.includes(publicStatus)) {
      return { onShift: false, source: `adjustment:${publicStatus}` };
    }
    if (adjustment.startTime && adjustment.endTime) {
      return {
        onShift: isMinuteInsideRange(minute, adjustment.startTime, adjustment.endTime),
        source: "adjustment:hours",
      };
    }
  }

  const schedule = await getBaseSchedule(db, identity.agendaUserIds, dayKey);
  if (!schedule || schedule.isActive === false || schedule.isRestDay) {
    return { onShift: false, source: schedule?.isRestDay ? "base:rest" : "base:missing" };
  }
  return {
    onShift: isMinuteInsideRange(minute, schedule.startTime, schedule.endTime),
    source: "base:hours",
  };
}

async function resolvePrintshopAssignees(db, createdAt = new Date(), configuredIds = {}) {
  const creationDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(creationDate.getTime())) throw new Error("createdAt inválido para asignación de Imprenta.");
  const config = await resolveAssignmentConfig(db, configuredIds);
  const [tonyShift, ernestoShift] = await Promise.all([
    getUserShiftState(db, config.tony, creationDate),
    getUserShiftState(db, config.ernesto, creationDate),
  ]);

  let assigned = config.tony;
  let support = config.ernesto;
  let assignmentSource = "agenda:tony";
  let fallbackReason = "";

  if (tonyShift.onShift !== ernestoShift.onShift) {
    if (ernestoShift.onShift) {
      assigned = config.ernesto;
      support = config.tony;
      assignmentSource = "agenda:ernesto";
    }
  } else {
    fallbackReason = tonyShift.onShift
      ? "Tony y Ernesto aparecen de turno al mismo tiempo."
      : `Agenda no detectó turno activo. Tony=${tonyShift.source}; Ernesto=${ernestoShift.source}.`;
    assignmentSource = "fallback:tony-default";
    console.warn("[printshop-assignment] Fallback de asignación", {
      createdAt: creationDate.toISOString(),
      reason: fallbackReason,
      tonyUserId: config.tony.userId,
      ernestoUserId: config.ernesto.userId,
    });
  }

  return {
    assignedUserId: assigned.userId,
    assignedUserName: assigned.name,
    supportUserId: support.userId,
    supportUserName: support.name,
    assignmentSource,
    assignmentFallbackReason: fallbackReason,
  };
}

function removeUndefinedValues(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(removeUndefinedValues);
  }
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefinedValues(item)])
  );
}

async function createPrintRequestWithAssignment(db, payload, options = {}) {
  const createdAt = options.createdAt instanceof Date ? options.createdAt : new Date();
  const persistedTimestamp = options.fieldValue?.serverTimestamp?.() || createdAt;
  const assignment = await resolvePrintshopAssignees(db, createdAt, options.configuredIds || {});
  const [assignedProfile, supportProfile] = await Promise.all([
    getUserPresentation(db, assignment.assignedUserId),
    getUserPresentation(db, assignment.supportUserId),
  ]);
  const cleanPayload = removeUndefinedValues(payload || {});
  ASSIGNMENT_FIELDS.forEach((field) => delete cleanPayload[field]);
  delete cleanPayload.createdAt;
  delete cleanPayload.updatedAt;

  const requestData = {
    ...cleanPayload,
    assignedUserId: assignment.assignedUserId,
    assignedUserName: assignment.assignedUserName,
    supportUserId: assignment.supportUserId,
    supportUserName: assignment.supportUserName,
    responsibleUid: assignment.assignedUserId,
    responsibleName: assignment.assignedUserName,
    responsibleEmail: assignedProfile.email,
    collaboratorUid: assignment.supportUserId,
    collaboratorName: assignment.supportUserName,
    collaboratorEmail: supportProfile.email,
    responsibleAutoAssigned: true,
    assignmentPending: false,
    assignmentSource: assignment.assignmentSource,
    assignmentFallbackReason: assignment.assignmentFallbackReason,
    assignmentEvaluatedAt: createdAt.toISOString(),
    createdAt: persistedTimestamp,
    updatedAt: persistedTimestamp,
  };

  let requestRef;
  if (options.requestId) {
    requestRef = db.collection("printRequests").doc(options.requestId);
    try {
      await requestRef.create(requestData);
    } catch (error) {
      const alreadyExists = error?.code === 6 ||
        error?.code === "already-exists" ||
        error?.code === "ALREADY_EXISTS" ||
        /already exists/i.test(error?.message || "");
      if (!options.idempotent || !alreadyExists) throw error;
      const existingSnapshot = await requestRef.get();
      if (!existingSnapshot.exists) throw error;
      const existingData = existingSnapshot.data();
      const existingAssignments = normalizePrintRequestAssignments(existingData);
      console.info("[printshop-assignment] Envío duplicado reutilizó solicitud", {
        requestId: requestRef.id,
      });
      return {
        requestId: requestRef.id,
        requestData: existingData,
        assignedUserId: existingAssignments.assignedUserId,
        assignedUserName: existingAssignments.assignedUserName,
        supportUserId: existingAssignments.supportUserId,
        supportUserName: existingAssignments.supportUserName,
        assignmentSource: existingData.assignmentSource || "",
        assignmentFallbackReason: existingData.assignmentFallbackReason || "",
        duplicate: true,
      };
    }
  } else {
    requestRef = await db.collection("printRequests").add(requestData);
  }
  console.info("[printshop-assignment] Solicitud creada con asignación", {
    requestId: requestRef.id,
    assignedUserId: assignment.assignedUserId,
    supportUserId: assignment.supportUserId,
    assignmentSource: assignment.assignmentSource,
  });
  return { requestId: requestRef.id, requestData, ...assignment };
}

async function repairPrintRequestAssignment(db, requestRef, configuredIds = {}, fieldValue) {
  const config = await resolveAssignmentConfig(db, configuredIds);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) return false;

    const data = snapshot.data();
    const current = normalizePrintRequestAssignments(data);
    const canonicalizeKnownIdentity = (userId) => {
      if (config.tony.agendaUserIds.includes(userId)) return config.tonyUserId;
      if (config.ernesto.agendaUserIds.includes(userId)) return config.ernestoUserId;
      return userId;
    };
    let assignedUserId = canonicalizeKnownIdentity(current.assignedUserId);
    let supportUserId = canonicalizeKnownIdentity(current.supportUserId);
    let automatic = null;

    if (!assignedUserId) {
      const createdAt = data.createdAt?.toDate?.() || new Date(data.assignmentEvaluatedAt || Date.now());
      automatic = await resolvePrintshopAssignees(db, createdAt, config);
      assignedUserId = automatic.assignedUserId;
      supportUserId = automatic.supportUserId;
    } else if (!supportUserId) {
      supportUserId = getOppositeSupportUserId(assignedUserId, config);
    }

    if (!assignedUserId || !supportUserId) return false;
    const [primary, support] = await Promise.all([
      getUserPresentation(db, assignedUserId),
      getUserPresentation(db, supportUserId),
    ]);
    const assignedUserName = current.assignedUserName || primary.name || automatic?.assignedUserName || "";
    const supportUserName = current.supportUserName || support.name || automatic?.supportUserName || "";
    const update = {};
    if (cleanUserId(data.assignedUserId) !== assignedUserId) update.assignedUserId = assignedUserId;
    if (!cleanText(data.assignedUserName)) update.assignedUserName = assignedUserName;
    if (!cleanUserId(data.responsibleUid)) update.responsibleUid = assignedUserId;
    if (!cleanText(data.responsibleName)) update.responsibleName = assignedUserName;
    if (!cleanText(data.responsibleEmail) && primary.email) update.responsibleEmail = primary.email;
    if (cleanUserId(data.supportUserId) !== supportUserId) update.supportUserId = supportUserId;
    if (!cleanText(data.supportUserName)) update.supportUserName = supportUserName;
    if (!cleanUserId(data.collaboratorUid)) update.collaboratorUid = supportUserId;
    if (!cleanText(data.collaboratorName)) update.collaboratorName = supportUserName;
    if (!cleanText(data.collaboratorEmail) && support.email) update.collaboratorEmail = support.email;
    if (Object.keys(update).length === 0) return false;

    Object.assign(update, {
      assignmentPending: false,
      assignmentSource: automatic?.assignmentSource || data.assignmentSource || "historical-normalization",
      assignmentFallbackReason: automatic?.assignmentFallbackReason || data.assignmentFallbackReason || "",
      assignmentRepairedAt: fieldValue.serverTimestamp(),
    });
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
  createPrintRequestWithAssignment,
  getLocalDateParts,
  getOppositeSupportUserId,
  normalizePrintRequestAssignments,
  removeUndefinedValues,
  repairAllPrintRequestAssignments,
  repairPrintRequestAssignment,
  resolveAssignmentConfig,
  resolvePrintshopAssignees,
};
