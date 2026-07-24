const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  BATCH_STATUS,
  QUALITY_STATUS,
  automaticBatchNeedsAssignment,
  buildAutomaticAssignmentPatch,
  buildQualityReviewPatch,
  canActiveProfileAccessPrintshop,
  calculateFinishedInventoryOutputStock,
  calculateReplenishment,
  consumeScheduledCapacity,
  deleteProductionBatch,
  evaluateInventoryEntry,
  getInventoryOutputMovementId,
  getInventoryMovementId,
  hasValidAssignmentPair,
  isResponsibleTransitionAllowed,
  matchesReplenishmentSuppression,
  registerFinishedInventoryOutput,
  resolveUnitsPerWorkday,
  selectCapacityAssignmentPair,
  selectCurrentShiftFallbackAssignment,
  selectAssignmentPair,
  saveProductionBatchAdminChanges,
  validateFinishedInventoryOutput,
} = require("../functions/productionBatches");

const checklist = [
  "cover", "level", "pagesComplete", "pageOrder", "printQuality",
  "cleanPrint", "cutting", "binding", "quantityMatches", "approvedRejectedRegistered",
].map((id) => ({ id, label: id, checked: true }));

describe("calidad de lotes", () => {
  it("cierra aprobación y aprobación con observaciones al 100 %", () => {
    const actor = { uid: "auditor", name: "Auditor", email: "auditor@test.local" };
    const timestamp = { server: true };
    const approved = buildQualityReviewPatch({
      qualityStatus: QUALITY_STATUS.APPROVED,
      approvedQuantity: 20,
      rejectedQuantity: 0,
      qualityChecklist: checklist,
      qualityNotes: "",
    }, actor, timestamp);
    assert.equal(approved.status, BATCH_STATUS.APPROVED);
    assert.equal(approved.progress, 100);
    assert.equal(approved.qualityCompleted, true);
    assert.equal(approved.qualityReviewedByUid, "auditor");
    assert.equal(approved.qualityFinishedAt, timestamp);

    const observed = buildQualityReviewPatch({
      qualityStatus: QUALITY_STATUS.APPROVED_WITH_NOTES,
      approvedQuantity: 19,
      rejectedQuantity: 1,
      qualityChecklist: checklist.map((item, index) => ({ ...item, checked: index !== 0 })),
      qualityNotes: "Una portada con detalle menor.",
    }, actor, timestamp);
    assert.equal(observed.status, BATCH_STATUS.APPROVED_WITH_NOTES);
    assert.equal(observed.progress, 100);
  });

  it("conserva rechazo en flujo correctivo y bloquea inventario", () => {
    const rejected = buildQualityReviewPatch({
      qualityStatus: QUALITY_STATUS.REJECTED,
      approvedQuantity: 0,
      rejectedQuantity: 20,
      qualityChecklist: checklist,
      qualityNotes: "Reimprimir portadas.",
    }, { uid: "auditor", name: "Auditor", email: "" }, {});
    assert.equal(rejected.status, BATCH_STATUS.QUALITY_REVIEW);
    assert.equal(rejected.qualityCompleted, true);
    assert.equal(evaluateInventoryEntry({
      ...rejected,
      producedQuantity: 20,
    }).eligible, false);
  });
});

describe("permisos de producción", () => {
  it("solo permite avance ordenado y retorno correctivo tras rechazo", () => {
    assert.equal(isResponsibleTransitionAllowed(BATCH_STATUS.PLANNED, BATCH_STATUS.PRINTING), true);
    assert.equal(isResponsibleTransitionAllowed(BATCH_STATUS.PRINTING, BATCH_STATUS.QUALITY_REVIEW), false);
    assert.equal(isResponsibleTransitionAllowed(
      BATCH_STATUS.QUALITY_REVIEW,
      BATCH_STATUS.PRINTING,
      QUALITY_STATUS.REJECTED
    ), true);
  });
});

