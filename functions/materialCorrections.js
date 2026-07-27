const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  isActiveCertificateSigner,
  normalizeCertificateSignerType,
} = require("./certificatePeople");
const { CAMPUS_OPTIONS } = require("./publicPrintRequest");

const REGION = "us-central1";
const TIME_ZONE = "America/Tijuana";
const REPORTS_COLLECTION = "materialCorrectionReports";
const COUNTERS_COLLECTION = "materialCorrectionCounters";
const RATE_LIMIT_COLLECTION = "materialCorrectionRateLimits";
const MATERIAL_DEPARTMENT = "desarrollo-de-material";

const MATERIAL_TYPES = new Set([
  "student_book",
  "teacher_book",
  "slide",
  "song",
  "audio",
  "video",
  "activity_sheet",
  "exam",
  "answers",
  "other",
]);
const MATERIAL_TYPES_WITH_PAGE = new Set([
  "student_book",
  "teacher_book",
  "activity_sheet",
  "exam",
  "answers",
  "other",
]);

const ERROR_TYPES = new Set([
  "spelling",
  "grammar",
  "typo",
  "incorrect_answer",
  "incorrect_or_confusing_instruction",
  "incorrect_translation",
  "design_or_format",
  "incorrect_image",
  "incorrect_audio",
  "missing_content",
  "duplicate_content",
  "broken_link",
  "other",
]);

const STATUSES = new Set([
  "reported",
  "under_review",
  "needs_information",
  "confirmed",
  "in_correction",
  "corrected",
  "publishing",
  "completed",
  "dismissed",
  "duplicate",
]);

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CLOSED_STATUSES = new Set(["completed", "dismissed", "duplicate"]);
const ADMIN_ONLY_STATUSES = new Set(["completed", "dismissed", "duplicate"]);
const DISTRIBUTION_KEYS = [
  "sourceFile",
  "inPersonDrive",
  "onlineDrive",
  "platform",
  "futurePrint",
];
const DISTRIBUTION_STATUSES = new Set(["pending", "in_progress", "not_applicable", "completed"]);
const COMMENT_VISIBILITIES = new Set(["internal", "public"]);
const COMMENT_TYPES = new Set(["comment", "information_request", "reporter_information"]);

const FILE_POLICIES = {
  jpg: { mime: new Set(["image/jpeg"]), category: "image", maxBytes: 10 * 1024 * 1024 },
  jpeg: { mime: new Set(["image/jpeg"]), category: "image", maxBytes: 10 * 1024 * 1024 },
  png: { mime: new Set(["image/png"]), category: "image", maxBytes: 10 * 1024 * 1024 },
  webp: { mime: new Set(["image/webp"]), category: "image", maxBytes: 10 * 1024 * 1024 },
  pdf: { mime: new Set(["application/pdf"]), category: "pdf", maxBytes: 20 * 1024 * 1024 },
  mp3: { mime: new Set(["audio/mpeg", "audio/mp3"]), category: "audio", maxBytes: 25 * 1024 * 1024 },
  m4a: { mime: new Set(["audio/mp4", "audio/x-m4a"]), category: "audio", maxBytes: 25 * 1024 * 1024 },
  wav: { mime: new Set(["audio/wav", "audio/x-wav"]), category: "audio", maxBytes: 25 * 1024 * 1024 },
  ogg: { mime: new Set(["audio/ogg"]), category: "audio", maxBytes: 25 * 1024 * 1024 },
  mp4: { mime: new Set(["video/mp4"]), category: "video", maxBytes: 100 * 1024 * 1024 },
  mov: { mime: new Set(["video/quicktime"]), category: "video", maxBytes: 100 * 1024 * 1024 },
  webm: { mime: new Set(["video/webm"]), category: "video", maxBytes: 100 * 1024 * 1024 },
};

const INTERNAL_FILE_POLICIES = {
  ...FILE_POLICIES,
  docx: {
    mime: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
    category: "source",
    maxBytes: 100 * 1024 * 1024,
  },
  pptx: {
    mime: new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
    category: "source",
    maxBytes: 100 * 1024 * 1024,
  },
  xlsx: {
    mime: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
    category: "source",
    maxBytes: 100 * 1024 * 1024,
  },
  zip: {
    mime: new Set(["application/zip", "application/x-zip-compressed"]),
    category: "source",
    maxBytes: 100 * 1024 * 1024,
  },
};

const STATUS_TRANSITIONS = {
  reported: new Set(["under_review", "needs_information"]),
  under_review: new Set(["needs_information", "in_correction"]),
  needs_information: new Set(["under_review"]),
  confirmed: new Set(["in_correction"]),
  in_correction: new Set(["needs_information", "corrected"]),
  corrected: new Set(["publishing"]),
  publishing: new Set(["needs_information", "in_correction", "corrected"]),
  completed: new Set([]),
  dismissed: new Set([]),
  duplicate: new Set([]),
};

const PUBLIC_STATUS_LABELS = {
  reported: "Recibido",
  under_review: "En revisión",
  needs_information: "Se requiere información",
  confirmed: "Corrección programada",
  in_correction: "En proceso",
  corrected: "Corregido, pendiente de validación o publicación",
  publishing: "Actualizando materiales",
  completed: "Completado",
  dismissed: "No se requiere corrección",
  duplicate: "Relacionado con otro reporte",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripUnsafeControls(value) {
  return Array.from(String(value || ""), (character) => {
    const code = character.charCodeAt(0);
    const allowedWhitespace = code === 9 || code === 10 || code === 13;
    return (code < 32 && !allowedWhitespace) || code === 127 ? " " : character;
  }).join("");
}

function sanitizeText(value, maxLength = 500, { required = false, field = "Campo" } = {}) {
  const cleaned = stripUnsafeControls(cleanString(value))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
  if (required && !cleaned) {
    throw new HttpsError("invalid-argument", `${field} es obligatorio.`);
  }
  return cleaned;
}

function sanitizeMultiline(value, maxLength = 5000, options = {}) {
  const cleaned = stripUnsafeControls(cleanString(value))
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, maxLength)
    .trim();
  if (options.required && !cleaned) {
    throw new HttpsError("invalid-argument", `${options.field || "Campo"} es obligatorio.`);
  }
  return cleaned;
}

function sanitizeUrl(value, { required = false, field = "Enlace" } = {}) {
  const raw = cleanString(value);
  if (!raw) {
    if (required) throw new HttpsError("invalid-argument", `${field} es obligatorio.`);
    return "";
  }
  if (raw.length > 2000) {
    throw new HttpsError("invalid-argument", `${field} excede la longitud permitida.`);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", `${field} no es una URL válida.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new HttpsError("invalid-argument", `${field} debe usar HTTPS y no incluir credenciales.`);
  }
  return parsed.toString();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDepartmentValue(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function normalizeRole(value) {
  return cleanString(value).toLowerCase();
}

function getProfileDepartmentValues(profile = {}) {
  return [
    profile.area,
    profile.department,
    profile.departmentName,
    profile.team,
    profile.departmentId,
    profile.primaryDepartmentId,
    profile.areaId,
    ...(Array.isArray(profile.departments) ? profile.departments : []),
    ...(Array.isArray(profile.departmentNames) ? profile.departmentNames : []),
    ...(Array.isArray(profile.departmentIds) ? profile.departmentIds : []),
  ].map(normalizeDepartmentValue).filter(Boolean);
}

function canProfileAccessMaterialCorrections(profile = {}) {
  if (profile.active !== true) return false;
  if (normalizeRole(profile.role) === "admin") return true;
  return normalizeRole(profile.role) === "collaborator"
    && getProfileDepartmentValues(profile).includes(MATERIAL_DEPARTMENT);
}

function getActor(profile, uid) {
  const role = normalizeRole(profile.role);
  return {
    uid,
    name: sanitizeText(profile.name || profile.displayName || profile.email, 160) || "Usuario",
    email: sanitizeText(profile.email, 254),
    role,
    isAdmin: role === "admin",
  };
}

async function assertInternalActor(request, db) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snapshot = await db.collection("users").doc(request.auth.uid).get();
  if (!snapshot.exists || !canProfileAccessMaterialCorrections(snapshot.data())) {
    throw new HttpsError(
      "permission-denied",
      "Solo administradores y colaboradores activos de Desarrollo de Material pueden acceder."
    );
  }
  return {
    ...getActor(snapshot.data(), request.auth.uid),
    profile: snapshot.data(),
  };
}

function getTijuanaYear(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
  }).format(date));
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeHashEquals(expectedHash, token) {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash || "")) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createPublicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function createEvidenceId() {
  return crypto.randomUUID();
}

