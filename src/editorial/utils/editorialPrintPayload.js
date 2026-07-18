// Fase 7 — Envío de exportaciones a Imprenta.
// Construye el payload para la Cloud Function existente
// `createPrintRequestWithAssignment` a partir de un PDF de imprenta editorial.
// El flujo de certificados/diplomas queda TOTALMENTE separado: aquí nunca se usa
// requestType "Certificado" ni "Diploma" ni campos de plantilla de certificado.

// Tipo de solicitud genérico por defecto (no certificado).
export const EDITORIAL_PRINT_REQUEST_TYPE = "Material interno";

// Tipos prohibidos para el puente editorial (pertenecen al flujo de certificados).
const CERTIFICATE_REQUEST_TYPES = new Set(["Certificado", "Diploma"]);

const PAPER_SIZES = ["Carta", "Oficio", "Tabloide", "A4", "Media carta", "Personalizado"];
const SIDES_OPTIONS = ["Una cara", "Doble cara"];
const COLOR_OPTIONS = ["Color", "Blanco y negro"];
const FINISH_OPTIONS = ["Sin acabado", "Engrapado", "Engargolado", "Empastado", "Plastificado", "Corte y doblez"];
const PRIORITY_OPTIONS = ["Baja", "Normal", "Alta", "Urgente"];

export const EDITORIAL_PRINT_OPTIONS = {
  paperSizes: PAPER_SIZES,
  sides: SIDES_OPTIONS,
  colors: COLOR_OPTIONS,
  finishes: FINISH_OPTIONS,
  priorities: PRIORITY_OPTIONS,
};

function variantLabel(variant) {
  if (variant === "teacher") return "Maestro";
  if (variant === "student") return "Alumno";
  if (variant === "review") return "Revisión";
  if (variant === "print") return "Imprenta";
  return variant || "";
}

// Campos autocompletados desde el documento/export editorial.
export function buildPrintAutofill({ project = {}, document = {}, exportItem = {}, user = {} } = {}) {
  const baseName = document.title || project.name || "Material editorial";
  return {
    productName: `${baseName} · ${variantLabel(exportItem.variant)}`.trim(),
    pages: Number(exportItem.pageCount || document.pageCount || project.pageCount || 0),
    size: project.size || "",
    variant: exportItem.variant || "",
    requesterName: String(user.name || user.email || ""),
    requesterArea: "Desarrollo de Material",
  };
}

// Construye el payload final. `form` trae lo que el usuario capturó
// (quantity/color/sides/paper/finish/priority/campus/date/notes). `autofill`
// viene de buildPrintAutofill. Lanza si faltan datos mínimos o si el export no
// es de imprenta terminado.
export function buildPrintRequestPayload({
  project = {},
  document = {},
  exportItem = {},
  autofill = {},
  form = {},
} = {}) {
  if (!exportItem || exportItem.status !== "completed") {
    throw new Error("La exportación de imprenta no está terminada.");
  }
  if (!(exportItem.downloadUrl || exportItem.downloadURL) || !exportItem.storagePath) {
    throw new Error("La exportación no tiene archivo para adjuntar.");
  }
  const requestedQuantity = Number(form.requestedQuantity || 0);
  if (!(requestedQuantity > 0)) {
    throw new Error("La cantidad solicitada debe ser mayor que cero.");
  }
  if (!String(form.campus || "").trim()) {
    throw new Error("Indica el plantel.");
  }
  const requestType = form.requestType && !CERTIFICATE_REQUEST_TYPES.has(form.requestType)
    ? form.requestType
    : EDITORIAL_PRINT_REQUEST_TYPE;

  return {
    requestType,
    productName: autofill.productName || project.name || "",
    requesterName: form.requesterName || autofill.requesterName || "",
    requesterArea: form.requesterArea || autofill.requesterArea || "Desarrollo de Material",
    campus: String(form.campus).trim(),
    requestedQuantity,
    deliveredQuantity: 0,
    priority: form.priority || "Normal",
    deliveryType: form.deliveryType || "Impresa",
    requestDate: form.requestDate || "",
    dueDate: form.dueDate || "",
    notes: String(form.notes || ""),
    // Especificaciones de impresión.
    printColor: form.color || "",
    printSides: form.sides || "",
    printPaper: form.paper || "",
    printFinish: form.finish || "",
    // Referencia (no copia) al PDF editorial.
    sourceModule: "editorial",
    editorialProjectId: String(project.id || ""),
    editorialDocumentId: String(document.id || ""),
    editorialExportId: String(exportItem.id || ""),
    editorialVariant: exportItem.variant || "",
    editorialPages: Number(autofill.pages || 0),
    attachmentStoragePath: exportItem.storagePath || "",
    attachmentUrl: exportItem.downloadUrl || exportItem.downloadURL || "",
    attachmentName: `${autofill.productName || "material"}.pdf`,
  };
}

// ¿Es un export apto para imprenta? (type "print" terminado.)
export function isPrintableExport(exportItem) {
  return Boolean(
    exportItem &&
      exportItem.type === "print" &&
      exportItem.status === "completed" &&
      exportItem.storagePath
  );
}
