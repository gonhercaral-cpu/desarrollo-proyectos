const { HttpsError } = require("firebase-functions/v2/https");

function googleErrorReason(error) {
  const supplied = error?.response?.data?.error?.errors || error?.errors;
  const reasons = Array.isArray(supplied) ? supplied : [];
  if (error?.details?.reason === "exportSizeLimitExceeded" || reasons.some((entry) => entry?.reason === "exportSizeLimitExceeded")) return "exportSizeLimitExceeded";
  return reasons.map((entry) => entry?.reason).find((reason) => typeof reason === "string") || "";
}
function processingError(error, slides = false) {
  if (googleErrorReason(error) === "exportSizeLimitExceeded") return new HttpsError("resource-exhausted", "El archivo de Google supera el límite de exportación. Procesa Google Slides por diapositivas.", { reason: "exportSizeLimitExceeded" });
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