function getExtension(fileName) {
  const match = cleanString(fileName).toLowerCase().match(/\.([a-z0-9]{2,8})$/);
  return match?.[1] || "";
}

function sanitizeFileName(fileName) {
  const extension = getExtension(fileName);
  const base = cleanString(fileName)
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "evidencia";
  return extension ? `${base}.${extension}` : base;
}

function validateEvidenceDeclaration(input = {}, { internal = false } = {}) {
  const originalName = sanitizeFileName(input.name);
  const extension = getExtension(originalName);
  const policy = (internal ? INTERNAL_FILE_POLICIES : FILE_POLICIES)[extension];
  const contentType = cleanString(input.contentType).toLowerCase();
  const size = Number(input.size);
  if (!policy || !policy.mime.has(contentType)) {
    throw new HttpsError(
      "invalid-argument",
      "Archivo no permitido. Usa JPG, PNG, WEBP, PDF, MP3, M4A, WAV, OGG, MP4, MOV o WEBM."
    );
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > policy.maxBytes) {
    throw new HttpsError(
      "invalid-argument",
      `El archivo excede el límite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`
    );
  }
  return { originalName, extension, contentType, size, policy };
}

function hasValidFileSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const ascii = buffer.toString("ascii", 0, Math.min(buffer.length, 16));
  const hex = buffer.subarray(0, Math.min(buffer.length, 16)).toString("hex");
  if (extension === "pdf") return ascii.startsWith("%PDF-");
  if (extension === "png") return hex.startsWith("89504e470d0a1a0a");
  if (extension === "jpg" || extension === "jpeg") return hex.startsWith("ffd8ff");
  if (extension === "webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (extension === "wav") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
  if (extension === "ogg") return ascii.startsWith("OggS");
  if (extension === "webm") return hex.startsWith("1a45dfa3");
  if (extension === "mp3") {
    return ascii.startsWith("ID3") || ["fff1", "fff2", "fff3", "fffa", "fffb"].some((prefix) => hex.startsWith(prefix));
  }
  if (["m4a", "mp4", "mov"].includes(extension)) {
    return ascii.slice(4, 8) === "ftyp";
  }
  if (["docx", "pptx", "xlsx", "zip"].includes(extension)) {
    return ascii.startsWith("PK");
  }
  return false;
}

function numberOrNull(value, { min = 0, max = 100000, integer = true } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    return null;
  }
  return parsed;
}

function sanitizeClassification(
  source = {},
  { requireCore = false, includeLegacy = true } = {}
) {
  const materialType = sanitizeText(source.materialType, 60);
  if (materialType && !MATERIAL_TYPES.has(materialType)) {
    throw new HttpsError("invalid-argument", "Tipo de material no válido.");
  }
  const unitNumber = numberOrNull(source.unitNumber, { min: 1, max: 9999 });
  const classification = {
    levelId: sanitizeText(source.levelId, 120),
    levelName: sanitizeText(source.levelName, 160, {
      required: requireCore,
      field: "Nivel",
    }),
    unitNumber,
    unitName: sanitizeText(source.unitName, 200),
    materialType,
  };
  if (includeLegacy || MATERIAL_TYPES_WITH_PAGE.has(materialType)) {
    classification.pageNumber = sanitizeText(source.pageNumber, 80);
  }
  if (includeLegacy) {
    Object.assign(classification, {
      bookId: sanitizeText(source.bookId, 120),
      bookName: sanitizeText(source.bookName, 200),
      lessonNumber: numberOrNull(source.lessonNumber, { min: 1, max: 9999 }),
      materialName: sanitizeText(source.materialName, 240),
      exerciseNumber: sanitizeText(source.exerciseNumber, 80),
      questionNumber: sanitizeText(source.questionNumber, 80),
      slideNumber: sanitizeText(source.slideNumber, 80),
      songName: sanitizeText(source.songName, 240),
      timestamp: sanitizeText(source.timestamp, 120),
    });
  }
  if (requireCore && !unitNumber && !classification.unitName) {
    throw new HttpsError("invalid-argument", "Unidad es obligatoria.");
  }
  if (requireCore && !MATERIAL_TYPES.has(materialType)) {
    throw new HttpsError("invalid-argument", "Tipo de material es obligatorio.");
  }
  return classification;
}

function getMaterialLevelName(template = {}) {
  const level = sanitizeText(template.level, 160);
  const programName = sanitizeText(template.programName, 160);
  const compactLevel = normalizeText(level).replace(/\s+/g, "");
  const compactProgram = normalizeText(programName).replace(/\s+/g, "");
  if (!programName || compactLevel.includes(compactProgram)) {
    return level;
  }
  return `${level} ${programName}`.trim();
}

async function resolveActiveMaterialLevel(db, source = {}) {
  const levelId = sanitizeText(source.levelId, 120, {
    required: true,
    field: "Nivel",
  });
  if (levelId.includes("/")) {
    throw new HttpsError("invalid-argument", "Nivel no válido.");
  }
  const snapshot = await db.collection("certificateTemplates").doc(levelId).get();
  const data = snapshot.exists ? snapshot.data() : null;
  const levelName = data?.active === true ? getMaterialLevelName(data) : "";
  if (!levelName) {
    throw new HttpsError("invalid-argument", "Nivel no existe o no está activo.");
  }
  return { levelId: snapshot.id, levelName };
}

async function resolveActivePrincipalReporter(db, source = {}) {
  const reporterId = sanitizeText(source.id, 120, {
    required: true,
    field: "Nombre del reportante",
  });
  if (reporterId.includes("/")) {
    throw new HttpsError("invalid-argument", "Reportante no válido.");
  }
  const snapshot = await db.collection("certificateSigners").doc(reporterId).get();
  const data = snapshot.exists ? snapshot.data() : null;
  const name = sanitizeText(
    data?.name || data?.displayName || data?.fullName || data?.nombre,
    160
  );
  if (
    !name
    || !isActiveCertificateSigner(data)
    || normalizeCertificateSignerType(data) !== "Principal"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Reportante no existe, no está activo o no es principal."
    );
  }
  return { id: snapshot.id, name };
}

function defaultDistribution() {
  return {
    sourceFile: { required: true, status: "pending", date: null, user: null, link: "", comment: "" },
    inPersonDrive: { required: true, status: "pending", date: null, user: null, link: "", comment: "" },
    onlineDrive: { required: true, status: "pending", date: null, user: null, link: "", comment: "" },
    platform: { required: false, status: "not_applicable", date: null, user: null, link: "", comment: "" },
    futurePrint: { required: false, status: "not_applicable", date: null, user: null, link: "", comment: "" },
  };
}

