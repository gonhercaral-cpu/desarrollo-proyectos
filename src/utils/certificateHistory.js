function firstText(...values) {
  const match = values.find((value) => typeof value === "string" && value.trim());
  return match ? match.trim() : "";
}

const PDF_URL_FIELDS = [
  "pdfUrl",
  "certificatePdfUrl",
  "originalPdfUrl",
  "certificateUrl",
  "downloadUrl",
  "downloadURL",
  "fileUrl",
];

const PDF_PATH_FIELDS = [
  "pdfStoragePath",
  "pdfPath",
  "storagePath",
  "filePath",
  "certificateStoragePath",
  "certificatePdfPath",
  "originalPdfPath",
];

const NESTED_PDF_FIELDS = [
  "pdf",
  "certificatePdf",
  "originalPdf",
  "certificateFile",
  "file",
];

function uniqueText(values) {
  return [...new Set(values.map((value) => firstText(value)).filter(Boolean))];
}

function readPdfFields(source, fields) {
  if (!source || typeof source !== "object") return [];

  const direct = fields.map((field) => source[field]);
  const nested = NESTED_PDF_FIELDS.flatMap((field) => {
    const value = source[field];
    return value && typeof value === "object"
      ? [...fields, "url", "path", "fullPath"].map((nestedField) => value[nestedField])
      : [];
  });

  return uniqueText([...direct, ...nested]);
}

export function getCertificateRequestId(certificate) {
  return firstText(
    certificate?.requestId,
    certificate?.solicitudId,
    certificate?.printRequestId,
    certificate?.sourceRequestId,
    certificate?.request?.id,
    certificate?.solicitud?.id
  );
}

export function getCertificateBatchId(certificate) {
  return firstText(
    certificate?.batchId,
    certificate?.loteId,
    certificate?.historyBatchId,
    certificate?.certificateBatchId,
    certificate?.batch?.id,
    certificate?.lote?.id
  );
}

export function getCertificatePdfUrl(certificate) {
  return readPdfFields(certificate, PDF_URL_FIELDS)[0] || "";
}

export function getCertificatePdfStoragePath(certificate) {
  return readPdfFields(certificate, PDF_PATH_FIELDS)[0] || "";
}

export function getCertificatePdfReferences(...sources) {
  return {
    urls: uniqueText(sources.flatMap((source) => [
      ...readPdfFields(source, PDF_URL_FIELDS),
      ...(Array.isArray(source?.pdfReferences?.urls) ? source.pdfReferences.urls : []),
    ])),
    paths: uniqueText(sources.flatMap((source) => [
      ...readPdfFields(source, PDF_PATH_FIELDS),
      ...(Array.isArray(source?.pdfReferences?.paths) ? source.pdfReferences.paths : []),
    ])),
  };
}

export function getStorageObjectPath(value) {
  const text = firstText(value);
  if (!text) return "";
  if (!/^(?:https?:|gs:|blob:|data:)/i.test(text)) return text.replace(/^\/+/, "");

  const gsMatch = text.match(/^gs:\/\/[^/]+\/(.+)$/i);
  if (gsMatch) return decodeURIComponent(gsMatch[1]);
  if (!/^https?:/i.test(text)) return "";

  try {
    const url = new URL(text);
    const objectApiMatch = url.pathname.match(/\/o\/(.+)$/);
    if (objectApiMatch) return decodeURIComponent(objectApiMatch[1]);

    if (url.hostname.toLowerCase() === "storage.googleapis.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.length > 1
        ? decodeURIComponent(segments.slice(1).join("/"))
        : "";
    }
  } catch {
    return "";
  }

  return "";
}

export function getCertificateStableIds(certificate, request = null, student = null, batch = null) {
  return uniqueText([
    certificate?.id,
    certificate?.certificateId,
    certificate?.validationCode,
    certificate?.codigoValidacion,
    certificate?.folio,
    certificate?.certificateFolio,
    certificate?.pdfFileName,
    student?.certificateRecordId,
    student?.certificateId,
    student?.validationCode,
    student?.codigoValidacion,
    student?.certificateFolio,
    student?.folio,
    request?.id,
    getCertificateRequestId(certificate),
    batch?.id,
    getCertificateBatchId(certificate),
  ]);
}

export function normalizeCertificateStatus(status, fallback = "Generado") {
  const normalized = String(status || "").trim().toLowerCase();

  if (["entregado", "entregada", "delivered"].includes(normalized)) return "Entregado";
  if (["cancelado", "cancelada", "cancelled", "canceled"].includes(normalized)) return "Cancelado";
  if (["generado", "generada", "generated"].includes(normalized)) return "Generado";
  if (["mixto", "mixed"].includes(normalized)) return "Mixto";
  return fallback;
}

export function findCertificateStudent(request, certificate) {
  const students = Array.isArray(request?.students) ? request.students : [];
  const certificateId = firstText(certificate?.id, certificate?.certificateId);
  const studentId = firstText(certificate?.studentId, certificate?.alumnoId);
  const validationCode = firstText(certificate?.validationCode, certificate?.codigoValidacion);
  const folio = firstText(certificate?.folio, certificate?.certificateFolio);

  return students.find((student) => {
    const stableMatches = [
      certificateId && firstText(student?.certificateRecordId, student?.certificateId) === certificateId,
      studentId && firstText(student?.id, student?.studentId, student?.alumnoId) === studentId,
      validationCode && firstText(student?.validationCode, student?.codigoValidacion) === validationCode,
      folio && firstText(
        student?.certificateFolio,
        student?.folio,
        student?.certificateNumber,
        student?.generatedFolio
      ) === folio,
    ];

    return stableMatches.some(Boolean);
  }) || null;
}

export function findCertificateRequest(certificate, requests = []) {
  const requestId = getCertificateRequestId(certificate);
  const direct = requestId
    ? requests.find((request) => String(request?.id || "") === requestId)
    : null;

  if (direct) return direct;

  return requests.find((request) => findCertificateStudent(request, certificate)) || null;
}

export function getCertificateAssociation(certificate, requests = []) {
  const request = findCertificateRequest(certificate, requests);

  return {
    request,
    requestId: request?.id || getCertificateRequestId(certificate),
    student: request ? findCertificateStudent(request, certificate) : null,
  };
}