describe("ingreso único al inventario", () => {
  it("usa cantidad producida y genera ID estable por lote", () => {
    const batch = {
      status: BATCH_STATUS.APPROVED,
      progress: 90,
      qualityStatus: QUALITY_STATUS.APPROVED,
      qualityCompleted: true,
      producedQuantity: 23,
      approvedQuantity: 20,
      inventoryApplied: false,
    };
    assert.deepEqual(evaluateInventoryEntry(batch), {
      eligible: true,
      reason: "ready",
      quantity: 23,
    });
    assert.equal(getInventoryMovementId("batch/23"), getInventoryMovementId("batch/23"));
    assert.equal(evaluateInventoryEntry({ ...batch, inventoryApplied: true }).reason, "already-applied");
  });
});

describe("reposición automática", () => {
  it("calcula diferencia contra stock proyectado", () => {
    assert.deepEqual(calculateReplenishment({
      currentStock: 25,
      minStock: 10,
      idealStock: 50,
      activeBatches: [],
    }), {
      valid: true,
      currentStock: 25,
      projectedStock: 25,
      pendingQuantity: 0,
      quantity: 25,
    });
  });

  it("evita duplicado cuando lote activo cubre necesidad", () => {
    const result = calculateReplenishment({
      currentStock: 25,
      minStock: 10,
      idealStock: 50,
      activeBatches: [{ status: BATCH_STATUS.PLANNED, plannedQuantity: 25, inventoryApplied: false }],
    });
    assert.equal(result.projectedStock, 50);
    assert.equal(result.quantity, 0);
  });
});

describe("asignación automática", () => {
  it("elige personas distintas, menor carga y desempate determinista", () => {
    const sharedBlocks = [{ dateValue: "2026-07-21", startMinute: 9 * 60, endMinute: 17 * 60 }];
    const result = selectAssignmentPair({
      requiredHours: 4,
      candidates: [
        { uid: "tony", productionLoad: 2, auditLoad: 0, blocks: sharedBlocks },
        { uid: "ernesto", productionLoad: 0, auditLoad: 2, blocks: sharedBlocks },
        { uid: "ivan", productionLoad: 1, auditLoad: 0, blocks: sharedBlocks },
      ],
    });
    assert.equal(result.responsible.uid, "ernesto");
    assert.equal(result.auditor.uid, "ivan");
    assert.notEqual(result.responsible.uid, result.auditor.uid);
    assert.equal(result.startDate, "2026-07-21");
    assert.equal(result.dueDate, "2026-07-21");
  });

  it("no asigna pareja sin coincidencia de horarios", () => {
    const result = selectAssignmentPair({
      requiredHours: 2,
      candidates: [
        { uid: "tony", productionLoad: 0, auditLoad: 0, blocks: [{ dateValue: "2026-07-21", startMinute: 540, endMinute: 660 }] },
        { uid: "ernesto", productionLoad: 0, auditLoad: 0, blocks: [{ dateValue: "2026-07-22", startMinute: 540, endMinute: 660 }] },
      ],
    });
    assert.equal(result, null);
  });

  it("considera válida solo una pareja completa y distinta", () => {
    assert.equal(hasValidAssignmentPair({
      responsibleUid: "producer",
      responsibleName: "Producción",
      auditorUid: "auditor",
      auditorName: "Calidad",
    }), true);
    assert.equal(hasValidAssignmentPair({
      responsibleUid: "same",
      responsibleName: "Misma persona",
      auditorUid: "same",
      auditorName: "Misma persona",
    }), false);
    assert.equal(hasValidAssignmentPair({
      responsibleUid: "same",
      responsibleName: "Misma persona",
      auditorUid: "same",
      auditorName: "Misma persona",
      assignmentSinglePersonFallback: true,
    }), true);
  });

  it("usa dos personas en turno y fallback explícito cuando solo hay una", () => {
    const now = new Date("2026-07-24T18:00:00.000Z");
    const currentBlock = [{ dateValue: "2026-07-24", startMinute: 600, endMinute: 780 }];
    const pair = selectCurrentShiftFallbackAssignment({
      now,
      candidates: [
        { uid: "tony", productionLoad: 0, auditLoad: 1, blocks: currentBlock },
        { uid: "ernesto", productionLoad: 1, auditLoad: 0, blocks: currentBlock },
      ],
    });
    assert.equal(pair.responsible.uid, "tony");
    assert.equal(pair.auditor.uid, "ernesto");
    assert.equal(pair.singlePersonFallback, false);

    const single = selectCurrentShiftFallbackAssignment({
      now,
      candidates: [
        { uid: "ivan", productionLoad: 0, auditLoad: 0, blocks: currentBlock },
      ],
    });
    assert.equal(single.responsible.uid, "ivan");
    assert.equal(single.auditor.uid, "ivan");
    assert.equal(single.singlePersonFallback, true);
    assert.equal(single.startDate, "2026-07-24");
  });

  it("persiste UIDs y nombres canónicos y conserva asignación al recargar", () => {
    const stored = buildAutomaticAssignmentPatch({
      assignment: {
        responsible: { uid: "tony-uid", name: "Tony", email: "tony@test.local" },
        auditor: { uid: "ivan-uid", name: "Iván", email: "ivan@test.local" },
        startDate: "2026-07-24",
        startTime: "11:00",
        dueDate: "2026-07-25",
        dueTime: "12:00",
        overlapHours: 3,
      },
      reason: "",
      unitsPerWorkday: 25,
      qualityReviewMinutes: 60,
    }, "server-timestamp", {
      assignmentVersion: 1,
      assignedByName: "Generación automática",
    });
    const reloaded = structuredClone(stored);

    assert.equal(reloaded.responsibleUid, "tony-uid");
    assert.equal(reloaded.responsibleName, "Tony");
    assert.equal(reloaded.auditorUid, "ivan-uid");
    assert.equal(reloaded.auditorName, "Iván");
    assert.equal(reloaded.assignmentPending, false);
    assert.equal(reloaded.status, BATCH_STATUS.PLANNED);
    assert.equal(hasValidAssignmentPair(reloaded), true);
  });
});

