import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";

import {
  findCertificateRequest,
  getCertificateBatchId,
  getCertificateHistoryMetadata,
  getLocalCertificateDateBoundary,
  getCertificatePdfReferences,
  getCertificatePdfStoragePath,
  getCertificatePdfUrl,
  getCertificateRequestId,
  getStorageObjectPath,
  normalizeCertificateSchedule,
  normalizeCertificateStatus,
} from "../src/utils/certificateHistory.js";
import {
  CERTIFICATE_PAGE,
  getPdfFirstPageSize,
  isLetterPortraitPdf,
} from "../src/utils/certificatePage.js";

test("normaliza nombres historicos de solicitud y PDF", () => {
  const certificate = {
    solicitudId: "solicitud-1",
    certificatePdfUrl: "https://example.test/certificado.pdf",
    storagePath: "printshop/generated-certificates/2025/certificado.pdf",
  };

  assert.equal(getCertificateRequestId(certificate), "solicitud-1");
  assert.equal(getCertificatePdfUrl(certificate), certificate.certificatePdfUrl);
  assert.equal(getCertificatePdfStoragePath(certificate), certificate.storagePath);
});

test("normaliza filePath, estructuras anidadas y lote historico", () => {
  const certificate = {
    loteId: "batch-9",
    filePath: "printshop/generated-certificates/request-9/2024/CERT-9.pdf",
    certificatePdf: { downloadUrl: "https://example.test/CERT-9.pdf" },
  };
  const references = getCertificatePdfReferences(certificate);

  assert.equal(getCertificateBatchId(certificate), "batch-9");
  assert.equal(getCertificatePdfStoragePath(certificate), certificate.filePath);
  assert.deepEqual(references.paths, [certificate.filePath]);
  assert.deepEqual(references.urls, [certificate.certificatePdf.downloadUrl]);
});

test("distingue rutas relativas, gs y variantes URL de Firebase Storage", () => {
  const objectPath = "printshop/generated-certificates/lote 1/CERT-Á-1.pdf";
  const encodedPath = encodeURIComponent(objectPath);

  assert.equal(getStorageObjectPath(objectPath), objectPath);
  assert.equal(
    getStorageObjectPath(`gs://demo.appspot.com/${objectPath}`),
    objectPath
  );
  assert.equal(
    getStorageObjectPath(`https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodedPath}?alt=media`),
    objectPath
  );
  assert.equal(
    getStorageObjectPath(`https://storage.googleapis.com/demo.appspot.com/${encodedPath}`),
    objectPath
  );
});

test("normaliza estados historicos en espanol e ingles", () => {
  assert.equal(normalizeCertificateStatus("GENERATED"), "Generado");
  assert.equal(normalizeCertificateStatus("entregada"), "Entregado");
  assert.equal(normalizeCertificateStatus("DELIVERED"), "Entregado");
  assert.equal(normalizeCertificateStatus("cancelled"), "Cancelado");
});

test("recupera solicitud por asociacion estable sin usar nombre visible", () => {
  const requests = [
    { id: "request-1", students: [{ id: "student-1", name: "Nombre cambiado", validationCode: "VALID-1" }] },
  ];

  assert.equal(findCertificateRequest({ validationCode: "VALID-1" }, requests)?.id, "request-1");
});

test("recupera certificado desde mapas y estructuras historicas de solicitud", () => {
  const requests = [{
    id: "request-map",
    certificates: {
      "VALID-MAP-1": {
        studentId: "student-map",
        certificateFolio: "CERT-MAP-1",
        pdfPath: "printshop/generated-certificates/CERT-MAP-1.pdf",
      },
    },
  }];

  assert.equal(findCertificateRequest({ validationCode: "VALID-MAP-1" }, requests)?.id, "request-map");
});

