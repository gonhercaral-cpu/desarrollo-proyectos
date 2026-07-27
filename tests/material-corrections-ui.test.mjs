import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMaterialCorrectionFilters,
  calculateMaterialCorrectionStats,
  groupMaterialCorrectionReports,
  sortMaterialCorrectionReports,
  validateInternalCorrectedFile,
  validateMaterialEvidenceFiles,
} from "../src/material-corrections/utils.js";
import {
  buildActiveMaterialCorrectionLevels,
} from "../src/utils/materialCorrectionCatalogs.js";
import {
  applyPersistedMaterialCorrectionPublicationSettings,
  buildMaterialCorrectionDetailUpdate,
  createMaterialCorrectionClassificationDraft,
  createMaterialCorrectionManagementDraft,
  getMaterialCorrectionDetailPermissions,
  inferMaterialCorrectionPublicationSettings,
  materialCorrectionDraftsMatch,
  validateMaterialCorrectionClientUpdate,
} from "../src/material-corrections/detailState.js";

const reports = [
  {
    id: "u10",
    folio: "MAT-2026-000010",
    levelName: "A1 Journey",
    unitNumber: 10,
    materialType: "student_book",
    errorType: "spelling",
    status: "reported",
    priority: "normal",
    manualOrder: 2,
    reportedBy: { name: "Ana", campus: "Centro" },
    distribution: {
      inPersonDrive: { required: true, status: "pending" },
      onlineDrive: { required: true, status: "completed" },
    },
    evidenceCount: 0,
    createdAt: new Date("2026-07-20T12:00:00Z"),
  },
  {
    id: "u2",
    folio: "MAT-2026-000002",
    levelName: "A1 Journey",
    unitNumber: 2,
    materialType: "slide",
    errorType: "design_or_format",
    status: "completed",
    priority: "urgent",
    manualOrder: 1,
    reportedBy: { name: "Luis", campus: "Norte" },
    assignedTo: { uid: "material", name: "María" },
    distribution: {
      inPersonDrive: { required: false, status: "not_applicable" },
      onlineDrive: { required: true, status: "completed" },
    },
    evidenceCount: 2,
    createdAt: new Date("2026-07-21T12:00:00Z"),
    completedAt: new Date("2026-07-22T12:00:00Z"),
  },
];

