const { HttpsError } = require("firebase-functions/v2/https");

const TOOL_STATUS = Object.freeze({
  AVAILABLE: "Disponible",
  ASSIGNED: "Asignada",
  IN_USE: "En uso",
  LOANED: "Prestada",
  MAINTENANCE: "En mantenimiento",
  DAMAGED: "Dañada",
  LOST: "Extraviada",
  RETIRED: "Baja",
});

const OPERATIONAL_STATUSES = new Set(Object.values(TOOL_STATUS).filter((status) => status !== TOOL_STATUS.RETIRED));
const WORKFLOW_STATUSES = new Set([
  TOOL_STATUS.ASSIGNED,
  TOOL_STATUS.IN_USE,
  TOOL_STATUS.LOANED,
  TOOL_STATUS.MAINTENANCE,
]);

function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function toAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function toBoolean(value) {
  return value === true;
}

function getDepartmentValues(profile = {}) {
  return [
    profile.area,
    profile.department,
    profile.departmentName,
    profile.team,
    ...(Array.isArray(profile.departmentNames) ? profile.departmentNames : []),
    ...(Array.isArray(profile.departments) ? profile.departments : []),
  ].map((value) => cleanText(value, 120).toLocaleLowerCase("es-MX"));
}

async function getSupportToolActor(db, uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
  const snapshot = await db.collection("users").doc(uid).get();
  if (!snapshot.exists || snapshot.data().active !== true) {
    throw new HttpsError("permission-denied", "Tu perfil no está activo.");
  }
  const profile = snapshot.data();
  const isAdmin = cleanText(profile.role, 80).toLocaleLowerCase("es-MX") === "admin";
  const canManage = isAdmin || getDepartmentValues(profile).some((department) =>
    department.includes("soporte técnico") || department.includes("soporte tecnico")
  );
  if (!canManage) {
    throw new HttpsError("permission-denied", "Tu perfil no tiene acceso a herramientas de Soporte Técnico.");
  }
  return {
    uid,
    name: cleanText(profile.name || profile.displayName || profile.email, 120),
    email: cleanText(profile.email, 180),
    isAdmin,
  };
}

function actorFields(actor, fieldValue) {
  return {
    updatedAt: fieldValue.serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.name,
    updatedByEmail: actor.email,
  };
}

function buildSearchText(data = {}) {
  return [
    data.folio,
    data.name,
    data.category,
    data.subcategory,
    data.brand,
    data.model,
    data.serialNumber,
    data.barcode,
    data.campus,
    data.area,
    data.warehouse,
    data.specificLocation,
    data.responsibleName,
  ].map((value) => cleanText(value, 300).toLocaleLowerCase("es-MX")).filter(Boolean).join(" ");
}

function buildToolPayload(input = {}, actor, fieldValue, current = null) {
  const name = cleanText(input.name, 180);
  const category = cleanText(input.category, 120);
  if (!name) throw new HttpsError("invalid-argument", "Nombre de herramienta obligatorio.");
  if (!category) throw new HttpsError("invalid-argument", "Categoría obligatoria.");
  const status = cleanText(input.status || current?.status || TOOL_STATUS.AVAILABLE, 60);
  if (!OPERATIONAL_STATUSES.has(status) && !(actor.isAdmin && status === TOOL_STATUS.RETIRED)) {
    throw new HttpsError("invalid-argument", "Estado de herramienta inválido.");
  }
  if (
    current
    && !actor.isAdmin
    && status !== current.status
    && (WORKFLOW_STATUSES.has(status) || WORKFLOW_STATUSES.has(current.status))
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Usa el flujo de préstamo, devolución o mantenimiento para cambiar este estado."
    );
  }
  const payload = {
    name,
    category,
    subcategory: cleanText(input.subcategory, 120),
    brand: cleanText(input.brand, 120),
    model: cleanText(input.model, 120),
    serialNumber: cleanText(input.serialNumber, 160),
    description: cleanText(input.description, 1500),
    imageUrl: cleanText(input.imageUrl, 1500),
    imagePath: cleanText(input.imagePath, 1000),
    barcode: cleanText(input.barcode, 180),
    status,
    campus: cleanText(input.campus, 120),
    area: cleanText(input.area, 120),
    warehouse: cleanText(input.warehouse, 120),
    specificLocation: cleanText(input.specificLocation, 240),
    responsibleUid: cleanText(input.responsibleUid, 180),
    responsibleName: cleanText(input.responsibleName, 180),
    assigned: [TOOL_STATUS.ASSIGNED, TOOL_STATUS.IN_USE, TOOL_STATUS.LOANED].includes(status),
    purchaseDate: cleanText(input.purchaseDate, 20),
    supplier: cleanText(input.supplier, 180),
    invoiceReference: cleanText(input.invoiceReference, 180),
    warrantyExpiresAt: cleanText(input.warrantyExpiresAt, 20),
    receiptUrl: cleanText(input.receiptUrl, 1500),
    receiptPath: cleanText(input.receiptPath, 1000),
    requiresMaintenance: toBoolean(input.requiresMaintenance),
    lastMaintenanceAt: cleanText(input.lastMaintenanceAt, 20),
    nextMaintenanceAt: cleanText(input.nextMaintenanceAt, 20),
    maintenanceFrequency: cleanText(input.maintenanceFrequency, 120),
    maintenanceNotes: cleanText(input.maintenanceNotes, 1500),
    notes: cleanText(input.notes, 1500),
    active: status !== TOOL_STATUS.RETIRED,
    deleted: false,
    ...actorFields(actor, fieldValue),
  };
  if (actor.isAdmin) payload.cost = toAmount(input.cost);
  else payload.cost = current ? toAmount(current.cost) : 0;
  payload.searchText = buildSearchText({ ...current, ...payload });
  return payload;
}

