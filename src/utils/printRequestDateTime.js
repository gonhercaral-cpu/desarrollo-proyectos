const PRINT_REQUEST_TIME_ZONE = "America/Tijuana";

function toValidDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatExactTimestamp(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = toValidDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PRINT_REQUEST_TIME_ZONE,
  }).format(date);
}

function formatCalendarDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const safeDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: PRINT_REQUEST_TIME_ZONE,
  }).format(safeDate);
}

export function formatPrintRequestCreatedAt(request = {}) {
  const exactTimestamp = [
    request.createdAt,
    request.assignmentEvaluatedAt,
  ].map(formatExactTimestamp).find(Boolean);

  if (exactTimestamp) return exactTimestamp;

  return formatCalendarDate(request.requestDate) || "Sin fecha";
}

export { PRINT_REQUEST_TIME_ZONE };