test("enriquece lote sin reemplazar metadatos historicos validos", () => {
  const originalGeneratedAt = "2025-08-10T16:00:00.000Z";
  const metadata = getCertificateHistoryMetadata(
    {
      teacherName: "Maestra histórica",
      groupSchedule: "5:00–6:00",
      generatedAt: originalGeneratedAt,
    },
    {
      teacherSignerId: "teacher-1",
      teacherSignerName: "Maestra actual",
      schedule: "17:00 - 18:00",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    []
  );

  assert.equal(metadata.teacherId, "teacher-1");
  assert.equal(metadata.teacherName, "Maestra histórica");
  assert.equal(metadata.groupSchedule, "5:00–6:00");
  assert.equal(metadata.generatedAt, originalGeneratedAt);
  assert.equal(normalizeCertificateSchedule(" 5:00 – 6:00 "), "5:00-6:00");
});

test("construye un rango local inclusivo sin convertir a UTC", () => {
  const start = getLocalCertificateDateBoundary("2026-07-13");
  const end = getLocalCertificateDateBoundary("2026-07-13", true);

  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 6);
  assert.equal(start.getDate(), 13);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMilliseconds(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  assert.equal(end.getSeconds(), 59);
  assert.equal(end.getMilliseconds(), 999);
});

test("detecta Letter vertical 612 por 792 puntos", () => {
  const letterPdf = "%PDF-1.4\n/MediaBox [0 0 612 792]\n";
  const landscapePdf = "%PDF-1.4\n/MediaBox [0 0 792 612]\n";

  assert.deepEqual(getPdfFirstPageSize(letterPdf), {
    widthPt: CERTIFICATE_PAGE.widthPt,
    heightPt: CERTIFICATE_PAGE.heightPt,
  });
  assert.equal(isLetterPortraitPdf(letterPdf), true);
  assert.equal(isLetterPortraitPdf(landscapePdf), false);
});

test("jsPDF genera MediaBox Letter vertical exacto", () => {
  const pdf = new jsPDF({
    orientation: CERTIFICATE_PAGE.orientation,
    unit: "pt",
    format: [CERTIFICATE_PAGE.widthPt, CERTIFICATE_PAGE.heightPt],
  });
  const bytes = pdf.output("arraybuffer");

  assert.equal(isLetterPortraitPdf(bytes), true);
  assert.deepEqual(getPdfFirstPageSize(bytes), {
    widthPt: CERTIFICATE_PAGE.widthPt,
    heightPt: CERTIFICATE_PAGE.heightPt,
  });
});

test("abrir PDF, reimprimir y ver solicitud no ejecutan migraciones", () => {
  const source = readFileSync(new URL("../src/pages/printshop.jsx", import.meta.url), "utf8");
  const actionSource = source.slice(
    source.indexOf("async function openOriginalGeneratedCertificate"),
    source.indexOf("async function addSingleRequestStudent")
  );
  const selectSource = source.slice(
    source.indexOf("function selectRequest"),
    source.indexOf("async function savePrintRequest")
  );

  assert.doesNotMatch(actionSource, /repairGeneratedCertificateReferences|updateDoc\(|writeBatch\(/);
  assert.doesNotMatch(selectSource, /publishRequestStudentValidations|updateDoc\(|writeBatch\(/);
});

test("historial y detalle comparten contexto, renderer y servicio PDF", () => {
  const source = readFileSync(new URL("../src/pages/printshop.jsx", import.meta.url), "utf8");
  const historyBuilder = source.slice(
    source.indexOf("async function buildHistoryCertificatePdfBlob"),
    source.indexOf("function clearCertificateHistoryFilters")
  );
  const detailBuilder = source.slice(
    source.indexOf("async function buildAndStoreStudentCertificatePdf"),
    source.indexOf("async function saveMissingCertificatePdfs")
  );

  assert.match(historyBuilder, /resolveCertificateRenderContext/);
  assert.match(historyBuilder, /buildCertificatePdfBlobFromElement/);
  assert.doesNotMatch(historyBuilder, /saveGeneratedCertificatePdfBlob|uploadBytes|updateDoc\(/);
  assert.match(detailBuilder, /resolveCertificatePdfDocument/);
  assert.match(detailBuilder, /buildCertificatePdfBlobFromElement/);
});