function buildHistory(type, tool, actor, fieldValue, details = {}) {
  return {
    toolId: tool.id,
    toolFolio: cleanText(tool.folio, 40),
    type,
    description: cleanText(details.description || type, 1000),
    previousData: details.previousData || {},
    newData: details.newData || {},
    actorUid: actor.uid,
    actorName: actor.name,
    actorEmail: actor.email,
    createdAt: fieldValue.serverTimestamp(),
  };
}

function historyRef(db, toolId) {
  return db.collection("supportTools").doc(toolId).collection("history").doc();
}

async function createSupportTool(db, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc();
  const counterRef = db.collection("supportCounters").doc("tools");
  return db.runTransaction(async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef);
    const nextNumber = Math.max(0, Number(counterSnapshot.data()?.value || 0)) + 1;
    const folio = `HER-${String(nextNumber).padStart(6, "0")}`;
    const payload = {
      ...buildToolPayload({ ...input, status: TOOL_STATUS.AVAILABLE }, actor, fieldValue),
      folio,
      folioNumber: nextNumber,
      createdAt: fieldValue.serverTimestamp(),
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdByEmail: actor.email,
    };
    payload.searchText = buildSearchText(payload);
    transaction.set(counterRef, { value: nextNumber, updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    transaction.create(toolRef, payload);
    transaction.create(historyRef(db, toolRef.id), buildHistory("tool_created", {
      id: toolRef.id,
      ...payload,
    }, actor, fieldValue, {
      description: `Herramienta ${folio} registrada.`,
      newData: { status: payload.status, campus: payload.campus },
    }));
    return { id: toolRef.id, folio, status: payload.status };
  });
}

async function updateSupportTool(db, toolId, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const current = { id: snapshot.id, ...snapshot.data() };
    if (current.status === TOOL_STATUS.RETIRED && !actor.isAdmin) {
      throw new HttpsError("failed-precondition", "Herramienta dada de baja.");
    }
    if (!actor.isAdmin && cleanText(input.status) === TOOL_STATUS.RETIRED) {
      throw new HttpsError("permission-denied", "Solo administrador puede dar de baja.");
    }
    const patch = buildToolPayload(input, actor, fieldValue, current);
    transaction.update(toolRef, patch);
    transaction.create(historyRef(db, toolId), buildHistory("tool_updated", current, actor, fieldValue, {
      description: `Información operativa de ${current.folio} actualizada.`,
      previousData: {
        status: current.status,
        campus: current.campus,
        responsibleUid: current.responsibleUid || "",
      },
      newData: {
        status: patch.status,
        campus: patch.campus,
        responsibleUid: patch.responsibleUid,
      },
    }));
    return { id: toolId, name: patch.name, status: patch.status };
  });
}

