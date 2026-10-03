const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const PROCESSOR_VERSION = "office-pdf-v1";
const processingTargetPath = (revision) => `active-classroom/publications/files/${createHash("sha256").update(`${revision}:pdf`).digest("hex")}`;
const OFFICE_MIMES = {
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.google-apps.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.google-apps.document": "docx",
};
function officeExtension(resource) { return OFFICE_MIMES[resource?.mimeType] || (/\.(pptx?|docx?)$/i.exec(resource?.sourceName || resource?.name || "")?.[1].toLowerCase()) || null; }
function processingFingerprint(resource) {
  const source = resource.source === "drive"
    ? [resource.driveFileId, resource.driveVersion || "", resource.driveModifiedTime || "", resource.driveMd5Checksum || "", resource.sourceName || resource.name]
    : [resource.storagePath, resource.storageMd5Hash || "", resource.name];
  return createHash("sha256").update(JSON.stringify([PROCESSOR_VERSION, resource.source || "storage", resource.mimeType, ...source])).digest("hex");
}
function readyProcessing(resource) {
  const processing = resource?.processing;
  return processing?.state === "ready" && processing.sourceFingerprint === processingFingerprint(resource) && processing.processorVersion === PROCESSOR_VERSION;
}
function requireReady(resource) {
  if (officeExtension(resource) && !readyProcessing(resource)) throw new HttpsError("failed-precondition", "Procesando documento Office: procesa el original antes de publicar.");
}
function pdfSlides(resource, previous = []) {
  requireReady(resource);
  const count = resource.processing.pageCount;
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new HttpsError("data-loss", "Cantidad de páginas PDF inválida.");
  return Array.from({ length: count }, (_, index) => {
    const pageNumber = index + 1;
    const old = previous.find((slide) => (slide.metadata?.pageNumber ?? slide.index + 1) === pageNumber);
    return { slideId: old?.slideId || `pdf-${createHash("sha256").update(resource.id).digest("hex").slice(0, 16)}-${pageNumber}`, index, title: old?.title || "", resourceIds: old?.resourceIds || [], metadata: { pageNumber, notes: old?.metadata?.notes || "" } };
  });
}
module.exports = { PROCESSOR_VERSION, processingTargetPath, OFFICE_MIMES, officeExtension, processingFingerprint, readyProcessing, requireReady, pdfSlides };