function inferPublicationSettings(report = {}) {
  if (report.publicationSettings && typeof report.publicationSettings === "object") {
    const enabled = report.publicationSettings.enabled === true;
    return {
      enabled,
      collaboratorCanEdit: enabled
        && report.publicationSettings.collaboratorCanEdit === true,
    };
  }
  const enabled = Boolean(report.distribution) && DISTRIBUTION_KEYS.some((key) => {
    const destination = report.distribution?.[key];
    return destination?.required === true
      || ["pending", "in_progress", "completed"].includes(destination?.status);
  });
  return { enabled, collaboratorCanEdit: false };
}

function sanitizePublicationSettings(source = {}, previous = {}) {
  const enabled = Object.hasOwn(source, "enabled")
    ? source.enabled === true
    : previous.enabled === true;
  const collaboratorCanEdit = enabled && (
    Object.hasOwn(source, "collaboratorCanEdit")
      ? source.collaboratorCanEdit === true
      : previous.collaboratorCanEdit === true
  );
  return { enabled, collaboratorCanEdit };
}

function distributionDestinationChanged(incoming, current) {
  return ["required", "status", "link", "comment"].some((field) => (
    JSON.stringify(incoming?.[field] ?? "") !== JSON.stringify(current?.[field] ?? "")
  ));
}

function sanitizeDistribution(
  source = {},
  previous = defaultDistribution(),
  actor = null,
  { canEditRequirements = true } = {}
) {
  const result = {};
  for (const key of DISTRIBUTION_KEYS) {
    const current = previous?.[key] || defaultDistribution()[key];
    const incoming = source?.[key] || current;
    if (!canEditRequirements && incoming.required !== current.required) {
      throw new HttpsError(
        "permission-denied",
        "Solo administradores pueden cambiar destinos requeridos."
      );
    }
    if (!canEditRequirements && current.required !== true && distributionDestinationChanged(incoming, current)) {
      throw new HttpsError(
        "permission-denied",
        "El colaborador solo puede actualizar destinos requeridos."
      );
    }
    const required = incoming.required === true;
    let status = sanitizeText(incoming.status, 40) || (required ? "pending" : "not_applicable");
    if (!DISTRIBUTION_STATUSES.has(status)) {
      throw new HttpsError("invalid-argument", `Estado de distribución no válido: ${key}.`);
    }
    if (required && status === "not_applicable") status = "pending";
    if (!required) status = "not_applicable";
    const completedNow = status === "completed" && current.status !== "completed";
    result[key] = {
      required,
      status,
      date: status === "completed"
        ? (completedNow ? new Date() : current.date || new Date())
        : current.date || null,
      user: status === "completed"
        ? (completedNow ? actor : current.user || actor)
        : current.user || null,
      link: sanitizeUrl(incoming.link),
      comment: sanitizeMultiline(incoming.comment, 1200),
    };
  }
  return result;
}

function allRequiredDestinationsCompleted(distribution = {}) {
  return DISTRIBUTION_KEYS.every((key) => {
    const destination = distribution?.[key];
    return destination?.required !== true || destination.status === "completed";
  });
}

function buildSearchText(report) {
  return normalizeText([
    report.folio,
    report.levelName,
    report.unitNumber,
    report.unitName,
    report.materialType,
    report.pageNumber,
    report.errorType,
    report.description,
    report.reportedBy?.name,
    report.reportedBy?.campus,
  ].filter(Boolean).join(" "));
}

function descriptionSimilarity(first, second) {
  const a = new Set(normalizeText(first).split(" ").filter((word) => word.length > 2));
  const b = new Set(normalizeText(second).split(" ").filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((word) => {
    if (b.has(word)) intersection += 1;
  });
  return intersection / (a.size + b.size - intersection);
}

function getClientIp(request) {
  const forwarded = cleanString(request.rawRequest?.headers?.["x-forwarded-for"]).split(",")[0].trim();
  return forwarded || cleanString(request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress) || "unknown";
}

async function enforceRateLimit(db, request, {
  action,
  identity = "",
  limit,
  windowMs,
}) {
  const now = Date.now();
  const key = crypto.createHash("sha256")
    .update(`${action}|${getClientIp(request)}|${identity}`)
    .digest("hex");
  const reference = db.collection(RATE_LIMIT_COLLECTION).doc(key);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.exists ? snapshot.data() : {};
    const windowStart = data.windowStart?.toMillis?.() || Number(data.windowStartMillis) || 0;
    const sameWindow = now - windowStart < windowMs;
    const count = sameWindow ? Number(data.count || 0) : 0;
    if (count >= limit) {
      throw new HttpsError("resource-exhausted", "Demasiadas solicitudes. Espera e intenta nuevamente.");
    }
    transaction.set(reference, {
      action,
      count: count + 1,
      windowStart: sameWindow ? data.windowStart : new Date(now),
      windowStartMillis: sameWindow ? windowStart : now,
      updatedAt: new Date(now),
      expireAt: new Date(now + Math.max(windowMs * 4, 24 * 60 * 60 * 1000)),
    });
  });
}

function assertHoneypot(data = {}) {
  if (cleanString(data.website)) {
    throw new HttpsError("invalid-argument", "No fue posible validar el formulario.");
  }
  const startedAt = Number(data.formStartedAt);
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 1500 || elapsed > 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "La sesión del formulario no es válida. Recarga la página.");
  }
}

async function findPossibleDuplicates(db, classification, description, excludeReportId = "") {
  let query = db.collection(REPORTS_COLLECTION)
    .where("levelName", "==", classification.levelName)
    .where("unitNumber", "==", classification.unitNumber)
    .where("materialType", "==", classification.materialType)
    .limit(40);
  const snapshot = await query.get();
  return snapshot.docs
    .filter((document) => document.id !== excludeReportId)
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((report) => !report.deleted && report.status !== "dismissed")
    .filter((report) => {
      const sameLocation = Boolean(cleanString(classification.pageNumber))
        && cleanString(report.pageNumber) === cleanString(classification.pageNumber);
      return sameLocation || descriptionSimilarity(report.description, description) >= 0.45;
    })
    .slice(0, 5);
}

async function getReportByFolio(db, folio) {
  const cleanFolio = sanitizeText(folio, 40, { required: true, field: "Folio" }).toUpperCase();
  if (!/^MAT-\d{4}-\d{6}$/.test(cleanFolio)) {
    throw new HttpsError("not-found", "No se encontró el reporte o el enlace no es válido.");
  }
  const snapshot = await db.collection(REPORTS_COLLECTION)
    .where("folio", "==", cleanFolio)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "No se encontró el reporte o el enlace no es válido.");
  }
  const document = snapshot.docs[0];
  return { id: document.id, ref: document.ref, ...document.data() };
}

async function assertPublicReportAccess(db, data = {}) {
  const token = cleanString(data.token);
  if (token.length < 32) {
    throw new HttpsError("not-found", "No se encontró el reporte o el enlace no es válido.");
  }
  const report = await getReportByFolio(db, data.folio);
  if (report.deleted || !safeHashEquals(report.publicTrackingTokenHash, token)) {
    throw new HttpsError("not-found", "No se encontró el reporte o el enlace no es válido.");
  }
  return report;
}

function serializeDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicDistribution(distribution = {}) {
  return {
    inPerson: {
      required: distribution.inPersonDrive?.required === true,
      status: distribution.inPersonDrive?.status || "pending",
      date: serializeDate(distribution.inPersonDrive?.date),
      link: distribution.inPersonDrive?.status === "completed"
        ? sanitizeUrl(distribution.inPersonDrive?.link)
        : "",
      comment: distribution.inPersonDrive?.comment || "",
    },
    online: {
      required: distribution.onlineDrive?.required === true,
      status: distribution.onlineDrive?.status || "pending",
      date: serializeDate(distribution.onlineDrive?.date),
      link: distribution.onlineDrive?.status === "completed"
        ? sanitizeUrl(distribution.onlineDrive?.link)
        : "",
      comment: distribution.onlineDrive?.comment || "",
    },
  };
}

async function getPublicTrackingProjection(report) {
  const [commentsSnapshot, evidencesSnapshot] = await Promise.all([
    report.ref.collection("comments").orderBy("createdAt", "asc").limit(100).get(),
    report.ref.collection("evidences").get(),
  ]);
  const comments = commentsSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((comment) => comment.visibility === "public")
    .map((comment) => ({
      id: comment.id,
      type: comment.type || "comment",
      message: comment.message || "",
      authorName: comment.type === "reporter_information" ? "Reportante" : "Desarrollo de Material",
      createdAt: serializeDate(comment.createdAt),
    }));
  const evidences = evidencesSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((evidence) => evidence.status === "ready" && evidence.visibility !== "internal")
    .map((evidence) => ({
      id: evidence.id,
      name: evidence.originalName,
      contentType: evidence.contentType,
      size: evidence.size,
      createdAt: serializeDate(evidence.createdAt),
    }));
  return {
    folio: report.folio,
    material: {
      levelName: report.levelName,
      bookName: report.bookName,
      unitNumber: report.unitNumber,
      unitName: report.unitName,
      lessonNumber: report.lessonNumber,
      materialType: report.materialType,
      materialName: report.materialName,
      pageNumber: report.pageNumber,
      slideNumber: report.slideNumber,
      songName: report.songName,
      timestamp: report.timestamp,
    },
    createdAt: serializeDate(report.createdAt),
    status: report.status,
    statusLabel: PUBLIC_STATUS_LABELS[report.status] || "En seguimiento",
    distribution: publicDistribution(report.distribution),
    comments,
    evidences,
    evidenceSlotsRemaining: Math.max(0, 5 - evidences.length),
  };
}

async function createNextFolio(db) {
  const year = getTijuanaYear();
  const counterRef = db.collection(COUNTERS_COLLECTION).doc(String(year));
  const sequence = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const next = Number(snapshot.data()?.lastSequence || 0) + 1;
    transaction.set(counterRef, {
      year,
      lastSequence: next,
      updatedAt: new Date(),
    }, { merge: true });
    return next;
  });
  return `MAT-${year}-${String(sequence).padStart(6, "0")}`;
}

async function materialNotificationRecipients(db) {
  const snapshot = await db.collection("users").where("active", "==", true).get();
  return snapshot.docs
    .map((document) => ({ uid: document.id, ...document.data() }))
    .filter(canProfileAccessMaterialCorrections);
}

async function createNotifications(db, {
  report,
  type,
  title,
  message,
  actorUid = "",
  recipientUids = null,
}) {
  const profiles = await materialNotificationRecipients(db);
  const allowed = new Set(profiles.map((profile) => profile.uid));
  const recipients = recipientUids
    ? new Set(recipientUids.filter((uid) => allowed.has(uid)))
    : new Set(profiles.map((profile) => profile.uid));
  recipients.delete(actorUid);
  if (!recipients.size) return;
  const batch = db.batch();
  for (const uid of recipients) {
    const reference = db.collection("notifications").doc();
    batch.set(reference, {
      recipientId: uid,
      materialCorrectionReportId: report.id,
      materialCorrectionFolio: report.folio,
      link: `/?page=material-corrections&reportId=${encodeURIComponent(report.id)}`,
      dedupeKey: `${type}:${report.id}:${Date.now()}`,
      tipo: type,
      titulo: title,
      mensaje: message,
      actorId: actorUid,
      actorName: actorUid ? "Usuario" : "Formulario público",
      read: false,
      createdAt: new Date(),
    });
  }
  await batch.commit();
}

function isAssignedMaterialCollaborator(actor, report) {
  return !actor.isAdmin && report.assignedTo?.uid === actor.uid;
}

function assertActorCanModifyReport(actor, report, changes = {}, action = "update") {
  if (actor.isAdmin) return;
  if (!isAssignedMaterialCollaborator(actor, report)) {
    throw new HttpsError(
      "permission-denied",
      "Solo el colaborador responsable asignado puede modificar este reporte."
    );
  }
  const adminOnlyFields = [
    "assignedTo",
    "confirmedClassification",
    "duplicateFolio",
    "manualOrder",
    "publicationSettings",
    "approvalComment",
  ];
  if (adminOnlyFields.some((field) => Object.hasOwn(changes, field)) || action !== "update") {
    throw new HttpsError(
      "permission-denied",
      "Esta acción está reservada para administradores."
    );
  }
}

function assertActorCanEditDistribution(actor, publicationSettings) {
  if (actor.isAdmin) return;
  if (
    publicationSettings.enabled !== true
    || publicationSettings.collaboratorCanEdit !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "Publicación y distribución solo pueden gestionarlas administradores."
    );
  }
}

function validateStatusTransition(
  current,
  next,
  isAdmin,
  action,
  { isAssigned = false, publicationSettings = {} } = {}
) {
  if (current === next) return;
  if (isAdmin) {
    if (action === "reopen" && (!CLOSED_STATUSES.has(current) || next !== "under_review")) {
      throw new HttpsError("failed-precondition", "El reporte no puede reabrirse desde este estado.");
    }
    return;
  }
  if (!isAssigned) {
    throw new HttpsError(
      "permission-denied",
      "Solo el colaborador responsable asignado puede cambiar el estado."
    );
  }
  if (ADMIN_ONLY_STATUSES.has(next) || ["reported", "confirmed"].includes(next)) {
    throw new HttpsError(
      "permission-denied",
      "Este estado solo puede establecerlo un administrador."
    );
  }
  if (
    next === "publishing"
    && (
      publicationSettings.enabled !== true
      || publicationSettings.collaboratorCanEdit !== true
    )
  ) {
    throw new HttpsError(
      "permission-denied",
      "Publicación no está habilitada para el colaborador."
    );
  }
  if (!STATUS_TRANSITIONS[current]?.has(next)) {
    throw new HttpsError("failed-precondition", `No se puede cambiar de ${current} a ${next}.`);
  }
}

function validateCompletionRequirements({
  currentStatus,
  isAdmin,
  appliedSolution,
  publicationSettings,
  distribution,
}) {
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Solo administradores pueden aprobar el cierre.");
  }
  if (!["corrected", "publishing"].includes(currentStatus)) {
    throw new HttpsError(
      "failed-precondition",
      "La corrección debe estar marcada como corregida antes de completar."
    );
  }
  if (!sanitizeMultiline(appliedSolution, 6000)) {
    throw new HttpsError(
      "failed-precondition",
      "Registra la solución aplicada antes de completar."
    );
  }
  if (
    publicationSettings.enabled === true
    && !allRequiredDestinationsCompleted(distribution)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Completa todos los destinos de publicación requeridos antes de cerrar."
    );
  }
}

function sanitizeAssignedTo(value) {
  if (!value) return null;
  const uid = sanitizeText(value.uid, 160);
  if (!uid) return null;
  return {
    uid,
    name: sanitizeText(value.name, 160),
    email: sanitizeText(value.email, 254),
  };
}