async function loanSupportTool(db, toolId, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const tool = { id: snapshot.id, ...snapshot.data() };
    if (tool.status !== TOOL_STATUS.AVAILABLE) {
      throw new HttpsError("failed-precondition", `Herramienta no disponible: ${tool.status || "sin estado"}.`);
    }
    const recipientUid = cleanText(input.recipientUid, 180);
    const recipientName = cleanText(input.recipientName, 180);
    if (!recipientUid && !recipientName) throw new HttpsError("invalid-argument", "Indica receptor.");
    const mode = input.mode === "assigned" ? "assigned" : "loan";
    const status = mode === "assigned" ? TOOL_STATUS.ASSIGNED : TOOL_STATUS.LOANED;
    const movementRef = toolRef.collection("movements").doc();
    const movement = {
      toolId,
      toolFolio: cleanText(tool.folio, 40),
      type: mode,
      status: "active",
      recipientUid,
      recipientName,
      deliveredByUid: actor.uid,
      deliveredByName: actor.name,
      deliveredAt: fieldValue.serverTimestamp(),
      expectedReturnAt: cleanText(input.expectedReturnAt, 20),
      campus: cleanText(input.campus || tool.campus, 120),
      location: cleanText(input.location || tool.specificLocation, 240),
      reason: cleanText(input.reason, 600),
      physicalConditionOut: cleanText(input.physicalConditionOut, 300),
      photosOut: Array.isArray(input.photosOut) ? input.photosOut.slice(0, 6) : [],
      notesOut: cleanText(input.notes, 1000),
      createdAt: fieldValue.serverTimestamp(),
    };
    transaction.create(movementRef, movement);
    transaction.update(toolRef, {
      status,
      assigned: true,
      responsibleUid: recipientUid,
      responsibleName: recipientName,
      activeMovementId: movementRef.id,
      ...actorFields(actor, fieldValue),
    });
    transaction.create(historyRef(db, toolId), buildHistory("tool_loaned", tool, actor, fieldValue, {
      description: `${tool.folio} entregada a ${recipientName || recipientUid}.`,
      previousData: { status: tool.status, responsibleUid: tool.responsibleUid || "" },
      newData: { status, responsibleUid: recipientUid, movementId: movementRef.id },
    }));
    return { movementId: movementRef.id, status, recipientUid, recipientName };
  });
}

async function returnSupportTool(db, toolId, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const tool = { id: snapshot.id, ...snapshot.data() };
    if (![TOOL_STATUS.ASSIGNED, TOOL_STATUS.LOANED, TOOL_STATUS.IN_USE].includes(tool.status)) {
      throw new HttpsError("failed-precondition", "Herramienta no tiene préstamo o asignación activa.");
    }
    const damaged = input.damaged === true;
    const status = damaged ? TOOL_STATUS.DAMAGED : TOOL_STATUS.AVAILABLE;
    const movementId = cleanText(tool.activeMovementId, 180);
    if (movementId) {
      transaction.update(toolRef.collection("movements").doc(movementId), {
        status: "returned",
        returnedAt: fieldValue.serverTimestamp(),
        receivedByUid: actor.uid,
        receivedByName: actor.name,
        physicalConditionIn: cleanText(input.physicalConditionIn, 300),
        damages: cleanText(input.damages, 1000),
        notesIn: cleanText(input.notes, 1000),
        photosIn: Array.isArray(input.photosIn) ? input.photosIn.slice(0, 6) : [],
        returnCampus: cleanText(input.campus || tool.campus, 120),
        returnLocation: cleanText(input.location || tool.specificLocation, 240),
      });
    }
    transaction.update(toolRef, {
      status,
      assigned: false,
      responsibleUid: "",
      responsibleName: "",
      activeMovementId: "",
      campus: cleanText(input.campus || tool.campus, 120),
      specificLocation: cleanText(input.location || tool.specificLocation, 240),
      ...actorFields(actor, fieldValue),
    });
    transaction.create(historyRef(db, toolId), buildHistory("tool_returned", tool, actor, fieldValue, {
      description: `${tool.folio} devuelta${damaged ? " con daño" : ""}.`,
      previousData: { status: tool.status, responsibleUid: tool.responsibleUid || "" },
      newData: { status, damages: cleanText(input.damages, 1000) },
    }));
    return { toolId, status };
  });
}

async function startSupportToolMaintenance(db, toolId, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const tool = { id: snapshot.id, ...snapshot.data() };
    if ([TOOL_STATUS.LOANED, TOOL_STATUS.ASSIGNED, TOOL_STATUS.IN_USE, TOOL_STATUS.RETIRED].includes(tool.status)) {
      throw new HttpsError("failed-precondition", `No puede enviarse a mantenimiento desde ${tool.status}.`);
    }
    const maintenanceRef = toolRef.collection("maintenance").doc();
    const maintenance = {
      toolId,
      toolFolio: cleanText(tool.folio, 40),
      status: "in_progress",
      reason: cleanText(input.reason, 1000),
      provider: cleanText(input.provider, 180),
      responsibleName: cleanText(input.responsibleName, 180),
      sentAt: cleanText(input.sentAt, 20),
      estimatedReturnAt: cleanText(input.estimatedReturnAt, 20),
      cost: actor.isAdmin ? toAmount(input.cost) : 0,
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdAt: fieldValue.serverTimestamp(),
    };
    transaction.create(maintenanceRef, maintenance);
    transaction.update(toolRef, {
      status: TOOL_STATUS.MAINTENANCE,
      assigned: false,
      activeMaintenanceId: maintenanceRef.id,
      ...actorFields(actor, fieldValue),
    });
    transaction.create(historyRef(db, toolId), buildHistory("maintenance_started", tool, actor, fieldValue, {
      description: `${tool.folio} enviada a mantenimiento.`,
      previousData: { status: tool.status },
      newData: { status: TOOL_STATUS.MAINTENANCE, maintenanceId: maintenanceRef.id },
    }));
    return { maintenanceId: maintenanceRef.id, status: TOOL_STATUS.MAINTENANCE };
  });
}

