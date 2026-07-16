export function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number(value) || 0;
}

export function normalizeSearch(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function formatFileSize(value) {
  const size = Number(value) || 0;
  if (size <= 0) return "Sin tamaño";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDriveFileDate(value) {
  const millis = getTimestampMillis(value);
  if (!millis) return "Sin fecha";

  return new Date(millis).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatAuditDate(timestamp) {
  const millis = getTimestampMillis(timestamp);
  if (!millis) return "Sin fecha";

  return new Date(millis).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getShortText(value = "", length = 8) {
  const text = String(value || "");
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}
