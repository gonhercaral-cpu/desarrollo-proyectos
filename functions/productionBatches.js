const PRINTSHOP_TIME_ZONE = "America/Tijuana";

const BATCH_STATUS = Object.freeze({
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

const QUALITY_STATUS = Object.freeze({
  PENDING: "Pendiente",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobado",
  APPROVED_WITH_NOTES: "Aprobado con observaciones",
  REJECTED: "Rechazado",
});

const STATUS_ALIASES = Object.freeze({
  "En encuadernación": BATCH_STATUS.BINDING,
  "En encuadernacion": BATCH_STATUS.BINDING,
  "En revision de calidad": BATCH_STATUS.QUALITY_REVIEW,
  Finalizado: BATCH_STATUS.INVENTORIED,
});

const INACTIVE_BATCH_STATUSES = new Set([
  BATCH_STATUS.INVENTORIED,
  BATCH_STATUS.CLOSED,
  BATCH_STATUS.CANCELLED,
]);
const BLOCKING_ADJUSTMENT_STATUSES = new Set(["permission", "absence", "dayOff"]);
const ELIGIBLE_NAME_ALIASES = ["tony", "antonio", "ernesto", "ivan"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const QUALITY_CHECKLIST_IDS = [
  "cover", "level", "pagesComplete", "pageOrder", "printQuality",
  "cleanPrint", "cutting", "binding", "quantityMatches", "approvedRejectedRegistered",
];

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeBatchStatus(status) {
  return STATUS_ALIASES[status] || status || BATCH_STATUS.PLANNED;
}

function isAssignedActor(batch, role, actor) {
  const uid = cleanText(batch?.[`${role}Uid`]);
  const email = cleanText(batch?.[`${role}Email`]).toLowerCase();
  const name = normalizeText(batch?.[`${role}Name`] || (role === "responsible" ? batch?.responsible : ""));
  if (uid) return uid === actor.uid;
  if (email) return email === cleanText(actor.email).toLowerCase();
  return Boolean(name && name === normalizeText(actor.name));
}

function isSuccessfulQualityResult(status) {
  return status === QUALITY_STATUS.APPROVED || status === QUALITY_STATUS.APPROVED_WITH_NOTES;
}

function isFinishedQualityResult(status) {
  return isSuccessfulQualityResult(status) || status === QUALITY_STATUS.REJECTED;
}

function isResponsibleTransitionAllowed(previousStatus, nextStatus, qualityStatus) {
  const previous = normalizeBatchStatus(previousStatus);
  const next = normalizeBatchStatus(nextStatus);
  if (previous === next && [BATCH_STATUS.PRINTING, BATCH_STATUS.BINDING, BATCH_STATUS.QUALITY_REVIEW].includes(next)) {
    return true;
  }
  if ([BATCH_STATUS.PLANNED, BATCH_STATUS.PENDING_ASSIGNMENT].includes(previous)) {
    return next === BATCH_STATUS.PRINTING;
  }
  if (previous === BATCH_STATUS.PRINTING) return next === BATCH_STATUS.BINDING;
  if (previous === BATCH_STATUS.BINDING) return next === BATCH_STATUS.QUALITY_REVIEW;
  return previous === BATCH_STATUS.QUALITY_REVIEW
    && qualityStatus === QUALITY_STATUS.REJECTED
    && next === BATCH_STATUS.PRINTING;
}

function getEffectiveProgress(batch) {
  const normalizedStatus = normalizeBatchStatus(batch?.status);
  if ([BATCH_STATUS.APPROVED, BATCH_STATUS.APPROVED_WITH_NOTES,
    BATCH_STATUS.INVENTORIED, BATCH_STATUS.CLOSED].includes(normalizedStatus)) return 100;
  if (normalizedStatus === BATCH_STATUS.CANCELLED) return 0;
  const explicit = Number(batch?.progress);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(100, explicit);
  const progress = {
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
  return progress[normalizedStatus] ?? 0;
}

function buildQualityReviewPatch(review, actor, timestamp) {
  const qualityStatus = cleanText(review?.qualityStatus);
  if (!Object.values(QUALITY_STATUS).includes(qualityStatus)) {
    throw new Error("El resultado de calidad no es válido.");
  }

  const approvedQuantity = Number(review?.approvedQuantity || 0);
  const rejectedQuantity = Number(review?.rejectedQuantity || 0);
  if (!Number.isFinite(approvedQuantity) || approvedQuantity < 0
      || !Number.isFinite(rejectedQuantity) || rejectedQuantity < 0) {
    throw new Error("Las cantidades de calidad no son válidas.");
  }

  const qualityFinished = isFinishedQualityResult(qualityStatus);
  const successful = isSuccessfulQualityResult(qualityStatus);
  const qualityNotes = cleanText(review?.qualityNotes);
  if ([QUALITY_STATUS.APPROVED_WITH_NOTES, QUALITY_STATUS.REJECTED].includes(qualityStatus)
      && !qualityNotes) {
    throw new Error("Agrega observaciones para este resultado de calidad.");
  }
  const checklist = Array.isArray(review?.qualityChecklist) ? review.qualityChecklist : [];
  const checklistIds = new Set(checklist.map((item) => cleanText(item?.id)));
  if (checklist.length !== QUALITY_CHECKLIST_IDS.length
      || QUALITY_CHECKLIST_IDS.some((id) => !checklistIds.has(id))
      || checklist.some((item) => typeof item?.checked !== "boolean")) {
    throw new Error("El checklist de calidad está incompleto o no es válido.");
  }

  const patch = {
    approvedQuantity,
    rejectedQuantity,
    qualityChecklist: checklist.map((item) => ({
      id: cleanText(item.id),
      label: cleanText(item.label),
      checked: item.checked,
    })),
    qualityStatus,
    qualityResult: qualityStatus,
    qualityNotes,
    qualityCompleted: qualityFinished,
    status: successful
      ? qualityStatus
      : BATCH_STATUS.QUALITY_REVIEW,
    progress: successful ? 100 : 75,
    updatedAt: timestamp,
    updatedByUid: actor.uid,
    updatedByName: actor.name,
    updatedByEmail: actor.email,
  };

  if (qualityFinished) {
    Object.assign(patch, {
      qualityReviewedAt: timestamp,
      qualityFinishedAt: timestamp,
      qualityReviewedByUid: actor.uid,
      qualityReviewedByName: actor.name,
      qualityReviewedByEmail: actor.email,
    });
  }

  return patch;
}

function evaluateInventoryEntry(batch) {
  const status = normalizeBatchStatus(batch?.status);
  const qualityStatus = batch?.qualityStatus || batch?.qualityResult || QUALITY_STATUS.PENDING;
  const qualityCompleted = batch?.qualityCompleted === true
    || Boolean(batch?.qualityFinishedAt)
    || (isSuccessfulQualityResult(qualityStatus) && Boolean(batch?.qualityReviewedAt));
  if (batch?.inventoryApplied === true || status === BATCH_STATUS.INVENTORIED) {
    return { eligible: false, reason: "already-applied", quantity: 0 };
  }
  if (!isSuccessfulQualityResult(qualityStatus) || !qualityCompleted) {
    return { eligible: false, reason: "quality-not-approved", quantity: 0 };
  }
  if (getEffectiveProgress(batch) !== 100) {
    return { eligible: false, reason: "progress-not-complete", quantity: 0 };
  }
  const quantity = Number(batch?.producedQuantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { eligible: false, reason: "produced-quantity-required", quantity: 0 };
  }
  return { eligible: true, reason: "ready", quantity };
}

function getInventoryMovementId(batchId) {
  return `production-batch-${String(batchId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function isActivePendingBatch(batch) {
  const status = normalizeBatchStatus(batch?.status);
  return batch?.inventoryApplied !== true
    && batch?.deleted !== true
    && batch?.active !== false
    && !INACTIVE_BATCH_STATUSES.has(status);
}

function calculateReplenishment({ currentStock, minStock, idealStock, activeBatches = [] }) {
  const current = Number(currentStock);
  const minimum = Number(minStock);
  const ideal = Number(idealStock);
  if (![current, minimum, ideal].every(Number.isFinite)
      || current < 0 || minimum < 0 || ideal <= 0 || ideal < minimum) {
    return { valid: false, currentStock: current, projectedStock: current, pendingQuantity: 0, quantity: 0 };
  }

  const pendingQuantity = activeBatches
    .filter(isActivePendingBatch)
    .reduce((total, batch) => {
      const planned = Number(batch?.plannedQuantity || 0);
      return total + (Number.isFinite(planned) && planned > 0 ? planned : 0);
    }, 0);
  const projectedStock = current + pendingQuantity;
  return {
    valid: true,
    currentStock: current,
    projectedStock,
    pendingQuantity,
    quantity: Math.max(0, ideal - projectedStock),
  };
}

function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)
      || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.round(value));
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDayKey(dateValue) {
  return DAY_KEYS[new Date(`${dateValue}T12:00:00Z`).getUTCDay()];
}

function getLocalNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PRINTSHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    dateValue: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildAvailabilityBlocks(candidate, schedules, adjustments, now = new Date(), maxDays = 60) {
  const nowParts = getLocalNowParts(now);
  const aliases = new Set(candidate.aliasIds);
  const candidateSchedules = schedules.filter((schedule) => aliases.has(cleanText(schedule.userId)));
  const candidateAdjustments = adjustments
    .filter((adjustment) => adjustment.isActive !== false && aliases.has(cleanText(adjustment.userId)))
    .sort((first, second) => timestampMillis(second.updatedAt || second.approvedAt)
      - timestampMillis(first.updatedAt || first.approvedAt));
  const blocks = [];

  for (let offset = 0; offset < maxDays; offset += 1) {
    const dateValue = addDays(nowParts.dateValue, offset);
    const adjustment = candidateAdjustments.find((item) => {
      const startDate = cleanText(item.startDate);
      const endDate = cleanText(item.endDate || item.startDate);
      return startDate && dateValue >= startDate && dateValue <= endDate;
    });
    let selectedHours;

    if (adjustment) {
      const publicStatus = adjustment.publicStatus || adjustment.type;
      if (BLOCKING_ADJUSTMENT_STATUSES.has(publicStatus)) continue;
      selectedHours = {
        startTime: adjustment.startTime || "",
        endTime: adjustment.endTime || "",
      };
    } else {
      const schedule = candidateSchedules.find((item) => item.dayOfWeek === getDayKey(dateValue));
      if (!schedule || schedule.isActive === false || schedule.isRestDay) continue;
      selectedHours = {
        startTime: schedule.startTime || "",
        endTime: schedule.endTime || "",
      };
    }

    let startMinute = toMinutes(selectedHours.startTime);
    let endMinute = toMinutes(selectedHours.endTime);
    if (startMinute === null || endMinute === null || startMinute === endMinute) continue;
    if (endMinute < startMinute) endMinute += 24 * 60;
    if (offset === 0) startMinute = Math.max(startMinute, nowParts.minute);
    if (endMinute <= startMinute) continue;
    blocks.push({ dateValue, startMinute, endMinute });
  }
  return blocks;
}

function consumeScheduledHours(blocks, requiredHours) {
  let pendingMinutes = Math.ceil(requiredHours * 60);
  if (!Number.isFinite(pendingMinutes) || pendingMinutes <= 0) return null;
  const segments = [];
  for (const block of blocks) {
    if (pendingMinutes <= 0) break;
    const duration = Math.min(block.endMinute - block.startMinute, pendingMinutes);
    if (duration <= 0) continue;
    segments.push({ ...block, endMinute: block.startMinute + duration });
    pendingMinutes -= duration;
  }
  if (pendingMinutes > 0 || segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    segments,
    startDate: first.dateValue,
    startTime: minutesToTime(first.startMinute),
    dueDate: last.dateValue,
    dueTime: minutesToTime(last.endMinute),
  };
}

function countOverlapHours(segments, blocks) {
  let overlapMinutes = 0;
  for (const segment of segments) {
    for (const block of blocks) {
      if (segment.dateValue !== block.dateValue) continue;
      overlapMinutes += Math.max(0, Math.min(segment.endMinute, block.endMinute)
        - Math.max(segment.startMinute, block.startMinute));
    }
  }
  return overlapMinutes / 60;
}

function selectAssignmentPair({ candidates, requiredHours }) {
  const options = [];
  for (const responsible of candidates) {
    const productionWindow = consumeScheduledHours(responsible.blocks || [], requiredHours);
    if (!productionWindow) continue;
    for (const auditor of candidates) {
      if (responsible.uid === auditor.uid) continue;
      const overlapHours = countOverlapHours(productionWindow.segments, auditor.blocks || []);
      if (overlapHours <= 0) continue;
      options.push({
        responsible,
        auditor,
        overlapHours,
        ...productionWindow,
      });
    }
  }

  options.sort((first, second) =>
    (first.responsible.productionLoad - second.responsible.productionLoad)
    || (first.auditor.auditLoad - second.auditor.auditLoad)
    || ((first.responsible.productionLoad + first.auditor.auditLoad)
      - (second.responsible.productionLoad + second.auditor.auditLoad))
    || (second.overlapHours - first.overlapHours)
    || first.responsible.uid.localeCompare(second.responsible.uid)
    || first.auditor.uid.localeCompare(second.auditor.uid));
  return options[0] || null;
}

function getDepartmentNames(profile) {
  return [
    profile.area,
    profile.department,
    profile.departmentName,
    ...(Array.isArray(profile.departments) ? profile.departments : []),
    ...(Array.isArray(profile.departmentNames) ? profile.departmentNames : []),
  ].map(normalizeText).filter(Boolean);
}

function isEligibleProfile(profile, configuredIds) {
  const uid = cleanText(profile.uid || profile.authUid || profile.docId || profile.id);
  if (!uid || profile.active === false || profile.deleted === true || profile.archived === true) return false;
  const configured = new Set((configuredIds || []).map(cleanText).filter(Boolean));
  const inPrintshop = getDepartmentNames(profile).some((name) =>
    name === "impresion" || name.split(" ").includes("imprenta"));
  const normalizedName = normalizeText(profile.name || profile.displayName || profile.fullName);
  const aliasMatch = ELIGIBLE_NAME_ALIASES.some((alias) => normalizedName.split(" ").includes(alias));
  const explicitlyEligible = profile.printshopProductionEligible === true
    || ["tony", "ernesto", "ivan"].includes(normalizeText(profile.printshopAssignmentRole));
  return inPrintshop && (configured.has(uid) || aliasMatch || explicitlyEligible);
}

function resolveRequiredProductionHours(product, settings, quantity) {
  const hourlyCapacityCandidates = [
    product.productionUnitsPerHour,
    product.unitsPerHour,
    product.productionCapacityPerHour,
    settings.productionUnitsPerHour,
  ];
  const capacityPerHour = hourlyCapacityCandidates
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0);
  if (capacityPerHour) return quantity / capacityPerHour;

  const hoursPerUnit = [
    product.productionHoursPerUnit,
    product.hoursPerUnit,
    settings.productionHoursPerUnit,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0);
  if (hoursPerUnit) return quantity * hoursPerUnit;

  const configuredDuration = [
    product.productionDurationHours,
    product.estimatedProductionHours,
    settings.defaultProductionDurationHours,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0);
  return configuredDuration || 0;
}

async function resolveAutomaticAssignment(db, product, quantity, now = new Date()) {
  const [usersSnapshot, schedulesSnapshot, adjustmentsSnapshot, batchesSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("users").get(),
    db.collection("workSchedules").get(),
    db.collection("scheduleAdjustments").get(),
    db.collection("printProductionBatches").get(),
    db.collection("systemSettings").doc("printshopProduction").get(),
  ]);
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  const configuredIds = [settings.tonyUserId, settings.ernestoUserId, settings.ivanUserId];
  const schedules = schedulesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const adjustments = adjustmentsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const activeBatches = batchesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter(isActivePendingBatch);
  const candidates = usersSnapshot.docs
    .map((item) => ({ ...item.data(), docId: item.id }))
    .filter((profile) => isEligibleProfile(profile, configuredIds))
    .map((profile) => {
      const uid = cleanText(profile.uid || profile.authUid || profile.docId || profile.id);
      const aliasIds = [...new Set([uid, profile.docId, profile.id, profile.agendaUserId, profile.collaboratorId]
        .map(cleanText).filter(Boolean))];
      return {
        uid,
        name: cleanText(profile.name || profile.displayName || profile.fullName),
        email: cleanText(profile.email),
        aliasIds,
        productionLoad: activeBatches.filter((batch) => batch.responsibleUid === uid).length,
        auditLoad: activeBatches.filter((batch) => batch.auditorUid === uid).length,
      };
    });
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.uid, candidate])).values()]
    .map((candidate) => ({
      ...candidate,
      blocks: buildAvailabilityBlocks(candidate, schedules, adjustments, now),
    }));
  const requiredHours = resolveRequiredProductionHours(product, settings, quantity);
  const adminIds = usersSnapshot.docs
    .filter((item) => item.data().active === true && normalizeText(item.data().role) === "admin")
    .map((item) => cleanText(item.data().uid || item.id));
  if (requiredHours <= 0) {
    return {
      assignment: null,
      adminIds,
      reason: "Falta capacidad de producción por hora configurada para calcular fechas.",
    };
  }
  const assignment = selectAssignmentPair({ candidates: uniqueCandidates, requiredHours });
  if (!assignment) {
    return {
      assignment: null,
      adminIds,
      reason: "No existe una pareja distinta con horarios coincidentes suficientes.",
    };
  }
  return { assignment, adminIds, reason: "" };
}

function automaticBatchFolio(productId, dateValue, sequence) {
  const productKey = String(productId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "PRODUCTO";
  return `AUTO-${dateValue.replaceAll("-", "")}-${productKey}-${String(sequence).padStart(3, "0")}`;
}

async function reconcileProductReplenishment(db, productId, options = {}) {
  const cleanProductId = cleanText(productId);
  if (!cleanProductId) return { created: false, reason: "missing-product-id" };
  const productRef = db.collection("printProducts").doc(cleanProductId);
  const productSnapshot = await productRef.get();
  if (!productSnapshot.exists) return { created: false, reason: "missing-product" };
  const product = productSnapshot.data();
  if (product.active === false || product.deleted === true) return { created: false, reason: "inactive-product" };

  const inventoryPreview = await db.collection("printFinishedInventory").where("productId", "==", cleanProductId).get();
  const currentStock = inventoryPreview.docs
    .filter((item) => item.data().active !== false && item.data().deleted !== true)
    .reduce((sum, item) => sum + Number(item.data().currentStock || 0), 0);
  const batchesPreview = await db.collection("printProductionBatches").where("productId", "==", cleanProductId).get();
  const previewPlan = calculateReplenishment({
    currentStock,
    minStock: product.minStock,
    idealStock: product.idealStock,
    activeBatches: batchesPreview.docs.map((item) => item.data()),
  });
  if (!previewPlan.valid || previewPlan.quantity <= 0) {
    return { created: false, reason: previewPlan.valid ? "stock-covered" : "invalid-stock-data" };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const assignmentResult = await resolveAutomaticAssignment(db, product, previewPlan.quantity, now);
  const lockRef = db.collection("printProductionReplenishment").doc(cleanProductId);
  const newBatchRef = db.collection("printProductionBatches").doc();
  const timestamp = options.fieldValue.serverTimestamp();

  return db.runTransaction(async (transaction) => {
    const [lockSnapshot, freshProductSnapshot, inventorySnapshot, batchesSnapshot] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(productRef),
      transaction.get(db.collection("printFinishedInventory").where("productId", "==", cleanProductId)),
      transaction.get(db.collection("printProductionBatches").where("productId", "==", cleanProductId)),
    ]);
    if (!freshProductSnapshot.exists) return { created: false, reason: "missing-product" };
    const freshProduct = freshProductSnapshot.data();
    const freshCurrentStock = inventorySnapshot.docs
      .filter((item) => item.data().active !== false && item.data().deleted !== true)
      .reduce((sum, item) => sum + Number(item.data().currentStock || 0), 0);
    const plan = calculateReplenishment({
      currentStock: freshCurrentStock,
      minStock: freshProduct.minStock,
      idealStock: freshProduct.idealStock,
      activeBatches: batchesSnapshot.docs.map((item) => item.data()),
    });
    if (!plan.valid || plan.quantity <= 0) {
      return { created: false, reason: plan.valid ? "stock-covered" : "invalid-stock-data" };
    }

    const sequence = Number(lockSnapshot.data()?.generationSequence || 0) + 1;
    const assignment = assignmentResult.assignment;
    const actor = { uid: "system", name: "Generación automática", email: "" };
    const dateValue = getLocalNowParts(now).dateValue;
    const payload = {
      folio: automaticBatchFolio(cleanProductId, dateValue, sequence),
      origin: "automatic",
      automaticOrigin: "inventory-replenishment",
      automatic: true,
      productId: cleanProductId,
      productName: cleanText(freshProduct.name),
      category: cleanText(freshProduct.category || "Libro"),
      level: cleanText(freshProduct.level || "No aplica"),
      unit: cleanText(freshProduct.unit || "Libro"),
      detectedStock: plan.currentStock,
      projectedStock: plan.projectedStock,
      minimumStockUsed: Number(freshProduct.minStock),
      idealStockUsed: Number(freshProduct.idealStock),
      calculatedQuantity: plan.quantity,
      plannedQuantity: plan.quantity,
      producedQuantity: 0,
      approvedQuantity: 0,
      rejectedQuantity: 0,
      status: assignment ? BATCH_STATUS.PLANNED : BATCH_STATUS.PENDING_ASSIGNMENT,
      progress: assignment ? 10 : 0,
      responsible: assignment?.responsible.name || "",
      responsibleUid: assignment?.responsible.uid || "",
      responsibleName: assignment?.responsible.name || "",
      responsibleEmail: assignment?.responsible.email || "",
      auditorUid: assignment?.auditor.uid || "",
      auditorName: assignment?.auditor.name || "",
      auditorEmail: assignment?.auditor.email || "",
      startDate: assignment?.startDate || "",
      startTime: assignment?.startTime || "",
      dueDate: assignment?.dueDate || "",
      dueTime: assignment?.dueTime || "",
      assignmentPending: !assignment,
      assignmentReason: assignmentResult.reason,
      assignmentSource: assignment ? "automatic:schedule-load" : "automatic:pending",
      scheduleOverlapHours: assignment ? assignment.overlapHours : 0,
      generationReason: `Stock proyectado ${plan.projectedStock} menor al ideal ${Number(freshProduct.idealStock)}.`,
      notes: assignmentResult.reason,
      qualityChecklist: [],
      qualityStatus: QUALITY_STATUS.PENDING,
      qualityResult: QUALITY_STATUS.PENDING,
      qualityNotes: "",
      qualityCompleted: false,
      inventoryApplied: false,
      inventoryId: "",
      inventoryMovementId: "",
      createdAt: timestamp,
      automaticCreatedAt: timestamp,
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdByEmail: actor.email,
      updatedAt: timestamp,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      updatedByEmail: actor.email,
    };
    transaction.create(newBatchRef, payload);
    transaction.set(lockRef, {
      productId: cleanProductId,
      generationSequence: sequence,
      lastBatchId: newBatchRef.id,
      lastCalculatedQuantity: plan.quantity,
      lastProjectedStock: plan.projectedStock,
      updatedAt: timestamp,
    }, { merge: true });
    if (!assignment) {
      for (const adminId of assignmentResult.adminIds || []) {
        const notificationId = `print-batch-pending-${newBatchRef.id}-${adminId}`;
        transaction.set(db.collection("notifications").doc(notificationId), {
          recipientId: adminId,
          batchId: newBatchRef.id,
          productId: cleanProductId,
          tipo: "PRINT_BATCH_ASSIGNMENT_PENDING",
          titulo: "Lote automático pendiente de asignación",
          mensaje: `${payload.folio}: ${assignmentResult.reason}`,
          actorId: "system",
          actorName: "Generación automática",
          read: false,
          createdAt: timestamp,
        });
      }
    }
    return { created: true, batchId: newBatchRef.id, quantity: plan.quantity, assignmentPending: !assignment };
  });
}

async function reconcileAllProducts(db, options = {}) {
  const snapshot = await db.collection("printProducts").get();
  const results = [];
  for (const productSnapshot of snapshot.docs) {
    try {
      results.push(await reconcileProductReplenishment(db, productSnapshot.id, options));
    } catch (error) {
      results.push({ created: false, productId: productSnapshot.id, reason: error.message });
    }
  }
  return {
    scanned: snapshot.size,
    created: results.filter((result) => result.created).length,
    pendingAssignment: results.filter((result) => result.assignmentPending).length,
    results,
  };
}

async function reviewProductionBatchQuality(db, batchId, review, actor, fieldValue) {
  const batchRef = db.collection("printProductionBatches").doc(batchId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(batchRef);
    if (!snapshot.exists) throw new Error("No se encontró el lote de producción.");
    const batch = snapshot.data();
    if (!actor.isAdmin && !isAssignedActor(batch, "auditor", actor)) {
      throw new Error("Solo el auditor asignado o un administrador puede guardar esta revisión.");
    }
    if (batch.inventoryApplied === true || normalizeBatchStatus(batch.status) === BATCH_STATUS.CANCELLED) {
      throw new Error("Este lote ya no admite revisión de calidad.");
    }
    if (!actor.isAdmin && normalizeBatchStatus(batch.status) !== BATCH_STATUS.QUALITY_REVIEW) {
      throw new Error("El lote debe estar en revisión de calidad.");
    }
    const producedQuantity = Number(batch.producedQuantity || 0);
    const approvedQuantity = Number(review?.approvedQuantity || 0);
    const rejectedQuantity = Number(review?.rejectedQuantity || 0);
    if (approvedQuantity + rejectedQuantity > producedQuantity) {
      throw new Error("Aprobados y rechazados no pueden superar la cantidad producida.");
    }
    const patch = buildQualityReviewPatch(review, actor, fieldValue.serverTimestamp());
    transaction.update(batchRef, patch);
    return {
      batchId,
      status: patch.status,
      progress: patch.progress,
      approvedQuantity: patch.approvedQuantity,
      rejectedQuantity: patch.rejectedQuantity,
      qualityChecklist: patch.qualityChecklist,
      qualityStatus: patch.qualityStatus,
      qualityResult: patch.qualityResult,
      qualityNotes: patch.qualityNotes,
      qualityCompleted: patch.qualityCompleted,
    };
  });
}

async function updateProductionBatchProgress(db, batchId, update, actor, fieldValue) {
  const batchRef = db.collection("printProductionBatches").doc(batchId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(batchRef);
    if (!snapshot.exists) throw new Error("No se encontró el lote de producción.");
    const batch = snapshot.data();
    if (!actor.isAdmin && !isAssignedActor(batch, "responsible", actor)) {
      throw new Error("Solo el responsable asignado o un administrador puede actualizar producción.");
    }
    if (batch.inventoryApplied === true || normalizeBatchStatus(batch.status) === BATCH_STATUS.CANCELLED) {
      throw new Error("Este lote ya no admite cambios de producción.");
    }
    const status = normalizeBatchStatus(update?.status);
    const producedQuantity = Number(update?.producedQuantity || 0);
    if (!Number.isFinite(producedQuantity) || producedQuantity < 0) {
      throw new Error("La cantidad producida no es válida.");
    }
    if (!actor.isAdmin && !isResponsibleTransitionAllowed(
      batch.status,
      status,
      batch.qualityStatus || batch.qualityResult
    )) {
      throw new Error("La transición de producción no está permitida.");
    }
    const patch = {
      status,
      producedQuantity,
      updatedAt: fieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      updatedByEmail: actor.email,
    };
    transaction.update(batchRef, patch);
    return { batchId, status, producedQuantity };
  });
}

async function enterProductionBatchInventory(db, batchId, actor, fieldValue) {
  const batchRef = db.collection("printProductionBatches").doc(batchId);
  const movementRef = db.collection("printInventoryMovements").doc(getInventoryMovementId(batchId));
  return db.runTransaction(async (transaction) => {
    const [batchSnapshot, existingMovement] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(movementRef),
    ]);
    if (!batchSnapshot.exists) throw new Error("No se encontró el lote de producción.");
    const batch = batchSnapshot.data();
    if (!actor.isAdmin && !isAssignedActor(batch, "responsible", actor)) {
      throw new Error("Solo el responsable asignado o un administrador puede ingresar este lote.");
    }
    const evaluation = evaluateInventoryEntry(batch);
    if (evaluation.reason === "already-applied" || existingMovement.exists) {
      return {
        batchId,
        alreadyApplied: true,
        inventoryId: cleanText(batch.inventoryId),
        movementId: cleanText(batch.inventoryMovementId) || movementRef.id,
      };
    }
    if (!evaluation.eligible) {
      const messages = {
        "quality-not-approved": "La revisión de calidad debe terminar aprobada.",
        "progress-not-complete": "El lote debe estar al 100 %.",
        "produced-quantity-required": "La cantidad producida debe ser mayor que cero.",
      };
      throw new Error(messages[evaluation.reason] || "El lote no puede ingresar al inventario.");
    }

    const [productSnapshot, inventorySnapshot] = await Promise.all([
      transaction.get(db.collection("printProducts").doc(batch.productId)),
      transaction.get(db.collection("printFinishedInventory").where("productId", "==", batch.productId)),
    ]);
    if (!productSnapshot.exists) throw new Error("No se encontró el producto del lote.");
    const product = productSnapshot.data();
    const inventoryDoc = inventorySnapshot.docs.find((item) => item.data().active !== false && item.data().deleted !== true)
      || inventorySnapshot.docs[0];
    const inventoryRef = inventoryDoc?.ref || db.collection("printFinishedInventory").doc(batch.productId);
    const inventory = inventoryDoc?.data() || {};
    const previousStock = Number(inventory.currentStock || 0);
    const newStock = previousStock + evaluation.quantity;
    const timestamp = fieldValue.serverTimestamp();
    const audit = {
      updatedAt: timestamp,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      updatedByEmail: actor.email,
    };

    transaction.set(inventoryRef, {
      productId: batch.productId,
      productName: cleanText(batch.productName || product.name),
      category: cleanText(batch.category || product.category || "Libro"),
      level: cleanText(batch.level || product.level || "No aplica"),
      unit: cleanText(batch.unit || product.unit || "Libro"),
      currentStock: newStock,
      minStock: Number(inventory.minStock ?? product.minStock ?? 0),
      idealStock: Number(inventory.idealStock ?? product.idealStock ?? 0),
      active: true,
      deleted: false,
      notes: cleanText(inventory.notes),
      lastBatchId: batchId,
      lastBatchFolio: cleanText(batch.folio),
      ...audit,
    }, { merge: true });
    transaction.create(movementRef, {
      inventoryId: inventoryRef.id,
      productId: batch.productId,
      productName: cleanText(batch.productName || product.name),
      type: "Entrada",
      quantity: evaluation.quantity,
      reason: "Lote de producción finalizado",
      previousStock,
      newStock,
      notes: `Ingreso único desde ${cleanText(batch.folio) || "lote de producción"}.`,
      batchId,
      batchFolio: cleanText(batch.folio),
      createdAt: timestamp,
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdByEmail: actor.email,
    });
    transaction.update(batchRef, {
      status: BATCH_STATUS.INVENTORIED,
      progress: 100,
      inventoryApplied: true,
      inventoryId: inventoryRef.id,
      inventoryMovementId: movementRef.id,
      inventoryAppliedAt: timestamp,
      inventoryAppliedByUid: actor.uid,
      inventoryAppliedByName: actor.name,
      inventoryAppliedByEmail: actor.email,
      finalizedAt: timestamp,
      finalizedByUid: actor.uid,
      ...audit,
    });
    return {
      batchId,
      alreadyApplied: false,
      inventoryId: inventoryRef.id,
      movementId: movementRef.id,
      quantity: evaluation.quantity,
      previousStock,
      newStock,
      status: BATCH_STATUS.INVENTORIED,
    };
  });
}

module.exports = {
  BATCH_STATUS,
  QUALITY_STATUS,
  buildAvailabilityBlocks,
  buildQualityReviewPatch,
  calculateReplenishment,
  consumeScheduledHours,
  enterProductionBatchInventory,
  evaluateInventoryEntry,
  getEffectiveProgress,
  getInventoryMovementId,
  isActivePendingBatch,
  isResponsibleTransitionAllowed,
  reconcileAllProducts,
  reconcileProductReplenishment,
  reviewProductionBatchQuality,
  selectAssignmentPair,
  updateProductionBatchProgress,
};
