import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCertificateReportSchedule,
  getCertificateReportTeacher,
  isCertificateReportRequest,
} from "../src/utils/printRequestReport.js";

describe("reporte de solicitudes de certificados", () => {
  it("lee estructura actual y variantes históricas anidadas", () => {
    assert.equal(getCertificateReportTeacher({
      teacherSignerName: "Maestra Actual",
    }), "Maestra Actual");
    assert.equal(getCertificateReportTeacher({
      group: { teacher: { name: "Maestro Histórico" } },
    }), "Maestro Histórico");
    assert.equal(getCertificateReportSchedule({
      certificateData: { groupSchedule: "Lun/Mié 18:00" },
    }), "Lun/Mié 18:00");
  });

  it("aplica fallbacks explícitos y detecta certificados antiguos", () => {
    assert.equal(getCertificateReportTeacher({}), "Sin maestro registrado");
    assert.equal(getCertificateReportSchedule({}), "Sin horario registrado");
    assert.equal(isCertificateReportRequest({ requestType: "Certificado" }), true);
    assert.equal(isCertificateReportRequest({ type: "certificados" }), true);
    assert.equal(isCertificateReportRequest({ requestType: "Libro" }), false);
  });
});
