import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";

const productCategories = [
  "Libro",
  "Certificado",
  "Diploma",
  "Volante",
  "Vinil",
  "Hoja de canciones",
  "Hoja de actividades",
  "Material interno",
  "Otro",
];

const productionTypes = [
  "Producto terminado",
  "Trabajo solicitado",
  "Documento generado",
  "Material interno",
];

const levels = ["No aplica", "A1", "A2", "B1", "B2", "C1", "Otro"];

const units = ["Pieza", "Libro", "Documento", "Paquete", "Hoja", "Metro", "Lote"];

const productFormInitialState = {
  name: "",
  category: "Libro",
  productionType: "Producto terminado",
  level: "No aplica",
  unit: "Pieza",
  minStock: 0,
  idealStock: 0,
  requiresPrinting: true,
  requiresBinding: false,
  requiresCutting: false,
  requiresQualityCheck: true,
  requiresSignature: false,
  requiresValidationQr: false,
  active: true,
  notes: "",
};

const inventoryFormInitialState = {
  productId: "",
  initialStock: 0,
  minStock: 0,
  idealStock: 0,
  notes: "",
};

const movementFormInitialState = {
  inventoryId: "",
  type: "Entrada",
  quantity: 1,
  reason: "Producción terminada",
  notes: "",
};

const movementReasons = [
  "Producción terminada",
  "Entrega a plantel",
  "Entrega a alumno",
  "Ajuste de inventario",
  "Reposición",
  "Daño o merma",
  "Otro",
];

const printRequestTypes = [
  "Certificado",
  "Diploma",
  "Volante",
  "Vinil",
  "Hoja de canciones",
  "Hoja de actividades",
  "Material interno",
  "Otro",
];

const printRequestStatuses = [
  "Solicitud recibida",
  "Datos incompletos",
  "En revisión",
  "Aprobada",
  "En producción",
  "En revisión de calidad",
  "Lista para entrega",
  "Entregada",
  "Cancelada",
];

const printRequestPriorities = ["Baja", "Normal", "Alta", "Urgente"];

const printDeliveryTypes = ["Impresa", "Digital", "Ambas"];

const studentDeliveryTypes = ["Impreso", "Digital", "Ambos"];

const studentStatuses = ["Pendiente", "Listo para generar", "Folio generado", "Generado", "Entregado", "Cancelado"];

const printCampuses = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
  "Otro",
];

const requestFormInitialState = {
  productId: "",
  requestType: "Volante",
  requesterName: "",
  requesterArea: "",
  campus: "Plaza Estrella",
  responsibleUid: "",
  responsibleName: "",
  responsibleEmail: "",
  priority: "Normal",
  requestedQuantity: 1,
  deliveredQuantity: 0,
  deliveryType: "Impresa",
  status: "Solicitud recibida",
  requestDate: "",
  dueDate: "",
  notes: "",
  level: "No aplica",
  group: "",
  teacherName: "",
  schedule: "",
  printedQuantity: 0,
  digitalQuantity: 0,
};

const productionBatchStatuses = [
  "Planeado",
  "En impresión",
  "En encuadernado",
  "En revisión de calidad",
  "Aprobado",
  "Ingresado a inventario",
  "Cerrado",
  "Cancelado",
];

const productionResponsibleStatuses = [
  "En impresión",
  "En encuadernado",
  "En revisión de calidad",
];

const qualityAuditorStatuses = [
  "En revisión de calidad",
  "Aprobado",
  "Cancelado",
];

const qualityStatuses = [
  "Pendiente",
  "En revisión",
  "Aprobado",
  "Aprobado con observaciones",
  "Rechazado",
];

const qualityChecklistItems = [
  { id: "cover", label: "Portada correcta" },
  { id: "level", label: "Nivel correcto" },
  { id: "pagesComplete", label: "Páginas completas" },
  { id: "pageOrder", label: "Orden correcto de páginas" },
  { id: "printQuality", label: "Impresión legible" },
  { id: "cleanPrint", label: "Sin manchas o líneas de impresión" },
  { id: "cutting", label: "Corte correcto" },
  { id: "binding", label: "Encuadernado firme" },
  { id: "quantityMatches", label: "Cantidad producida coincide con el lote" },
  { id: "approvedRejectedRegistered", label: "Cantidad aprobada y rechazada registrada" },
];

function getDefaultQualityChecklist() {
  return qualityChecklistItems.map((item) => ({
    ...item,
    checked: false,
  }));
}

const batchFormInitialState = {
  productId: "",
  plannedQuantity: 0,
  producedQuantity: 0,
  approvedQuantity: 0,
  rejectedQuantity: 0,
  status: "Planeado",
  responsible: "",
  responsibleUid: "",
  responsibleName: "",
  responsibleEmail: "",
  auditorUid: "",
  auditorName: "",
  auditorEmail: "",
  startDate: "",
  dueDate: "",
  notes: "",
  qualityStatus: "Pendiente",
  qualityChecklist: getDefaultQualityChecklist(),
  qualityNotes: "",
};

const basePrintProducts = [
  {
    name: "Journey A1",
    category: "Libro",
    productionType: "Producto terminado",
    level: "A1",
    unit: "Libro",
    minStock: 10,
    idealStock: 30,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Libro producido internamente para inventario terminado.",
  },
  {
    name: "Explore A2",
    category: "Libro",
    productionType: "Producto terminado",
    level: "A2",
    unit: "Libro",
    minStock: 10,
    idealStock: 30,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Libro producido internamente para inventario terminado.",
  },
  {
    name: "Discover B1",
    category: "Libro",
    productionType: "Producto terminado",
    level: "B1",
    unit: "Libro",
    minStock: 10,
    idealStock: 25,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Libro producido internamente para inventario terminado.",
  },
  {
    name: "B2",
    category: "Libro",
    productionType: "Producto terminado",
    level: "B2",
    unit: "Libro",
    minStock: 8,
    idealStock: 20,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Libro producido internamente para inventario terminado.",
  },
  {
    name: "New Horizons C1",
    category: "Libro",
    productionType: "Producto terminado",
    level: "C1",
    unit: "Libro",
    minStock: 8,
    idealStock: 20,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Libro producido internamente para inventario terminado.",
  },
  {
    name: "Certificado A1",
    category: "Certificado",
    productionType: "Documento generado",
    level: "A1",
    unit: "Documento",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: false,
    requiresQualityCheck: true,
    requiresSignature: true,
    requiresValidationQr: true,
    active: true,
    notes: "Documento generado con folio, firma y QR de validación.",
  },
  {
    name: "Certificado A2",
    category: "Certificado",
    productionType: "Documento generado",
    level: "A2",
    unit: "Documento",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: false,
    requiresQualityCheck: true,
    requiresSignature: true,
    requiresValidationQr: true,
    active: true,
    notes: "Documento generado con folio, firma y QR de validación.",
  },
  {
    name: "Diploma de finalización",
    category: "Diploma",
    productionType: "Documento generado",
    level: "No aplica",
    unit: "Documento",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: false,
    requiresQualityCheck: true,
    requiresSignature: true,
    requiresValidationQr: true,
    active: true,
    notes: "Diploma generado con folio, firma y QR de validación.",
  },
  {
    name: "Volante promocional",
    category: "Volante",
    productionType: "Trabajo solicitado",
    level: "No aplica",
    unit: "Pieza",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Trabajo solicitado por área o plantel.",
  },
  {
    name: "Vinil",
    category: "Vinil",
    productionType: "Trabajo solicitado",
    level: "No aplica",
    unit: "Metro",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Trabajo solicitado para corte, impresión o rotulación.",
  },
  {
    name: "Hoja de canciones",
    category: "Hoja de canciones",
    productionType: "Material interno",
    level: "No aplica",
    unit: "Hoja",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: false,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Material interno para clases o actividades académicas.",
  },
  {
    name: "Hoja de actividades",
    category: "Hoja de actividades",
    productionType: "Material interno",
    level: "No aplica",
    unit: "Hoja",
    minStock: 0,
    idealStock: 0,
    requiresPrinting: true,
    requiresBinding: false,
    requiresCutting: false,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    active: true,
    notes: "Material interno para clases o actividades académicas.",
  },
];

const metrics = [
  {
    label: "Solicitudes pendientes",
    value: "18",
    helper: "Trabajos por atender",
    icon: "▤",
    tone: "blue",
  },
  {
    label: "Lotes activos",
    value: "7",
    helper: "Producción en curso",
    icon: "▧",
    tone: "teal",
  },
  {
    label: "Libros con stock bajo",
    value: "3",
    helper: "Requieren reposición",
    icon: "▣",
    tone: "orange",
  },
  {
    label: "Listos para entrega",
    value: "12",
    helper: "Pendientes de salida",
    icon: "✓",
    tone: "green",
  },
  {
    label: "Insumos críticos",
    value: "4",
    helper: "Debajo del mínimo",
    icon: "!",
    tone: "red",
  },
  {
    label: "Merma del mes",
    value: "2.4%",
    helper: "Producción registrada",
    icon: "↗",
    tone: "purple",
  },
];

const requests = [
  {
    folio: "IMP-2026-0012",
    product: "Certificados A2",
    requester: "Dirección Académica",
    status: "En revisión",
    statusTone: "blue",
    delivery: "Hoy 5:00 pm",
  },
  {
    folio: "IMP-2026-0013",
    product: "Volantes",
    requester: "Recepción",
    status: "En producción",
    statusTone: "orange",
    delivery: "Mañana",
  },
  {
    folio: "IMP-2026-0014",
    product: "Vinil",
    requester: "Administración",
    status: "Lista para entrega",
    statusTone: "green",
    delivery: "Viernes",
  },
];

const batches = [
  {
    folio: "LOTE-JOURNEY-2026-001",
    product: "Journey A1",
    progress: 75,
    status: "En encuadernado",
    statusTone: "blue",
    quantity: "1,200 / 1,600",
  },
  {
    folio: "LOTE-EXPLORE-2026-002",
    product: "Explore A2",
    progress: 45,
    status: "En revisión de calidad",
    statusTone: "orange",
    quantity: "800 / 1,800",
  },
  {
    folio: "LOTE-DISCOVER-2026-003",
    product: "Discover B1",
    progress: 100,
    status: "Ingresado a inventario",
    statusTone: "green",
    quantity: "1,500 / 1,500",
  },
];

const finishedInventory = [
  {
    product: "Journey A1",
    stock: 8,
    minimum: 10,
    status: "Bajo",
    tone: "red",
  },
  {
    product: "Explore A2",
    stock: 12,
    minimum: 10,
    status: "OK",
    tone: "green",
  },
  {
    product: "Discover B1",
    stock: 5,
    minimum: 10,
    status: "Bajo",
    tone: "red",
  },
];

const criticalSupplies = [
  {
    icon: "▤",
    name: "Papel bond carta",
    spec: "75 g/m²",
    available: "3 resmas",
    minimum: "10 resmas",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "▥",
    name: "Opalina",
    spec: "225 g/m²",
    available: "2 paquetes",
    minimum: "5 paquetes",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "●",
    name: "Tinta Epson 544",
    spec: "Negra",
    available: "1 unidad",
    minimum: "4 unidades",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "▨",
    name: "Cartucho Canon PFI-120",
    spec: "Cyan",
    available: "2 unidades",
    minimum: "4 unidades",
    status: "Bajo",
    tone: "orange",
  },
];

const certificateStudents = [
  {
    name: "Ana López Martínez",
    delivery: "Impreso",
  },
  {
    name: "Carlos Ramírez Gómez",
    delivery: "Digital",
  },
  {
    name: "Mariana Torres Ruiz",
    delivery: "Ambos",
  },
];


function getRequestStatusTone(status) {
  if (status === "Cancelada" || status === "Datos incompletos") return "red";
  if (status === "Entregada") return "green";
  if (status === "Lista para entrega") return "teal";
  if (status === "En producción" || status === "En revisión de calidad") return "orange";
  if (status === "Aprobada" || status === "En revisión") return "blue";
  return "purple";
}

function getPriorityTone(priority) {
  if (priority === "Urgente") return "red";
  if (priority === "Alta") return "orange";
  if (priority === "Baja") return "teal";
  return "blue";
}

function buildRequestFolio(type) {
  const year = new Date().getFullYear();
  const typeCode = String(type || "IMP")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 12) || "IMP";
  const suffix = String(Date.now()).slice(-5);

  return `IMP-${typeCode}-${year}-${suffix}`;
}

function isRequestCertificateLike(requestType) {
  return requestType === "Certificado" || requestType === "Diploma";
}

function createStudentId() {
  return `student-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeRequestStudents(students) {
  if (!Array.isArray(students)) return [];

  return students
    .map((student) => ({
      id: student?.id || createStudentId(),
      name: String(student?.name || "").trim(),
      deliveryType: studentDeliveryTypes.includes(student?.deliveryType)
        ? student.deliveryType
        : "Impreso",
      status: studentStatuses.includes(student?.status) ? student.status : "Pendiente",
      certificateFolio: String(student?.certificateFolio || ""),
      validationCode: String(student?.validationCode || ""),
      validationUrl: String(student?.validationUrl || ""),
      qrDataUrl: String(student?.qrDataUrl || ""),
      qrGenerated: student?.qrGenerated === true,
      generatedAt: String(student?.generatedAt || ""),
      generatedByUid: String(student?.generatedByUid || ""),
      generatedByName: String(student?.generatedByName || ""),
      generatedByEmail: String(student?.generatedByEmail || ""),
    }))
    .filter((student) => student.name);
}

function getStudentDeliveryCounts(students) {
  const normalizedStudents = normalizeRequestStudents(students);

  return normalizedStudents.reduce(
    (totals, student) => {
      const deliveryType = student.deliveryType || "Impreso";

      totals.total += 1;

      if (deliveryType === "Impreso" || deliveryType === "Ambos") {
        totals.printed += 1;
      }

      if (deliveryType === "Digital" || deliveryType === "Ambos") {
        totals.digital += 1;
      }

      return totals;
    },
    { total: 0, printed: 0, digital: 0 }
  );
}

function getStudentValidationSummary(request) {
  const counts = getStudentDeliveryCounts(request?.students);
  const requestedQuantity = Number(request?.requestedQuantity || 0);
  const printedQuantity = Number(request?.printedQuantity || 0);
  const digitalQuantity = Number(request?.digitalQuantity || 0);

  return {
    ...counts,
    requestedQuantity,
    printedQuantity,
    digitalQuantity,
    totalMatches: counts.total === requestedQuantity,
    printedMatches: counts.printed === printedQuantity,
    digitalMatches: counts.digital === digitalQuantity,
  };
}

function sanitizeFolioSegment(value, fallback = "GEN") {
  const cleaned = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();

  return cleaned || fallback;
}

function getCertificatePrefix(requestType) {
  return requestType === "Diploma" ? "DIPL" : "CERT";
}

function buildCertificateStudentFolio(request, studentIndex) {
  const year = new Date().getFullYear();
  const prefix = getCertificatePrefix(request?.requestType);
  const levelCode = sanitizeFolioSegment(request?.level || "NA", "NA").slice(0, 8);
  const requestCode = sanitizeFolioSegment(request?.folio || request?.id || Date.now(), "REQ")
    .replace(/^IMP-?/, "")
    .slice(-10);
  const consecutive = String(studentIndex).padStart(3, "0");

  return `${prefix}-${year}-${levelCode}-${requestCode}-${consecutive}`;
}

function buildValidationCode(folio) {
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${folio}-${randomPart}`;
}

function buildValidationUrl(validationCode) {
  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "https://active-english-school.web.app";

  return `${origin}/validar-certificado/${encodeURIComponent(validationCode)}`;
}

function getRequestProductLabel(request) {
  if (!request) return "Solicitud";

  const baseName = request.productName || request.requestType || "Solicitud";

  if (isRequestCertificateLike(request.requestType) && request.level && request.level !== "No aplica") {
    return `${baseName} ${request.level}`;
  }

  return baseName;
}

function isRequestPending(status) {
  return [
    "Solicitud recibida",
    "Datos incompletos",
    "En revisión",
    "Aprobada",
    "En producción",
    "En revisión de calidad",
  ].includes(status);
}

function getRequestProgress(status) {
  const statusProgress = {
    "Solicitud recibida": 10,
    "Datos incompletos": 8,
    "En revisión": 25,
    Aprobada: 40,
    "En producción": 62,
    "En revisión de calidad": 78,
    "Lista para entrega": 90,
    Entregada: 100,
    Cancelada: 0,
  };

  return statusProgress[status] ?? 0;
}

