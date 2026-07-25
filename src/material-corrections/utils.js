import {
  EVIDENCE_FILE_POLICIES,
  INTERNAL_CORRECTED_FILE_POLICIES,
  ERROR_TYPE_OPTIONS,
  MATERIAL_CORRECTION_PRIORITY_OPTIONS,
  MATERIAL_CORRECTION_STATUS_OPTIONS,
  MATERIAL_CORRECTION_TIME_ZONE,
  MATERIAL_TYPE_OPTIONS,
} from "./constants.js";

export function getOptionLabel(options, value, fallback = "Sin dato") {
  return options.find((option) => option.value === value)?.label || fallback;
}

export function getMaterialTypeLabel(value) {
  return getOptionLabel(MATERIAL_TYPE_OPTIONS, value);
}

export function getErrorTypeLabel(value) {
  return getOptionLabel(ERROR_TYPE_OPTIONS, value);
}

export function getStatusOption(value) {
  return MATERIAL_CORRECTION_STATUS_OPTIONS.find((option) => option.value === value)
    || MATERIAL_CORRECTION_STATUS_OPTIONS[0];
}

export function getPriorityOption(value) {
  return MATERIAL_CORRECTION_PRIORITY_OPTIONS.find((option) => option.value === value)
    || MATERIAL_CORRECTION_PRIORITY_OPTIONS[1];
}

export function toDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMaterialCorrectionDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: MATERIAL_CORRECTION_TIME_ZONE,
    dateStyle: options.dateOnly ? "medium" : "medium",
    ...(options.dateOnly ? {} : { timeStyle: "short" }),
  }).format(date);
}

export function formatFileSize(bytes = 0) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getFileExtension(fileName) {
  return String(fileName || "").toLowerCase().match(/\.([a-z0-9]{2,8})$/)?.[1] || "";
}

export function validateMaterialEvidenceFiles(files, existingCount = 0) {
  const list = Array.from(files || []);
  if (existingCount + list.length > 5) {
    throw new Error("Puedes adjuntar hasta 5 archivos en total.");
  }
  return list.map((file) => {
    const extension = getFileExtension(file.name);
    const policy = EVIDENCE_FILE_POLICIES[extension];
    if (!policy || !policy.types.includes(String(file.type || "").toLowerCase())) {
      throw new Error(`${file.name}: tipo o extensión no permitida.`);
    }
    if (!file.size || file.size > policy.maxBytes) {
      throw new Error(
        `${file.name}: máximo ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`
      );
    }
    return file;
  });
}

export function validateInternalCorrectedFile(file) {
  if (!file) throw new Error("Selecciona un archivo.");
  const extension = getFileExtension(file.name);
  const policy = INTERNAL_CORRECTED_FILE_POLICIES[extension];
  if (!policy || !policy.types.includes(String(file.type || "").toLowerCase())) {
    throw new Error(`${file.name}: tipo o extensión no permitida.`);
  }
  if (!file.size || file.size > policy.maxBytes) {
    throw new Error(`${file.name}: máximo ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`);
  }
  return file;
}