describe("capacidad y fechas automáticas", () => {
  it("usa capacidad central, carga activa y tiempo de auditoría", () => {
    const blocks = [
      { dateValue: "2026-07-20", startMinute: 540, endMinute: 1020 },
      { dateValue: "2026-07-21", startMinute: 540, endMinute: 1020 },
      { dateValue: "2026-07-22", startMinute: 540, endMinute: 1020 },
    ];
    const result = selectCapacityAssignmentPair({
      quantity: 50,
      unitsPerWorkday: 25,
      qualityReviewMinutes: 60,
      candidates: [
        { uid: "tony", productionLoad: 1, auditLoad: 0, blocks },
        { uid: "ernesto", productionLoad: 0, auditLoad: 0, blocks },
        { uid: "ivan", productionLoad: 0, auditLoad: 1, blocks },
      ],
    });
    assert.equal(result.responsible.uid, "ernesto");
    assert.notEqual(result.responsible.uid, result.auditor.uid);
    assert.equal(result.startDate, "2026-07-20");
    assert.equal(result.dueDate, "2026-07-22");
    assert.equal(result.dueTime, "10:00");
  });

  it("inicia en el siguiente bloque válido y detecta ausencia de personal", () => {
    const window = consumeScheduledCapacity([
      { dateValue: "2026-07-21", startMinute: 540, endMinute: 1020 },
    ], 10, 20);
    assert.equal(window.startDate, "2026-07-21");
    assert.equal(window.startTime, "09:00");
    assert.equal(selectCapacityAssignmentPair({
      quantity: 10,
      unitsPerWorkday: 20,
      qualityReviewMinutes: 30,
      candidates: [{ uid: "solo", productionLoad: 0, auditLoad: 0, blocks: window.segments }],
    }), null);
  });

  it("resuelve capacidad por producto, categoría y fallback central", () => {
    const settings = {
      capacityByProduct: { book1: 40 },
      capacityByCategory: { Libro: 30 },
      defaultUnitsPerWorkday: 20,
    };
    assert.equal(resolveUnitsPerWorkday({ id: "book1", category: "Libro" }, settings), 40);
    assert.equal(resolveUnitsPerWorkday({ id: "book2", category: "Libro" }, settings), 30);
    assert.equal(resolveUnitsPerWorkday({ id: "poster", category: "Cartel" }, settings), 20);
  });
});

