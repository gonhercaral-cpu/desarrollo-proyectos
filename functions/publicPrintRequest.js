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
    certificateTemplateId: payload?.certificateTemplateId,
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
    certificateTemplateId: sanitizeDocumentId(payload.certificateTemplateId, "Plantilla"),
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

module.exports = {
  MAX_PUBLIC_STUDENTS,
  PRINT_REQUEST_CALLABLE_CORS,
  createLegacyPublicRequestId,
  createPublicRequestId,
  sanitizePublicPrintRequest,
  validatePublicSubmissionId,
};
