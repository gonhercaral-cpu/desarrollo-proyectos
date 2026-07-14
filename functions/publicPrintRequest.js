const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const PRINT_REQUEST_CALLABLE_CORS = [
  "https://sistema-desarrollo-proyectos.web.app",
  "https://sistema-desarrollo-proyectos.firebaseapp.com",
  /^http:\/\/localhost:\d+$/,
];

const CAMPUS_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Online",
];
const STUDENT_DELIVERY_TYPES = ["Impreso", "Digital"];
const MAX_PUBLIC_STUDENTS = 150;
const COURSE_OPTIONS = new Map([
  ["A1 Journey", { level: "A1", programName: "Journey", audience: "Adultos", productName: "Certificado A1 Journey" }],
  ["A2 Explore", { level: "A2", programName: "Explore", audience: "Adultos", productName: "Certificado A2 Explore" }],
  ["B1 Discovery", { level: "B1", programName: "Discovery", audience: "Adultos", productName: "Certificado B1 Discovery" }],
  ["B2", { level: "B2", programName: "B2", audience: "Adultos", productName: "Certificado B2" }],
  ["C1 New Horizons", { level: "C1", programName: "New Horizons", audience: "Adultos", productName: "Certificado C1 New Horizons" }],
  ["Smile 1", { level: "Smile 1", programName: "Smile 1", audience: "Kids", productName: "Certificado Smile 1" }],
  ["Smile 2", { level: "Smile 2", programName: "Smile 2", audience: "Kids", productName: "Certificado Smile 2" }],
  ["Smile 3", { level: "Smile 3", programName: "Smile 3", audience: "Kids", productName: "Certificado Smile 3" }],
  ["Smile 4", { level: "Smile 4", programName: "Smile 4", audience: "Kids", productName: "Certificado Smile 4" }],
  ["Smile 5", { level: "Smile 5", programName: "Smile 5", audience: "Kids", productName: "Certificado Smile 5" }],
  ["Mega Flash", { level: "Mega Flash", programName: "Mega Flash", audience: "Kids", productName: "Certificado Mega Flash" }],
]);

function invalidArgument(message) {
  throw new HttpsError("invalid-argument", message);
}

function sanitizeText(value, fieldName, maximumLength, required = true) {
  if (typeof value !== "string") invalidArgument(`${fieldName} debe ser texto.`);
  const cleanValue = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  if (required && !cleanValue) invalidArgument(`${fieldName} es obligatorio.`);
  if (cleanValue.length > maximumLength) {
    invalidArgument(`${fieldName} excede ${maximumLength} caracteres.`);
  }
  return cleanValue;
}

function sanitizeDocumentId(value, fieldName) {
  const cleanValue = sanitizeText(value, fieldName, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(cleanValue)) {
    invalidArgument(`${fieldName} no es válido.`);
  }
  return cleanValue;
}

function getTijuanaDate(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Tijuana",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sanitizeDeliveryDate(value, requestDate) {
  if (value === "" || value === undefined || value === null) return "";
  const cleanValue = sanitizeText(value, "Fecha de entrega", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue) || Number.isNaN(Date.parse(`${cleanValue}T00:00:00Z`))) {
    invalidArgument("Fecha de entrega inválida.");
  }
  if (cleanValue < requestDate) invalidArgument("Fecha de entrega no puede estar en el pasado.");
  return cleanValue;
}

function calculatePriority(requestDate, dueDate) {
  if (!dueDate) return "Normal";
  const start = Date.parse(`${requestDate}T00:00:00Z`);
  const end = Date.parse(`${dueDate}T00:00:00Z`);
  const days = Math.ceil((end - start) / 86400000);
  if (days <= 3) return "Urgente";
  if (days <= 7) return "Alta";
  return "Normal";
}