describe("bajas y supresión de reposición", () => {
  it("detecta lotes automáticos históricos incompletos", () => {
    assert.equal(automaticBatchNeedsAssignment({
      automatic: true,
      status: BATCH_STATUS.PENDING_ASSIGNMENT,
      responsibleUid: "",
      auditorUid: "auditor",
      startDate: "",
      dueDate: "2026-07-22",
    }), true);
  });

  it("no recalcula lotes planeados ni asignaciones manuales bloqueadas", () => {
    assert.equal(automaticBatchNeedsAssignment({
      automatic: true,
      status: BATCH_STATUS.PLANNED,
      responsibleUid: "",
      auditorUid: "",
    }), false);
    assert.equal(automaticBatchNeedsAssignment({
      automatic: true,
      status: BATCH_STATUS.PENDING_ASSIGNMENT,
      assignmentSource: "manual",
      assignmentLocked: true,
      responsibleUid: "producer",
      auditorUid: "auditor",
    }), false);
  });

  it("guarda asignación manual parcial y evita sobrescritura automática concurrente", async () => {
    const state = {
      automatic: true,
      origin: "automatic",
      status: BATCH_STATUS.PENDING_ASSIGNMENT,
      progress: 0,
      productId: "book-1",
      responsible: "",
      responsibleUid: "",
      responsibleName: "",
      responsibleEmail: "",
      auditorUid: "",
      auditorName: "",
      auditorEmail: "",
      startDate: "2026-07-21",
      dueDate: "2026-07-24",
      assignmentPending: true,
      assignmentVersion: 0,
    };
    const ref = { id: "batch-1", path: "printProductionBatches/batch-1" };
    let queue = Promise.resolve();
    const db = {
      collection: () => ({ doc: () => ref }),
      runTransaction(callback) {
        const run = queue.then(() => callback({
          get: async () => ({ exists: true, data: () => ({ ...state }) }),
          update: (_ref, patch) => Object.assign(state, patch),
        }));
        queue = run.catch(() => undefined);
        return run;
      },
    };
    const fieldValue = { serverTimestamp: () => "timestamp" };
    const actor = { uid: "admin", name: "Admin", email: "admin@test.local", isAdmin: true };

    const manualSave = saveProductionBatchAdminChanges(db, "batch-1", {
      status: BATCH_STATUS.PLANNED,
      responsibleUid: "producer",
      responsibleName: "Producción",
      responsibleEmail: "producer@test.local",
      responsible: "Producción",
      auditorUid: "auditor",
      auditorName: "Calidad",
      auditorEmail: "auditor@test.local",
      startDate: "",
      dueDate: "",
    }, actor, fieldValue);
    const automaticReconciliation = db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (automaticBatchNeedsAssignment(snapshot.data())) {
        transaction.update(ref, {
          status: BATCH_STATUS.PENDING_ASSIGNMENT,
          responsibleUid: "",
          auditorUid: "",
        });
      }
    });

    await Promise.all([manualSave, automaticReconciliation]);
    assert.equal(state.assignmentSource, "manual");
    assert.equal(state.assignmentLocked, true);
    assert.equal(state.assignmentPending, false);
    assert.equal(state.status, BATCH_STATUS.PLANNED);
    assert.equal(state.responsibleUid, "producer");
    assert.equal(state.auditorUid, "auditor");
    assert.equal(state.startDate, "2026-07-21");
    assert.equal(state.dueDate, "2026-07-24");
    assert.equal(automaticBatchNeedsAssignment(state), false);
  });

  it("mantiene supresión mientras stock y umbrales no cambien", () => {
    const lock = {
      suppressed: true,
      suppressedCurrentStock: 25,
      suppressedMinimumStock: 10,
      suppressedIdealStock: 50,
    };
    assert.equal(matchesReplenishmentSuppression(lock, 25, 10, 50), true);
    assert.equal(matchesReplenishmentSuppression(lock, 24, 10, 50), false);
  });

  it("elimina lógicamente el último lote sin exigir otro registro", async () => {
    const state = { folio: "LOT-ULTIMO", automatic: false, inventoryApplied: false };
    const ref = { id: "last", path: "printProductionBatches/last" };
    const db = {
      collection: () => ({ doc: () => ref }),
      runTransaction: async (callback) => callback({
        get: async () => ({ exists: true, data: () => state }),
        update: (_ref, patch) => Object.assign(state, patch),
      }),
    };
    const result = await deleteProductionBatch(
      db,
      "last",
      { uid: "admin", name: "Admin", email: "admin@test.local", isAdmin: true },
      { serverTimestamp: () => "timestamp" }
    );
    assert.equal(result.deleted, true);
    assert.equal(state.deleted, true);
    assert.equal(state.active, false);
  });
});

