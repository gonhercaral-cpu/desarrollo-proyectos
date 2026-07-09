// Funciones utilitarias para estadísticas de certificados (módulo Imprenta).
// Trabajan sobre los arreglos ya cargados de "printRequests" y "generatedCertificates";
// no acceden a Firestore directamente para poder reutilizarse tanto en el módulo
// Imprenta (listeners en tiempo real) como en el Dashboard ejecutivo (carga puntual).

export const CERTIFICATE_QUICK_RANGES = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "Esta semana" },
  { key: "month", label: "Este mes" },
  { key: "last30", label: "Últimos 30 días" },
  { key: "year", label: "Este año" },
  { key: "all", label: "Todo" },
  { key: "custom", label: "Personalizado" },
];

const FINAL_DELIVERED_STATUS = "Entregada";
const FINAL_CANCELLED_STATUS = "Cancelada";
const PENDING_REQUEST_STATUSES = new Set(["Solicitud recibida", "Datos incompletos"]);
const IN_PROGRESS_REQUEST_STATUSES = new Set([
  "En revisión",
  "Aprobada",
  "En producción",
  "En revisión de calidad",
  "Lista para entrega",
]);

export function isCertificateLikeRequest(request) {
  return request?.requestType === "Certificado" || request?.requestType === "Diploma";
}

export function isVisibleCertificateRecord(record) {
  return Boolean(record) && record.deleted !== true && record.active !== false;
}

function toDateValue(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime()) ? null : parsed;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getRequestDate(request) {
  return (
    toDateValue(request?.requestDate) ||
    toDateValue(request?.createdAt) ||
    null
  );
}

function getCertificateDate(certificate) {
  return (
    toDateValue(certificate?.generatedAt) ||
    toDateValue(certificate?.pdfSavedAt) ||
    toDateValue(certificate?.issueDate) ||
    null
  );
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diffToMonday = (day + 6) % 7;
  next.setDate(next.getDate() - diffToMonday);
  return next;
}

