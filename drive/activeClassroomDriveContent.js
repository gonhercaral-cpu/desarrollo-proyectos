const { HttpsError } = require("firebase-functions/v2/https");

function googleErrorReason(error) {
  const supplied = error?.response?.data?.error?.errors || error?.errors;
  const reasons = Array.isArray(supplied) ? supplied : [];
  if (error?.details?.reason === "exportSizeLimitExceeded" || reasons.some((entry) => entry?.reason === "exportSizeLimitExceeded")) return "exportSizeLimitExceeded";
  return reasons.map((entry) => entry?.reason).find((reason) => typeof reason === "string") || "";
}
function processingError(error, slides = false) {
  const processorError = error?.response?.data?.error;
  const processorMessages = {
    "conversion-timeout": ["deadline-exceeded", "La conversión agotó el tiempo. Reintenta; si persiste, divide la presentación."],
    "invalid-office-file": ["failed-precondition", "La presentación está dañada o tiene un formato incorrecto. Revisa el archivo original."],
    "invalid-office-archive": ["resource-exhausted", "La presentación contiene recursos descomprimidos fuera de los límites permitidos o un archivo inválido."],
    "external-document-reference": ["failed-precondition", "La presentación contiene recursos vinculados externamente. Incrústalos antes de importar."],
    "file-too-large": ["resource-exhausted", "La presentación supera el tamaño permitido para conversión."],
    "too-many-slides": ["resource-exhausted", "La presentación supera 200 diapositivas. Divídela antes de importar."],
    "invalid-page-count": ["resource-exhausted", "La presentación convertida requiere entre 1 y 200 páginas."],
  };
  if (typeof processorError === "string" && Object.hasOwn(processorMessages, processorError)) {
    const [code, message] = processorMessages[processorError];
    return new HttpsError(code, message);
  }
  if (googleErrorReason(error) === "exportSizeLimitExceeded") return new HttpsError("resource-exhausted", "El archivo de Google supera el límite de exportación. Procesa Google Slides por diapositivas.", { reason: "exportSizeLimitExceeded" });
  if (Number(error?.response?.status || error?.code) === 413) return new HttpsError("resource-exhausted", "El proveedor rechazó el archivo por superar su límite de tamaño.", { reason: "providerSizeLimitExceeded" });
  if (error instanceof HttpsError) return error;
  return new HttpsError("failed-precondition", slides ? "No se pudo procesar la presentación de Google Slides" : "No se pudo procesar el documento. Reintenta o revisa el original.");
}
async function openActiveClassroomDrive(drive, file, descriptor) {
  if (file.mimeType === "application/vnd.google-apps.presentation") throw new HttpsError("failed-precondition", "Google Slides requiere procesamiento por diapositivas.");
  try {
    // Only native Workspace documents use export. Real PPT/PPTX always use media,
    // even when an outdated caller passes an exported descriptor.
    const response = file.mimeType.startsWith("application/vnd.google-apps.")
      ? await drive.files.export({ fileId: file.id, mimeType: descriptor.deliveredMimeType }, { responseType: "stream" })
      : await drive.files.get({ fileId: file.id, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    return response.data;
  } catch (error) { throw processingError(error); }
}
module.exports = { openActiveClassroomDrive, googleErrorReason, processingError };