describe("bandeja de correcciones de material", () => {
  it("ordena unidad como número: 2 antes que 10", () => {
    assert.deepEqual(
      sortMaterialCorrectionReports(reports, "unit").map((report) => report.unitNumber),
      [2, 10]
    );
  });

  it("conserva orden manual separado de prioridad", () => {
    assert.deepEqual(
      sortMaterialCorrectionReports(reports, "manual").map((report) => report.id),
      ["u2", "u10"]
    );
    assert.deepEqual(
      sortMaterialCorrectionReports(reports, "priority").map((report) => report.id),
      ["u2", "u10"]
    );
  });

  it("busca y filtra evidencia y publicación pendiente", () => {
    const bySearch = applyMaterialCorrectionFilters(reports, {}, "Ana unidad");
    assert.deepEqual(bySearch.map((report) => report.id), ["u10"]);
    const byMaterial = applyMaterialCorrectionFilters(reports, {}, "Libro del alumno");
    assert.deepEqual(byMaterial.map((report) => report.id), ["u10"]);
    const pending = applyMaterialCorrectionFilters(reports, {
      evidence: "without",
      pendingInPerson: true,
    }, "");
    assert.deepEqual(pending.map((report) => report.id), ["u10"]);
  });

  it("agrupa por unidad sin perder reportes", () => {
    const groups = groupMaterialCorrectionReports(reports, "unit");
    assert.equal(groups.length, 2);
    assert.equal(groups.flatMap((group) => group.reports).length, reports.length);
  });

  it("calcula tarjetas y resolución promedio", () => {
    const stats = calculateMaterialCorrectionStats(reports);
    assert.equal(stats.new, 1);
    assert.equal(stats.urgent, 0);
    assert.equal(stats.averageDays, 1);
  });

  it("valida cantidad, MIME, extensión y límites en cliente", () => {
    const file = { name: "evidencia.pdf", type: "application/pdf", size: 1024 };
    assert.equal(validateMaterialEvidenceFiles([file]).length, 1);
    assert.throws(
      () => validateMaterialEvidenceFiles(new Array(6).fill(file)),
      /hasta 5/
    );
    assert.throws(
      () => validateMaterialEvidenceFiles([{ name: "malware.exe", type: "application/octet-stream", size: 10 }]),
      /no permitida/
    );
    assert.equal(validateInternalCorrectedFile({
      name: "fuente.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
    }).name, "fuente.pptx");
  });

  it("forma niveles desde Plantillas activas, con id y nombre histórico", () => {
    const levels = buildActiveMaterialCorrectionLevels([
      { id: "a1-blue", active: true, level: "A1", programName: "Journey" },
      { id: "a1-green", active: true, level: "A1", programName: "Journey" },
      { id: "d1", active: true, level: "D1", programName: "Discover" },
      { id: "smile2", active: true, level: "Smile 2", programName: "Smile2" },
      { id: "inactive", active: false, level: "B2", programName: "Summit" },
    ]);
    assert.deepEqual(levels, [
      { id: "a1-blue", name: "A1 Journey" },
      { id: "d1", name: "D1 Discover" },
      { id: "smile2", name: "Smile 2" },
    ]);
  });

  it("detecta cambios pendientes sin alterar reportes históricos", () => {
    const historical = {
      priority: "normal",
      status: "under_review",
      assignedTo: { uid: "material", name: "María" },
      originalClassification: {
        levelId: "a1",
        levelName: "A1 Journey",
        unitNumber: 3,
        unitName: "Welcome",
        materialType: "student_book",
        pageNumber: "14",
        bookName: "Dato histórico",
        lessonNumber: "2",
      },
    };
    const management = createMaterialCorrectionManagementDraft(historical);
    const classification = createMaterialCorrectionClassificationDraft(historical);

    assert.equal(materialCorrectionDraftsMatch(
      management,
      createMaterialCorrectionManagementDraft(historical)
    ), true);
    assert.equal(materialCorrectionDraftsMatch(
      { ...management, priority: "urgent" },
      management
    ), false);
    assert.deepEqual(classification, {
      levelId: "a1",
      levelName: "A1 Journey",
      unitNumber: 3,
      unitName: "Welcome",
      materialType: "student_book",
      pageNumber: "14",
    });
  });

  it("unifica gestión y reclasificación en un guardado", () => {
    const form = {
      priority: "high",
      status: "confirmed",
      assignedUid: "material",
      reviewResult: "Error confirmado",
      appliedSolution: "Texto corregido",
      correctedFileLink: "https://drive.google.com/file",
      duplicateFolio: "",
      distribution: { sourceFile: { required: true, status: "completed" } },
    };
    const classification = {
      levelId: "d1",
      levelName: "D1 Discover",
      unitNumber: 4,
      unitName: "Science",
      materialType: "slide",
      pageNumber: "",
    };
    const update = buildMaterialCorrectionDetailUpdate({
      form,
      classification,
      assignees: [{ uid: "material", name: "María" }],
      includeClassification: true,
      includeAdministration: true,
      includeDistribution: true,
    });

    assert.equal(update.action, "reclassify");
    assert.deepEqual(update.changes.assignedTo, { uid: "material", name: "María" });
    assert.deepEqual(update.changes.confirmedClassification, classification);
  });

  it("limita edición al colaborador asignado y filtra estados", () => {
    const assigned = getMaterialCorrectionDetailPermissions({
      report: {
        status: "in_correction",
        assignedTo: { uid: "material" },
        publicationSettings: { enabled: true, collaboratorCanEdit: false },
      },
      isAdmin: false,
      currentUserId: "material",
    });
    assert.equal(assigned.canEditOperational, true);
    assert.equal(assigned.canEditDistribution, false);
    assert.deepEqual(
      assigned.statusOptions.map((option) => option.value),
      ["needs_information", "in_correction", "corrected"]
    );

    const unassigned = getMaterialCorrectionDetailPermissions({
      report: {
        status: "reported",
        assignedTo: { uid: "other" },
      },
      isAdmin: false,
      currentUserId: "material",
    });
    assert.equal(unassigned.canEditOperational, false);
    assert.deepEqual(unassigned.statusOptions.map((option) => option.value), ["reported"]);
  });

  it("reserva configuración y cierre al administrador en cliente", () => {
    const collaborator = getMaterialCorrectionDetailPermissions({
      report: {
        status: "corrected",
        assignedTo: { uid: "material" },
        publicationSettings: { enabled: true, collaboratorCanEdit: true },
      },
      isAdmin: false,
      currentUserId: "material",
    });
    assert.throws(
      () => validateMaterialCorrectionClientUpdate({
        action: "update",
        changes: { status: "completed" },
        permissions: collaborator,
      }),
      /Transición/
    );
    assert.throws(
      () => validateMaterialCorrectionClientUpdate({
        action: "update",
        changes: {
          publicationSettings: { enabled: false, collaboratorCanEdit: false },
        },
        permissions: collaborator,
      }),
      /administrativos/
    );
  });

  it("infiere publicación histórica sin habilitar al colaborador", () => {
    assert.deepEqual(inferMaterialCorrectionPublicationSettings({
      distribution: {
        sourceFile: { required: true, status: "pending" },
      },
    }), {
      enabled: true,
      collaboratorCanEdit: false,
    });
    assert.deepEqual(inferMaterialCorrectionPublicationSettings({
      publicationSettings: {
        enabled: false,
        collaboratorCanEdit: true,
      },
      distribution: {
        sourceFile: { required: true, status: "pending" },
      },
    }), {
      enabled: false,
      collaboratorCanEdit: false,
    });
    assert.deepEqual(inferMaterialCorrectionPublicationSettings({
      publicationSettings: {},
      distribution: {
        sourceFile: { required: true, status: "pending" },
      },
    }), {
      enabled: true,
      collaboratorCanEdit: false,
    });
  });

  it("envía false explícito y mantiene formulario desmarcado tras guardar", () => {
    const form = {
      priority: "normal",
      status: "corrected",
      assignedUid: "material",
      reviewResult: "Validado",
      appliedSolution: "Corregido",
      correctedFileLink: "",
      duplicateFolio: "",
      approvalComment: "",
      publicationSettings: {
        enabled: false,
        collaboratorCanEdit: true,
      },
      distribution: {
        sourceFile: { required: true, status: "pending" },
      },
    };
    const update = buildMaterialCorrectionDetailUpdate({
      form,
      classification: {},
      assignees: [{ uid: "material", name: "María" }],
      includeClassification: false,
      includeAdministration: true,
      includeDistribution: true,
    });
    assert.deepEqual(update.changes.publicationSettings, {
      enabled: false,
      collaboratorCanEdit: false,
    });

    const afterSave = applyPersistedMaterialCorrectionPublicationSettings(
      form,
      update.changes.publicationSettings
    );
    assert.equal(afterSave.publicationSettings.enabled, false);
    assert.equal(afterSave.publicationSettings.collaboratorCanEdit, false);

    const afterReload = createMaterialCorrectionManagementDraft({
      publicationSettings: update.changes.publicationSettings,
      distribution: form.distribution,
    });
    assert.equal(afterReload.publicationSettings.enabled, false);
    assert.equal(afterReload.publicationSettings.collaboratorCanEdit, false);
  });
});