async function completeSupportToolMaintenance(db, toolId, input, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const tool = { id: snapshot.id, ...snapshot.data() };
    const maintenanceId = cleanText(tool.activeMaintenanceId, 180);
    if (tool.status !== TOOL_STATUS.MAINTENANCE || !maintenanceId) {
      throw new HttpsError("failed-precondition", "Herramienta no está en mantenimiento.");
    }
    const result = cleanText(input.result, 80);
    if (!["Reparada", "Reparada parcialmente", "No reparable", "Requiere baja"].includes(result)) {
      throw new HttpsError("invalid-argument", "Resultado de mantenimiento inválido.");
    }
    const status = ["No reparable", "Requiere baja"].includes(result)
      ? TOOL_STATUS.DAMAGED
      : TOOL_STATUS.AVAILABLE;
    transaction.update(toolRef.collection("maintenance").doc(maintenanceId), {
      status: "completed",
      repairDescription: cleanText(input.repairDescription, 1500),
      returnedAt: cleanText(input.returnedAt, 20),
      result,
      finalCost: actor.isAdmin ? toAmount(input.cost) : 0,
      completedByUid: actor.uid,
      completedByName: actor.name,
      completedAt: fieldValue.serverTimestamp(),
    });
    transaction.update(toolRef, {
      status,
      activeMaintenanceId: "",
      lastMaintenanceAt: cleanText(input.returnedAt, 20),
      nextMaintenanceAt: cleanText(input.nextMaintenanceAt, 20),
      maintenanceNotes: cleanText(input.repairDescription, 1500),
      ...actorFields(actor, fieldValue),
    });
    transaction.create(historyRef(db, toolId), buildHistory("maintenance_completed", tool, actor, fieldValue, {
      description: `Mantenimiento de ${tool.folio} completado: ${result}.`,
      previousData: { status: tool.status },
      newData: { status, result, maintenanceId },
    }));
    return { toolId, status, result };
  });
}

async function retireSupportTool(db, toolId, reason, actor, fieldValue) {
  if (!actor.isAdmin) throw new HttpsError("permission-denied", "Solo administrador puede dar de baja.");
  const toolRef = db.collection("supportTools").doc(toolId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
    const tool = { id: snapshot.id, ...snapshot.data() };
    if (tool.activeMovementId || tool.activeMaintenanceId) {
      throw new HttpsError("failed-precondition", "Cierra préstamo o mantenimiento antes de dar de baja.");
    }
    transaction.update(toolRef, {
      status: TOOL_STATUS.RETIRED,
      active: false,
      assigned: false,
      retiredAt: fieldValue.serverTimestamp(),
      retiredReason: cleanText(reason, 1000),
      retiredByUid: actor.uid,
      retiredByName: actor.name,
      ...actorFields(actor, fieldValue),
    });
    transaction.create(historyRef(db, toolId), buildHistory("tool_retired", tool, actor, fieldValue, {
      description: `${tool.folio} dada de baja. ${cleanText(reason, 500)}`,
      previousData: { status: tool.status },
      newData: { status: TOOL_STATUS.RETIRED },
    }));
    return { toolId, status: TOOL_STATUS.RETIRED };
  });
}

async function recordSupportToolLabelPrint(db, toolId, actor, fieldValue) {
  const toolRef = db.collection("supportTools").doc(toolId);
  const snapshot = await toolRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Herramienta no encontrada.");
  const tool = { id: snapshot.id, ...snapshot.data() };
  await historyRef(db, toolId).set(buildHistory("label_printed", tool, actor, fieldValue, {
    description: `Etiqueta de ${tool.folio} impresa o descargada.`,
  }));
  return { toolId, recorded: true };
}

module.exports = {
  TOOL_STATUS,
  completeSupportToolMaintenance,
  createSupportTool,
  getSupportToolActor,
  loanSupportTool,
  recordSupportToolLabelPrint,
  retireSupportTool,
  returnSupportTool,
  startSupportToolMaintenance,
  updateSupportTool,
};
