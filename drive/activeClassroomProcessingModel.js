const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const PROCESSOR_VERSION = "office-pdf-v1";
const SLIDES_PROCESSOR_VERSION = "google-slides-png-v1";
const isGoogleSlides = (resource) => resource?.mimeType === "application/vnd.google-apps.presentation";
const validPageObjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_:-]{0,199}$/.test(value);
const processorVersion = (resource) => isGoogleSlides(resource) ? SLIDES_PROCESSOR_VERSION : PROCESSOR_VERSION;
const slideResourceId = (resourceId, pageObjectId) => `gs-${createHash("sha256").update(`${resourceId}:${pageObjectId}`).digest("hex").slice(0, 40)}`;
const slidesTargetPath = (revision, pageObjectId) => `active-classroom/publications/files/${createHash("sha256").update(`${revision}:png:${pageObjectId}`).digest("hex")}`;
const processingTargetPath = (revision) => `active-classroom/publications/files/${createHash("sha256").update(`${revision}:pdf`).digest("hex")}`;
const OFFICE_MIMES = {
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.google-apps.document": "docx",
};
function officeExtension(resource) { return isGoogleSlides(resource) ? null : OFFICE_MIMES[resource?.mimeType] || (/\.(pptx?|docx?)$/i.exec(resource?.sourceName || resource?.name || "")?.[1].toLowerCase()) || null; }
const needsDocumentProcessing = (resource) => isGoogleSlides(resource) || Boolean(officeExtension(resource));
function processingFingerprint(resource) {
  const source = resource.source === "drive"
    ? [resource.driveFileId, resource.driveVersion || "", resource.driveModifiedTime || "", resource.driveMd5Checksum || "", resource.sourceName || resource.name]
    : [resource.storagePath, resource.storageMd5Hash || "", resource.name];
  return createHash("sha256").update(JSON.stringify([processorVersion(resource), resource.source || "storage", resource.mimeType, ...source])).digest("hex");
}
function readyProcessing(resource) {
  const processing = resource?.processing;
  return processing?.state === "ready" && processing.sourceFingerprint === processingFingerprint(resource) && processing.processorVersion === processorVersion(resource)
    && (!isGoogleSlides(resource) || (Array.isArray(processing.pages) && processing.pages.length === processing.pageCount && processing.pageCount > 0 && processing.pageCount <= 200 && processing.download?.mimeType === "image/png"));
}
function requireReady(resource) {
  if (needsDocumentProcessing(resource) && !readyProcessing(resource)) throw new HttpsError("failed-precondition", "Procesando documento: procesa el original antes de publicar.");
}
function pdfSlides(resource, previous = []) {
  requireReady(resource);
  if (isGoogleSlides(resource)) return resource.processing.pages.map((page, index) => {
    const old = previous.find((slide) => slide.metadata?.pageObjectId === page.pageObjectId) || (previous[index]?.metadata?.pageObjectId ? null : previous[index]);
    return { slideId: old?.slideId || slideResourceId(resource.id, page.pageObjectId), index, title: old?.title || "", resourceIds: old?.resourceIds || [], metadata: { pageNumber: 1, pageObjectId: page.pageObjectId, presentationResourceId: index === 0 ? resource.id : slideResourceId(resource.id, page.pageObjectId), notes: old?.metadata?.notes || "" } };
  });
  const count = resource.processing.pageCount;
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new HttpsError("data-loss", "Cantidad de páginas PDF inválida.");
  return Array.from({ length: count }, (_, index) => {
    const pageNumber = index + 1;
    const old = previous.find((slide) => (slide.metadata?.pageNumber ?? slide.index + 1) === pageNumber);
    return { slideId: old?.slideId || `pdf-${createHash("sha256").update(resource.id).digest("hex").slice(0, 16)}-${pageNumber}`, index, title: old?.title || "", resourceIds: old?.resourceIds || [], metadata: { pageNumber, notes: old?.metadata?.notes || "" } };
  });
}
module.exports = { PROCESSOR_VERSION, SLIDES_PROCESSOR_VERSION, isGoogleSlides, validPageObjectId, processorVersion, needsDocumentProcessing, slideResourceId, slidesTargetPath, processingTargetPath, OFFICE_MIMES, officeExtension, processingFingerprint, readyProcessing, requireReady, pdfSlides };