export function createClientSubmissionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `material-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getReportSearchText(report) {
  return normalizeSearchText([
    report.folio,
    report.description,
    report.materialName,
    report.bookName,
    report.pageNumber,
    report.slideNumber,
    report.unitNumber,
    report.unitNumber && `unidad ${report.unitNumber}`,
    report.unitName,
    report.reportedBy?.name,
    report.reportedBy?.campus,
  ].filter(Boolean).join(" "));
}

export function isDistributionPending(report, key) {
  const destination = report.distribution?.[key];
  return destination?.required === true && destination.status !== "completed";
}

function compareText(first, second) {
  return String(first || "").localeCompare(String(second || ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortMaterialCorrectionReports(reports, mode) {
  const list = [...reports];
  const timestamp = (report) => toDate(report.createdAt)?.getTime() || 0;
  const statusRank = (report) => getStatusOption(report.status).rank;
  const priorityRank = (report) => getPriorityOption(report.priority).rank;
  const compare = {
    recent: (a, b) => timestamp(b) - timestamp(a),
    oldest: (a, b) => timestamp(a) - timestamp(b),
    priority: (a, b) => priorityRank(b) - priorityRank(a) || timestamp(b) - timestamp(a),
    level: (a, b) => compareText(a.levelName, b.levelName) || Number(a.unitNumber || 0) - Number(b.unitNumber || 0),
    unit: (a, b) => Number(a.unitNumber || 0) - Number(b.unitNumber || 0) || compareText(a.bookName, b.bookName),
    status: (a, b) => statusRank(a) - statusRank(b) || timestamp(b) - timestamp(a),
    assigned: (a, b) => compareText(a.assignedTo?.name, b.assignedTo?.name) || timestamp(b) - timestamp(a),
    manual: (a, b) => Number(a.manualOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.manualOrder ?? Number.MAX_SAFE_INTEGER),
  }[mode] || ((a, b) => timestamp(b) - timestamp(a));
  return list.sort(compare);
}

export function groupMaterialCorrectionReports(reports, mode) {
  if (!mode || mode === "none") return [{ key: "all", label: "", reports }];
  const getValue = {
    level: (report) => report.levelName || "Sin nivel",
    book: (report) => report.bookName || "Sin libro",
    unit: (report) => `Unidad ${report.unitNumber || report.unitName || "sin dato"}`,
    material: (report) => getMaterialTypeLabel(report.materialType),
    status: (report) => getStatusOption(report.status).label,
    assigned: (report) => report.assignedTo?.name || "Sin responsable",
  }[mode];
  const groups = new Map();
  reports.forEach((report) => {
    const label = getValue(report);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(report);
  });
  return Array.from(groups, ([label, groupedReports]) => ({
    key: `${mode}:${label}`,
    label,
    reports: groupedReports,
  }));
}

export function applyMaterialCorrectionFilters(reports, filters, search) {
  const needle = normalizeSearchText(search);
  return reports.filter((report) => {
    if (report.deleted || report.archived) return false;
    const reportSearchText = getReportSearchText(report);
    if (needle && !needle.split(" ").every((token) => reportSearchText.includes(token))) return false;
    const exactFields = [
      ["status", report.status],
      ["priority", report.priority],
      ["level", report.levelName],
      ["book", report.bookName],
      ["unit", String(report.unitNumber || "")],
      ["lesson", String(report.lessonNumber || "")],
      ["materialType", report.materialType],
      ["errorType", report.errorType],
      ["reporter", report.reportedBy?.name],
      ["campus", report.reportedBy?.campus],
      ["assigned", report.assignedTo?.uid || "unassigned"],
    ];
    if (exactFields.some(([key, value]) => filters[key] && filters[key] !== String(value || ""))) {
      return false;
    }
    if (filters.evidence === "with" && Number(report.evidenceCount || 0) <= 0) return false;
    if (filters.evidence === "without" && Number(report.evidenceCount || 0) > 0) return false;
    if (filters.pendingInPerson && !isDistributionPending(report, "inPersonDrive")) return false;
    if (filters.pendingOnline && !isDistributionPending(report, "onlineDrive")) return false;
    const created = toDate(report.createdAt);
    if (filters.dateFrom && (!created || created < new Date(`${filters.dateFrom}T00:00:00`))) return false;
    if (filters.dateTo && (!created || created > new Date(`${filters.dateTo}T23:59:59.999`))) return false;
    return true;
  });
}

export function calculateMaterialCorrectionStats(reports) {
  const active = reports.filter((report) => !report.deleted && !report.archived);
  const now = Date.now();
  const completedThisWeek = active.filter((report) => (
    report.status === "completed"
    && now - (toDate(report.completedAt)?.getTime() || 0) <= 7 * 24 * 60 * 60 * 1000
  ));
  const resolved = active
    .map((report) => {
      const created = toDate(report.createdAt)?.getTime();
      const completed = toDate(report.completedAt)?.getTime();
      return created && completed ? completed - created : null;
    })
    .filter((value) => Number.isFinite(value) && value >= 0);
  const averageMs = resolved.length
    ? resolved.reduce((sum, value) => sum + value, 0) / resolved.length
    : 0;
  return {
    new: active.filter((report) => report.status === "reported").length,
    reviewing: active.filter((report) => ["under_review", "needs_information", "confirmed"].includes(report.status)).length,
    correcting: active.filter((report) => report.status === "in_correction").length,
    publishing: active.filter((report) => ["corrected", "publishing"].includes(report.status)).length,
    urgent: active.filter((report) => report.priority === "urgent" && !["completed", "dismissed", "duplicate"].includes(report.status)).length,
    completedWeek: completedThisWeek.length,
    averageDays: averageMs ? Math.round((averageMs / 86400000) * 10) / 10 : 0,
  };
}