async function validateAssignee(db, assignedTo) {
  if (!assignedTo?.uid) return null;
  const snapshot = await db.collection("users").doc(assignedTo.uid).get();
  if (!snapshot.exists || !canProfileAccessMaterialCorrections(snapshot.data())) {
    throw new HttpsError("invalid-argument", "Responsable no válido o inactivo.");
  }
  return {
    uid: snapshot.id,
    name: sanitizeText(snapshot.data().name || snapshot.data().email, 160),
    email: sanitizeText(snapshot.data().email, 254),
  };
}

function comparableValue(value) {
  if (value === undefined) return null;
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value;
}

function changedKeys(before, after) {
  return Object.keys(after).filter((key) => (
    JSON.stringify(comparableValue(before[key])) !== JSON.stringify(comparableValue(after[key]))
  ));
}

function createMaterialCorrectionHandlers({ db, bucket, FieldValue }) {
  const callableOptions = {
    region: REGION,
    cors: true,
    timeoutSeconds: 60,
    memory: "512MiB",
  };

  const createMaterialCorrectionReport = onCall(callableOptions, async (request) => {
    const data = request.data || {};
    assertHoneypot(data);
    await enforceRateLimit(db, request, {
      action: "create",
      identity: sanitizeText(data.reportedBy?.id, 120),
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    const [principalReporter, activeLevel] = await Promise.all([
      resolveActivePrincipalReporter(db, data.reportedBy),
      resolveActiveMaterialLevel(db, data.classification),
    ]);
    const campus = sanitizeText(data.reportedBy?.campus, 160, {
      required: true,
      field: "Plantel",
    });
    if (!CAMPUS_OPTIONS.includes(campus)) {
      throw new HttpsError("invalid-argument", "Plantel no válido.");
    }
    const reportedBy = {
      ...principalReporter,
      campusId: campus,
      campus,
    };
    const classification = {
      ...sanitizeClassification(data.classification, {
        requireCore: true,
        includeLegacy: false,
      }),
      ...activeLevel,
    };
    const errorType = sanitizeText(data.error?.errorType, 80);
    if (!ERROR_TYPES.has(errorType)) {
      throw new HttpsError("invalid-argument", "Tipo de error no válido.");
    }
    const description = sanitizeMultiline(data.error?.description, 5000, {
      required: true,
      field: "Descripción",
    });
    const blocksClass = data.error?.blocksClass === true;
    const externalEvidenceUrl = sanitizeUrl(data.externalEvidenceUrl);
    const possibleDuplicates = await findPossibleDuplicates(db, classification, description);
    if (possibleDuplicates.length && data.duplicateWarningAcknowledged !== true) {
      return {
        duplicateWarning: true,
        possibleDuplicateCount: possibleDuplicates.length,
      };
    }

    const [folio, publicToken] = await Promise.all([
      createNextFolio(db),
      Promise.resolve(createPublicToken()),
    ]);
    const reference = db.collection(REPORTS_COLLECTION).doc();
    const originalClassification = { ...classification };
    const report = {
      folio,
      publicTrackingTokenHash: tokenHash(publicToken),
      reportedBy,
      originalClassification,
      confirmedClassification: { ...classification },
      ...classification,
      errorType,
      description,
      currentContent: sanitizeMultiline(data.error?.currentContent, 5000),
      suggestedCorrection: sanitizeMultiline(data.error?.suggestedCorrection, 5000),
      priority: blocksClass ? "urgent" : "normal",
      blocksClass,
      status: "reported",
      assignedTo: null,
      reviewResult: "",
      appliedSolution: "",
      correctedFileLink: "",
      duplicateReportId: "",
      duplicateFolio: "",
      approvalComment: "",
      publicationSettings: {
        enabled: true,
        collaboratorCanEdit: false,
      },
      distribution: defaultDistribution(),
      manualOrder: Date.now(),
      externalEvidenceUrl,
      evidenceCount: 0,
      source: "public_form",
      possibleDuplicateIds: possibleDuplicates.map((duplicate) => duplicate.id),
      possibleDuplicateCount: possibleDuplicates.length,
      searchText: "",
      archived: false,
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      correctedAt: null,
      completedAt: null,
      completedBy: null,
    };
    report.searchText = buildSearchText(report);
    const batch = db.batch();
    batch.set(reference, report);
    batch.set(reference.collection("history").doc(), {
      action: "created",
      field: "report",
      previousValue: null,
      newValue: "reported",
      actor: { uid: "public", name: reportedBy.name, email: "" },
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const createdReport = { id: reference.id, ...report };
    if (blocksClass) {
      await createNotifications(db, {
        report: createdReport,
        type: "MATERIAL_CORRECTION_URGENT",
        title: `Reporte urgente ${folio}`,
        message: `${classification.levelName}, unidad ${classification.unitNumber || classification.unitName}.`,
      });
    }
    return {
      reportId: reference.id,
      folio,
      token: publicToken,
      duplicateWarning: false,
      possibleDuplicateCount: possibleDuplicates.length,
    };
  });

  const checkMaterialCorrectionDuplicates = onCall(callableOptions, async (request) => {
    const data = request.data || {};
    assertHoneypot(data);
    await enforceRateLimit(db, request, {
      action: "duplicates",
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    const activeLevel = await resolveActiveMaterialLevel(db, data.classification);
    const classification = {
      ...sanitizeClassification(data.classification, {
        requireCore: true,
        includeLegacy: false,
      }),
      ...activeLevel,
    };
    const description = sanitizeMultiline(data.description, 5000, {
      required: true,
      field: "Descripción",
    });
    const matches = await findPossibleDuplicates(db, classification, description);
    return { possibleDuplicateCount: matches.length };
  });

  const getMaterialCorrectionTracking = onCall(callableOptions, async (request) => {
    const data = request.data || {};
    await enforceRateLimit(db, request, {
      action: "tracking",
      identity: sanitizeText(data.folio, 40),
      limit: 60,
      windowMs: 15 * 60 * 1000,
    });
    const report = await assertPublicReportAccess(db, data);
    return getPublicTrackingProjection(report);
  });

  const addPublicMaterialCorrectionInformation = onCall(callableOptions, async (request) => {
    const data = request.data || {};
    await enforceRateLimit(db, request, {
      action: "public-info",
      identity: sanitizeText(data.folio, 40),
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    const report = await assertPublicReportAccess(db, data);
    if (report.deleted || report.archived) {
      throw new HttpsError("failed-precondition", "El reporte ya no acepta información.");
    }
    const message = sanitizeMultiline(data.message, 4000, {
      required: true,
      field: "Información",
    });
    const batch = db.batch();
    batch.set(report.ref.collection("comments").doc(), {
      type: "reporter_information",
      visibility: "public",
      message,
      author: { uid: "public", name: report.reportedBy?.name || "Reportante", email: "" },
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(report.ref.collection("history").doc(), {
      action: "public_information_added",
      field: "comments",
      previousValue: null,
      newValue: "Información adicional del reportante",
      actor: { uid: "public", name: report.reportedBy?.name || "Reportante", email: "" },
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(report.ref, {
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  });

  const authorizeMaterialCorrectionEvidenceUpload = onCall({
    ...callableOptions,
    timeoutSeconds: 30,
  }, async (request) => {
    const data = request.data || {};
    let report;
    let actor;
    let publicUpload = false;
    if (request.auth?.uid) {
      actor = await assertInternalActor(request, db);
      const snapshot = await db.collection(REPORTS_COLLECTION).doc(sanitizeText(data.reportId, 160)).get();
      if (!snapshot.exists || snapshot.data().deleted) {
        throw new HttpsError("not-found", "Reporte no encontrado.");
      }
      report = { id: snapshot.id, ref: snapshot.ref, ...snapshot.data() };
      assertActorCanModifyReport(actor, report);
    } else {
      report = await assertPublicReportAccess(db, data);
      actor = { uid: "public", name: report.reportedBy?.name || "Reportante", email: "" };
      publicUpload = true;
    }
    await enforceRateLimit(db, request, {
      action: "upload-authorize",
      identity: report.id,
      limit: publicUpload ? 12 : 50,
      windowMs: 60 * 60 * 1000,
    });
    const declaration = validateEvidenceDeclaration(data.file, { internal: !publicUpload });
    const existingSnapshot = await report.ref.collection("evidences").get();
    const publicEvidenceCount = existingSnapshot.docs
      .map((document) => document.data())
      .filter((evidence) => {
        if (!evidence.source?.startsWith("public_") || evidence.status === "rejected") return false;
        if (evidence.status === "ready") return true;
        const expiresAt = evidence.expiresAt?.toMillis?.() || new Date(evidence.expiresAt || 0).getTime();
        return evidence.status === "pending" && expiresAt > Date.now();
      })
      .length;
    if (publicUpload && publicEvidenceCount >= 5) {
      throw new HttpsError("failed-precondition", "Este reporte ya alcanzó el límite de 5 evidencias.");
    }
    if (!publicUpload && existingSnapshot.size >= 25) {
      throw new HttpsError("failed-precondition", "Este reporte alcanzó el límite interno de archivos.");
    }

    const evidenceId = createEvidenceId();
    const storageName = `${evidenceId}.${declaration.extension}`;
    const storagePath = `public-material-corrections/${report.id}/evidences/${storageName}`;
    const evidenceRef = report.ref.collection("evidences").doc(evidenceId);
    const source = publicUpload
      ? (data.additional === true ? "public_additional" : "public_initial")
      : (sanitizeText(data.category, 60) || "internal_corrected");
    await evidenceRef.set({
      originalName: declaration.originalName,
      storagePath,
      declaredSize: declaration.size,
      contentType: declaration.contentType,
      extension: declaration.extension,
      category: declaration.policy.category,
      source,
      visibility: publicUpload ? "reporter" : "internal",
      status: "pending",
      createdBy: actor,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const file = bucket.file(storagePath);
    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 10 * 60 * 1000,
      contentType: declaration.contentType,
    });
    return {
      evidenceId,
      uploadUrl,
      contentType: declaration.contentType,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  });

  const finalizeMaterialCorrectionEvidenceUpload = onCall({
    ...callableOptions,
    timeoutSeconds: 120,
    memory: "1GiB",
  }, async (request) => {
    const data = request.data || {};
    let report;
    let actor;
    if (request.auth?.uid) {
      actor = await assertInternalActor(request, db);
      const snapshot = await db.collection(REPORTS_COLLECTION).doc(sanitizeText(data.reportId, 160)).get();
      if (!snapshot.exists || snapshot.data().deleted) {
        throw new HttpsError("not-found", "Reporte no encontrado.");
      }
      report = { id: snapshot.id, ref: snapshot.ref, ...snapshot.data() };
      assertActorCanModifyReport(actor, report);
    } else {
      report = await assertPublicReportAccess(db, data);
    }
    const evidenceId = sanitizeText(data.evidenceId, 160, {
      required: true,
      field: "Evidencia",
    });
    const evidenceRef = report.ref.collection("evidences").doc(evidenceId);
    const evidenceSnapshot = await evidenceRef.get();
    if (!evidenceSnapshot.exists) {
      throw new HttpsError("not-found", "Autorización de evidencia no encontrada.");
    }
    const evidence = evidenceSnapshot.data();
    if (evidence.status === "ready") {
      return { ok: true, evidenceId, size: evidence.size };
    }
    if (evidence.status !== "pending") {
      throw new HttpsError("failed-precondition", "La evidencia ya no puede finalizarse.");
    }
    const file = bucket.file(evidence.storagePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      throw new HttpsError("failed-precondition", "La carga no terminó. Intenta subir el archivo nuevamente.");
    }
    const actualSize = Number(metadata.size);
    const declaration = validateEvidenceDeclaration({
      name: evidence.originalName,
      size: actualSize,
      contentType: metadata.contentType,
    }, { internal: !evidence.source?.startsWith("public_") });
    if (actualSize !== Number(evidence.declaredSize)) {
      await file.delete({ ignoreNotFound: true });
      await evidenceRef.update({ status: "rejected", rejectionReason: "size_mismatch" });
      throw new HttpsError("invalid-argument", "El tamaño recibido no coincide con el archivo autorizado.");
    }
    const [header] = await file.download({ start: 0, end: 31 });
    if (!hasValidFileSignature(header, declaration.extension)) {
      await file.delete({ ignoreNotFound: true });
      await evidenceRef.update({ status: "rejected", rejectionReason: "signature_mismatch" });
      throw new HttpsError("invalid-argument", "El contenido real del archivo no coincide con su extensión.");
    }
    const batch = db.batch();
    batch.update(evidenceRef, {
      status: "ready",
      size: actualSize,
      contentType: declaration.contentType,
      validatedAt: FieldValue.serverTimestamp(),
      expiresAt: FieldValue.delete(),
    });
    batch.update(report.ref, {
      evidenceCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(report.ref.collection("history").doc(), {
      action: "evidence_added",
      field: "evidences",
      previousValue: null,
      newValue: evidence.originalName,
      actor: evidence.createdBy,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, evidenceId, size: actualSize };
  });

  const getMaterialCorrectionEvidenceDownloadUrl = onCall({
    ...callableOptions,
    timeoutSeconds: 30,
  }, async (request) => {
    const data = request.data || {};
    let report;
    let publicAccess = false;
    if (request.auth?.uid) {
      await assertInternalActor(request, db);
      const snapshot = await db.collection(REPORTS_COLLECTION).doc(sanitizeText(data.reportId, 160)).get();
      if (!snapshot.exists || snapshot.data().deleted) {
        throw new HttpsError("not-found", "Reporte no encontrado.");
      }
      report = { id: snapshot.id, ref: snapshot.ref, ...snapshot.data() };
    } else {
      report = await assertPublicReportAccess(db, data);
      publicAccess = true;
    }
    const evidenceId = sanitizeText(data.evidenceId, 160);
    const snapshot = await report.ref.collection("evidences").doc(evidenceId).get();
    if (!snapshot.exists || snapshot.data().status !== "ready") {
      throw new HttpsError("not-found", "Evidencia no encontrada.");
    }
    const evidence = snapshot.data();
    if (publicAccess && evidence.visibility === "internal") {
      throw new HttpsError("permission-denied", "Esta evidencia es interna.");
    }
    const [url] = await bucket.file(evidence.storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 5 * 60 * 1000,
      responseDisposition: `attachment; filename="${sanitizeFileName(evidence.originalName)}"`,
    });
    return { url, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  });

  const deleteMaterialCorrectionEvidence = onCall(callableOptions, async (request) => {
    const actor = await assertInternalActor(request, db);
    if (!actor.isAdmin) {
      throw new HttpsError("permission-denied", "Solo administradores pueden eliminar evidencias.");
    }
    const reportId = sanitizeText(request.data?.reportId, 160, {
      required: true,
      field: "Reporte",
    });
    const evidenceId = sanitizeText(request.data?.evidenceId, 160, {
      required: true,
      field: "Evidencia",
    });
    const reportRef = db.collection(REPORTS_COLLECTION).doc(reportId);
    const [reportSnapshot, evidenceSnapshot] = await Promise.all([
      reportRef.get(),
      reportRef.collection("evidences").doc(evidenceId).get(),
    ]);
    if (!reportSnapshot.exists || !evidenceSnapshot.exists) {
      throw new HttpsError("not-found", "Reporte o evidencia no encontrados.");
    }
    const evidence = evidenceSnapshot.data();
    if (evidence.storagePath) {
      await bucket.file(evidence.storagePath).delete({ ignoreNotFound: true });
    }
    const batch = db.batch();
    batch.delete(evidenceSnapshot.ref);
    batch.update(reportRef, {
      evidenceCount: evidence.status === "ready"
        ? FieldValue.increment(-1)
        : Number(reportSnapshot.data().evidenceCount || 0),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(reportRef.collection("history").doc(), {
      action: "evidence_deleted",
      field: "evidences",
      previousValue: evidence.originalName || evidenceId,
      newValue: null,
      actor,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  });

  const listMaterialCorrectionAssignees = onCall(callableOptions, async (request) => {
    await assertInternalActor(request, db);
    const profiles = await materialNotificationRecipients(db);
    return {
      assignees: profiles.map((profile) => ({
        uid: profile.uid,
        name: sanitizeText(profile.name || profile.email, 160),
        email: sanitizeText(profile.email, 254),
        role: normalizeRole(profile.role),
      })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    };
  });

  const updateMaterialCorrectionReport = onCall(callableOptions, async (request) => {
    const actor = await assertInternalActor(request, db);
    const data = request.data || {};
    const reportId = sanitizeText(data.reportId, 160, { required: true, field: "Reporte" });
    const action = sanitizeText(data.action, 60) || "update";
    const changes = data.changes && typeof data.changes === "object" ? data.changes : {};
    const reference = db.collection(REPORTS_COLLECTION).doc(reportId);
    const initialSnapshot = await reference.get();
    if (!initialSnapshot.exists || initialSnapshot.data().deleted) {
      throw new HttpsError("not-found", "Reporte no encontrado.");
    }
    const initial = initialSnapshot.data();
    let duplicateTarget = null;

    if (action === "archive" || action === "delete") {
      if (!actor.isAdmin) {
        throw new HttpsError("permission-denied", "Solo administradores pueden archivar o eliminar.");
      }
      const patch = action === "archive"
        ? { archived: true, archivedAt: FieldValue.serverTimestamp(), archivedBy: actor }
        : { deleted: true, deletedAt: FieldValue.serverTimestamp(), deletedBy: actor };
      await reference.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
      await reference.collection("history").add({
        action,
        field: action === "archive" ? "archived" : "deleted",
        previousValue: false,
        newValue: true,
        actor,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    }

    assertActorCanModifyReport(actor, initial, changes, action);
    const initialPublicationSettings = inferPublicationSettings(initial);
    const patch = {};
    if (Object.hasOwn(changes, "priority")) {
      const priority = sanitizeText(changes.priority, 40);
      if (!PRIORITIES.has(priority)) throw new HttpsError("invalid-argument", "Prioridad no válida.");
      patch.priority = priority;
    }
    if (Object.hasOwn(changes, "assignedTo")) {
      patch.assignedTo = await validateAssignee(db, sanitizeAssignedTo(changes.assignedTo));
    }
    if (Object.hasOwn(changes, "reviewResult")) {
      patch.reviewResult = sanitizeMultiline(changes.reviewResult, 6000);
    }
    if (Object.hasOwn(changes, "appliedSolution")) {
      patch.appliedSolution = sanitizeMultiline(changes.appliedSolution, 6000);
    }
    if (Object.hasOwn(changes, "correctedFileLink")) {
      patch.correctedFileLink = sanitizeUrl(changes.correctedFileLink);
    }
    if (Object.hasOwn(changes, "approvalComment")) {
      patch.approvalComment = sanitizeMultiline(changes.approvalComment, 4000);
    }
    if (Object.hasOwn(changes, "duplicateFolio")) {
      const duplicateFolio = sanitizeText(changes.duplicateFolio, 40).toUpperCase();
      if (duplicateFolio) {
        const duplicate = await getReportByFolio(db, duplicateFolio);
        if (duplicate.id === reportId) {
          throw new HttpsError("invalid-argument", "Un reporte no puede duplicarse a sí mismo.");
        }
        patch.duplicateFolio = duplicate.folio;
        patch.duplicateReportId = duplicate.id;
        duplicateTarget = duplicate;
      } else {
        patch.duplicateFolio = "";
        patch.duplicateReportId = "";
      }
    }
    if (Object.hasOwn(changes, "confirmedClassification")) {
      if (action !== "reclassify") {
        throw new HttpsError("failed-precondition", "Usa la acción Reclasificar.");
      }
      const merged = {
        ...(initial.confirmedClassification || initial.originalClassification || {}),
        ...changes.confirmedClassification,
      };
      const activeLevel = await resolveActiveMaterialLevel(db, merged);
      const classification = {
        ...sanitizeClassification(merged, {
          requireCore: true,
          includeLegacy: false,
        }),
        ...activeLevel,
      };
      patch.confirmedClassification = classification;
      Object.assign(patch, classification);
    }
    if (Object.hasOwn(changes, "publicationSettings")) {
      patch.publicationSettings = sanitizePublicationSettings(
        changes.publicationSettings,
        initialPublicationSettings
      );
    }
    const effectivePublicationSettings = patch.publicationSettings || initialPublicationSettings;
    if (Object.hasOwn(changes, "distribution")) {
      assertActorCanEditDistribution(actor, effectivePublicationSettings);
      patch.distribution = sanitizeDistribution(
        changes.distribution,
        initial.distribution,
        actor,
        { canEditRequirements: actor.isAdmin }
      );
    }
    if (Object.hasOwn(changes, "status")) {
      const status = sanitizeText(changes.status, 60);
      if (!STATUSES.has(status)) throw new HttpsError("invalid-argument", "Estado no válido.");
      validateStatusTransition(initial.status, status, actor.isAdmin, action, {
        isAssigned: initial.assignedTo?.uid === actor.uid,
        publicationSettings: effectivePublicationSettings,
      });
      patch.status = status;
      if (["corrected", "publishing", "completed"].includes(status) && !initial.correctedAt) {
        patch.correctedAt = FieldValue.serverTimestamp();
      }
      if (status === "completed" && initial.status !== "completed") {
        const distribution = patch.distribution || initial.distribution;
        validateCompletionRequirements({
          currentStatus: initial.status,
          isAdmin: actor.isAdmin,
          appliedSolution: patch.appliedSolution ?? initial.appliedSolution,
          publicationSettings: effectivePublicationSettings,
          distribution,
        });
        patch.completedAt = FieldValue.serverTimestamp();
        patch.completedBy = actor;
      }
      if (action === "reopen") {
        if (!actor.isAdmin) throw new HttpsError("permission-denied", "Solo administradores pueden reabrir.");
        patch.completedAt = null;
        patch.completedBy = null;
        patch.archived = false;
      }
    }
    if (Object.hasOwn(changes, "manualOrder")) {
      const manualOrder = Number(changes.manualOrder);
      if (!Number.isFinite(manualOrder)) throw new HttpsError("invalid-argument", "Orden manual no válido.");
      patch.manualOrder = manualOrder;
    }
    if (!Object.keys(patch).length) {
      return { ok: true, changed: [] };
    }
    const resultingStatus = patch.status || initial.status;
    const resultingDuplicateReportId = patch.duplicateReportId || initial.duplicateReportId;
    if (resultingStatus === "duplicate" && !resultingDuplicateReportId) {
      throw new HttpsError(
        "failed-precondition",
        "Indica folio del reporte relacionado antes de marcar como duplicado."
      );
    }
    patch.searchText = buildSearchText({ ...initial, ...patch });
    patch.updatedAt = FieldValue.serverTimestamp();

    const changed = changedKeys(initial, patch).filter((key) => !["updatedAt", "searchText"].includes(key));
    const batch = db.batch();
    batch.update(reference, patch);
    for (const field of changed) {
      batch.set(reference.collection("history").doc(), {
        action,
        field,
        previousValue: initial[field] ?? null,
        newValue: patch[field] ?? null,
        actor,
        comment: field === "status" ? (patch.approvalComment || "") : "",
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (resultingStatus === "duplicate") {
      const targetRef = duplicateTarget?.ref
        || db.collection(REPORTS_COLLECTION).doc(resultingDuplicateReportId);
      batch.set(targetRef.collection("duplicateReporters").doc(reportId), {
        sourceReportId: reportId,
        sourceFolio: initial.folio,
        reportedBy: initial.reportedBy || null,
        linkedBy: actor,
        linkedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();

    const updatedReport = { id: reportId, ...initial, ...patch };
    if (changed.includes("assignedTo") && patch.assignedTo?.uid) {
      await createNotifications(db, {
        report: updatedReport,
        type: "MATERIAL_CORRECTION_ASSIGNED",
        title: `Asignación ${initial.folio}`,
        message: "Tienes un reporte de corrección asignado.",
        actorUid: actor.uid,
        recipientUids: [patch.assignedTo.uid],
      });
    }
    if (patch.status === "needs_information" || patch.status === "corrected" || patch.status === "completed") {
      const notificationConfig = {
        needs_information: ["MATERIAL_CORRECTION_INFO_REQUESTED", `Información requerida ${initial.folio}`, "Se solicitó información al reportante."],
        corrected: ["MATERIAL_CORRECTION_CORRECTED", `Material corregido ${initial.folio}`, "Corrección terminada; publicación pendiente."],
        completed: ["MATERIAL_CORRECTION_COMPLETED", `Reporte completado ${initial.folio}`, "Corrección y distribución completadas."],
      }[patch.status];
      await createNotifications(db, {
        report: updatedReport,
        type: notificationConfig[0],
        title: notificationConfig[1],
        message: notificationConfig[2],
        actorUid: actor.uid,
      });
    }
    return { ok: true, changed };
  });

  const addMaterialCorrectionComment = onCall(callableOptions, async (request) => {
    const actor = await assertInternalActor(request, db);
    const data = request.data || {};
    const reportId = sanitizeText(data.reportId, 160);
    const reference = db.collection(REPORTS_COLLECTION).doc(reportId);
    const snapshot = await reference.get();
    if (!snapshot.exists || snapshot.data().deleted) {
      throw new HttpsError("not-found", "Reporte no encontrado.");
    }
    const report = snapshot.data();
    assertActorCanModifyReport(actor, report);
    const visibility = sanitizeText(data.visibility, 30) || "internal";
    const type = sanitizeText(data.type, 60) || "comment";
    if (!COMMENT_VISIBILITIES.has(visibility) || !COMMENT_TYPES.has(type) || type === "reporter_information") {
      throw new HttpsError("invalid-argument", "Tipo de comentario no válido.");
    }
    if (type === "information_request" && visibility !== "public") {
      throw new HttpsError("invalid-argument", "La solicitud de información debe ser pública.");
    }
    if (type === "information_request") {
      validateStatusTransition(report.status, "needs_information", actor.isAdmin, "update", {
        isAssigned: report.assignedTo?.uid === actor.uid,
        publicationSettings: inferPublicationSettings(report),
      });
    }
    const message = sanitizeMultiline(data.message, 4000, {
      required: true,
      field: "Comentario",
    });
    const batch = db.batch();
    batch.set(reference.collection("comments").doc(), {
      type,
      visibility,
      message,
      author: actor,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(reference.collection("history").doc(), {
      action: type === "information_request" ? "information_requested" : "comment_added",
      field: visibility === "public" ? "publicComments" : "internalComments",
      previousValue: null,
      newValue: message,
      actor,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (type === "information_request" && report.status !== "needs_information") {
      batch.set(reference.collection("history").doc(), {
        action: "information_requested",
        field: "status",
        previousValue: report.status,
        newValue: "needs_information",
        actor,
        comment: message,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    const reportPatch = { updatedAt: FieldValue.serverTimestamp() };
    if (type === "information_request") reportPatch.status = "needs_information";
    batch.update(reference, reportPatch);
    await batch.commit();
    if (type === "information_request") {
      await createNotifications(db, {
        report: { id: snapshot.id, ...snapshot.data(), status: "needs_information" },
        type: "MATERIAL_CORRECTION_INFO_REQUESTED",
        title: `Información requerida ${snapshot.data().folio}`,
        message: "Se solicitó información adicional al reportante.",
        actorUid: actor.uid,
      });
    }
    return { ok: true };
  });

  const reorderMaterialCorrectionReports = onCall(callableOptions, async (request) => {
    const actor = await assertInternalActor(request, db);
    if (!actor.isAdmin) {
      throw new HttpsError("permission-denied", "Solo administradores pueden cambiar el orden manual.");
    }
    const orderedIds = Array.isArray(request.data?.orderedIds)
      ? request.data.orderedIds.map((id) => sanitizeText(id, 160)).filter(Boolean)
      : [];
    if (!orderedIds.length || orderedIds.length > 500 || new Set(orderedIds).size !== orderedIds.length) {
      throw new HttpsError("invalid-argument", "Orden manual no válido.");
    }
    const batch = db.batch();
    orderedIds.forEach((id, index) => {
      const reference = db.collection(REPORTS_COLLECTION).doc(id);
      batch.update(reference, {
        manualOrder: index + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(reference.collection("history").doc(), {
        action: "manual_reorder",
        field: "manualOrder",
        previousValue: null,
        newValue: index + 1,
        actor,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return { ok: true };
  });

  return {
    createMaterialCorrectionReport,
    checkMaterialCorrectionDuplicates,
    getMaterialCorrectionTracking,
    addPublicMaterialCorrectionInformation,
    authorizeMaterialCorrectionEvidenceUpload,
    finalizeMaterialCorrectionEvidenceUpload,
    getMaterialCorrectionEvidenceDownloadUrl,
    deleteMaterialCorrectionEvidence,
    listMaterialCorrectionAssignees,
    updateMaterialCorrectionReport,
    addMaterialCorrectionComment,
    reorderMaterialCorrectionReports,
  };
}

module.exports = {
  ERROR_TYPES,
  FILE_POLICIES,
  MATERIAL_TYPES,
  PRIORITIES,
  STATUSES,
  allRequiredDestinationsCompleted,
  assertActorCanEditDistribution,
  assertActorCanModifyReport,
  buildSearchText,
  canProfileAccessMaterialCorrections,
  createMaterialCorrectionHandlers,
  descriptionSimilarity,
  getTijuanaYear,
  hasValidFileSignature,
  inferPublicationSettings,
  safeHashEquals,
  sanitizeClassification,
  sanitizeDistribution,
  sanitizePublicationSettings,
  tokenHash,
  validateCompletionRequirements,
  validateEvidenceDeclaration,
  validateStatusTransition,
};