function createPublicFolio(createdAt = new Date()) {
  const year = getTijuanaDate(createdAt).slice(0, 4);
  return `CERT-${year}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function validatePublicSubmissionId(value) {
  const cleanValue = sanitizeText(value, "Identificador de envío", 100);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(cleanValue)) {
    invalidArgument("Identificador de envío inválido.");
  }
  return cleanValue;
}

function createPublicRequestId(submissionId) {
  const validSubmissionId = validatePublicSubmissionId(submissionId);
  const digest = createHash("sha256").update(validSubmissionId).digest("hex").slice(0, 40);
  return `public-${digest}`;
}

function createLegacyPublicRequestId(payload, clientKey, createdAt = new Date()) {
  const bucket = Math.floor(createdAt.getTime() / (10 * 60 * 1000));
  const stableRequest = {
    bucket,
    clientKey: String(clientKey || "unknown").slice(0, 300),
    requesterId: payload?.requesterId,
    principalSignerId: payload?.principalSignerId,
    teacherSignerId: payload?.teacherSignerId,
    campus: payload?.campus,
    requestedDeliveryDate: payload?.requestedDeliveryDate,
    courseLevel: payload?.courseLevel,
    schedule: payload?.schedule,
    students: Array.isArray(payload?.students)
      ? payload.students.map((student) => ({
        name: student?.name,
        deliveryType: student?.deliveryType,
        notes: student?.notes,
      }))
      : [],
  };
  const digest = createHash("sha256").update(JSON.stringify(stableRequest)).digest("hex").slice(0, 40);
  return `public-legacy-${digest}`;
}

function sanitizePublicPrintRequest(payload, createdAt = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidArgument("Faltan datos de la solicitud.");
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 256 * 1024) {
    invalidArgument("La solicitud excede el tamaño permitido.");
  }
  if (payload.publicRequestSource !== "certificate-public-form") {
    invalidArgument("Origen de solicitud inválido.");
  }

  const campus = sanitizeText(payload.campus, "Plantel", 80);
  if (!CAMPUS_OPTIONS.includes(campus)) invalidArgument("Plantel inválido.");
  const courseLevel = sanitizeText(payload.courseLevel, "Nivel", 80);
  const course = COURSE_OPTIONS.get(courseLevel);
  if (!course) invalidArgument("Nivel no permitido.");
  const requestDate = getTijuanaDate(createdAt);
  const dueDate = sanitizeDeliveryDate(payload.requestedDeliveryDate, requestDate);
  const students = Array.isArray(payload.students) ? payload.students : [];
  if (students.length < 1 || students.length > MAX_PUBLIC_STUDENTS) {
    invalidArgument(`Cantidad de alumnos debe estar entre 1 y ${MAX_PUBLIC_STUDENTS}.`);
  }

  const sanitizedStudents = students.map((student, index) => {
    if (!student || typeof student !== "object" || Array.isArray(student)) {
      invalidArgument(`Alumno ${index + 1} inválido.`);
    }
    const deliveryType = sanitizeText(student.deliveryType, `Entrega de alumno ${index + 1}`, 16);
    if (!STUDENT_DELIVERY_TYPES.includes(deliveryType)) {
      invalidArgument(`Entrega de alumno ${index + 1} inválida.`);
    }
    return {
      id: `student-${randomUUID()}`,
      name: sanitizeText(student.name, `Nombre de alumno ${index + 1}`, 160),
      originalName: sanitizeText(student.originalName || student.name, `Nombre original ${index + 1}`, 160),
      suggestedName: sanitizeText(student.suggestedName || "", `Nombre sugerido ${index + 1}`, 160, false),
      correctionAccepted: student.correctionAccepted === true,
      deliveryType,
      status: "Pendiente",
      certificateFolio: "",
      validationCode: "",
      validationUrl: "",
      qrDataUrl: "",
      qrGenerated: false,
      notes: sanitizeText(student.notes || "", `Notas de alumno ${index + 1}`, 500, false),
    };
  });
  const printedQuantity = sanitizedStudents.filter((student) => student.deliveryType === "Impreso").length;
  const digitalQuantity = sanitizedStudents.length - printedQuantity;
  const deliveryType = printedQuantity && digitalQuantity
    ? "Ambas"
    : digitalQuantity
      ? "Digital"
      : "Impresa";

  return {
    folio: createPublicFolio(createdAt),
    productId: "",
    productName: course.productName,
    requestType: "Certificado",
    requesterId: sanitizeDocumentId(payload.requesterId, "Solicitante"),
    requesterArea: "Dirección Académica",
    campus,
    priority: calculatePriority(requestDate, dueDate),
    requestedQuantity: sanitizedStudents.length,
    deliveredQuantity: 0,
    deliveryType,
    status: "Solicitud recibida",
    statusLabel: "Solicitud recibida",
    requestDate,
    dueDate,
    requestedDeliveryDate: dueDate,
    certificateIssueDate: dueDate || requestDate,
    notes: sanitizeText(payload.notes || "", "Observaciones", 2000, false),
    level: course.level,
    group: courseLevel,
    courseLevel,
    courseProgramName: course.programName,
    courseAudience: course.audience,
    schedule: sanitizeText(payload.schedule, "Horario", 120),
    principalSignerId: sanitizeDocumentId(payload.principalSignerId, "Firmante principal"),
    teacherSignerId: sanitizeDocumentId(payload.teacherSignerId, "Maestro"),
    printedQuantity,
    digitalQuantity,
    students: sanitizedStudents,
    publicTrackingEnabled: true,
    publicRequestSource: "certificate-public-form",
  };
}

function normalizeTemplateMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/discovery/g, "discover")
    .replace(/new horizons/g, "newhorizons")
    .replace(/mega flash/g, "megaflash")
    .replace(/smile\s+/g, "smile")
    .replace(/[^a-z0-9]+/g, "");
}

function certificateTemplateTextMatches(source, target) {
  const sourceText = normalizeTemplateMatchText(source);
  const targetText = normalizeTemplateMatchText(target);
  if (!sourceText || !targetText) return false;
  return sourceText === targetText || sourceText.includes(targetText) || targetText.includes(sourceText);
}

function getPublicTemplateTargets(requestData = {}) {
  return {
    level: String(requestData.level || requestData.certificateTemplateLevel || "").trim(),
    programName: String(
      requestData.courseProgramName ||
      requestData.certificateTemplateProgramName ||
      requestData.courseLevel ||
      requestData.group ||
      ""
    ).trim(),
    audience: String(requestData.courseAudience || requestData.certificateTemplateAudience || "").trim(),
    certificateType: String(requestData.requestType || "Certificado").trim(),
  };
}

function matchesPublicCertificateTemplate(template, requestData) {
  const targets = getPublicTemplateTargets(requestData);
  const templateType = template.certificateType || "Certificado";
  const typeMatches = certificateTemplateTextMatches(templateType, targets.certificateType);
  const audienceMatches = targets.audience
    ? certificateTemplateTextMatches(template.audience, targets.audience)
    : true;
  const levelMatches = targets.level
    ? certificateTemplateTextMatches(template.level, targets.level)
    : false;
  const hasComparableLevel = Boolean(
    targets.level && template.level && template.level !== "No aplica"
  );
  if (!typeMatches || !audienceMatches || (hasComparableLevel && !levelMatches)) return false;

  const programMatches = targets.programName
    ? certificateTemplateTextMatches(template.programName, targets.programName) ||
      certificateTemplateTextMatches(template.name, targets.programName) ||
      certificateTemplateTextMatches(
        `${template.level || ""} ${template.programName || ""}`,
        targets.programName
      )
    : false;

  return levelMatches || programMatches;
}

function getConfiguredTemplateId(settings = {}, requestData = {}) {
  const targets = getPublicTemplateTargets(requestData);
  const lookupKeys = [
    requestData.courseLevel,
    `${targets.certificateType}:${targets.audience}:${targets.level}`,
    `${targets.certificateType}:${targets.level}`,
    targets.level,
    targets.programName,
  ].filter(Boolean);
  const maps = [
    settings.defaultCertificateTemplateIds,
    settings.certificateTemplateDefaults,
    settings.defaultTemplateIds,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));

  for (const map of maps) {
    for (const key of lookupKeys) {
      const directValue = map[key];
      if (typeof directValue === "string" && directValue.trim()) return directValue.trim();
      const normalizedKey = Object.keys(map).find(
        (candidate) => normalizeTemplateMatchText(candidate) === normalizeTemplateMatchText(key)
      );
      const normalizedValue = normalizedKey ? map[normalizedKey] : "";
      if (typeof normalizedValue === "string" && normalizedValue.trim()) {
        return normalizedValue.trim();
      }
    }
  }

  const directDefault =
    settings.defaultCertificateTemplateId ||
    settings.defaultTemplateId ||
    "";
  return typeof directDefault === "string" ? directDefault.trim() : "";
}

function selectPublicCertificateTemplate(templates = [], requestData = {}, settings = {}) {
  const compatibleTemplates = templates.filter((template) =>
    template &&
    template.id &&
    template.active === true &&
    typeof template.name === "string" &&
    template.name.trim() &&
    matchesPublicCertificateTemplate(template, requestData)
  );

  if (compatibleTemplates.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      `No existe una plantilla activa compatible con ${requestData.courseLevel || requestData.level || "la solicitud"}.`
    );
  }
  if (compatibleTemplates.length === 1) return compatibleTemplates[0];

  const configuredTemplateId = getConfiguredTemplateId(settings, requestData);
  const configuredTemplate = compatibleTemplates.find(
    (template) => template.id === configuredTemplateId
  );
  if (configuredTemplate) return configuredTemplate;

  const defaults = compatibleTemplates.filter((template) =>
    template.defaultForPublicRequests === true ||
    template.isDefault === true ||
    template.default === true
  );
  if (defaults.length === 1) return defaults[0];

  throw new HttpsError(
    "failed-precondition",
    `Hay varias plantillas activas compatibles con ${requestData.courseLevel || requestData.level || "la solicitud"}; configura una como predeterminada en Imprenta.`
  );
}

function validatePublicCertificateTemplate(templateData, requestData) {
  const templateType = normalizeTemplateMatchText(templateData?.certificateType || "Certificado");
  const templateLevel = normalizeTemplateMatchText(templateData?.level);
  const requestLevel = normalizeTemplateMatchText(requestData?.level);
  const templateAudience = normalizeTemplateMatchText(templateData?.audience);
  const requestAudience = normalizeTemplateMatchText(requestData?.courseAudience);

  const requestType = normalizeTemplateMatchText(requestData?.requestType || "Certificado");

  if (templateType !== requestType) {
    invalidArgument("La plantilla resuelta no corresponde al tipo de documento solicitado.");
  }
  if (templateLevel && requestLevel && templateLevel !== requestLevel) {
    invalidArgument("La plantilla seleccionada no corresponde al nivel solicitado.");
  }
  if (templateAudience && requestAudience && templateAudience !== requestAudience) {
    invalidArgument("La plantilla seleccionada no corresponde al público solicitado.");
  }
  return true;
}

module.exports = {
  MAX_PUBLIC_STUDENTS,
  PRINT_REQUEST_CALLABLE_CORS,
  createLegacyPublicRequestId,
  createPublicRequestId,
  sanitizePublicPrintRequest,
  selectPublicCertificateTemplate,
  validatePublicCertificateTemplate,
  validatePublicSubmissionId,
};