function getRequestDueLabel(request) {
  if (!request?.dueDate) return "Sin compromiso";

  const date = new Date(`${request.dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return request.dueDate;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(date);
}

function getInventoryStatus(item) {
  const currentStock = Number(item?.currentStock || 0);
  const minStock = Number(item?.minStock || 0);
  const idealStock = Number(item?.idealStock || 0);

  if (currentStock <= 0) {
    return { label: "Crítico", tone: "red" };
  }

  if (minStock > 0 && currentStock < minStock) {
    return { label: "Bajo", tone: "orange" };
  }

  if (idealStock > 0 && currentStock >= idealStock) {
    return { label: "Óptimo", tone: "green" };
  }

  return { label: "Normal", tone: "blue" };
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}


function getBatchProgress(batch) {
  const statusProgress = {
    Planeado: 10,
    "En impresión": 35,
    "En encuadernado": 55,
    "En revisión de calidad": 75,
    Aprobado: 90,
    "Ingresado a inventario": 100,
    Cerrado: 100,
    Cancelado: 0,
  };

  return statusProgress[batch?.status] ?? 0;
}

function getBatchStatusTone(status) {
  if (status === "Cancelado") return "red";
  if (status === "Ingresado a inventario" || status === "Cerrado") return "green";
  if (status === "Aprobado" || status === "En revisión de calidad") return "orange";
  if (status === "En impresión" || status === "En encuadernado") return "blue";
  return "teal";
}

function getQualityStatusTone(status) {
  if (status === "Aprobado" || status === "Aprobado con observaciones") return "green";
  if (status === "Rechazado") return "red";
  if (status === "En revisión") return "orange";
  return "blue";
}

function normalizeBatchQualityChecklist(checklist) {
  const received = Array.isArray(checklist) ? checklist : [];

  return qualityChecklistItems.map((baseItem) => {
    const savedItem = received.find((item) => item?.id === baseItem.id);

    return {
      id: baseItem.id,
      label: baseItem.label,
      checked: savedItem?.checked === true,
    };
  });
}

function isQualityChecklistComplete(checklist) {
  const normalized = normalizeBatchQualityChecklist(checklist);
  return normalized.length > 0 && normalized.every((item) => item.checked === true);
}

function isBatchQualityApproved(batch) {
  const status = batch?.qualityStatus || "Pendiente";
  return (
    isQualityChecklistComplete(batch?.qualityChecklist) &&
    (status === "Aprobado" || status === "Aprobado con observaciones")
  );
}

function getUserDisplayName(person) {
  return (
    person?.name ||
    person?.displayName ||
    person?.fullName ||
    person?.email ||
    "Usuario sin nombre"
  );
}

function getUserEmail(person) {
  return person?.email || "";
}

function getUserUid(person) {
  return person?.uid || person?.id || "";
}

function isSameUid(a, b) {
  return Boolean(a) && Boolean(b) && String(a) === String(b);
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
}

function isSameText(a, b) {
  const first = normalizeComparable(a);
  const second = normalizeComparable(b);
  return Boolean(first) && Boolean(second) && first === second;
}

function toDateInputValue(value) {
  if (!value) return "";

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function isBatchInsideRange(batch, from, to) {
  if (!from && !to) return true;

  const batchDate =
    batch?.startDate ||
    batch?.createdAt ||
    batch?.updatedAt ||
    batch?.dueDate ||
    "";

  const dateValue = toDateInputValue(batchDate);

  if (!dateValue) return false;
  if (from && dateValue < from) return false;
  if (to && dateValue > to) return false;

  return true;
}

function buildBatchFolio(product) {
  const year = new Date().getFullYear();
  const productCode = String(product?.name || "LIBRO")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 18) || "LIBRO";
  const suffix = String(Date.now()).slice(-5);

  return `LOTE-${productCode}-${year}-${suffix}`;
}

export default function PrintShop() {
  const { user, profile, isAdmin } = useAuth();

  const [activeSection, setActiveSection] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [seedingProducts, setSeedingProducts] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [productForm, setProductForm] = useState(productFormInitialState);
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [typeFilter, setTypeFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Activos");
  const [formMessage, setFormMessage] = useState("");

  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryForm, setInventoryForm] = useState(inventoryFormInitialState);
  const [movementForm, setMovementForm] = useState(movementFormInitialState);
  const [savingInventory, setSavingInventory] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [movementMessage, setMovementMessage] = useState("");


  const [productionBatches, setProductionBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [batchesError, setBatchesError] = useState("");
  const [batchForm, setBatchForm] = useState(batchFormInitialState);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [closingBatchId, setClosingBatchId] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [batchSummaryFrom, setBatchSummaryFrom] = useState("");
  const [batchSummaryTo, setBatchSummaryTo] = useState("");

  const [printRequests, setPrintRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const [requestForm, setRequestForm] = useState(requestFormInitialState);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [savingRequest, setSavingRequest] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("Todos");
  const [requestTypeFilter, setRequestTypeFilter] = useState("Todos");
  const [requestPriorityFilter, setRequestPriorityFilter] = useState("Todas");
  const [studentName, setStudentName] = useState("");
  const [studentDeliveryType, setStudentDeliveryType] = useState("Impreso");
  const [bulkStudentsText, setBulkStudentsText] = useState("");
  const [bulkStudentsDeliveryType, setBulkStudentsDeliveryType] = useState("Impreso");
  const [savingStudents, setSavingStudents] = useState(false);
  const [generatingStudentId, setGeneratingStudentId] = useState(null);

  useEffect(() => {
    setStudentName("");
    setStudentDeliveryType("Impreso");
    setBulkStudentsText("");
    setBulkStudentsDeliveryType("Impreso");
  }, [selectedRequestId]);

  useEffect(() => {
    if (!isAdmin) {
      setActiveUsers([]);
      return undefined;
    }

    setLoadingUsers(true);
    setUsersError("");

    const usersQuery = query(collection(db, "users"), orderBy("name", "asc"));

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const nextUsers = snapshot.docs
          .map((userDoc) => ({
            id: userDoc.id,
            ...userDoc.data(),
          }))
          .filter((person) => person.active !== false && person.deleted !== true)
          .map((person) => ({
            ...person,
            uid: getUserUid(person),
            name: getUserDisplayName(person),
            email: getUserEmail(person),
          }));

        setActiveUsers(nextUsers);
        setLoadingUsers(false);
      },
      (error) => {
        console.error("No se pudo cargar la lista de usuarios:", error);
        setUsersError("No se pudo cargar la lista de responsables y auditores.");
        setLoadingUsers(false);
      }
    );

    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    setLoadingProducts(true);
    setProductsError("");

    const productsQuery = query(
      collection(db, "printProducts"),
      orderBy("name", "asc")
    );

    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const nextProducts = snapshot.docs.map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data(),
        }));

        setProducts(nextProducts);
        setLoadingProducts(false);
      },
      (error) => {
        console.error("No se pudo cargar el catálogo de imprenta:", error);
        setProductsError(
          "No se pudo cargar el catálogo. Revisa las reglas de Firestore o tu conexión."
        );
        setLoadingProducts(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setLoadingInventory(true);
    setInventoryError("");

    const inventoryQuery = query(
      collection(db, "printFinishedInventory"),
      orderBy("productName", "asc")
    );

    const unsubscribe = onSnapshot(
      inventoryQuery,
      (snapshot) => {
        const nextInventory = snapshot.docs.map((inventoryDoc) => ({
          id: inventoryDoc.id,
          ...inventoryDoc.data(),
        }));

        setInventoryItems(nextInventory);
        setLoadingInventory(false);
      },
      (error) => {
        console.error("No se pudo cargar el inventario terminado:", error);
        setInventoryError(
          "No se pudo cargar el inventario terminado. Revisa las reglas de Firestore."
        );
        setLoadingInventory(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const movementsQuery = query(
      collection(db, "printInventoryMovements"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      movementsQuery,
      (snapshot) => {
        const nextMovements = snapshot.docs.map((movementDoc) => ({
          id: movementDoc.id,
          ...movementDoc.data(),
        }));

        setInventoryMovements(nextMovements);
      },
      (error) => {
        console.error("No se pudo cargar el historial de inventario:", error);
        setInventoryError(
          "No se pudo cargar el historial de movimientos. Revisa las reglas de Firestore."
        );
      }
    );

    return () => unsubscribe();
  }, []);


  useEffect(() => {
    setLoadingBatches(true);
    setBatchesError("");

    const batchesQuery = query(
      collection(db, "printProductionBatches"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      batchesQuery,
      (snapshot) => {
        const nextBatches = snapshot.docs.map((batchDoc) => ({
          id: batchDoc.id,
          ...batchDoc.data(),
        }));

        setProductionBatches(nextBatches);
        setLoadingBatches(false);
      },
      (error) => {
        console.error("No se pudieron cargar los lotes de producción:", error);
        setBatchesError(
          "No se pudieron cargar los lotes de producción. Revisa las reglas de Firestore."
        );
        setLoadingBatches(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setLoadingRequests(true);
    setRequestsError("");

    const requestsQuery = query(
      collection(db, "printRequests"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const nextRequests = snapshot.docs.map((requestDoc) => ({
          id: requestDoc.id,
          ...requestDoc.data(),
        }));

        setPrintRequests(nextRequests);
        setLoadingRequests(false);
      },
      (error) => {
        console.error("No se pudieron cargar las solicitudes de imprenta:", error);
        setRequestsError(
          "No se pudieron cargar las solicitudes de imprenta. Revisa las reglas de Firestore."
        );
        setLoadingRequests(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const productStats = useMemo(() => {
    const activeProducts = products.filter((product) => product.active !== false);
    const inactiveProducts = products.filter((product) => product.active === false);
    const books = activeProducts.filter((product) => product.category === "Libro");
    const generatedDocuments = activeProducts.filter(
      (product) => product.productionType === "Documento generado"
    );

    return {
      total: products.length,
      active: activeProducts.length,
      inactive: inactiveProducts.length,
      books: books.length,
      generatedDocuments: generatedDocuments.length,
    };
  }, [products]);

  const inventoryStats = useMemo(() => {
    const activeInventory = inventoryItems.filter((item) => item.active !== false);
    const lowStock = activeInventory.filter((item) => {
      const currentStock = Number(item.currentStock || 0);
      const minStock = Number(item.minStock || 0);
      return minStock > 0 && currentStock < minStock;
    });
    const critical = activeInventory.filter(
      (item) => Number(item.currentStock || 0) <= 0
    );
    const totalStock = activeInventory.reduce(
      (sum, item) => sum + Number(item.currentStock || 0),
      0
    );

    return {
      total: activeInventory.length,
      lowStock: lowStock.length,
      critical: critical.length,
      totalStock,
    };
  }, [inventoryItems]);

  const inventoryProducts = useMemo(() => {
    return products.filter(
      (product) =>
        product.active !== false &&
        product.category === "Libro" &&
        product.productionType === "Producto terminado"
    );
  }, [products]);

  const productsWithoutInventory = useMemo(() => {
    const inventoryProductIds = new Set(
      inventoryItems.map((item) => item.productId).filter(Boolean)
    );

    return inventoryProducts.filter(
      (product) => !inventoryProductIds.has(product.id)
    );
  }, [inventoryProducts, inventoryItems]);


  const batchStats = useMemo(() => {
    const activeBatches = productionBatches.filter(
      (batch) =>
        !["Ingresado a inventario", "Cerrado", "Cancelado"].includes(batch.status)
    );
    const pendingInventory = productionBatches.filter(
      (batch) =>
        batch.status === "Aprobado" &&
        batch.inventoryApplied !== true &&
        Number(batch.approvedQuantity || 0) > 0
    );
    const completed = productionBatches.filter(
      (batch) => batch.inventoryApplied === true || batch.status === "Ingresado a inventario"
    );
    const cancelled = productionBatches.filter((batch) => batch.status === "Cancelado");

    return {
      total: productionBatches.length,
      active: activeBatches.length,
      pendingInventory: pendingInventory.length,
      completed: completed.length,
      cancelled: cancelled.length,
    };
  }, [productionBatches]);

  const requestStats = useMemo(() => {
    const pending = printRequests.filter((request) => isRequestPending(request.status)).length;
    const inProduction = printRequests.filter((request) => request.status === "En producción").length;
    const ready = printRequests.filter((request) => request.status === "Lista para entrega").length;
    const urgent = printRequests.filter(
      (request) => request.priority === "Urgente" && request.status !== "Entregada" && request.status !== "Cancelada"
    ).length;
    const delivered = printRequests.filter((request) => request.status === "Entregada").length;
    const cancelled = printRequests.filter((request) => request.status === "Cancelada").length;

    return {
      total: printRequests.length,
      pending,
      inProduction,
      ready,
      urgent,
      delivered,
      cancelled,
    };
  }, [printRequests]);

  const batchProductionSummary = useMemo(() => {
    const visibleBatches = productionBatches.filter((batch) =>
      isBatchInsideRange(batch, batchSummaryFrom, batchSummaryTo)
    );

    const planned = visibleBatches.reduce(
      (sum, batch) => sum + Number(batch.plannedQuantity || 0),
      0
    );
    const produced = visibleBatches.reduce(
      (sum, batch) => sum + Number(batch.producedQuantity || 0),
      0
    );
    const approved = visibleBatches.reduce(
      (sum, batch) => sum + Number(batch.approvedQuantity || 0),
      0
    );
    const rejected = visibleBatches.reduce(
      (sum, batch) => sum + Number(batch.rejectedQuantity || 0),
      0
    );
    const inventoryApplied = visibleBatches
      .filter((batch) => batch.inventoryApplied === true || batch.status === "Ingresado a inventario")
      .reduce((sum, batch) => sum + Number(batch.approvedQuantity || 0), 0);

    const rejectionRate = produced > 0 ? Math.round((rejected / produced) * 1000) / 10 : 0;

    return {
      count: visibleBatches.length,
      planned,
      produced,
      approved,
      rejected,
      inventoryApplied,
      rejectionRate,
    };
  }, [productionBatches, batchSummaryFrom, batchSummaryTo]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !normalizedSearch ||
        `${product.name || ""} ${product.category || ""} ${product.level || ""}`
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCategory =
        categoryFilter === "Todas" || product.category === categoryFilter;

      const matchesType =
        typeFilter === "Todos" || product.productionType === typeFilter;

      const matchesStatus =
        statusFilter === "Todos" ||
        (statusFilter === "Activos" && product.active !== false) ||
        (statusFilter === "Inactivos" && product.active === false);

      return matchesSearch && matchesCategory && matchesType && matchesStatus;
    });
  }, [products, productSearch, categoryFilter, typeFilter, statusFilter]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );


  const selectedBatch = useMemo(
    () => productionBatches.find((batch) => batch.id === selectedBatchId) || null,
    [productionBatches, selectedBatchId]
  );

  const filteredRequests = useMemo(() => {
    const normalizedSearch = requestSearch.trim().toLowerCase();

    return printRequests.filter((request) => {
      const matchesSearch =
        !normalizedSearch ||
        `${request.folio || ""} ${request.productName || ""} ${request.requestType || ""} ${request.requesterName || ""} ${request.requesterArea || ""}`
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesStatus =
        requestStatusFilter === "Todos" || request.status === requestStatusFilter;

      const matchesType =
        requestTypeFilter === "Todos" || request.requestType === requestTypeFilter;

      const matchesPriority =
        requestPriorityFilter === "Todas" || request.priority === requestPriorityFilter;

      return matchesSearch && matchesStatus && matchesType && matchesPriority;
    });
  }, [printRequests, requestSearch, requestStatusFilter, requestTypeFilter, requestPriorityFilter]);

  const selectedRequest = useMemo(
    () => printRequests.find((request) => request.id === selectedRequestId) || null,
    [printRequests, selectedRequestId]
  );

  function getAuditUser() {
    return {
      uid: user?.uid || profile?.uid || profile?.id || "",
      name: profile?.name || user?.displayName || "Usuario",
      email: profile?.email || user?.email || "",
    };
  }

  function findAssignableUser(uid) {
    return activeUsers.find((person) => isSameUid(person.uid, uid) || isSameUid(person.id, uid));
  }

  function isBatchResponsible(batch, auditUser = getAuditUser()) {
    if (!batch) return false;

    return (
      isSameUid(auditUser.uid, batch.responsibleUid) ||
      isSameText(auditUser.email, batch.responsibleEmail) ||
      isSameText(auditUser.name, batch.responsibleName) ||
      isSameText(auditUser.name, batch.responsible)
    );
  }

  function isBatchAuditor(batch, auditUser = getAuditUser()) {
    if (!batch) return false;

    return (
      isSameUid(auditUser.uid, batch.auditorUid) ||
      isSameText(auditUser.email, batch.auditorEmail) ||
      isSameText(auditUser.name, batch.auditorName)
    );
  }

  function canCurrentUserSendBatchToInventory(batch, auditUser = getAuditUser()) {
    if (!batch) return false;

    const inventoryReady =
      batch.inventoryApplied === true || batch.status === "Ingresado a inventario";

    return (
      (isAdmin || isBatchResponsible(batch, auditUser)) &&
      !inventoryReady &&
      batch.status !== "Cancelado"
    );
  }

  function getBatchUserRole(batch = selectedBatch) {
    const auditUser = getAuditUser();

    if (isAdmin) return "admin";
    if (isBatchResponsible(batch, auditUser)) return "responsible";
    if (isBatchAuditor(batch, auditUser)) return "auditor";

    return "viewer";
  }

  function canUserSaveCurrentBatch() {
    if (!selectedBatchId) return isAdmin;

    const role = getBatchUserRole();

    return role === "admin" || role === "responsible" || role === "auditor";
  }

  function isPrintRequestResponsible(request, auditUser = getAuditUser()) {
    if (!request) return false;

    return (
      isSameUid(auditUser.uid, request.responsibleUid) ||
      isSameText(auditUser.email, request.responsibleEmail) ||
      isSameText(auditUser.name, request.responsibleName)
    );
  }

  function canCurrentUserEditRequest(request = selectedRequest) {
    return isAdmin || isPrintRequestResponsible(request);
  }

  function handleRequestInputChange(event) {
    const { name, value } = event.target;

    setRequestMessage("");
    setRequestForm((current) => {
      if (name === "responsibleUid") {
        const selectedUser = findAssignableUser(value);

        return {
          ...current,
          responsibleUid: value,
          responsibleName: selectedUser ? getUserDisplayName(selectedUser) : "",
          responsibleEmail: selectedUser ? getUserEmail(selectedUser) : "",
        };
      }

      if (name === "productId") {
        const selectedProduct = products.find((product) => product.id === value);

        return {
          ...current,
          productId: value,
          requestType: selectedProduct?.category && printRequestTypes.includes(selectedProduct.category)
            ? selectedProduct.category
            : current.requestType,
          level: selectedProduct?.level || current.level,
        };
      }

      if (name === "requestType") {
        return {
          ...current,
          requestType: value,
          deliveryType: isRequestCertificateLike(value) ? "Ambas" : current.deliveryType,
        };
      }

      return {
        ...current,
        [name]: value,
      };
    });
  }

  function handleRequestNumberInputChange(event) {
    const { name, value } = event.target;
    const nextValue = Number(value);

    setRequestMessage("");
    setRequestForm((current) => ({
      ...current,
      [name]: Number.isNaN(nextValue) ? 0 : Math.max(0, nextValue),
    }));
  }

  function resetRequestForm() {
    setSelectedRequestId(null);
    setRequestForm(requestFormInitialState);
    setRequestMessage("");
    setStudentName("");
    setStudentDeliveryType("Impreso");
    setBulkStudentsText("");
    setBulkStudentsDeliveryType("Impreso");
  }

  function selectRequest(request) {
    setSelectedRequestId(request.id);
    setRequestMessage("");
    setRequestForm({
      productId: request.productId || "",
      requestType: request.requestType || "Volante",
      requesterName: request.requesterName || "",
      requesterArea: request.requesterArea || "",
      campus: request.campus || "Plaza Estrella",
      responsibleUid: request.responsibleUid || "",
      responsibleName: request.responsibleName || "",
      responsibleEmail: request.responsibleEmail || "",
      priority: request.priority || "Normal",
      requestedQuantity: Number(request.requestedQuantity || 0),
      deliveredQuantity: Number(request.deliveredQuantity || 0),
      deliveryType: request.deliveryType || "Impresa",
      status: request.status || "Solicitud recibida",
      requestDate: request.requestDate || "",
      dueDate: request.dueDate || "",
      notes: request.notes || "",
      level: request.level || "No aplica",
      group: request.group || "",
      teacherName: request.teacherName || "",
      schedule: request.schedule || "",
      printedQuantity: Number(request.printedQuantity || 0),
      digitalQuantity: Number(request.digitalQuantity || 0),
    });
  }

  async function savePrintRequest(event) {
    event.preventDefault();
    setRequestMessage("");

    const auditUser = getAuditUser();
    const currentRequest = selectedRequest;

    if (!selectedRequestId && !isAdmin) {
      setRequestMessage("Solo los administradores pueden crear solicitudes desde esta vista.");
      return;
    }

    if (selectedRequestId && !canCurrentUserEditRequest(currentRequest)) {
      setRequestMessage("No tienes permisos para modificar esta solicitud.");
      return;
    }

    const selectedProduct = products.find((product) => product.id === requestForm.productId);

    if (!selectedProduct) {
      setRequestMessage("Selecciona un producto o servicio del catálogo.");
      return;
    }

    const requestedQuantity = Number(requestForm.requestedQuantity || 0);
    const deliveredQuantity = Number(requestForm.deliveredQuantity || 0);
    const printedQuantity = Number(requestForm.printedQuantity || 0);
    const digitalQuantity = Number(requestForm.digitalQuantity || 0);

    if (requestedQuantity <= 0) {
      setRequestMessage("La cantidad solicitada debe ser mayor que cero.");
      return;
    }

    if (deliveredQuantity > requestedQuantity) {
      setRequestMessage("La cantidad entregada no puede ser mayor que la cantidad solicitada.");
      return;
    }

    if (isRequestCertificateLike(requestForm.requestType)) {
      if (printedQuantity + digitalQuantity !== requestedQuantity) {
        setRequestMessage("En certificados y diplomas, impresos + digitales debe coincidir con la cantidad solicitada.");
        return;
      }

      if (!requestForm.group.trim() || !requestForm.teacherName.trim() || !requestForm.schedule.trim()) {
        setRequestMessage("Para certificados o diplomas indica grupo, maestro y horario.");
        return;
      }
    }

    const basePayload = {
      productId: selectedProduct.id,
      productName: selectedProduct.name || "",
      requestType: requestForm.requestType,
      requesterName: requestForm.requesterName.trim(),
      requesterArea: requestForm.requesterArea.trim(),
      campus: requestForm.campus,
      responsibleUid: requestForm.responsibleUid || "",
      responsibleName: requestForm.responsibleName || "",
      responsibleEmail: requestForm.responsibleEmail || "",
      priority: requestForm.priority,
      requestedQuantity,
      deliveredQuantity,
      deliveryType: requestForm.deliveryType,
      status: requestForm.status,
      requestDate: requestForm.requestDate,
      dueDate: requestForm.dueDate,
      notes: requestForm.notes || "",
      level: requestForm.level || "No aplica",
      group: requestForm.group.trim(),
      teacherName: requestForm.teacherName.trim(),
      schedule: requestForm.schedule.trim(),
      printedQuantity,
      digitalQuantity,
      students: normalizeRequestStudents(currentRequest?.students || []),
      updatedAt: serverTimestamp(),
      updatedByUid: auditUser.uid,
      updatedByName: auditUser.name,
      updatedByEmail: auditUser.email,
    };

    try {
      setSavingRequest(true);

      if (selectedRequestId) {
        const payload = isAdmin
          ? basePayload
          : {
              status: basePayload.status,
              deliveredQuantity: basePayload.deliveredQuantity,
              notes: basePayload.notes,
              updatedAt: basePayload.updatedAt,
              updatedByUid: basePayload.updatedByUid,
              updatedByName: basePayload.updatedByName,
              updatedByEmail: basePayload.updatedByEmail,
            };

        await updateDoc(doc(db, "printRequests", selectedRequestId), payload);
        setRequestMessage("Solicitud actualizada correctamente.");
      } else {
        if (!requestForm.requesterName.trim() || !requestForm.requesterArea.trim()) {
          setRequestMessage("Indica solicitante y área solicitante.");
          setSavingRequest(false);
          return;
        }

        await addDoc(collection(db, "printRequests"), {
          ...basePayload,
          folio: buildRequestFolio(requestForm.requestType),
          createdAt: serverTimestamp(),
          createdByUid: auditUser.uid,
          createdByName: auditUser.name,
          createdByEmail: auditUser.email,
        });
        setRequestForm(requestFormInitialState);
        setRequestMessage("Solicitud creada correctamente.");
      }
    } catch (error) {
      console.error("No se pudo guardar la solicitud de imprenta:", error);
      setRequestMessage("No se pudo guardar la solicitud. Revisa las reglas de Firestore.");
    } finally {
      setSavingRequest(false);
    }
  }

  function canCurrentUserManageRequestStudents(request = selectedRequest) {
    return Boolean(
      request &&
      selectedRequestId &&
      isRequestCertificateLike(request.requestType) &&
      canCurrentUserEditRequest(request)
    );
  }

  async function updateSelectedRequestStudents(nextStudents, successMessage = "Lista de alumnos actualizada.") {
    const currentRequest = selectedRequest;

    if (!currentRequest || !selectedRequestId) {
      setRequestMessage("Selecciona primero una solicitud de certificado o diploma.");
      return;
    }

    if (!isRequestCertificateLike(currentRequest.requestType)) {
      setRequestMessage("La lista de alumnos solo aplica para certificados y diplomas.");
      return;
    }

    if (!canCurrentUserManageRequestStudents(currentRequest)) {
      setRequestMessage("No tienes permisos para modificar la lista de alumnos de esta solicitud.");
      return;
    }

    const auditUser = getAuditUser();
    const normalizedStudents = normalizeRequestStudents(nextStudents);

    try {
      setSavingStudents(true);
      setRequestMessage("");

      await updateDoc(doc(db, "printRequests", selectedRequestId), {
        students: normalizedStudents,
        updatedAt: serverTimestamp(),
        updatedByUid: auditUser.uid,
        updatedByName: auditUser.name,
        updatedByEmail: auditUser.email,
      });

      setRequestMessage(successMessage);
    } catch (error) {
      console.error("No se pudo actualizar la lista de alumnos:", error);
      setRequestMessage("No se pudo actualizar la lista de alumnos. Revisa las reglas de Firestore.");
    } finally {
      setSavingStudents(false);
    }
  }

  async function addSingleRequestStudent(event) {
    event.preventDefault();

    const cleanName = studentName.trim();

    if (!cleanName) {
      setRequestMessage("Escribe el nombre del alumno.");
      return;
    }

    const currentStudents = normalizeRequestStudents(selectedRequest?.students || []);
    const nextStudents = [
      ...currentStudents,
      {
        id: createStudentId(),
        name: cleanName,
        deliveryType: studentDeliveryType,
        status: "Pendiente",
      },
    ];

    await updateSelectedRequestStudents(nextStudents, "Alumno agregado correctamente.");
    setStudentName("");
  }

  async function addBulkRequestStudents(event) {
    event.preventDefault();

    const names = bulkStudentsText
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    if (names.length === 0) {
      setRequestMessage("Pega al menos un nombre de alumno.");
      return;
    }

    const currentStudents = normalizeRequestStudents(selectedRequest?.students || []);
    const nextStudents = [
      ...currentStudents,
      ...names.map((name) => ({
        id: createStudentId(),
        name,
        deliveryType: bulkStudentsDeliveryType,
        status: "Pendiente",
      })),
    ];

    await updateSelectedRequestStudents(nextStudents, `${names.length} alumnos agregados correctamente.`);
    setBulkStudentsText("");
  }

  async function updateRequestStudent(studentId, changes) {
    const currentStudents = normalizeRequestStudents(selectedRequest?.students || []);
    const nextStudents = currentStudents.map((student) => {
      if (student.id !== studentId) return student;

      return {
        ...student,
        ...changes,
        name: changes.name !== undefined ? String(changes.name || "").trim() : student.name,
      };
    });

    if (changes.name !== undefined && !String(changes.name || "").trim()) {
      setRequestMessage("El nombre del alumno no puede quedar vacío.");
      return;
    }

    await updateSelectedRequestStudents(nextStudents, "Alumno actualizado correctamente.");
  }

  async function deleteRequestStudent(studentId) {
    const currentStudents = normalizeRequestStudents(selectedRequest?.students || []);
    const nextStudents = currentStudents.filter((student) => student.id !== studentId);

    await updateSelectedRequestStudents(nextStudents, "Alumno eliminado correctamente.");
  }


  function validateStudentsReadyForFolios(request = selectedRequest) {
    if (!request || !selectedRequestId) {
      setRequestMessage("Selecciona primero una solicitud de certificado o diploma.");
      return false;
    }

    if (!isRequestCertificateLike(request.requestType)) {
      setRequestMessage("Los folios y QR solo aplican para certificados y diplomas.");
      return false;
    }

    if (!canCurrentUserManageRequestStudents(request)) {
      setRequestMessage("No tienes permisos para generar folios en esta solicitud.");
      return false;
    }

    const students = normalizeRequestStudents(request.students || []);

    if (students.length === 0) {
      setRequestMessage("Agrega primero la lista de alumnos.");
      return false;
    }

    const summary = getStudentValidationSummary(request);
    const listMatchesRequest =
      summary.totalMatches && summary.printedMatches && summary.digitalMatches;

    if (!listMatchesRequest) {
      setRequestMessage(
        "Antes de generar folios, revisa que el total de alumnos, impresos y digitales coincida con la solicitud."
      );
      return false;
    }

    return true;
  }

  async function buildStudentWithFolio(request, student, studentIndex, auditUser) {
    const certificateFolio = buildCertificateStudentFolio(request, studentIndex + 1);
    const validationCode = buildValidationCode(certificateFolio);
    const validationUrl = buildValidationUrl(validationCode);
    const qrDataUrl = await QRCode.toDataURL(validationUrl, {
      margin: 2,
      width: 180,
      errorCorrectionLevel: "M",
    });

    return {
      ...student,
      status: "Folio generado",
      certificateFolio,
      validationCode,
      validationUrl,
      qrDataUrl,
      qrGenerated: true,
      generatedAt: new Date().toISOString(),
      generatedByUid: auditUser.uid,
      generatedByName: auditUser.name,
      generatedByEmail: auditUser.email,
    };
  }

  async function generateStudentFolio(studentId) {
    const currentRequest = selectedRequest;

    if (!validateStudentsReadyForFolios(currentRequest)) return;

    const currentStudents = normalizeRequestStudents(currentRequest.students || []);
    const studentIndex = currentStudents.findIndex((student) => student.id === studentId);

    if (studentIndex < 0) {
      setRequestMessage("No se encontró el alumno seleccionado.");
      return;
    }

    if (currentStudents[studentIndex].certificateFolio) {
      setRequestMessage("Este alumno ya tiene folio y QR de validación.");
      return;
    }

    const auditUser = getAuditUser();

    try {
      setGeneratingStudentId(studentId);
      setRequestMessage("");

      const studentWithFolio = await buildStudentWithFolio(
        currentRequest,
        currentStudents[studentIndex],
        studentIndex,
        auditUser
      );

      const nextStudents = currentStudents.map((student) =>
        student.id === studentId ? studentWithFolio : student
      );

      await updateSelectedRequestStudents(nextStudents, "Folio y QR generados correctamente.");
    } catch (error) {
      console.error("No se pudo generar el folio/QR del alumno:", error);
      setRequestMessage("No se pudo generar el folio y QR. Revisa que la librería qrcode esté instalada correctamente.");
    } finally {
      setGeneratingStudentId(null);
    }
  }

  async function generateAllStudentFolios() {
    const currentRequest = selectedRequest;

    if (!validateStudentsReadyForFolios(currentRequest)) return;

    const currentStudents = normalizeRequestStudents(currentRequest.students || []);
    const pendingStudents = currentStudents.filter((student) => !student.certificateFolio);

    if (pendingStudents.length === 0) {
      setRequestMessage("Todos los alumnos ya tienen folio y QR de validación.");
      return;
    }

    const auditUser = getAuditUser();

    try {
      setGeneratingStudentId("all");
      setRequestMessage("");

      const nextStudents = [];

      for (let index = 0; index < currentStudents.length; index += 1) {
        const student = currentStudents[index];

        if (student.certificateFolio) {
          nextStudents.push(student);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const studentWithFolio = await buildStudentWithFolio(
            currentRequest,
            student,
            index,
            auditUser
          );
          nextStudents.push(studentWithFolio);
        }
      }

      await updateSelectedRequestStudents(
        nextStudents,
        `${pendingStudents.length} folios y QR generados correctamente.`
      );
    } catch (error) {
      console.error("No se pudieron generar los folios/QR:", error);
      setRequestMessage("No se pudieron generar los folios y QR. Revisa que la librería qrcode esté instalada correctamente.");
    } finally {
      setGeneratingStudentId(null);
    }
  }

  function handleProductInputChange(event) {
    const { name, value, type, checked } = event.target;

    setProductForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleNumberInputChange(event) {
    const { name, value } = event.target;
    const nextValue = Number(value);

    setProductForm((current) => ({
      ...current,
      [name]: Number.isNaN(nextValue) ? 0 : Math.max(0, nextValue),
    }));
  }

  function resetProductForm() {
    setSelectedProductId(null);
    setProductForm(productFormInitialState);
    setFormMessage("");
  }

  function selectProduct(product) {
    setSelectedProductId(product.id);
    setFormMessage("");
    setProductForm({
      name: product.name || "",
      category: product.category || "Libro",
      productionType: product.productionType || "Producto terminado",
      level: product.level || "No aplica",
      unit: product.unit || "Pieza",
      minStock: Number(product.minStock || 0),
      idealStock: Number(product.idealStock || 0),
      requiresPrinting: product.requiresPrinting !== false,
      requiresBinding: product.requiresBinding === true,
      requiresCutting: product.requiresCutting === true,
      requiresQualityCheck: product.requiresQualityCheck !== false,
      requiresSignature: product.requiresSignature === true,
      requiresValidationQr: product.requiresValidationQr === true,
      active: product.active !== false,
      notes: product.notes || "",
    });
  }

  async function saveProduct(event) {
    event.preventDefault();
    setFormMessage("");

    const trimmedName = productForm.name.trim();

    if (!trimmedName) {
      setFormMessage("Escribe el nombre del producto antes de guardar.");
      return;
    }

    if (Number(productForm.idealStock) < Number(productForm.minStock)) {
      setFormMessage("El stock ideal no puede ser menor que el stock mínimo.");
      return;
    }

    const auditUser = getAuditUser();
    const payload = {
      ...productForm,
      name: trimmedName,
      minStock: Number(productForm.minStock || 0),
      idealStock: Number(productForm.idealStock || 0),
      updatedAt: serverTimestamp(),
      updatedByUid: auditUser.uid,
      updatedByName: auditUser.name,
      updatedByEmail: auditUser.email,
    };

    try {
      setSavingProduct(true);

      if (selectedProductId) {
        await updateDoc(doc(db, "printProducts", selectedProductId), payload);
        setFormMessage("Producto actualizado correctamente.");
      } else {
        await addDoc(collection(db, "printProducts"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: auditUser.uid,
          createdByName: auditUser.name,
          createdByEmail: auditUser.email,
        });
        setProductForm(productFormInitialState);
        setFormMessage("Producto agregado correctamente.");
      }
    } catch (error) {
      console.error("No se pudo guardar el producto de imprenta:", error);
      setFormMessage(
        "No se pudo guardar. Revisa que hayas publicado las reglas nuevas de Firestore."
      );
    } finally {
      setSavingProduct(false);
    }
  }

  async function toggleProductStatus(product) {
    if (!product?.id) return;

    const auditUser = getAuditUser();

    try {
      await updateDoc(doc(db, "printProducts", product.id), {
        active: product.active === false,
        updatedAt: serverTimestamp(),
        updatedByUid: auditUser.uid,
        updatedByName: auditUser.name,
        updatedByEmail: auditUser.email,
      });
    } catch (error) {
      console.error("No se pudo cambiar el estado del producto:", error);
      setProductsError(
        "No se pudo cambiar el estado del producto. Revisa permisos de Firestore."
      );
    }
  }

  async function seedBaseProducts() {
    if (!isAdmin || products.length > 0) return;

    const auditUser = getAuditUser();
    const batch = writeBatch(db);

    basePrintProducts.forEach((product) => {
      const productRef = doc(collection(db, "printProducts"));
      batch.set(productRef, {
        ...product,
        createdAt: serverTimestamp(),
        createdByUid: auditUser.uid,
        createdByName: auditUser.name,
        createdByEmail: auditUser.email,
        updatedAt: serverTimestamp(),
        updatedByUid: auditUser.uid,
        updatedByName: auditUser.name,
        updatedByEmail: auditUser.email,
      });
    });

    try {
      setSeedingProducts(true);
      await batch.commit();
      setFormMessage("Productos base cargados correctamente.");
    } catch (error) {
      console.error("No se pudieron cargar los productos base:", error);
      setFormMessage(
        "No se pudieron cargar los productos base. Publica primero las reglas nuevas de Firestore."
      );
    } finally {
      setSeedingProducts(false);
    }
  }

  function handleInventoryInputChange(event) {
    const { name, value } = event.target;

    setInventoryMessage("");

    setInventoryForm((current) => {
      const nextForm = {
        ...current,
        [name]: value,
      };

      if (name === "productId") {
        const selectedProduct = products.find((product) => product.id === value);

        if (selectedProduct) {
          nextForm.minStock = Number(selectedProduct.minStock || 0);
          nextForm.idealStock = Number(selectedProduct.idealStock || 0);
        }
      }

      return nextForm;
    });
  }

  function handleInventoryNumberInputChange(event) {
    const { name, value } = event.target;
    const nextValue = Number(value);

    setInventoryMessage("");

    setInventoryForm((current) => ({
      ...current,
      [name]: Number.isNaN(nextValue) ? 0 : Math.max(0, nextValue),
    }));
  }

  function resetInventoryForm() {
    setInventoryForm(inventoryFormInitialState);
    setInventoryMessage("");
  }

  function handleMovementInputChange(event) {
    const { name, value } = event.target;

    setMovementMessage("");
    setMovementForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleMovementNumberInputChange(event) {
    const { name, value } = event.target;
    const nextValue = Number(value);

    setMovementMessage("");
    setMovementForm((current) => ({
      ...current,
      [name]: Number.isNaN(nextValue) ? 1 : Math.max(1, nextValue),
    }));
  }

  function prepareMovement(item, type = "Entrada") {
    setActiveSection("inventory");
    setMovementForm((current) => ({
      ...current,
      inventoryId: item.id,
      type,
      reason: type === "Entrada" ? "Producción terminada" : "Entrega a plantel",
      quantity: 1,
      notes: "",
    }));
    setMovementMessage(
      `Se preparó una ${type.toLowerCase()} para ${item.productName}. Revisa la cantidad y el motivo, luego presiona “Registrar movimiento”.`
    );

    window.setTimeout(() => {
      const movementPanel = document.getElementById("printshop-movement-panel");
      const quantityInput = document.getElementById("printshop-movement-quantity");

      if (movementPanel) {
        movementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      if (quantityInput) {
        quantityInput.focus();
        quantityInput.select();
      }
    }, 80);
  }

  async function createInventoryItem(event) {
    event.preventDefault();
    setInventoryMessage("");

    if (!isAdmin) {
      setInventoryMessage("Solo los administradores pueden crear inventario.");
      return;
    }

    if (!inventoryForm.productId) {
      setInventoryMessage("Selecciona un producto del catálogo.");
      return;
    }

    if (Number(inventoryForm.idealStock) < Number(inventoryForm.minStock)) {
      setInventoryMessage("El stock ideal no puede ser menor que el stock mínimo.");
      return;
    }

    const selectedProduct = products.find(
      (product) => product.id === inventoryForm.productId
    );

    if (!selectedProduct) {
      setInventoryMessage("No se encontró el producto seleccionado.");
      return;
    }

    const alreadyExists = inventoryItems.some(
      (item) => item.productId === selectedProduct.id
    );

    if (alreadyExists) {
      setInventoryMessage("Este producto ya tiene inventario registrado.");
      return;
    }

    const initialStock = Number(inventoryForm.initialStock || 0);
    const minStock = Number(inventoryForm.minStock || 0);
    const idealStock = Number(inventoryForm.idealStock || 0);
    const auditUser = getAuditUser();

    const inventoryRef = doc(collection(db, "printFinishedInventory"));
    const batch = writeBatch(db);

    batch.set(inventoryRef, {
      productId: selectedProduct.id,
      productName: selectedProduct.name || "",
      category: selectedProduct.category || "Libro",
      level: selectedProduct.level || "No aplica",
      unit: selectedProduct.unit || "Pieza",
      currentStock: initialStock,
      minStock,
      idealStock,
      active: true,
      notes: inventoryForm.notes || "",
      createdAt: serverTimestamp(),
      createdByUid: auditUser.uid,
      createdByName: auditUser.name,
      createdByEmail: auditUser.email,
      updatedAt: serverTimestamp(),
      updatedByUid: auditUser.uid,
      updatedByName: auditUser.name,
      updatedByEmail: auditUser.email,
    });

    if (initialStock > 0) {
      const movementRef = doc(collection(db, "printInventoryMovements"));
      batch.set(movementRef, {
        inventoryId: inventoryRef.id,
        productId: selectedProduct.id,
        productName: selectedProduct.name || "",
        type: "Entrada",
        quantity: initialStock,
        reason: "Stock inicial",
        previousStock: 0,
        newStock: initialStock,
        notes: inventoryForm.notes || "Alta inicial de inventario terminado.",
        createdAt: serverTimestamp(),
        createdByUid: auditUser.uid,
        createdByName: auditUser.name,
        createdByEmail: auditUser.email,
      });
    }

    try {
      setSavingInventory(true);
      await batch.commit();
      setInventoryForm(inventoryFormInitialState);
      setInventoryMessage("Inventario creado correctamente.");
    } catch (error) {
      console.error("No se pudo crear el inventario terminado:", error);
      setInventoryMessage(
        "No se pudo crear el inventario. Revisa que hayas publicado las reglas nuevas de Firestore."
      );
    } finally {
      setSavingInventory(false);
    }
  }

  async function registerInventoryMovement(event) {
    event.preventDefault();
    setMovementMessage("");

    if (!isAdmin) {
      setMovementMessage("Solo los administradores pueden registrar movimientos.");
      return;
    }

    if (!movementForm.inventoryId) {
      setMovementMessage("Selecciona un producto del inventario.");
      return;
    }

    const quantity = Number(movementForm.quantity || 0);

    if (quantity <= 0) {
      setMovementMessage("La cantidad debe ser mayor que cero.");
      return;
    }

    const auditUser = getAuditUser();
    const inventoryRef = doc(db, "printFinishedInventory", movementForm.inventoryId);
    const movementRef = doc(collection(db, "printInventoryMovements"));

    try {
      setSavingMovement(true);

      await runTransaction(db, async (transaction) => {
        const inventorySnapshot = await transaction.get(inventoryRef);

        if (!inventorySnapshot.exists()) {
          throw new Error("No se encontró el inventario seleccionado.");
        }

        const inventoryData = inventorySnapshot.data();
        const previousStock = Number(inventoryData.currentStock || 0);
        const newStock =
          movementForm.type === "Entrada"
            ? previousStock + quantity
            : previousStock - quantity;

        if (newStock < 0) {
          throw new Error("No puedes registrar una salida mayor al stock disponible.");
        }

        transaction.update(inventoryRef, {
          currentStock: newStock,
          updatedAt: serverTimestamp(),
          updatedByUid: auditUser.uid,
          updatedByName: auditUser.name,
          updatedByEmail: auditUser.email,
        });

        transaction.set(movementRef, {
          inventoryId: movementForm.inventoryId,
          productId: inventoryData.productId || "",
          productName: inventoryData.productName || "",
          type: movementForm.type,
          quantity,
          reason: movementForm.reason || "Ajuste de inventario",
          previousStock,
          newStock,
          notes: movementForm.notes || "",
          createdAt: serverTimestamp(),
          createdByUid: auditUser.uid,
          createdByName: auditUser.name,
          createdByEmail: auditUser.email,
        });
      });

      setMovementForm(movementFormInitialState);
      setMovementMessage("Movimiento registrado correctamente.");
    } catch (error) {
      console.error("No se pudo registrar el movimiento:", error);
      setMovementMessage(
        error?.message ||
          "No se pudo registrar el movimiento. Revisa reglas de Firestore."
      );
    } finally {
      setSavingMovement(false);
    }
  }


  function handleBatchInputChange(event) {
    const { name, value } = event.target;

    setBatchMessage("");
    setBatchForm((current) => {
      if (name === "responsibleUid") {
        const selectedUser = findAssignableUser(value);

        return {
          ...current,
          responsibleUid: value,
          responsibleName: selectedUser ? getUserDisplayName(selectedUser) : "",
          responsibleEmail: selectedUser ? getUserEmail(selectedUser) : "",
          responsible: selectedUser ? getUserDisplayName(selectedUser) : "",
        };
      }

      if (name === "auditorUid") {
        const selectedUser = findAssignableUser(value);

        return {
          ...current,
          auditorUid: value,
          auditorName: selectedUser ? getUserDisplayName(selectedUser) : "",
          auditorEmail: selectedUser ? getUserEmail(selectedUser) : "",
        };
      }

      return {
        ...current,
        [name]: value,
      };
    });
  }

  function handleBatchNumberInputChange(event) {
    const { name, value } = event.target;
    const nextValue = Number(value);

    setBatchMessage("");
    setBatchForm((current) => ({
      ...current,
      [name]: Number.isNaN(nextValue) ? 0 : Math.max(0, nextValue),
    }));
  }

  function handleQualityChecklistToggle(itemId) {
    setBatchMessage("");
    setBatchForm((current) => ({
      ...current,
      qualityChecklist: normalizeBatchQualityChecklist(current.qualityChecklist).map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      ),
    }));
  }

  function resetBatchForm() {
    setSelectedBatchId(null);
    setBatchForm(batchFormInitialState);
    setBatchMessage("");
  }

  function selectBatch(batch) {
    setSelectedBatchId(batch.id);
    setBatchMessage("");
    setBatchForm({
      productId: batch.productId || "",
      plannedQuantity: Number(batch.plannedQuantity || 0),
      producedQuantity: Number(batch.producedQuantity || 0),
      approvedQuantity: Number(batch.approvedQuantity || 0),
      rejectedQuantity: Number(batch.rejectedQuantity || 0),
      status: batch.status || "Planeado",
      responsible: batch.responsible || batch.responsibleName || "",
      responsibleUid: batch.responsibleUid || "",
      responsibleName: batch.responsibleName || batch.responsible || "",
      responsibleEmail: batch.responsibleEmail || "",
      auditorUid: batch.auditorUid || "",
      auditorName: batch.auditorName || "",
      auditorEmail: batch.auditorEmail || "",
      startDate: batch.startDate || "",
      dueDate: batch.dueDate || "",
      notes: batch.notes || "",
      qualityStatus: batch.qualityStatus || "Pendiente",
      qualityChecklist: normalizeBatchQualityChecklist(batch.qualityChecklist),
      qualityNotes: batch.qualityNotes || "",
    });
  }

  async function saveProductionBatch(event) {
    event.preventDefault();
    setBatchMessage("");

    const role = getBatchUserRole();
    const auditUser = getAuditUser();

    if (!selectedBatchId && !isAdmin) {
      setBatchMessage("Solo los administradores pueden crear nuevos lotes.");
      return;
    }

    if (selectedBatchId && !canUserSaveCurrentBatch()) {
      setBatchMessage("No tienes permisos para modificar este lote.");
      return;
    }

    if (!batchForm.productId) {
      setBatchMessage("Selecciona un producto del catálogo para el lote.");
      return;
    }

    const selectedProduct = products.find((product) => product.id === batchForm.productId);

    if (!selectedProduct) {
      setBatchMessage("No se encontró el producto seleccionado.");
      return;
    }

    const plannedQuantity = Number(batchForm.plannedQuantity || 0);
    const producedQuantity = Number(batchForm.producedQuantity || 0);
    const approvedQuantity = Number(batchForm.approvedQuantity || 0);
    const rejectedQuantity = Number(batchForm.rejectedQuantity || 0);

    if (plannedQuantity <= 0) {
      setBatchMessage("La cantidad planeada debe ser mayor que cero.");
      return;
    }

    if (approvedQuantity + rejectedQuantity > producedQuantity) {
      setBatchMessage("La suma de aprobados y rechazados no puede ser mayor que la cantidad producida.");
      return;
    }

    const normalizedQualityChecklist = normalizeBatchQualityChecklist(batchForm.qualityChecklist);
    const qualityStatus = batchForm.qualityStatus || "Pendiente";
    const qualityCompleted =
      isQualityChecklistComplete(normalizedQualityChecklist) &&
      (qualityStatus === "Aprobado" || qualityStatus === "Aprobado con observaciones");
    const requiresApprovedQuality = ["Aprobado", "Ingresado a inventario", "Cerrado"].includes(
      batchForm.status
    );

    if (requiresApprovedQuality && !qualityCompleted) {
      setBatchMessage(
        "Antes de aprobar, cerrar o ingresar este lote al inventario, completa y aprueba la revisión de calidad."
      );
      return;
    }

    if (!isAdmin && role === "responsible") {
      if (!productionResponsibleStatuses.includes(batchForm.status)) {
        setBatchMessage(
          "El responsable de producción solo puede mover el lote a En impresión, En encuadernado o En revisión de calidad."
        );
        return;
      }

      const payload = {
        status: batchForm.status,
        producedQuantity,
        notes: batchForm.notes || "",
        updatedAt: serverTimestamp(),
        updatedByUid: auditUser.uid,
        updatedByName: auditUser.name,
        updatedByEmail: auditUser.email,
      };

      try {
        setSavingBatch(true);
        await updateDoc(doc(db, "printProductionBatches", selectedBatchId), payload);
        setBatchMessage("Avance de producción actualizado correctamente.");
      } catch (error) {
        console.error("No se pudo guardar el avance de producción:", error);
        setBatchMessage("No se pudo guardar el avance. Revisa permisos de Firestore.");
      } finally {
        setSavingBatch(false);
      }

      return;
    }

    if (!isAdmin && role === "auditor") {
      if (!qualityAuditorStatuses.includes(batchForm.status)) {
        setBatchMessage(
          "El auditor solo puede trabajar el lote en revisión de calidad, aprobado o cancelado."
        );
        return;
      }

      if (batchForm.status === "Aprobado" && !qualityCompleted) {
        setBatchMessage("Para aprobar el lote, completa el checklist y marca la calidad como aprobada.");
        return;
      }

      const payload = {
        status: batchForm.status,
        approvedQuantity,
        rejectedQuantity,
        qualityChecklist: normalizedQualityChecklist,
        qualityStatus,
        qualityNotes: batchForm.qualityNotes || "",
        qualityCompleted,
        qualityReviewedAt: qualityCompleted ? serverTimestamp() : selectedBatch?.qualityReviewedAt || null,
        qualityReviewedByUid: qualityCompleted ? auditUser.uid : selectedBatch?.qualityReviewedByUid || "",
        qualityReviewedByName: qualityCompleted ? auditUser.name : selectedBatch?.qualityReviewedByName || "",
        qualityReviewedByEmail: qualityCompleted ? auditUser.email : selectedBatch?.qualityReviewedByEmail || "",
        updatedAt: serverTimestamp(),
        updatedByUid: auditUser.uid,
        updatedByName: auditUser.name,
        updatedByEmail: auditUser.email,
      };

      try {
        setSavingBatch(true);
        await updateDoc(doc(db, "printProductionBatches", selectedBatchId), payload);
        setBatchMessage("Revisión de calidad actualizada correctamente.");
      } catch (error) {
        console.error("No se pudo guardar la revisión de calidad:", error);
        setBatchMessage("No se pudo guardar la revisión. Revisa permisos de Firestore.");
      } finally {
        setSavingBatch(false);
      }

      return;
    }

    const responsibleUser = findAssignableUser(batchForm.responsibleUid);
    const auditorUser = findAssignableUser(batchForm.auditorUid);

    const payload = {
      folio: selectedBatch?.folio || buildBatchFolio(selectedProduct),
      productId: selectedProduct.id,
      productName: selectedProduct.name || "",
      category: selectedProduct.category || "Libro",
      level: selectedProduct.level || "No aplica",
      unit: selectedProduct.unit || "Libro",
      plannedQuantity,
      producedQuantity,
      approvedQuantity,
      rejectedQuantity,
      status: batchForm.status || "Planeado",
      responsible: batchForm.responsibleName || batchForm.responsible || "",
      responsibleUid: batchForm.responsibleUid || "",
      responsibleName: responsibleUser
        ? getUserDisplayName(responsibleUser)
        : batchForm.responsibleName || batchForm.responsible || "",
      responsibleEmail: responsibleUser
        ? getUserEmail(responsibleUser)
        : batchForm.responsibleEmail || "",
      auditorUid: batchForm.auditorUid || "",
      auditorName: auditorUser
        ? getUserDisplayName(auditorUser)
        : batchForm.auditorName || "",
      auditorEmail: auditorUser
        ? getUserEmail(auditorUser)
        : batchForm.auditorEmail || "",
      startDate: batchForm.startDate || "",
      dueDate: batchForm.dueDate || "",
      notes: batchForm.notes || "",
      qualityChecklist: normalizedQualityChecklist,
      qualityStatus,
      qualityNotes: batchForm.qualityNotes || "",
      qualityCompleted,
      qualityReviewedAt: qualityCompleted ? serverTimestamp() : selectedBatch?.qualityReviewedAt || null,
      qualityReviewedByUid: qualityCompleted ? auditUser.uid : selectedBatch?.qualityReviewedByUid || "",
      qualityReviewedByName: qualityCompleted ? auditUser.name : selectedBatch?.qualityReviewedByName || "",
      qualityReviewedByEmail: qualityCompleted ? auditUser.email : selectedBatch?.qualityReviewedByEmail || "",
      inventoryApplied: selectedBatch?.inventoryApplied === true,
      inventoryId: selectedBatch?.inventoryId || "",
      inventoryMovementId: selectedBatch?.inventoryMovementId || "",
      updatedAt: serverTimestamp(),
      updatedByUid: auditUser.uid,
      updatedByName: auditUser.name,
      updatedByEmail: auditUser.email,
    };

    if (!payload.responsibleUid) {
      setBatchMessage("Selecciona un responsable de producción.");
      return;
    }

    if (!payload.auditorUid) {
      setBatchMessage("Selecciona un auditor de calidad.");
      return;
    }

    if (payload.responsibleUid === payload.auditorUid) {
      setBatchMessage("El responsable de producción y el auditor deben ser personas diferentes.");
      return;
    }

    try {
      setSavingBatch(true);

      if (selectedBatchId) {
        await updateDoc(doc(db, "printProductionBatches", selectedBatchId), payload);
        setBatchMessage("Lote actualizado correctamente.");
      } else {
        await addDoc(collection(db, "printProductionBatches"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: auditUser.uid,
          createdByName: auditUser.name,
          createdByEmail: auditUser.email,
        });
        setBatchForm(batchFormInitialState);
        setBatchMessage("Lote creado correctamente.");
      }
    } catch (error) {
      console.error("No se pudo guardar el lote de producción:", error);
      setBatchMessage(
        "No se pudo guardar el lote. Revisa que hayas publicado las reglas nuevas de Firestore."
      );
    } finally {
      setSavingBatch(false);
    }
  }

  async function sendBatchToInventory(batch) {
    if (!batch?.id) return;

    setBatchMessage("");

    const auditUser = getAuditUser();

    if (!canCurrentUserSendBatchToInventory(batch, auditUser)) {
      setBatchMessage(
        "Solo el responsable asignado o un administrador puede ingresar el lote al inventario, y el lote no debe estar cancelado ni ingresado previamente."
      );
      return;
    }

    if (batch.inventoryApplied === true || batch.status === "Ingresado a inventario") {
      setBatchMessage("Este lote ya fue ingresado al inventario.");
      return;
    }

    const approvedQuantity = Number(batch.approvedQuantity || 0);

    if (approvedQuantity <= 0) {
      setBatchMessage("Para ingresar un lote al inventario, primero registra cantidad aprobada.");
      return;
    }

    if (!isBatchQualityApproved(batch)) {
      setBatchMessage(
        "Antes de ingresar este lote al inventario, completa el checklist y marca la revisión de calidad como aprobada."
      );
      return;
    }

    const inventoryItem = inventoryItems.find(
      (item) => item.productId === batch.productId && item.active !== false
    );

    if (!inventoryItem) {
      setBatchMessage(
        "Este producto todavía no tiene inventario terminado. Primero créalo en la pestaña Inventario terminado."
      );
      return;
    }

    const batchRef = doc(db, "printProductionBatches", batch.id);
    const inventoryRef = doc(db, "printFinishedInventory", inventoryItem.id);
    const movementRef = doc(collection(db, "printInventoryMovements"));

    try {
      setClosingBatchId(batch.id);

      await runTransaction(db, async (transaction) => {
        const inventorySnapshot = await transaction.get(inventoryRef);
        const batchSnapshot = await transaction.get(batchRef);

        if (!inventorySnapshot.exists()) {
          throw new Error("No se encontró el inventario terminado para este producto.");
        }

        if (!batchSnapshot.exists()) {
          throw new Error("No se encontró el lote de producción.");
        }

        const batchData = batchSnapshot.data();

        if (batchData.inventoryApplied === true) {
          throw new Error("Este lote ya fue ingresado al inventario.");
        }

        if (!isAdmin && !isBatchResponsible(batchData, auditUser)) {
          throw new Error("Solo el responsable asignado puede ingresar este lote al inventario.");
        }

        if (!isBatchQualityApproved(batchData)) {
          throw new Error("La revisión de calidad debe estar aprobada antes de ingresar al inventario.");
        }

        const inventoryData = inventorySnapshot.data();
        const previousStock = Number(inventoryData.currentStock || 0);
        const newStock = previousStock + approvedQuantity;

        transaction.update(inventoryRef, {
          currentStock: newStock,
          lastBatchId: batch.id,
          lastBatchFolio: batch.folio || "",
          updatedAt: serverTimestamp(),
          updatedByUid: auditUser.uid,
          updatedByName: auditUser.name,
          updatedByEmail: auditUser.email,
        });

        transaction.set(movementRef, {
          inventoryId: inventoryItem.id,
          productId: batch.productId || "",
          productName: batch.productName || "",
          type: "Entrada",
          quantity: approvedQuantity,
          reason: "Lote de producción cerrado",
          previousStock,
          newStock,
          notes: `Ingreso automático desde ${batch.folio || "lote de producción"}.`,
          batchId: batch.id,
          batchFolio: batch.folio || "",
          createdAt: serverTimestamp(),
          createdByUid: auditUser.uid,
          createdByName: auditUser.name,
          createdByEmail: auditUser.email,
        });

        transaction.update(batchRef, {
          status: "Ingresado a inventario",
          inventoryApplied: true,
          inventoryId: inventoryItem.id,
          inventoryMovementId: movementRef.id,
          inventoryAppliedAt: serverTimestamp(),
          inventoryAppliedByUid: auditUser.uid,
          inventoryAppliedByName: auditUser.name,
          inventoryAppliedByEmail: auditUser.email,
          updatedAt: serverTimestamp(),
          updatedByUid: auditUser.uid,
          updatedByName: auditUser.name,
          updatedByEmail: auditUser.email,
        });
      });

      setBatchMessage("Lote ingresado al inventario correctamente.");
      resetBatchForm();
    } catch (error) {
      console.error("No se pudo ingresar el lote al inventario:", error);
      setBatchMessage(error?.message || "No se pudo ingresar el lote al inventario.");
    } finally {
      setClosingBatchId(null);
    }
  }

  return (
    <div className="printshop-page">
      <section className="printshop-topbar">
        <div>
          <p className="section-kicker printshop-kicker">Módulo operativo</p>
          <h1>Módulo de Imprenta</h1>
          <p>
            Control de producción, solicitudes, inventario de libros, insumos y
            generación de certificados con folio y QR de validación.
          </p>
        </div>

        <label className="printshop-search">
          <span>⌕</span>
          <input
            type="search"
            placeholder="Buscar folio, producto o insumo"
            value={activeSection === "catalog" ? productSearch : activeSection === "requests" ? requestSearch : ""}
            onChange={(event) => {
              if (activeSection === "requests") {
                setRequestSearch(event.target.value);
              } else {
                setProductSearch(event.target.value);
              }
            }}
            onFocus={() => setActiveSection(activeSection === "requests" ? "requests" : "catalog")}
          />
        </label>
      </section>

      <section className="printshop-section-tabs">
        <button
          type="button"
          className={activeSection === "dashboard" ? "active" : ""}
          onClick={() => setActiveSection("dashboard")}
        >
          <span>▦</span>
          Inicio
        </button>
        <button
          type="button"
          className={activeSection === "catalog" ? "active" : ""}
          onClick={() => setActiveSection("catalog")}
        >
          <span>▤</span>
          Catálogo de productos
        </button>
        <button
          type="button"
          className={activeSection === "inventory" ? "active" : ""}
          onClick={() => setActiveSection("inventory")}
        >
          <span>▣</span>
          Inventario terminado
        </button>
        <button
          type="button"
          className={activeSection === "requests" ? "active" : ""}
          onClick={() => setActiveSection("requests")}
        >
          <span>▤</span>
          Solicitudes
        </button>
        <button
          type="button"
          className={activeSection === "batches" ? "active" : ""}
          onClick={() => setActiveSection("batches")}
        >
          <span>▧</span>
          Lotes de producción
        </button>
      </section>

      {activeSection === "dashboard" ? (
        <DashboardView
          products={products}
          productStats={productStats}
          inventoryItems={inventoryItems}
          inventoryStats={inventoryStats}
          productionBatches={productionBatches}
          batchStats={batchStats}
          printRequests={printRequests}
          requestStats={requestStats}
          onOpenCatalog={() => setActiveSection("catalog")}
          onOpenInventory={() => setActiveSection("inventory")}
          onOpenBatches={() => setActiveSection("batches")}
          onOpenRequests={() => setActiveSection("requests")}
        />
      ) : activeSection === "catalog" ? (
        <ProductCatalogView
          products={products}
          filteredProducts={filteredProducts}
          loadingProducts={loadingProducts}
          productsError={productsError}
          productStats={productStats}
          productForm={productForm}
          formMessage={formMessage}
          savingProduct={savingProduct}
          seedingProducts={seedingProducts}
          selectedProduct={selectedProduct}
          selectedProductId={selectedProductId}
          productSearch={productSearch}
          categoryFilter={categoryFilter}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          isAdmin={isAdmin}
          onSearchChange={setProductSearch}
          onCategoryFilterChange={setCategoryFilter}
          onTypeFilterChange={setTypeFilter}
          onStatusFilterChange={setStatusFilter}
          onInputChange={handleProductInputChange}
          onNumberInputChange={handleNumberInputChange}
          onSaveProduct={saveProduct}
          onSelectProduct={selectProduct}
          onResetForm={resetProductForm}
          onToggleStatus={toggleProductStatus}
          onSeedBaseProducts={seedBaseProducts}
        />
      ) : activeSection === "inventory" ? (
        <FinishedInventoryView
          productsWithoutInventory={productsWithoutInventory}
          inventoryProducts={inventoryProducts}
          inventoryItems={inventoryItems}
          inventoryMovements={inventoryMovements}
          loadingInventory={loadingInventory}
          inventoryError={inventoryError}
          inventoryStats={inventoryStats}
          inventoryForm={inventoryForm}
          movementForm={movementForm}
          savingInventory={savingInventory}
          savingMovement={savingMovement}
          inventoryMessage={inventoryMessage}
          movementMessage={movementMessage}
          isAdmin={isAdmin}
          onInventoryInputChange={handleInventoryInputChange}
          onInventoryNumberInputChange={handleInventoryNumberInputChange}
          onMovementInputChange={handleMovementInputChange}
          onMovementNumberInputChange={handleMovementNumberInputChange}
          onCreateInventoryItem={createInventoryItem}
          onRegisterMovement={registerInventoryMovement}
          onPrepareMovement={prepareMovement}
          onResetInventoryForm={resetInventoryForm}
        />
      ) : activeSection === "requests" ? (
        <PrintRequestsView
          printRequests={printRequests}
          filteredRequests={filteredRequests}
          products={products}
          activeUsers={activeUsers}
          loadingRequests={loadingRequests}
          requestsError={requestsError}
          requestStats={requestStats}
          requestForm={requestForm}
          selectedRequest={selectedRequest}
          selectedRequestId={selectedRequestId}
          savingRequest={savingRequest}
          requestMessage={requestMessage}
          requestSearch={requestSearch}
          requestStatusFilter={requestStatusFilter}
          requestTypeFilter={requestTypeFilter}
          requestPriorityFilter={requestPriorityFilter}
          isAdmin={isAdmin}
          currentUserUid={getAuditUser().uid}
          onRequestInputChange={handleRequestInputChange}
          onRequestNumberInputChange={handleRequestNumberInputChange}
          onSavePrintRequest={savePrintRequest}
          onSelectRequest={selectRequest}
          onResetRequestForm={resetRequestForm}
          onRequestSearchChange={setRequestSearch}
          onRequestStatusFilterChange={setRequestStatusFilter}
          onRequestTypeFilterChange={setRequestTypeFilter}
          onRequestPriorityFilterChange={setRequestPriorityFilter}
          studentName={studentName}
          studentDeliveryType={studentDeliveryType}
          bulkStudentsText={bulkStudentsText}
          bulkStudentsDeliveryType={bulkStudentsDeliveryType}
          savingStudents={savingStudents}
          generatingStudentId={generatingStudentId}
          onStudentNameChange={setStudentName}
          onStudentDeliveryTypeChange={setStudentDeliveryType}
          onBulkStudentsTextChange={setBulkStudentsText}
          onBulkStudentsDeliveryTypeChange={setBulkStudentsDeliveryType}
          onAddSingleStudent={addSingleRequestStudent}
          onAddBulkStudents={addBulkRequestStudents}
          onUpdateStudent={updateRequestStudent}
          onDeleteStudent={deleteRequestStudent}
          onGenerateStudentFolio={generateStudentFolio}
          onGenerateAllStudentFolios={generateAllStudentFolios}
        />
      ) : (
        <ProductionBatchesView
          inventoryProducts={inventoryProducts}
          inventoryItems={inventoryItems}
          productionBatches={productionBatches}
          loadingBatches={loadingBatches}
          batchesError={batchesError}
          batchStats={batchStats}
          batchForm={batchForm}
          selectedBatch={selectedBatch}
          selectedBatchId={selectedBatchId}
          savingBatch={savingBatch}
          batchMessage={batchMessage}
          closingBatchId={closingBatchId}
          isAdmin={isAdmin}
          currentUserUid={getAuditUser().uid}
          activeUsers={activeUsers}
          loadingUsers={loadingUsers}
          usersError={usersError}
          batchProductionSummary={batchProductionSummary}
          batchSummaryFrom={batchSummaryFrom}
          batchSummaryTo={batchSummaryTo}
          onBatchSummaryFromChange={setBatchSummaryFrom}
          onBatchSummaryToChange={setBatchSummaryTo}
          onBatchInputChange={handleBatchInputChange}
          onBatchNumberInputChange={handleBatchNumberInputChange}
          onQualityChecklistToggle={handleQualityChecklistToggle}
          onSaveProductionBatch={saveProductionBatch}
          onSelectBatch={selectBatch}
          onResetBatchForm={resetBatchForm}
          onSendBatchToInventory={sendBatchToInventory}
          onOpenInventory={() => setActiveSection("inventory")}
        />
      )}
    </div>
  );
}

function DashboardView({
  productStats,
  inventoryItems,
  inventoryStats,
  productionBatches,
  batchStats,
  printRequests,
  requestStats,
  onOpenCatalog,
  onOpenInventory,
  onOpenBatches,
  onOpenRequests,
}) {
  const lowInventoryItems = inventoryItems
    .filter((item) => {
      const currentStock = Number(item.currentStock || 0);
      const minStock = Number(item.minStock || 0);
      return minStock > 0 && currentStock < minStock;
    })
    .slice(0, 5);

  const dashboardMetrics = metrics.map((metric) => {
    if (metric.label === "Solicitudes pendientes") {
      return {
        ...metric,
        value: String(requestStats.pending),
        helper: requestStats.pending === 1 ? "Trabajo por atender" : "Trabajos por atender",
      };
    }

    if (metric.label === "Listos para entrega") {
      return {
        ...metric,
        value: String(requestStats.ready),
        helper: requestStats.ready === 1 ? "Solicitud lista" : "Solicitudes listas",
      };
    }

    if (metric.label === "Libros con stock bajo") {
      return {
        ...metric,
        value: String(inventoryStats.lowStock),
        helper:
          inventoryStats.lowStock === 1
            ? "Libro bajo mínimo"
            : "Libros bajo mínimo",
      };
    }

    if (metric.label === "Lotes activos") {
      return {
        ...metric,
        value: String(batchStats.active),
        helper: batchStats.active === 1 ? "Producción en curso" : "Producciones en curso",
      };
    }

    return metric;
  });


  const dashboardRequests = printRequests.length
    ? printRequests.slice(0, 4).map((request) => ({
        folio: request.folio || "Sin folio",
        product: getRequestProductLabel(request),
        requester: request.requesterName || request.requesterArea || "Sin solicitante",
        status: request.status || "Solicitud recibida",
        statusTone: getRequestStatusTone(request.status),
        delivery: getRequestDueLabel(request),
      }))
    : requests;

  const dashboardBatches = productionBatches.length
    ? productionBatches.slice(0, 3).map((batch) => ({
        folio: batch.folio || "Sin folio",
        product: batch.productName || "Producto sin nombre",
        progress: getBatchProgress(batch),
        status: batch.status || "Planeado",
        statusTone: getBatchStatusTone(batch.status),
        quantity: `${Number(batch.approvedQuantity || 0)} aprobados / ${Number(batch.plannedQuantity || 0)} planeados`,
      }))
    : batches;

  const operationalCards = [
    {
      icon: "▤",
      title: "Solicitudes especiales",
      value: `${requestStats.pending} activas`,
      description: "Certificados, volantes y viniles con fechas próximas.",
      tone: "blue",
    },
    {
      icon: "▧",
      title: "Producción para inventario",
      value: `${batchStats.active} lotes`,
      description: "Libros en impresión, encuadernado o revisión de calidad.",
      tone: "teal",
    },
    {
      icon: "◎",
      title: "Certificados profesionales",
      value: "Folio + QR",
      description: "Base preparada para documentos digitales e impresos.",
      tone: "purple",
    },
    {
      icon: "!",
      title: "Insumos por revisar",
      value: "4 alertas",
      description: "Papel, opalina y tintas debajo del mínimo sugerido.",
      tone: "red",
    },
  ];

  const workflowSteps = [
    {
      number: "01",
      title: "Recibir solicitud",
      description: "Trabajos solicitados por dirección, recepción, administración o maestros.",
    },
    {
      number: "02",
      title: "Producir o generar",
      description: "Impresión física, lote de libros o certificado digital automático.",
    },
    {
      number: "03",
      title: "Revisión de calidad",
      description: "Validación de nombres, cortes, encuadernado, folio, firma y QR.",
    },
    {
      number: "04",
      title: "Entregar y registrar",
      description: "Salida física o digital con evidencia y control de inventario.",
    },
  ];

  return (
    <>
      <section className="printshop-dashboard-hero">
        <div className="printshop-hero-content">
          <p className="section-kicker printshop-hero-kicker">Centro operativo</p>
          <h2>Producción, solicitudes e inventario en un solo lugar</h2>
          <p>
            Esta pantalla será el punto de control de Imprenta: trabajos solicitados,
            lotes de libros, certificados con folio, insumos críticos y entregas pendientes.
          </p>

          <div className="printshop-hero-badges">
            <span>{productStats.active} productos activos</span>
            <span>{productStats.books} libros configurados</span>
            <span>{productStats.generatedDocuments} documentos generados</span>
          </div>

          <div className="printshop-hero-actions">
            <button type="button" className="visual-primary-button" onClick={onOpenCatalog}>
              Administrar catálogo
            </button>
            <button type="button" className="visual-outline-button">
              Ver flujo de producción
            </button>
          </div>
        </div>

        <div className="printshop-hero-visual" aria-hidden="true">
          <div className="printshop-hero-printer">
            <div className="printer-top" />
            <div className="printer-body">
              <span />
              <span />
              <span />
            </div>
            <div className="printer-paper">
              <b>CERT</b>
              <small>Folio + QR</small>
            </div>
          </div>

          <div className="printshop-hero-floating-card one">
            <strong>LOTE</strong>
            <span>Journey A1 · 75%</span>
          </div>

          <div className="printshop-hero-floating-card two">
            <strong>QR</strong>
            <span>Validación activa</span>
          </div>
        </div>
      </section>

      <section className="printshop-metrics-grid printshop-metrics-enhanced">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="printshop-operational-grid">
        {operationalCards.map((card) => (
          <article className={`printshop-operational-card ${card.tone}`} key={card.title}>
            <div>{card.icon}</div>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.description}</p>
          </article>
        ))}
      </section>

      <section className="printshop-action-grid printshop-action-grid-enhanced">
        <ActionCard
          icon="＋"
          title="Nueva solicitud"
          description="Registrar certificados, diplomas, volantes, viniles o materiales internos."
          onClick={onOpenRequests}
        />
        <ActionCard
          icon="▧"
          title="Nuevo lote"
          description="Crear producción interna de libros para inventario terminado."
          onClick={onOpenBatches}
        />
        <ActionCard
          icon="◎"
          title="Generar certificados"
          description="Preparar documentos con folio, firma precargada y QR de validación."
        />
        <ActionCard
          icon="▤"
          title="Catálogo de productos"
          description={`${productStats.active} productos activos registrados para imprenta.`}
          onClick={onOpenCatalog}
        />
      </section>

      <section className="printshop-dashboard-layout-enhanced">
        <div className="printshop-dashboard-main-enhanced">
          <Panel title="Tablero de trabajo" icon="▦" actionLabel="Vista operativa">
            <div className="printshop-workboard-grid">
              <div className="printshop-workboard-column">
                <div className="printshop-mini-heading">
                  <span>▤</span>
                  <div>
                    <strong>Solicitudes recientes</strong>
                    <p>Trabajos pedidos por áreas o planteles.</p>
                  </div>
                </div>

                <div className="printshop-request-card-list">
                  {dashboardRequests.map((request) => (
                    <article className="printshop-request-card" key={request.folio}>
                      <div>
                        <strong>{request.product}</strong>
                        <span>{request.folio} · {request.requester}</span>
                      </div>
                      <div>
                        <StatusBadge tone={request.statusTone}>{request.status}</StatusBadge>
                        <small>{request.delivery}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="printshop-workboard-column">
                <div className="printshop-mini-heading">
                  <span>▧</span>
                  <div>
                    <strong>Lotes de producción</strong>
                    <p>Producción interna para mantener inventario.</p>
                  </div>
                </div>

                <div className="printshop-batch-card-list">
                  {dashboardBatches.map((batch) => (
                    <article className="printshop-batch-card" key={batch.folio}>
                      <div className="printshop-batch-card-top">
                        <div>
                          <strong>{batch.product}</strong>
                          <span>{batch.folio}</span>
                        </div>
                        <StatusBadge tone={batch.statusTone}>{batch.status}</StatusBadge>
                      </div>
                      <ProgressBar value={batch.progress} tone={batch.statusTone} />
                      <small>{batch.quantity}</small>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Flujo recomendado de Imprenta" icon="▥" actionLabel="Proceso base">
            <div className="printshop-workflow-track">
              {workflowSteps.map((step) => (
                <article className="printshop-workflow-step" key={step.number}>
                  <span>{step.number}</span>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="printshop-dashboard-side-enhanced">
          <Panel title="Inventario de productos terminados" icon="▣" actionLabel={`${inventoryStats.total} libros`}>
            <div className="finished-inventory-list enhanced">
              {inventoryItems.length === 0 ? (
                <div className="printshop-small-empty">
                  <strong>Inventario pendiente</strong>
                  <span>Configura los libros terminados desde la pestaña Inventario.</span>
                </div>
              ) : lowInventoryItems.length === 0 ? (
                inventoryItems.slice(0, 3).map((item) => {
                  const status = getInventoryStatus(item);

                  return (
                    <div className="finished-inventory-row" key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>Stock {Number(item.currentStock || 0)} · mínimo {Number(item.minStock || 0)}</span>
                      </div>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                  );
                })
              ) : (
                lowInventoryItems.map((item) => {
                  const status = getInventoryStatus(item);

                  return (
                    <div className="finished-inventory-row" key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>Stock {Number(item.currentStock || 0)} · mínimo {Number(item.minStock || 0)}</span>
                      </div>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              className="visual-outline-button printshop-full-button"
              onClick={onOpenInventory}
            >
              Administrar inventario
            </button>
          </Panel>

          <Panel title="Catálogo de productos" icon="▤" actionLabel="Base real">
            <div className="printshop-catalog-summary-card enhanced">
              <div>
                <strong>{productStats.total}</strong>
                <span>Productos registrados</span>
              </div>
              <div>
                <strong>{productStats.books}</strong>
                <span>Libros</span>
              </div>
              <div>
                <strong>{productStats.generatedDocuments}</strong>
                <span>Documentos generados</span>
              </div>
            </div>
            <button
              type="button"
              className="visual-outline-button printshop-full-button"
              onClick={onOpenCatalog}
            >
              Administrar catálogo
            </button>
          </Panel>

          <Panel title="Insumos críticos" icon="!" actionLabel="Alertas">
            <div className="critical-supplies-list compact">
              {criticalSupplies.map((supply) => (
                <div className="critical-supply-row" key={`${supply.name}-${supply.spec}`}>
                  <div className={`critical-supply-icon ${supply.tone}`}>{supply.icon}</div>
                  <div className="critical-supply-info">
                    <strong>{supply.name}</strong>
                    <span>{supply.spec} · {supply.available}</span>
                  </div>
                  <StatusBadge tone={supply.tone}>{supply.status}</StatusBadge>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </section>

      <section className="printshop-certificate-feature">
        <div className="printshop-certificate-feature-copy">
          <p className="section-kicker printshop-kicker">Certificados y diplomas</p>
          <h2>Generación automática con folio y QR de validación</h2>
          <p>
            Esta sección quedará preparada para capturar nivel, grupo, maestro,
            horario, lista de alumnos, entrega impresa o digital, firma precargada
            y validación profesional por código QR.
          </p>

          <div className="printshop-certificate-feature-stats">
            <div>
              <strong>12</strong>
              <span>Impresos</span>
            </div>
            <div>
              <strong>6</strong>
              <span>Digitales</span>
            </div>
            <div>
              <strong>18</strong>
              <span>Total del grupo</span>
            </div>
          </div>
        </div>

        <div className="certificate-card-preview enhanced-preview">
          <div className="certificate-border">
            <div className="certificate-logo">AES</div>
            <small>Active English School</small>
            <h3>CERTIFICADO</h3>
            <p>Otorgado a</p>
            <strong>Juan Pérez García</strong>
            <span>
              Por haber concluido satisfactoriamente el nivel A2 del programa académico correspondiente.
            </span>
            <div className="certificate-signature">Samantha Rodríguez</div>
            <div className="certificate-footer">
              <div>
                <small>Folio</small>
                <b>CERT-2026-000123</b>
              </div>
              <div>
                <small>QR de validación</small>
                <div className="qr-placeholder">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="certificate-students-card enhanced-students">
          <div className="mini-section-header no-margin">
            <div>
              <span>☑</span>
              <h3>Lista de alumnos</h3>
            </div>
          </div>

          <div className="certificate-students-list">
            {certificateStudents.map((student) => (
              <div className="certificate-student-row" key={student.name}>
                <strong>{student.name}</strong>
                <StatusBadge
                  tone={
                    student.delivery === "Digital"
                      ? "blue"
                      : student.delivery === "Ambos"
                        ? "purple"
                        : "green"
                  }
                >
                  {student.delivery}
                </StatusBadge>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="printshop-bottom-grid enhanced-bottom">
        <Panel title="Ruta de desarrollo" icon="▥" actionLabel="Plan activo">
          <div className="printshop-roadmap-list">
            <RoadmapItem
              number="1"
              title="Interfaz principal"
              description="Dashboard profesional para visualizar operación, inventario y alertas."
              active
            />
            <RoadmapItem
              number="2"
              title="Catálogo de productos"
              description="Registrar productos reales y usarlos como base de lotes y solicitudes."
              active
            />
            <RoadmapItem
              number="3"
              title="Inventario terminado"
              description="Controlar libros producidos, mínimos, ideales y alertas de reposición."
              active
            />
            <RoadmapItem
              number="4"
              title="Lotes de producción"
              description="Producir libros para inventario y registrar entradas automáticas."
              active
            />
            <RoadmapItem
              number="5"
              title="Certificados automáticos"
              description="Folio, firma precargada, QR de validación y versión digital."
            />
          </div>
        </Panel>

        <Panel title="Siguiente función sugerida" icon="→" actionLabel="Etapa 3">
          <div className="printshop-next-feature-card">
            <span>☑</span>
            <div>
              <strong>Checklist de calidad para lotes</strong>
              <p>
                Después de crear lotes, lo ideal será validar impresión, corte,
                encuadernado y conteo antes de ingresar al inventario.
              </p>
              <button type="button" className="visual-outline-button" onClick={onOpenBatches}>
                Abrir lotes de producción
              </button>
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}


function ProductionBatchesView({
  inventoryProducts,
  inventoryItems,
  productionBatches,
  loadingBatches,
  batchesError,
  batchStats,
  batchForm,
  selectedBatch,
  selectedBatchId,
  savingBatch,
  batchMessage,
  closingBatchId,
  isAdmin,
  currentUserUid,
  activeUsers,
  loadingUsers,
  usersError,
  batchProductionSummary,
  batchSummaryFrom,
  batchSummaryTo,
  onBatchSummaryFromChange,
  onBatchSummaryToChange,
  onBatchInputChange,
  onBatchNumberInputChange,
  onQualityChecklistToggle,
  onSaveProductionBatch,
  onSelectBatch,
  onResetBatchForm,
  onSendBatchToInventory,
  onOpenInventory,
}) {
  const activeBatches = productionBatches.filter((batch) => batch.status !== "Cancelado");
  const selectedRole = isAdmin
    ? "admin"
    : isSameUid(currentUserUid, selectedBatch?.responsibleUid)
      ? "responsible"
      : isSameUid(currentUserUid, selectedBatch?.auditorUid)
        ? "auditor"
        : "viewer";
  const canCreateBatch = isAdmin;
  const canEditAdministrativeFields = isAdmin;
  const canEditProductionFields = isAdmin || selectedRole === "responsible";
  const canEditQualityFields = isAdmin || selectedRole === "auditor";
  const canSaveBatch =
    (!selectedBatchId && canCreateBatch) ||
    (selectedBatchId && ["admin", "responsible", "auditor"].includes(selectedRole));
  const availableStatusOptions = isAdmin
    ? productionBatchStatuses
    : selectedRole === "responsible"
      ? productionResponsibleStatuses
      : selectedRole === "auditor"
        ? qualityAuditorStatuses
        : [batchForm.status || "Planeado"];

  return (
    <section className="printshop-batches-page">
      <div className="printshop-catalog-hero batches-hero">
        <div>
          <p className="section-kicker printshop-kicker">Etapa 4</p>
          <h2>Lotes de producción</h2>
          <p>
            Registra producciones internas de libros, controla su avance y, al aprobarlos,
            ingrésalos automáticamente al inventario terminado.
          </p>
        </div>

        <div className="inventory-hero-card batches-hero-card">
          <strong>{batchStats.active}</strong>
          <span>Lotes activos</span>
        </div>
      </div>

      <div className="printshop-catalog-metrics">
        <CatalogMetric tone="blue" icon="▧" label="Total" value={batchStats.total} />
        <CatalogMetric tone="teal" icon="↻" label="Activos" value={batchStats.active} />
        <CatalogMetric tone="orange" icon="→" label="Por ingresar" value={batchStats.pendingInventory} />
        <CatalogMetric tone="green" icon="✓" label="Ingresados" value={batchStats.completed} />
        <CatalogMetric tone="red" icon="×" label="Cancelados" value={batchStats.cancelled} />
      </div>

      <Panel title="Resumen de producción" icon="∑" actionLabel={`${batchProductionSummary.count} lotes`}>
        <div className="batch-summary-toolbar">
          <label>
            <span>Desde</span>
            <input
              type="date"
              value={batchSummaryFrom}
              onChange={(event) => onBatchSummaryFromChange(event.target.value)}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              value={batchSummaryTo}
              onChange={(event) => onBatchSummaryToChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="visual-outline-button"
            onClick={() => {
              onBatchSummaryFromChange("");
              onBatchSummaryToChange("");
            }}
          >
            Limpiar periodo
          </button>
        </div>

        <div className="batch-summary-grid">
          <CatalogMetric tone="blue" icon="□" label="Planeado" value={batchProductionSummary.planned} />
          <CatalogMetric tone="teal" icon="▣" label="Producido" value={batchProductionSummary.produced} />
          <CatalogMetric tone="green" icon="✓" label="Aprobado" value={batchProductionSummary.approved} />
          <CatalogMetric tone="red" icon="×" label="Rechazado" value={batchProductionSummary.rejected} />
          <CatalogMetric tone="orange" icon="%" label="Rechazo" value={`${batchProductionSummary.rejectionRate}%`} />
          <CatalogMetric tone="purple" icon="↳" label="Inventario" value={batchProductionSummary.inventoryApplied} />
        </div>
      </Panel>

      {batchesError && <div className="form-error">{batchesError}</div>}
      {usersError && <div className="form-error">{usersError}</div>}

      <div className="printshop-batches-layout">
        <div className="printshop-batches-main">
          <Panel title="Lotes registrados" icon="▧" actionLabel={`${activeBatches.length} visibles`}>
            {loadingBatches ? (
              <div className="printshop-empty-catalog">
                <div>▧</div>
                <h3>Cargando lotes...</h3>
                <p>Estamos consultando las producciones registradas.</p>
              </div>
            ) : productionBatches.length === 0 ? (
              <div className="printshop-empty-catalog">
                <div>▧</div>
                <h3>Aún no hay lotes de producción</h3>
                <p>
                  Crea el primer lote para producir libros y conectarlo con el inventario terminado.
                </p>
              </div>
            ) : (
              <div className="printshop-table-wrap">
                <table className="printshop-table printshop-batches-table">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Producto</th>
                      <th>Responsable</th>
                      <th>Auditor</th>
                      <th>Planeado</th>
                      <th>Producido</th>
                      <th>Aprobado</th>
                      <th>Rechazado</th>
                      <th>Estado</th>
                      <th>Calidad</th>
                      <th>Inventario</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionBatches.map((batch) => {
                      const tone = getBatchStatusTone(batch.status);
                      const inventoryReady =
                        batch.inventoryApplied === true || batch.status === "Ingresado a inventario";
                      const canSendToInventory =
                        (isAdmin || isSameUid(currentUserUid, batch.responsibleUid)) &&
                        !inventoryReady &&
                        batch.status !== "Cancelado";

                      return (
                        <tr
                          key={batch.id}
                          className={selectedBatchId === batch.id ? "selected-product-row" : ""}
                        >
                          <td>
                            <strong>{batch.folio}</strong>
                            <span>{formatDate(batch.createdAt)}</span>
                          </td>
                          <td>
                            <strong>{batch.productName}</strong>
                            <span>{batch.level || "No aplica"} · {batch.unit || "Libro"}</span>
                          </td>
                          <td>
                            <strong>{batch.responsibleName || batch.responsible || "Sin asignar"}</strong>
                            <span>{batch.responsibleEmail || ""}</span>
                          </td>
                          <td>
                            <strong>{batch.auditorName || "Sin asignar"}</strong>
                            <span>{batch.auditorEmail || ""}</span>
                          </td>
                          <td>{Number(batch.plannedQuantity || 0)}</td>
                          <td>{Number(batch.producedQuantity || 0)}</td>
                          <td>{Number(batch.approvedQuantity || 0)}</td>
                          <td>{Number(batch.rejectedQuantity || 0)}</td>
                          <td>
                            <StatusBadge tone={tone}>{batch.status || "Planeado"}</StatusBadge>
                            <ProgressBar value={getBatchProgress(batch)} tone={tone} />
                          </td>
                          <td>
                            <StatusBadge tone={getQualityStatusTone(batch.qualityStatus)}>
                              {batch.qualityStatus || "Pendiente"}
                            </StatusBadge>
                            <span className="batch-quality-mini">
                              {isQualityChecklistComplete(batch.qualityChecklist)
                                ? "Checklist completo"
                                : "Checklist pendiente"}
                            </span>
                          </td>
                          <td>
                            <StatusBadge tone={inventoryReady ? "green" : "orange"}>
                              {inventoryReady ? "Ingresado" : "Pendiente"}
                            </StatusBadge>
                          </td>
                          <td>
                            <div className="printshop-product-actions batch-actions">
                              <button type="button" onClick={() => onSelectBatch(batch)}>
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => onSendBatchToInventory(batch)}
                                disabled={!canSendToInventory || closingBatchId === batch.id}
                                title={
                                  canSendToInventory
                                    ? "Ingresar cantidad aprobada al inventario"
                                    : "Disponible para el responsable asignado o administrador cuando el lote no esté cancelado ni ingresado"
                                }
                              >
                                {closingBatchId === batch.id ? "Ingresando..." : "Ingresar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Relación con inventario terminado" icon="▣" actionLabel={`${inventoryItems.length} inventarios`}>
            <div className="batch-inventory-helper">
              <div>
                <strong>Cómo funciona</strong>
                <p>
                  Cuando un lote tenga cantidad aprobada, presiona “Ingresar”. El sistema sumará
                  esa cantidad al inventario terminado y creará un movimiento automático de entrada.
                </p>
              </div>
              <button type="button" className="visual-outline-button" onClick={onOpenInventory}>
                Ver inventario terminado
              </button>
            </div>
          </Panel>
        </div>

        <aside className="printshop-batches-side">
          <Panel
            title={selectedBatch ? "Editar lote" : "Nuevo lote"}
            icon={selectedBatch ? "✎" : "＋"}
            actionLabel={selectedBatch ? "Editando" : "Alta"}
          >
            <form className="printshop-product-form" onSubmit={onSaveProductionBatch}>
              <label className="full">
                <span>Producto</span>
                <select
                  name="productId"
                  value={batchForm.productId}
                  onChange={onBatchInputChange}
                  disabled={!canEditAdministrativeFields || inventoryProducts.length === 0}
                >
                  <option value="">Seleccionar libro</option>
                  {inventoryProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.level || "No aplica"}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cantidad planeada</span>
                <input
                  type="number"
                  name="plannedQuantity"
                  min="0"
                  value={batchForm.plannedQuantity}
                  onChange={onBatchNumberInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Cantidad producida</span>
                <input
                  type="number"
                  name="producedQuantity"
                  min="0"
                  value={batchForm.producedQuantity}
                  onChange={onBatchNumberInputChange}
                  disabled={!canEditProductionFields}
                />
              </label>

              <label>
                <span>Aprobados</span>
                <input
                  type="number"
                  name="approvedQuantity"
                  min="0"
                  value={batchForm.approvedQuantity}
                  onChange={onBatchNumberInputChange}
                  disabled={!canEditQualityFields}
                />
              </label>

              <label>
                <span>Rechazados</span>
                <input
                  type="number"
                  name="rejectedQuantity"
                  min="0"
                  value={batchForm.rejectedQuantity}
                  onChange={onBatchNumberInputChange}
                  disabled={!canEditQualityFields}
                />
              </label>

              <label className="full">
                <span>Estado</span>
                <select
                  name="status"
                  value={batchForm.status}
                  onChange={onBatchInputChange}
                  disabled={selectedRole === "viewer"}
                >
                  {availableStatusOptions.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>Responsable de producción</span>
                <select
                  name="responsibleUid"
                  value={batchForm.responsibleUid}
                  onChange={onBatchInputChange}
                  disabled={!canEditAdministrativeFields || loadingUsers}
                >
                  <option value="">
                    {loadingUsers ? "Cargando usuarios..." : "Seleccionar responsable"}
                  </option>
                  {activeUsers.map((person) => (
                    <option key={person.uid || person.id} value={person.uid || person.id}>
                      {person.name} · {person.email || "sin correo"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>Auditor de calidad</span>
                <select
                  name="auditorUid"
                  value={batchForm.auditorUid}
                  onChange={onBatchInputChange}
                  disabled={!canEditAdministrativeFields || loadingUsers}
                >
                  <option value="">
                    {loadingUsers ? "Cargando usuarios..." : "Seleccionar auditor"}
                  </option>
                  {activeUsers.map((person) => (
                    <option key={person.uid || person.id} value={person.uid || person.id}>
                      {person.name} · {person.email || "sin correo"}
                    </option>
                  ))}
                </select>
              </label>

              {selectedBatchId && (
                <div className="batch-role-summary full">
                  <span>Tu rol en este lote</span>
                  <strong>
                    {selectedRole === "admin"
                      ? "Administrador"
                      : selectedRole === "responsible"
                        ? "Responsable de producción"
                        : selectedRole === "auditor"
                          ? "Auditor de calidad"
                          : "Solo lectura"}
                  </strong>
                </div>
              )}

              <label>
                <span>Inicio</span>
                <input
                  type="date"
                  name="startDate"
                  value={batchForm.startDate}
                  onChange={onBatchInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Entrega estimada</span>
                <input
                  type="date"
                  name="dueDate"
                  value={batchForm.dueDate}
                  onChange={onBatchInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label className="full">
                <span>Notas</span>
                <textarea
                  name="notes"
                  value={batchForm.notes}
                  onChange={onBatchInputChange}
                  placeholder="Ej. Lote urgente para reponer stock bajo de Journey A1."
                  disabled={!canEditProductionFields && !canEditAdministrativeFields}
                />
              </label>

              <div className="batch-quality-box full">
                <div className="batch-quality-header">
                  <div>
                    <strong>Revisión de calidad</strong>
                    <p>Completa esta revisión antes de aprobar o ingresar el lote al inventario.</p>
                  </div>
                  <StatusBadge tone={getQualityStatusTone(batchForm.qualityStatus)}>
                    {batchForm.qualityStatus || "Pendiente"}
                  </StatusBadge>
                </div>

                <div className="batch-quality-checklist">
                  {normalizeBatchQualityChecklist(batchForm.qualityChecklist).map((item) => (
                    <label key={item.id} className={item.checked ? "checked" : ""}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => onQualityChecklistToggle(item.id)}
                        disabled={!canEditQualityFields}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>

                <label className="batch-quality-field">
                  <span>Resultado de calidad</span>
                  <select
                    name="qualityStatus"
                    value={batchForm.qualityStatus}
                    onChange={onBatchInputChange}
                    disabled={!canEditQualityFields}
                  >
                    {qualityStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>

                <label className="batch-quality-field">
                  <span>Observaciones de calidad</span>
                  <textarea
                    name="qualityNotes"
                    value={batchForm.qualityNotes}
                    onChange={onBatchInputChange}
                    placeholder="Ej. Se corrigieron dos portadas antes de aprobar el lote."
                    disabled={!canEditQualityFields}
                  />
                </label>
              </div>

              {batchMessage && <div className="message-box full">{batchMessage}</div>}

              <div className="printshop-form-actions full">
                {selectedBatchId && (
                  <button type="button" className="visual-outline-button" onClick={onResetBatchForm}>
                    Nuevo lote
                  </button>
                )}

                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={savingBatch || !canSaveBatch || inventoryProducts.length === 0}
                >
                  {savingBatch
                    ? "Guardando..."
                    : selectedBatchId
                      ? "Guardar cambios"
                      : "Crear lote"}
                </button>
              </div>

              {inventoryProducts.length === 0 && (
                <p className="inventory-side-help full">
                  Primero crea productos de categoría Libro y tipo Producto terminado en el catálogo.
                </p>
              )}
            </form>
          </Panel>
        </aside>
      </div>
    </section>
  );
}


function FinishedInventoryView({
  productsWithoutInventory,
  inventoryProducts,
  inventoryItems,
  inventoryMovements,
  loadingInventory,
  inventoryError,
  inventoryStats,
  inventoryForm,
  movementForm,
  savingInventory,
  savingMovement,
  inventoryMessage,
  movementMessage,
  isAdmin,
  onInventoryInputChange,
  onInventoryNumberInputChange,
  onMovementInputChange,
  onMovementNumberInputChange,
  onCreateInventoryItem,
  onRegisterMovement,
  onPrepareMovement,
  onResetInventoryForm,
}) {
  const latestMovements = inventoryMovements.slice(0, 8);

  return (
    <section className="printshop-inventory-page">
      <div className="printshop-catalog-hero inventory-hero">
        <div>
          <p className="section-kicker printshop-kicker">Etapa 3</p>
          <h2>Inventario de productos terminados</h2>
          <p>
            Controla libros ya producidos, existencias actuales, mínimos, ideales,
            entradas, salidas e historial de movimientos para saber cuándo reponer.
          </p>
        </div>

        <div className="inventory-hero-card">
          <strong>{inventoryStats.totalStock}</strong>
          <span>Unidades disponibles</span>
        </div>
      </div>

      <div className="printshop-catalog-metrics">
        <CatalogMetric tone="blue" icon="▣" label="Productos" value={inventoryStats.total} />
        <CatalogMetric tone="orange" icon="!" label="Stock bajo" value={inventoryStats.lowStock} />
        <CatalogMetric tone="red" icon="×" label="Críticos" value={inventoryStats.critical} />
        <CatalogMetric tone="green" icon="✓" label="Unidades" value={inventoryStats.totalStock} />
        <CatalogMetric tone="purple" icon="↕" label="Movimientos" value={inventoryMovements.length} />
      </div>

      {inventoryError && <div className="form-error">{inventoryError}</div>}

      <div className="printshop-inventory-layout">
        <div className="printshop-inventory-main">
          <Panel title="Existencias actuales" icon="▣" actionLabel={`${inventoryItems.length} productos`}>
            {loadingInventory ? (
              <div className="printshop-empty-catalog">
                <div>▣</div>
                <h3>Cargando inventario...</h3>
                <p>Estamos consultando las existencias registradas.</p>
              </div>
            ) : inventoryItems.length === 0 ? (
              <div className="printshop-empty-catalog">
                <div>▣</div>
                <h3>Aún no hay inventario terminado</h3>
                <p>
                  Crea inventario desde productos del catálogo, empezando por los libros.
                </p>
              </div>
            ) : (
              <div className="printshop-table-wrap">
                <table className="printshop-table printshop-inventory-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Stock actual</th>
                      <th>Mínimo</th>
                      <th>Ideal</th>
                      <th>Estado</th>
                      <th>Actualización</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryItems.map((item) => {
                      const status = getInventoryStatus(item);

                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.productName}</strong>
                            <span>{item.level || "No aplica"} · {item.unit || "Pieza"}</span>
                          </td>
                          <td>
                            <strong>{Number(item.currentStock || 0)}</strong>
                          </td>
                          <td>{Number(item.minStock || 0)}</td>
                          <td>{Number(item.idealStock || 0)}</td>
                          <td>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          </td>
                          <td>
                            <span>{formatDate(item.updatedAt)}</span>
                          </td>
                          <td>
                            <div className="printshop-product-actions">
                              <button type="button" onClick={() => onPrepareMovement(item, "Entrada")}>
                                Entrada
                              </button>
                              <button type="button" onClick={() => onPrepareMovement(item, "Salida")}>
                                Salida
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Historial de movimientos" icon="↕" actionLabel="Últimos registros">
            {latestMovements.length === 0 ? (
              <div className="printshop-small-empty">
                <strong>Sin movimientos registrados</strong>
                <span>Las entradas y salidas aparecerán en este historial.</span>
              </div>
            ) : (
              <div className="inventory-movement-list">
                {latestMovements.map((movement) => (
                  <article className="inventory-movement-item" key={movement.id}>
                    <div className={`inventory-movement-icon ${movement.type === "Entrada" ? "green" : "orange"}`}>
                      {movement.type === "Entrada" ? "+" : "−"}
                    </div>
                    <div>
                      <strong>{movement.productName}</strong>
                      <p>
                        {movement.type} de {Number(movement.quantity || 0)} · {movement.reason || "Ajuste"}
                      </p>
                      <span>
                        Stock {Number(movement.previousStock || 0)} → {Number(movement.newStock || 0)}
                      </span>
                    </div>
                    <small>{formatDate(movement.createdAt)}</small>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="printshop-inventory-side">
          <Panel title="Crear inventario" icon="＋" actionLabel="Desde catálogo">
            <form className="printshop-product-form" onSubmit={onCreateInventoryItem}>
              <label className="full">
                <span>Producto del catálogo</span>
                <select
                  name="productId"
                  value={inventoryForm.productId}
                  onChange={onInventoryInputChange}
                  disabled={!isAdmin || productsWithoutInventory.length === 0}
                >
                  <option value="">Seleccionar producto</option>
                  {productsWithoutInventory.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.level || "No aplica"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="inventory-form-note full">
                <strong>{inventoryProducts.length}</strong>
                <span>productos terminados disponibles en catálogo</span>
              </div>

              <label>
                <span>Stock inicial</span>
                <input
                  type="number"
                  name="initialStock"
                  min="0"
                  value={inventoryForm.initialStock}
                  onChange={onInventoryNumberInputChange}
                />
              </label>

              <label>
                <span>Stock mínimo</span>
                <input
                  type="number"
                  name="minStock"
                  min="0"
                  value={inventoryForm.minStock}
                  onChange={onInventoryNumberInputChange}
                />
              </label>

              <label>
                <span>Stock ideal</span>
                <input
                  type="number"
                  name="idealStock"
                  min="0"
                  value={inventoryForm.idealStock}
                  onChange={onInventoryNumberInputChange}
                />
              </label>

              <label className="full">
                <span>Notas</span>
                <textarea
                  name="notes"
                  value={inventoryForm.notes}
                  onChange={onInventoryInputChange}
                  placeholder="Ej. Alta inicial de libros disponibles."
                />
              </label>

              {inventoryMessage && <div className="message-box full">{inventoryMessage}</div>}

              <div className="printshop-form-actions full">
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={onResetInventoryForm}
                >
                  Limpiar
                </button>
                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={savingInventory || !isAdmin || productsWithoutInventory.length === 0}
                >
                  {savingInventory ? "Guardando..." : "Crear inventario"}
                </button>
              </div>

              {productsWithoutInventory.length === 0 && (
                <p className="inventory-side-help full">
                  Todos los libros activos del catálogo ya tienen inventario, o aún no has creado productos tipo libro.
                </p>
              )}
            </form>
          </Panel>

          <div id="printshop-movement-panel">
            <Panel title="Registrar movimiento" icon="↕" actionLabel="Entrada / salida">
              <form className="printshop-product-form" onSubmit={onRegisterMovement}>
              <label className="full">
                <span>Producto</span>
                <select
                  name="inventoryId"
                  value={movementForm.inventoryId}
                  onChange={onMovementInputChange}
                  disabled={!isAdmin || inventoryItems.length === 0}
                >
                  <option value="">Seleccionar inventario</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.productName} · stock {Number(item.currentStock || 0)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tipo</span>
                <select
                  name="type"
                  value={movementForm.type}
                  onChange={onMovementInputChange}
                >
                  <option>Entrada</option>
                  <option>Salida</option>
                </select>
              </label>

              <label>
                <span>Cantidad</span>
                <input
                  id="printshop-movement-quantity"
                  type="number"
                  name="quantity"
                  min="1"
                  value={movementForm.quantity}
                  onChange={onMovementNumberInputChange}
                />
              </label>

              <label className="full">
                <span>Motivo</span>
                <select
                  name="reason"
                  value={movementForm.reason}
                  onChange={onMovementInputChange}
                >
                  {movementReasons.map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>Notas</span>
                <textarea
                  name="notes"
                  value={movementForm.notes}
                  onChange={onMovementInputChange}
                  placeholder="Ej. Entrega a Plaza Estrella, producción terminada, ajuste, etc."
                />
              </label>

              {movementMessage && <div className="message-box full">{movementMessage}</div>}

              <div className="printshop-form-actions full">
                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={savingMovement || !isAdmin || inventoryItems.length === 0}
                >
                  {savingMovement ? "Registrando..." : "Registrar movimiento"}
                </button>
              </div>
              </form>
            </Panel>
          </div>
        </aside>
      </div>
    </section>
  );
}


function PrintRequestsView({
  printRequests,
  filteredRequests,
  products,
  activeUsers,
  loadingRequests,
  requestsError,
  requestStats,
  requestForm,
  selectedRequest,
  selectedRequestId,
  savingRequest,
  requestMessage,
  requestSearch,
  requestStatusFilter,
  requestTypeFilter,
  requestPriorityFilter,
  isAdmin,
  currentUserUid,
  onRequestInputChange,
  onRequestNumberInputChange,
  onSavePrintRequest,
  onSelectRequest,
  onResetRequestForm,
  onRequestSearchChange,
  onRequestStatusFilterChange,
  onRequestTypeFilterChange,
  onRequestPriorityFilterChange,
  studentName,
  studentDeliveryType,
  bulkStudentsText,
  bulkStudentsDeliveryType,
  savingStudents,
  generatingStudentId,
  onStudentNameChange,
  onStudentDeliveryTypeChange,
  onBulkStudentsTextChange,
  onBulkStudentsDeliveryTypeChange,
  onAddSingleStudent,
  onAddBulkStudents,
  onUpdateStudent,
  onDeleteStudent,
  onGenerateStudentFolio,
  onGenerateAllStudentFolios,
}) {
  const requestProducts = products.filter(
    (product) => product.active !== false && product.category !== "Libro"
  );
  const selectedRole = selectedRequest
    ? isAdmin
      ? "admin"
      : isSameUid(currentUserUid, selectedRequest.responsibleUid)
        ? "responsible"
        : "viewer"
    : isAdmin
      ? "admin"
      : "viewer";
  const canEditAdministrativeFields = isAdmin;
  const canEditOperationalFields = isAdmin || selectedRole === "responsible";
  const canCreateRequest = isAdmin;
  const isCertificateLike = isRequestCertificateLike(requestForm.requestType);

  const requestMetricCards = [
    {
      tone: "blue",
      icon: "▤",
      label: "Pendientes",
      value: requestStats.pending,
    },
    {
      tone: "orange",
      icon: "◷",
      label: "En producción",
      value: requestStats.inProduction,
    },
    {
      tone: "teal",
      icon: "✓",
      label: "Listas para entrega",
      value: requestStats.ready,
    },
    {
      tone: "red",
      icon: "!",
      label: "Urgentes",
      value: requestStats.urgent,
    },
    {
      tone: "green",
      icon: "↗",
      label: "Entregadas",
      value: requestStats.delivered,
    },
  ];

  return (
    <section className="printshop-requests-section">
      <div className="printshop-section-heading">
        <div>
          <p className="section-kicker printshop-kicker">Solicitudes de imprenta</p>
          <h2>Trabajos solicitados por áreas y planteles</h2>
          <p>
            Registra certificados, diplomas, volantes, viniles, hojas de actividades y
            otros materiales solicitados a Imprenta.
          </p>
        </div>
      </div>

      <div className="catalog-metrics-grid request-metrics-grid">
        {requestMetricCards.map((metric) => (
          <CatalogMetric
            key={metric.label}
            tone={metric.tone}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>

      <div className="printshop-batches-layout request-layout">
        <div className="printshop-batches-main">
          <Panel title="Solicitudes registradas" icon="▤" actionLabel={`${filteredRequests.length} visibles`}>
            <div className="catalog-toolbar request-toolbar">
              <label className="visual-search catalog-search">
                <span>⌕</span>
                <input
                  type="search"
                  placeholder="Buscar folio, producto, solicitante o área"
                  value={requestSearch}
                  onChange={(event) => onRequestSearchChange(event.target.value)}
                />
              </label>

              <select value={requestStatusFilter} onChange={(event) => onRequestStatusFilterChange(event.target.value)}>
                <option>Todos</option>
                {printRequestStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>

              <select value={requestTypeFilter} onChange={(event) => onRequestTypeFilterChange(event.target.value)}>
                <option>Todos</option>
                {printRequestTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>

              <select value={requestPriorityFilter} onChange={(event) => onRequestPriorityFilterChange(event.target.value)}>
                <option>Todas</option>
                {printRequestPriorities.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </div>

            {requestsError && <div className="form-error">{requestsError}</div>}

            {loadingRequests ? (
              <div className="empty-state small">
                <p>Cargando solicitudes de imprenta...</p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="empty-state small">
                <div>▤</div>
                <p>No hay solicitudes con los filtros seleccionados.</p>
              </div>
            ) : (
              <div className="visual-table-wrap">
                <table className="visual-table production-batches-table request-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Producto / servicio</th>
                      <th>Solicitante</th>
                      <th>Responsable</th>
                      <th>Cantidad</th>
                      <th>Prioridad</th>
                      <th>Estado</th>
                      <th>Compromiso</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => {
                      const progress = getRequestProgress(request.status);

                      return (
                        <tr key={request.id} className={selectedRequestId === request.id ? "selected-user-row" : ""}>
                          <td>
                            <strong>{request.folio || "Sin folio"}</strong>
                            <small>{request.requestType || "Solicitud"}</small>
                          </td>
                          <td>
                            <strong>{getRequestProductLabel(request)}</strong>
                            <small>{request.deliveryType || "Sin tipo de entrega"}</small>
                          </td>
                          <td>
                            <strong>{request.requesterName || "Sin solicitante"}</strong>
                            <small>{request.requesterArea || "Sin área"} · {request.campus || "Sin plantel"}</small>
                          </td>
                          <td>
                            <strong>{request.responsibleName || "Sin asignar"}</strong>
                            <small>{request.responsibleEmail || ""}</small>
                          </td>
                          <td>
                            <strong>{Number(request.deliveredQuantity || 0)} / {Number(request.requestedQuantity || 0)}</strong>
                            <ProgressBar value={progress} tone={getRequestStatusTone(request.status)} />
                          </td>
                          <td>
                            <StatusBadge tone={getPriorityTone(request.priority)}>{request.priority || "Normal"}</StatusBadge>
                          </td>
                          <td>
                            <StatusBadge tone={getRequestStatusTone(request.status)}>{request.status || "Solicitud recibida"}</StatusBadge>
                          </td>
                          <td>{getRequestDueLabel(request)}</td>
                          <td>
                            <div className="table-actions">
                              <button type="button" onClick={() => onSelectRequest(request)}>
                                Abrir
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <aside className="printshop-batches-side">
          {selectedRequest && (
            <RequestDetailCard
              request={selectedRequest}
              selectedRole={selectedRole}
              canManageStudents={canEditOperationalFields}
              studentName={studentName}
              studentDeliveryType={studentDeliveryType}
              bulkStudentsText={bulkStudentsText}
              bulkStudentsDeliveryType={bulkStudentsDeliveryType}
              savingStudents={savingStudents}
              generatingStudentId={generatingStudentId}
              onStudentNameChange={onStudentNameChange}
              onStudentDeliveryTypeChange={onStudentDeliveryTypeChange}
              onBulkStudentsTextChange={onBulkStudentsTextChange}
              onBulkStudentsDeliveryTypeChange={onBulkStudentsDeliveryTypeChange}
              onAddSingleStudent={onAddSingleStudent}
              onAddBulkStudents={onAddBulkStudents}
              onUpdateStudent={onUpdateStudent}
              onDeleteStudent={onDeleteStudent}
              onGenerateStudentFolio={onGenerateStudentFolio}
              onGenerateAllStudentFolios={onGenerateAllStudentFolios}
            />
          )}

          <Panel
            title={selectedRequest ? "Actualizar solicitud" : "Nueva solicitud"}
            icon={selectedRequest ? "✎" : "＋"}
            actionLabel={selectedRequest ? "Seguimiento" : "Alta"}
          >
            <form className="printshop-product-form request-form" onSubmit={onSavePrintRequest}>
              <label className="full">
                <span>Producto o servicio</span>
                <select
                  name="productId"
                  value={requestForm.productId}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields || requestProducts.length === 0}
                >
                  <option value="">Seleccionar producto del catálogo</option>
                  {requestProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tipo</span>
                <select
                  name="requestType"
                  value={requestForm.requestType}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                >
                  {printRequestTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Prioridad</span>
                <select
                  name="priority"
                  value={requestForm.priority}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                >
                  {printRequestPriorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>Solicitante</span>
                <input
                  name="requesterName"
                  value={requestForm.requesterName}
                  onChange={onRequestInputChange}
                  placeholder="Nombre o área que solicita"
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Área solicitante</span>
                <input
                  name="requesterArea"
                  value={requestForm.requesterArea}
                  onChange={onRequestInputChange}
                  placeholder="Recepción, Dirección Académica, Administración..."
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Plantel</span>
                <select
                  name="campus"
                  value={requestForm.campus}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                >
                  {printCampuses.map((campus) => (
                    <option key={campus}>{campus}</option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>Responsable de producción</span>
                <select
                  name="responsibleUid"
                  value={requestForm.responsibleUid}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields || activeUsers.length === 0}
                >
                  <option value="">Seleccionar responsable</option>
                  {activeUsers.map((person) => (
                    <option key={person.uid || person.id} value={person.uid || person.id}>
                      {person.name} · {person.email || "sin correo"}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cantidad solicitada</span>
                <input
                  type="number"
                  name="requestedQuantity"
                  min="0"
                  value={requestForm.requestedQuantity}
                  onChange={onRequestNumberInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Cantidad entregada</span>
                <input
                  type="number"
                  name="deliveredQuantity"
                  min="0"
                  value={requestForm.deliveredQuantity}
                  onChange={onRequestNumberInputChange}
                  disabled={!canEditOperationalFields}
                />
              </label>

              <label>
                <span>Tipo de entrega</span>
                <select
                  name="deliveryType"
                  value={requestForm.deliveryType}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                >
                  {printDeliveryTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Estado</span>
                <select
                  name="status"
                  value={requestForm.status}
                  onChange={onRequestInputChange}
                  disabled={!canEditOperationalFields}
                >
                  {printRequestStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Fecha solicitada</span>
                <input
                  type="date"
                  name="requestDate"
                  value={requestForm.requestDate}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              <label>
                <span>Fecha compromiso</span>
                <input
                  type="date"
                  name="dueDate"
                  value={requestForm.dueDate}
                  onChange={onRequestInputChange}
                  disabled={!canEditAdministrativeFields}
                />
              </label>

              {isCertificateLike && (
                <div className="request-certificate-fields full">
                  <div className="batch-quality-header">
                    <div>
                      <strong>Datos para certificados o diplomas</strong>
                      <p>Estos datos preparan la siguiente etapa de generación automática.</p>
                    </div>
                  </div>

                  <label>
                    <span>Nivel</span>
                    <select name="level" value={requestForm.level} onChange={onRequestInputChange} disabled={!canEditAdministrativeFields}>
                      {levels.map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Grupo</span>
                    <input name="group" value={requestForm.group} onChange={onRequestInputChange} placeholder="Ej. Grupo Teacher Samantha" disabled={!canEditAdministrativeFields} />
                  </label>

                  <label>
                    <span>Maestro</span>
                    <input name="teacherName" value={requestForm.teacherName} onChange={onRequestInputChange} placeholder="Nombre del maestro" disabled={!canEditAdministrativeFields} />
                  </label>

                  <label>
                    <span>Horario</span>
                    <input name="schedule" value={requestForm.schedule} onChange={onRequestInputChange} placeholder="Ej. Lun/Mié 6:00 pm" disabled={!canEditAdministrativeFields} />
                  </label>

                  <label>
                    <span>Impresos</span>
                    <input type="number" name="printedQuantity" min="0" value={requestForm.printedQuantity} onChange={onRequestNumberInputChange} disabled={!canEditAdministrativeFields} />
                  </label>

                  <label>
                    <span>Digitales</span>
                    <input type="number" name="digitalQuantity" min="0" value={requestForm.digitalQuantity} onChange={onRequestNumberInputChange} disabled={!canEditAdministrativeFields} />
                  </label>
                </div>
              )}

              <label className="full">
                <span>Observaciones</span>
                <textarea
                  name="notes"
                  value={requestForm.notes}
                  onChange={onRequestInputChange}
                  placeholder="Notas, instrucciones de impresión, medidas, colores, archivos pendientes, etc."
                  disabled={!canEditOperationalFields}
                />
              </label>

              {selectedRequestId && (
                <div className="batch-role-summary full">
                  <span>Tu rol en esta solicitud</span>
                  <strong>
                    {selectedRole === "admin"
                      ? "Administrador"
                      : selectedRole === "responsible"
                        ? "Responsable asignado"
                        : "Solo lectura"}
                  </strong>
                </div>
              )}

              {requestMessage && <div className="message-box full">{requestMessage}</div>}

              <div className="printshop-form-actions full">
                {selectedRequestId && (
                  <button type="button" className="visual-outline-button" onClick={onResetRequestForm}>
                    Nueva solicitud
                  </button>
                )}

                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={savingRequest || (!canCreateRequest && !canEditOperationalFields) || requestProducts.length === 0}
                >
                  {savingRequest
                    ? "Guardando..."
                    : selectedRequestId
                      ? "Guardar cambios"
                      : "Crear solicitud"}
                </button>
              </div>

              {requestProducts.length === 0 && (
                <p className="inventory-side-help full">
                  Primero crea productos o servicios de solicitud en el catálogo.
                </p>
              )}
            </form>
          </Panel>
        </aside>
      </div>
    </section>
  );
}


function RequestDetailCard({
  request,
  selectedRole,
  canManageStudents,
  studentName,
  studentDeliveryType,
  bulkStudentsText,
  bulkStudentsDeliveryType,
  savingStudents,
  generatingStudentId,
  onStudentNameChange,
  onStudentDeliveryTypeChange,
  onBulkStudentsTextChange,
  onBulkStudentsDeliveryTypeChange,
  onAddSingleStudent,
  onAddBulkStudents,
  onUpdateStudent,
  onDeleteStudent,
  onGenerateStudentFolio,
  onGenerateAllStudentFolios,
}) {
  if (!request) return null;

  const isCertificateLike = isRequestCertificateLike(request.requestType);
  const requestedQuantity = Number(request.requestedQuantity || 0);
  const deliveredQuantity = Number(request.deliveredQuantity || 0);
  const printedQuantity = Number(request.printedQuantity || 0);
  const digitalQuantity = Number(request.digitalQuantity || 0);
  const pendingQuantity = Math.max(requestedQuantity - deliveredQuantity, 0);
  const students = normalizeRequestStudents(request.students || []);
  const studentSummary = getStudentValidationSummary(request);
  const studentListComplete =
    studentSummary.totalMatches &&
    studentSummary.printedMatches &&
    studentSummary.digitalMatches;

  return (
    <Panel
      title="Detalle de solicitud"
      icon="ℹ"
      actionLabel={request.folio || "Sin folio"}
    >
      <div className="request-detail-card">
        <div className="request-detail-hero">
          <div>
            <span>Producto / servicio</span>
            <strong>{getRequestProductLabel(request)}</strong>
            <p>{request.requestType || "Solicitud"} · {request.deliveryType || "Sin tipo de entrega"}</p>
          </div>
          <StatusBadge tone={getRequestStatusTone(request.status)}>
            {request.status || "Solicitud recibida"}
          </StatusBadge>
        </div>

        <div className="request-detail-grid">
          <DetailItem label="Solicitante" value={request.requesterName || "Sin solicitante"} helper={`${request.requesterArea || "Sin área"} · ${request.campus || "Sin plantel"}`} />
          <DetailItem label="Responsable" value={request.responsibleName || "Sin asignar"} helper={request.responsibleEmail || ""} />
          <DetailItem label="Prioridad" value={request.priority || "Normal"} badgeTone={getPriorityTone(request.priority)} />
          <DetailItem label="Compromiso" value={getRequestDueLabel(request)} helper={request.requestDate ? `Solicitado: ${request.requestDate}` : "Sin fecha solicitada"} />
          <DetailItem label="Cantidad solicitada" value={requestedQuantity} helper={`Pendiente: ${pendingQuantity}`} />
          <DetailItem label="Cantidad entregada" value={deliveredQuantity} helper="Actualizable por el responsable" />
        </div>

        {isCertificateLike && (
          <div className="request-detail-certificate">
            <div className="request-detail-certificate-header">
              <strong>Datos para generar certificados / diplomas</strong>
              <span>{request.level || "Nivel no definido"}</span>
            </div>

            <div className="request-detail-grid compact">
              <DetailItem label="Nivel" value={request.level || "No definido"} />
              <DetailItem label="Grupo" value={request.group || "No especificado"} />
              <DetailItem label="Maestro" value={request.teacherName || "No especificado"} />
              <DetailItem label="Horario" value={request.schedule || "No especificado"} />
              <DetailItem label="Impresos" value={printedQuantity} />
              <DetailItem label="Digitales" value={digitalQuantity} />
            </div>

            <div className="request-students-card">
              <div className="request-students-header">
                <div>
                  <strong>Alumnos para certificado / diploma</strong>
                  <p>
                    Agrega los nombres y define si cada alumno recibirá versión impresa,
                    digital o ambas. Esta lista será la base para generar folios y QR.
                  </p>
                </div>
                <div className="request-students-header-actions">
                  <StatusBadge tone={studentListComplete ? "green" : "orange"}>
                    {studentListComplete ? "Lista completa" : "Pendiente"}
                  </StatusBadge>
                  {canManageStudents && students.length > 0 && (
                    <button
                      type="button"
                      className="visual-outline-button request-generate-all-button"
                      disabled={
                        savingStudents ||
                        Boolean(generatingStudentId) ||
                        !studentListComplete ||
                        students.every((student) => Boolean(student.certificateFolio))
                      }
                      onClick={onGenerateAllStudentFolios}
                    >
                      {generatingStudentId === "all" ? "Generando..." : "Generar folios para todos"}
                    </button>
                  )}
                </div>
              </div>

              <div className="request-students-summary">
                <StudentSummaryPill
                  label="Total alumnos"
                  current={studentSummary.total}
                  expected={studentSummary.requestedQuantity}
                  valid={studentSummary.totalMatches}
                />
                <StudentSummaryPill
                  label="Impresos"
                  current={studentSummary.printed}
                  expected={studentSummary.printedQuantity}
                  valid={studentSummary.printedMatches}
                />
                <StudentSummaryPill
                  label="Digitales"
                  current={studentSummary.digital}
                  expected={studentSummary.digitalQuantity}
                  valid={studentSummary.digitalMatches}
                />
              </div>

              {canManageStudents ? (
                <div className="request-students-forms">
                  <form className="request-student-inline-form" onSubmit={onAddSingleStudent}>
                    <label>
                      <span>Nombre del alumno</span>
                      <input
                        value={studentName}
                        onChange={(event) => onStudentNameChange(event.target.value)}
                        placeholder="Ej. Ana López Martínez"
                        disabled={savingStudents}
                      />
                    </label>
                    <label>
                      <span>Entrega</span>
                      <select
                        value={studentDeliveryType}
                        onChange={(event) => onStudentDeliveryTypeChange(event.target.value)}
                        disabled={savingStudents}
                      >
                        {studentDeliveryTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="visual-primary-button" disabled={savingStudents}>
                      Agregar
                    </button>
                  </form>

                  <form className="request-student-bulk-form" onSubmit={onAddBulkStudents}>
                    <label>
                      <span>Pegar lista de alumnos</span>
                      <textarea
                        value={bulkStudentsText}
                        onChange={(event) => onBulkStudentsTextChange(event.target.value)}
                        placeholder={"Un alumno por línea:\nAna López\nCarlos Ramírez\nMariana Torres"}
                        disabled={savingStudents}
                      />
                    </label>
                    <label>
                      <span>Entrega para todos</span>
                      <select
                        value={bulkStudentsDeliveryType}
                        onChange={(event) => onBulkStudentsDeliveryTypeChange(event.target.value)}
                        disabled={savingStudents}
                      >
                        {studentDeliveryTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="visual-outline-button" disabled={savingStudents}>
                      Agregar lista
                    </button>
                  </form>
                </div>
              ) : (
                <div className="request-detail-note important">
                  <strong>Lista en solo lectura</strong>
                  <p>Solo el administrador o el responsable asignado pueden modificar los alumnos.</p>
                </div>
              )}

              <div className="request-students-table-wrap">
                {students.length === 0 ? (
                  <div className="empty-state small">
                    <div>◌</div>
                    <p>No hay alumnos registrados todavía.</p>
                  </div>
                ) : (
                  <table className="visual-table request-students-table">
                    <thead>
                      <tr>
                        <th>Alumno</th>
                        <th>Tipo de entrega</th>
                        <th>Estado</th>
                        <th>Folio / QR</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((student) => (
                        <tr key={student.id}>
                          <td>
                            <input
                              defaultValue={student.name}
                              disabled={!canManageStudents || savingStudents || Boolean(student.certificateFolio)}
                              onBlur={(event) => {
                                const nextName = event.target.value.trim();
                                if (nextName && nextName !== student.name) {
                                  onUpdateStudent(student.id, { name: nextName });
                                }
                              }}
                            />
                            {student.certificateFolio && (
                              <small className="request-student-locked-note">
                                Nombre bloqueado después de generar folio.
                              </small>
                            )}
                          </td>
                          <td>
                            <select
                              value={student.deliveryType}
                              disabled={!canManageStudents || savingStudents || Boolean(student.certificateFolio)}
                              onChange={(event) => onUpdateStudent(student.id, { deliveryType: event.target.value })}
                            >
                              {studentDeliveryTypes.map((type) => (
                                <option key={type}>{type}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <StatusBadge tone={student.status === "Pendiente" ? "purple" : "green"}>
                              {student.status || "Pendiente"}
                            </StatusBadge>
                          </td>
                          <td>
                            {student.certificateFolio ? (
                              <div className="request-student-validation-card">
                                <div>
                                  <strong>{student.certificateFolio}</strong>
                                  <small>{student.validationCode}</small>
                                </div>
                                {student.qrDataUrl && (
                                  <img
                                    src={student.qrDataUrl}
                                    alt={`QR de validación de ${student.name}`}
                                  />
                                )}
                              </div>
                            ) : (
                              <span className="request-student-no-folio">Sin folio</span>
                            )}
                          </td>
                          <td>
                            <div className="table-actions request-student-actions">
                              {!student.certificateFolio && (
                                <button
                                  type="button"
                                  className="visual-outline-button"
                                  disabled={
                                    !canManageStudents ||
                                    savingStudents ||
                                    Boolean(generatingStudentId) ||
                                    !studentListComplete
                                  }
                                  onClick={() => onGenerateStudentFolio(student.id)}
                                >
                                  {generatingStudentId === student.id ? "Generando..." : "Generar folio"}
                                </button>
                              )}

                              <button
                                type="button"
                                className="danger-table-button"
                                disabled={!canManageStudents || savingStudents || Boolean(generatingStudentId)}
                                onClick={() => onDeleteStudent(student.id)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!studentListComplete && students.length > 0 && (
                <div className="request-students-warning">
                  Revisa las cantidades: el total de alumnos, impresos y digitales debe coincidir con la solicitud.
                </div>
              )}
            </div>

            <div className="request-detail-note important">
              <strong>Siguiente paso</strong>
              <p>
                Cuando la lista esté completa, genera los folios y QR de validación. Después construiremos la plantilla visual y la descarga del certificado en PDF.
              </p>
            </div>
          </div>
        )}

        <div className="request-detail-note">
          <strong>Observaciones / instrucciones</strong>
          <p>{request.notes || "Sin observaciones registradas."}</p>
        </div>

        <div className="batch-role-summary request-role-summary">
          <span>Tu rol en esta solicitud</span>
          <strong>
            {selectedRole === "admin"
              ? "Administrador"
              : selectedRole === "responsible"
                ? "Responsable asignado"
                : "Solo lectura"}
          </strong>
        </div>
      </div>
    </Panel>
  );
}

function StudentSummaryPill({ label, current, expected, valid }) {
  return (
    <div className={`request-students-summary-pill ${valid ? "valid" : "warning"}`}>
      <span>{label}</span>
      <strong>{current} / {expected}</strong>
    </div>
  );
}

function DetailItem({ label, value, helper = "", badgeTone = "" }) {
  return (
    <div className="request-detail-item">
      <span>{label}</span>
      {badgeTone ? (
        <StatusBadge tone={badgeTone}>{value}</StatusBadge>
      ) : (
        <strong>{value}</strong>
      )}
      {helper && <small>{helper}</small>}
    </div>
  );
}

function ProductCatalogView({
  products,
  filteredProducts,
  loadingProducts,
  productsError,
  productStats,
  productForm,
  formMessage,
  savingProduct,
  seedingProducts,
  selectedProduct,
  selectedProductId,
  productSearch,
  categoryFilter,
  typeFilter,
  statusFilter,
  isAdmin,
  onSearchChange,
  onCategoryFilterChange,
  onTypeFilterChange,
  onStatusFilterChange,
  onInputChange,
  onNumberInputChange,
  onSaveProduct,
  onSelectProduct,
  onResetForm,
  onToggleStatus,
  onSeedBaseProducts,
}) {
  return (
    <section className="printshop-catalog-page">
      <div className="printshop-catalog-hero">
        <div>
          <p className="section-kicker printshop-kicker">Etapa 2</p>
          <h2>Catálogo de productos</h2>
          <p>
            Registra libros, certificados, diplomas, volantes, viniles y
            materiales internos. Este catálogo será la base de lotes,
            solicitudes, inventario terminado y certificados automáticos.
          </p>
        </div>

        {products.length === 0 && isAdmin && (
          <button
            type="button"
            className="visual-primary-button"
            onClick={onSeedBaseProducts}
            disabled={seedingProducts}
          >
            {seedingProducts ? "Cargando..." : "Cargar productos base"}
          </button>
        )}
      </div>

      <div className="printshop-catalog-metrics">
        <CatalogMetric tone="blue" icon="▤" label="Total" value={productStats.total} />
        <CatalogMetric tone="green" icon="✓" label="Activos" value={productStats.active} />
        <CatalogMetric tone="orange" icon="▣" label="Libros" value={productStats.books} />
        <CatalogMetric
          tone="purple"
          icon="◎"
          label="Docs. generados"
          value={productStats.generatedDocuments}
        />
        <CatalogMetric tone="red" icon="○" label="Inactivos" value={productStats.inactive} />
      </div>

      {productsError && <div className="form-error">{productsError}</div>}

      <div className="printshop-catalog-layout">
        <div className="printshop-catalog-main">
          <Panel title="Productos registrados" icon="▤" actionLabel={`${filteredProducts.length} visibles`}>
            <div className="printshop-catalog-toolbar">
              <label className="printshop-catalog-search">
                <span>Buscar</span>
                <input
                  type="search"
                  placeholder="Nombre, categoría o nivel"
                  value={productSearch}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </label>

              <label>
                <span>Categoría</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => onCategoryFilterChange(event.target.value)}
                >
                  <option>Todas</option>
                  {productCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tipo</span>
                <select
                  value={typeFilter}
                  onChange={(event) => onTypeFilterChange(event.target.value)}
                >
                  <option>Todos</option>
                  {productionTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Estado</span>
                <select
                  value={statusFilter}
                  onChange={(event) => onStatusFilterChange(event.target.value)}
                >
                  <option>Activos</option>
                  <option>Inactivos</option>
                  <option>Todos</option>
                </select>
              </label>
            </div>

            {loadingProducts ? (
              <div className="printshop-empty-catalog">
                <div>▤</div>
                <h3>Cargando catálogo...</h3>
                <p>Estamos consultando los productos registrados en Firestore.</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="printshop-empty-catalog">
                <div>▤</div>
                <h3>No hay productos para mostrar</h3>
                <p>
                  Ajusta los filtros o registra el primer producto del catálogo
                  de imprenta.
                </p>
              </div>
            ) : (
              <div className="printshop-table-wrap">
                <table className="printshop-table printshop-products-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Categoría</th>
                      <th>Tipo</th>
                      <th>Nivel</th>
                      <th>Stock</th>
                      <th>Requisitos</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => (
                      <tr
                        key={product.id}
                        className={selectedProductId === product.id ? "selected-product-row" : ""}
                      >
                        <td>
                          <strong>{product.name}</strong>
                          <span>{product.unit || "Pieza"}</span>
                        </td>
                        <td>{product.category}</td>
                        <td>{product.productionType}</td>
                        <td>{product.level || "No aplica"}</td>
                        <td>
                          <span>Mín. {Number(product.minStock || 0)}</span>
                          <span>Ideal {Number(product.idealStock || 0)}</span>
                        </td>
                        <td>
                          <RequirementChips product={product} />
                        </td>
                        <td>
                          <StatusBadge tone={product.active === false ? "red" : "green"}>
                            {product.active === false ? "Inactivo" : "Activo"}
                          </StatusBadge>
                        </td>
                        <td>
                          <div className="printshop-product-actions">
                            <button type="button" onClick={() => onSelectProduct(product)}>
                              Editar
                            </button>
                            <button type="button" onClick={() => onToggleStatus(product)}>
                              {product.active === false ? "Activar" : "Desactivar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <aside className="printshop-catalog-side">
          <Panel
            title={selectedProduct ? "Editar producto" : "Nuevo producto"}
            icon={selectedProduct ? "✎" : "＋"}
            actionLabel={selectedProduct ? "Editando" : "Alta"}
          >
            <form className="printshop-product-form" onSubmit={onSaveProduct}>
              <label className="full">
                <span>Nombre del producto</span>
                <input
                  name="name"
                  value={productForm.name}
                  onChange={onInputChange}
                  placeholder="Ej. Journey A1"
                />
              </label>

              <label>
                <span>Categoría</span>
                <select
                  name="category"
                  value={productForm.category}
                  onChange={onInputChange}
                >
                  {productCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tipo de producción</span>
                <select
                  name="productionType"
                  value={productForm.productionType}
                  onChange={onInputChange}
                >
                  {productionTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Nivel</span>
                <select name="level" value={productForm.level} onChange={onInputChange}>
                  {levels.map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Unidad</span>
                <select name="unit" value={productForm.unit} onChange={onInputChange}>
                  {units.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Stock mínimo</span>
                <input
                  type="number"
                  name="minStock"
                  min="0"
                  value={productForm.minStock}
                  onChange={onNumberInputChange}
                />
              </label>

              <label>
                <span>Stock ideal</span>
                <input
                  type="number"
                  name="idealStock"
                  min="0"
                  value={productForm.idealStock}
                  onChange={onNumberInputChange}
                />
              </label>

              <div className="printshop-product-checks full">
                <span>Requisitos del producto</span>
                <ProductCheckbox
                  name="requiresPrinting"
                  label="Requiere impresión"
                  checked={productForm.requiresPrinting}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="requiresBinding"
                  label="Requiere encuadernado"
                  checked={productForm.requiresBinding}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="requiresCutting"
                  label="Requiere corte"
                  checked={productForm.requiresCutting}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="requiresQualityCheck"
                  label="Requiere revisión de calidad"
                  checked={productForm.requiresQualityCheck}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="requiresSignature"
                  label="Requiere firma"
                  checked={productForm.requiresSignature}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="requiresValidationQr"
                  label="Requiere folio / QR de validación"
                  checked={productForm.requiresValidationQr}
                  onChange={onInputChange}
                />
                <ProductCheckbox
                  name="active"
                  label="Producto activo"
                  checked={productForm.active}
                  onChange={onInputChange}
                />
              </div>

              <label className="full">
                <span>Observaciones</span>
                <textarea
                  name="notes"
                  value={productForm.notes}
                  onChange={onInputChange}
                  placeholder="Notas internas sobre uso, producción, plantillas o calidad."
                />
              </label>

              {formMessage && <div className="message-box">{formMessage}</div>}

              <div className="printshop-form-actions full">
                {selectedProductId && (
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={onResetForm}
                  >
                    Nuevo producto
                  </button>
                )}

                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={savingProduct || !isAdmin}
                >
                  {savingProduct
                    ? "Guardando..."
                    : selectedProductId
                      ? "Guardar cambios"
                      : "Agregar producto"}
                </button>
              </div>
            </form>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function ProductCheckbox({ name, label, checked, onChange }) {
  return (
    <label className="product-check-item">
      <input type="checkbox" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function RequirementChips({ product }) {
  const requirements = [
    product.requiresPrinting !== false ? "Impresión" : null,
    product.requiresBinding ? "Encuadernado" : null,
    product.requiresCutting ? "Corte" : null,
    product.requiresQualityCheck !== false ? "Calidad" : null,
    product.requiresSignature ? "Firma" : null,
    product.requiresValidationQr ? "QR" : null,
  ].filter(Boolean);

  if (!requirements.length) {
    return <span className="printshop-muted-text">Sin requisitos</span>;
  }

  return (
    <div className="requirement-chip-list">
      {requirements.map((requirement) => (
        <span key={requirement}>{requirement}</span>
      ))}
    </div>
  );
}

function CatalogMetric({ tone, icon, label, value }) {
  return (
    <article className={`catalog-metric-card ${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MetricCard({ metric }) {
  return (
    <article className={`printshop-metric-card ${metric.tone}`}>
      <div className="printshop-metric-icon">{metric.icon}</div>
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <p>{metric.helper}</p>
      </div>
    </article>
  );
}

function ActionCard({ icon, title, description, onClick }) {
  return (
    <button type="button" className="printshop-action-card" onClick={onClick}>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <b>›</b>
    </button>
  );
}

function Panel({ title, icon, actionLabel, children }) {
  return (
    <section className="printshop-panel">
      <div className="printshop-panel-header">
        <div>
          <span>{icon}</span>
          <h2>{title}</h2>
        </div>

        {actionLabel && <button type="button">{actionLabel}</button>}
      </div>

      {children}
    </section>
  );
}

function StatusBadge({ tone = "blue", children }) {
  return <span className={`printshop-status-badge ${tone}`}>{children}</span>;
}

function ProgressBar({ value, tone = "blue" }) {
  return (
    <div className="printshop-progress-cell">
      <div className="printshop-progress-track">
        <div
          className={`printshop-progress-fill ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <strong>{value}%</strong>
    </div>
  );
}

function RoadmapItem({ number, title, description, active = false }) {
  return (
    <div className={`printshop-roadmap-item ${active ? "active" : ""}`}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