function startOfMonth(date) {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function startOfYear(date) {
  const next = startOfDay(date);
  next.setMonth(0, 1);
  return next;
}

export function getQuickRangeBounds(rangeKey, now = new Date(), custom = {}) {
  switch (rangeKey) {
    case "today":
      return { start: startOfDay(now), end: now };
    case "week":
      return { start: startOfWeek(now), end: now };
    case "month":
      return { start: startOfMonth(now), end: now };
    case "last30": {
      const start = startOfDay(now);
      start.setDate(start.getDate() - 30);
      return { start, end: now };
    }
    case "year":
      return { start: startOfYear(now), end: now };
    case "custom": {
      const start = custom.startDate ? startOfDay(new Date(custom.startDate)) : null;
      const end = custom.endDate ? new Date(custom.endDate) : null;
      if (end) end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "all":
    default:
      return { start: null, end: null };
  }
}

function isWithinRange(date, start, end) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function matchesTextFilter(value, filterValue) {
  if (!filterValue) return true;
  return String(value || "")
    .trim()
    .toLowerCase() === String(filterValue).trim().toLowerCase();
}

export function getRequestCertificateLabel(request) {
  const baseName = request?.productName || request?.requestType || "Certificado";
  if (request?.level && request.level !== "No aplica") {
    return `${baseName} ${request.level}`;
  }
  return baseName;
}

function rankEntries(countsMap, limit = 5) {
  return Array.from(countsMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function incrementMapCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

/**
 * @param {Array} printRequests - documentos crudos de la colección printRequests
 * @param {Array} generatedCertificates - documentos crudos de la colección generatedCertificates
 * @param {Object} filters
 *   rangeKey: "today"|"week"|"month"|"last30"|"year"|"all"|"custom"
 *   startDate, endDate: strings "YYYY-MM-DD" (solo si rangeKey === "custom")
 *   level, requesterName, teacherName, requestType, status: filtros exactos opcionales
 */
export function buildCertificateStatistics(printRequests = [], generatedCertificates = [], filters = {}) {
  const now = new Date();
  const rangeKey = filters.rangeKey || "month";
  const { start, end } = getQuickRangeBounds(rangeKey, now, filters);

  const visibleRequests = printRequests.filter(isVisibleCertificateRecord).filter(isCertificateLikeRequest);
  const visibleCertificates = generatedCertificates.filter(isVisibleCertificateRecord);

  const filteredRequests = visibleRequests.filter((request) => {
    if (!isWithinRange(getRequestDate(request), start, end)) return false;
    if (!matchesTextFilter(request.level, filters.level)) return false;
    if (!matchesTextFilter(request.requesterName, filters.requesterName)) return false;
    if (!matchesTextFilter(request.teacherName, filters.teacherName)) return false;
    if (!matchesTextFilter(request.requestType, filters.requestType)) return false;
    if (!matchesTextFilter(request.status, filters.status)) return false;
    return true;
  });

  const filteredCertificates = visibleCertificates.filter((certificate) => {
    if (!isWithinRange(getCertificateDate(certificate), start, end)) return false;
    if (!matchesTextFilter(certificate.level, filters.level)) return false;
    if (!matchesTextFilter(certificate.teacherName, filters.teacherName)) return false;
    if (!matchesTextFilter(certificate.requestType, filters.requestType)) return false;
    if (!matchesTextFilter(certificate.status, filters.status)) return false;
    return true;
  });

  const byStatusMap = new Map();
  const byLevelMap = new Map();
  const topCertificatesMap = new Map();
  const topRequestersMap = new Map();
  const topTeachersMap = new Map();

  let pending = 0;
  let inProgress = 0;
  let delivered = 0;
  let cancelled = 0;

  filteredRequests.forEach((request) => {
    const status = request.status || "Solicitud recibida";
    incrementMapCount(byStatusMap, status);
    incrementMapCount(byLevelMap, request.level || "No aplica");
    incrementMapCount(topCertificatesMap, getRequestCertificateLabel(request));
    incrementMapCount(topRequestersMap, request.requesterName || request.requesterArea || "Sin solicitante");
    incrementMapCount(topTeachersMap, request.teacherName || "Sin maestro asignado");

    if (status === FINAL_DELIVERED_STATUS) delivered += 1;
    else if (status === FINAL_CANCELLED_STATUS) cancelled += 1;
    else if (PENDING_REQUEST_STATUSES.has(status)) pending += 1;
    else if (IN_PROGRESS_REQUEST_STATUSES.has(status)) inProgress += 1;
  });

  const certificatesDelivered = filteredCertificates.filter((certificate) => certificate.status === "Entregado").length;
  const certificatesGenerated = filteredCertificates.length;
  const certificatesCancelled = filteredCertificates.filter((certificate) => certificate.status === "Cancelado").length;

  let comparison = null;
  if (start && end) {
    const durationMs = end.getTime() - start.getTime();
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(start.getTime() - durationMs);

    const previousCount = visibleRequests.filter((request) => {
      if (!isWithinRange(getRequestDate(request), previousStart, previousEnd)) return false;
      if (!matchesTextFilter(request.level, filters.level)) return false;
      if (!matchesTextFilter(request.requesterName, filters.requesterName)) return false;
      if (!matchesTextFilter(request.teacherName, filters.teacherName)) return false;
      if (!matchesTextFilter(request.requestType, filters.requestType)) return false;
      if (!matchesTextFilter(request.status, filters.status)) return false;
      return true;
    }).length;

    const currentCount = filteredRequests.length;
    const deltaPct = previousCount === 0
      ? (currentCount > 0 ? 100 : 0)
      : Math.round(((currentCount - previousCount) / previousCount) * 100);

    comparison = { currentCount, previousCount, deltaPct };
  }

  return {
    rangeKey,
    start,
    end,
    totals: {
      requested: filteredRequests.length,
      pending,
      inProgress,
      delivered,
      cancelled,
      certificatesGenerated,
      certificatesDelivered,
      certificatesCancelled,
    },
    byStatus: rankEntries(byStatusMap, 9),
    byLevel: rankEntries(byLevelMap, 13),
    topCertificates: rankEntries(topCertificatesMap, 5),
    topRequesters: rankEntries(topRequestersMap, 5),
    topTeachers: rankEntries(topTeachersMap, 5),
    comparison,
  };
}
