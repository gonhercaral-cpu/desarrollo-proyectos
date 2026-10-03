const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { PROCESSOR_VERSION, processingTargetPath, officeExtension, processingFingerprint, requireReady, readyProcessing, pdfSlides } = require("./activeClassroomProcessingModel");

const MAX_BYTES = 250 * 1024 * 1024;
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const fail = (message, code = "failed-precondition") => { throw new HttpsError(code, message); };

function createDocumentProcessing({ db, bucket, getProfile, prepareResource, convert, timestamp, clock = Date.now }) {
  const units = db.collection("activeClassroomUnits");
  const resources = db.collection("activeClassroomResources");
  const jobs = db.collection("activeClassroomProcessingJobs");

  async function verifyDerivative(result, attemptId) {
    if (result?.processorVersion !== PROCESSOR_VERSION || result.revision !== attemptId || !Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 200) fail("Resultado PDF inválido.", "data-loss");
    const download = result.download;
    if (download?.path !== processingTargetPath(attemptId) || !/^\d+$/.test(download.generation || "") || download.endpoint !== "activeClassroomPublicationFile" || download.provider !== "storage" || typeof download.name !== "string" || download.name.length > 160 || download.mimeType !== "application/pdf" || !Number.isSafeInteger(download.sizeBytes) || download.sizeBytes < 5 || download.sizeBytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(download.checksums?.sha256 || "")) fail("Referencia PDF inválida.", "data-loss");
    const file = bucket.file(download.path, { generation: download.generation });
    const [metadata] = await file.getMetadata();
    if (String(metadata.generation) !== download.generation || metadata.contentType !== "application/pdf" || Number(metadata.size) !== download.sizeBytes || metadata.metadata?.sha256 !== download.checksums.sha256 || metadata.metadata?.processingRevision !== attemptId || Number(metadata.metadata?.pageCount) !== result.pageCount) fail("El derivado no corresponde a esta conversión.", "data-loss");
    let size = 0; let prefix = Buffer.alloc(0); const hash = createHash("sha256");
    for await (const chunk of file.createReadStream()) {
      size += chunk.length;
      if (size > MAX_BYTES) fail("PDF demasiado grande.", "resource-exhausted");
      if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
      hash.update(chunk);
    }
    if (prefix.toString() !== "%PDF-" || size !== download.sizeBytes || hash.digest("hex") !== download.checksums.sha256) fail("PDF corrupto o checksum incorrecto.", "data-loss");
    return download;
  }

  async function applyReady(unitId, resourceId, expectedRevision) {
    return db.runTransaction(async (transaction) => {
      const unitRef = units.doc(unitId); const resourceRef = resources.doc(resourceId);
      const unit = (await transaction.get(unitRef)).data();
      const resource = { id: resourceId, ...(await transaction.get(resourceRef)).data() };
      if (!unit?.draft || unit.draftRevision !== expectedRevision) fail("El borrador cambió. Recarga y aplica el documento procesado.", "aborted");
      requireReady(resource);
      const draft = { ...unit.draft };
      if (draft.mainPresentationId === resourceId) {
        const slides = pdfSlides(resource, draft.slides);
        const retained = new Set(slides.flatMap((slide) => slide.resourceIds));
        const orphaned = draft.slides.flatMap((slide) => slide.resourceIds).filter((id) => id !== resourceId && !retained.has(id));
        draft.slides = slides;
        draft.generalResourceIds = [...new Set([...draft.generalResourceIds, ...orphaned])];
      }
      const draftRevision = unit.draftRevision + 1;
      transaction.update(unitRef, { draft, draftRevision, updatedAt: timestamp() });
      return { state: "ready", processing: resource.processing, draft, draftRevision };
    });
  }

  async function process(request) {
    if (!request.auth?.uid) fail("Debes iniciar sesión.", "unauthenticated");
    const profile = await getProfile(request.auth.uid);
    if (profile?.active !== true || profile.role !== "admin") fail("Solo administradores pueden procesar documentos.", "permission-denied");
    const { unitId, resourceId, expectedRevision } = request.data || {};
    if (!validId(unitId) || !validId(resourceId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("Solicitud de procesamiento inválida.", "invalid-argument");
    const resourceRef = resources.doc(resourceId);
    const resource = { id: resourceId, ...(await resourceRef.get()).data() };
    if (resource.folderId !== unitId || resource.archived || !officeExtension(resource)) fail("El recurso Office no pertenece a esta Unit.");
    // Existing snapshot infrastructure checks Drive ACL/version before and after reading.
    const original = await prepareResource(profile, resource);
    const fingerprint = processingFingerprint(resource);
    if (readyProcessing(resource)) {
      if (resource.processing.original.path !== original.path || resource.processing.original.generation !== original.generation) fail("El original cambió. Actualiza el borrador.");
      return applyReady(unitId, resourceId, expectedRevision);
    }
    const attemptId = randomUUID(); const jobRef = jobs.doc(attemptId);
    const accepted = await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(resourceRef)).data();
      const unit = (await transaction.get(units.doc(unitId))).data();
      if (!unit?.draft || unit.draftRevision !== expectedRevision) fail("El borrador cambió. Recarga antes de procesar.", "aborted");
      if (!current || current.folderId !== unitId || current.archived || processingFingerprint(current) !== fingerprint) fail("El original cambió durante la solicitud.", "aborted");
      if (["pending", "processing"].includes(current.processing?.state) && current.processing.leaseUntil > clock()) return false;
      const processing = { state: "pending", jobId: attemptId, revision: attemptId, processorVersion: PROCESSOR_VERSION, sourceFingerprint: fingerprint, original, requestedAt: new Date(clock()).toISOString(), leaseUntil: clock() + 540000, requestedByUid: request.auth.uid };
      transaction.create(jobRef, { ...processing, unitId, resourceId });
      transaction.update(resourceRef, { processing });
      return true;
    });
    if (!accepted) return { state: "processing" };
    try {
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        if (current?.processing?.jobId !== attemptId) fail("Solicitud reemplazada.", "aborted");
        transaction.update(jobRef, { state: "processing", startedAt: timestamp() });
        transaction.update(resourceRef, { "processing.state": "processing" });
      });
      const result = await convert({ revision: attemptId, processorVersion: PROCESSOR_VERSION, extension: officeExtension(resource), original });
      const download = await verifyDerivative(result, attemptId);
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        if (current?.processing?.jobId !== attemptId || current.archived || processingFingerprint(current) !== fingerprint) fail("El original cambió durante el procesamiento. Reintenta desde el borrador actual.", "aborted");
        const processing = { ...current.processing, state: "ready", download, pageCount: result.pageCount, completedAt: new Date(clock()).toISOString(), textExtraction: null };
        transaction.update(resourceRef, { processing });
        transaction.update(jobRef, { state: "ready", download, pageCount: result.pageCount, completedAt: timestamp() });
      });
    } catch (error) {
      // Keep diagnostics fixed; converter stdout/paths and upstream credentials are never exposed.
      console.error("Active Classroom document processing failed", { code: error instanceof HttpsError ? error.code : "conversion-failed" });
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        transaction.update(jobRef, { state: "failed", errorCode: error instanceof HttpsError ? error.code : "conversion-failed", failedAt: timestamp() });
        if (current?.processing?.jobId === attemptId) transaction.update(resourceRef, { "processing.state": "failed", "processing.error": "No se pudo procesar el documento. Reintenta o revisa el original." });
      });
      fail("Error de procesamiento. Reintenta o revisa el original.");
    }
    return applyReady(unitId, resourceId, expectedRevision);
  }

  async function prepareDelivery(profile, resource) {
    requireReady(resource);
    const original = await prepareResource(profile, resource);
    if (!officeExtension(resource)) return original;
    const processing = resource.processing;
    if (processing.original.path !== original.path || processing.original.generation !== original.generation || processing.original.checksums.sha256 !== original.checksums.sha256) fail("El original cambió. Procesa nuevamente el borrador.");
    // Generation is immutable. Full bytes/hash were verified when the processor completed.
    const [metadata] = await bucket.file(processing.download.path, { generation: processing.download.generation }).getMetadata();
    if (String(metadata.generation) !== processing.download.generation || Number(metadata.size) !== processing.download.sizeBytes || metadata.metadata?.sha256 !== processing.download.checksums.sha256 || metadata.contentType !== "application/pdf") fail("El PDF procesado no está disponible.", "data-loss");
    return processing.download;
  }
  return { process, prepareDelivery, verifyDerivative };
}
module.exports = { createDocumentProcessing };
