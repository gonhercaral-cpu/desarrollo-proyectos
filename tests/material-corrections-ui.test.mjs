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

const reports = [
  {
    id: "u10",
    folio: "MAT-2026-000010",
    levelName: "A1",
    bookName: "Journey",
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
    levelName: "A1",
    bookName: "Journey",
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
});