describe("salidas de inventario terminado", () => {
  it("permite admin o colaborador activo de Imprenta, sin elevar otros perfiles", () => {
    assert.equal(canActiveProfileAccessPrintshop({ active: true, role: "admin" }), true);
    assert.equal(canActiveProfileAccessPrintshop({ active: true, department: "Imprenta" }), true);
    assert.equal(canActiveProfileAccessPrintshop({ active: true, department: "Ventas" }), false);
    assert.equal(canActiveProfileAccessPrintshop({ active: false, department: "Imprenta" }), false);
  });

  it("valida entero positivo, motivo e idempotencia estable", () => {
    assert.deepEqual(validateFinishedInventoryOutput({ quantity: 3, reason: "Plantel Centro" }), {
      quantity: 3,
      reason: "Plantel Centro",
      notes: "",
    });
    assert.throws(() => validateFinishedInventoryOutput({ quantity: 1.5, reason: "Plantel" }));
    assert.throws(() => validateFinishedInventoryOutput({ quantity: 2, reason: "" }));
    assert.equal(
      getInventoryOutputMovementId("user", "same-request"),
      getInventoryOutputMovementId("user", "same-request")
    );
    assert.deepEqual(calculateFinishedInventoryOutputStock(5, 5), { previousStock: 5, newStock: 0 });
    assert.throws(() => calculateFinishedInventoryOutputStock(4, 5), /Stock insuficiente/);
  });

  it("descuenta una sola vez ante concurrencia y rechaza stock insuficiente", async () => {
    const documents = new Map([
      ["printFinishedInventory/inventory-1", {
        active: true,
        productId: "book-1",
        productName: "Libro Uno",
        currentStock: 10,
      }],
    ]);
    let queue = Promise.resolve();
    const db = {
      collection(name) {
        return {
          doc(id) { return { id, path: `${name}/${id}` }; },
        };
      },
      runTransaction(callback) {
        const run = queue.then(() => callback({
          async get(ref) {
            const data = documents.get(ref.path);
            return { exists: Boolean(data), data: () => data };
          },
          update(ref, patch) {
            documents.set(ref.path, { ...documents.get(ref.path), ...patch });
          },
          create(ref, data) {
            if (documents.has(ref.path)) throw new Error("already exists");
            documents.set(ref.path, data);
          },
        }));
        queue = run.catch(() => undefined);
        return run;
      },
    };
    const input = { inventoryId: "inventory-1", quantity: 3, reason: "Plantel", requestId: "same" };
    const actor = {
      uid: "printer",
      name: "Printer",
      email: "printer@test.local",
      canAccessPrintshop: true,
    };
    const fieldValue = { serverTimestamp: () => "timestamp" };
    const [first, retry] = await Promise.all([
      registerFinishedInventoryOutput(db, input, actor, fieldValue),
      registerFinishedInventoryOutput(db, input, actor, fieldValue),
    ]);
    assert.equal(documents.get("printFinishedInventory/inventory-1").currentStock, 7);
    assert.equal([first, retry].filter((result) => result.alreadyApplied).length, 1);
    await assert.rejects(() => registerFinishedInventoryOutput(
      db,
      { ...input, quantity: 8, requestId: "insufficient" },
      actor,
      fieldValue
    ), /Stock insuficiente/);
    await assert.rejects(() => registerFinishedInventoryOutput(
      db,
      { ...input, requestId: "unauthorized" },
      { uid: "sales", name: "Ventas" },
      fieldValue
    ), /acceso a Imprenta/);
  });
});
