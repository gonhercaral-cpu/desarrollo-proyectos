const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  BATCH_STATUS,
  QUALITY_STATUS,
  buildQualityReviewPatch,
  calculateReplenishment,
  evaluateInventoryEntry,
  getInventoryMovementId,
  isResponsibleTransitionAllowed,
  selectAssignmentPair,
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
});
