const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { PROCESSOR_VERSION, PPTX_PROCESSOR_VERSION, isRasterSlides, rasterTargetPath, processingTargetPath, officeExtension, isGoogleSlides, processorVersion, needsDocumentProcessing, processingFingerprint, requireReady, readyProcessing, pdfSlides } = require("./activeClassroomProcessingModel");
const { processingError, googleErrorReason } = require("./activeClassroomDriveContent");

const MAX_BYTES = 250 * 1024 * 1024;
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const fail = (message, code = "failed-precondition") => { throw new HttpsError(code, message); };
function logFailure(error, nativeSlides, stage) {
  const safeError = processingError(error, nativeSlides);
  const reason = googleErrorReason(error).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  console.error("Active Classroom document processing failed", { stage, code: safeError.code, sourceType: nativeSlides ? "google-slides" : "office", upstreamStatus: Number(error?.response?.status || error.status) || null, reason });
  return safeError;
}

function createDocumentProcessing({ db, bucket, getProfile, prepareResource, convert, googleSlides, timestamp, clock = Date.now }) {
  const units = db.collection("activeClassroomUnits");
  const resources = db.collection("activeClassroomResources");
  const jobs = db.collection("activeClassroomProcessingJobs");

  async function verifyDerivative(result, attemptId) {
    if (result?.processorVersion === PPTX_PROCESSOR_VERSION) {
      if (result.revision !== attemptId || !Array.isArray(result.pages) || result.pageCount !== result.pages.length || !result.pages.length || result.pages.length > 200) fail("Estados PPTX incompletos.", "data-loss");
      const states = result.pages.flatMap(page => [page, ...(page.builds || [])]);
      if (states.length > 200) fail("Demasiados estados PPTX.", "resource-exhausted");
      for (const [index, state] of states.entries()) {
        const download = state.download;
        if (download?.path !== rasterTargetPath(attemptId, index) || !/^\d+$/.test(download.generation || "") || download.mimeType !== "image/png" || download.endpoint !== "activeClassroomPublicationFile" || !Number.isSafeInteger(download.sizeBytes) || download.sizeBytes < 24 || download.sizeBytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(download.checksums?.sha256 || "")) fail("Referencia de estado PPTX inválida.", "data-loss");
        const file = bucket.file(download.path, { generation: download.generation });
        const [metadata] = await file.getMetadata();
        if (String(metadata.generation) !== download.generation || metadata.contentType !== "image/png" || Number(metadata.size) !== download.sizeBytes || metadata.metadata?.sha256 !== download.checksums.sha256 || metadata.metadata?.processingRevision !== attemptId) fail("Estado PPTX no disponible.", "data-loss");
        const hash = createHash("sha256"); let size = 0; let header = Buffer.alloc(0);
        for await (const chunk of file.createReadStream()) {
          size += chunk.length;
          if (size > download.sizeBytes) fail("Estado PNG demasiado grande.", "data-loss");
          if (header.length < 24) header = Buffer.concat([header, chunk.subarray(0, 24 - header.length)]);
          hash.update(chunk);
        }
        if (size !== download.sizeBytes || hash.digest("hex") !== download.checksums.sha256 || header.length < 24 || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || header.readUInt32BE(16) !== state.width || header.readUInt32BE(20) !== state.height) fail("Estado PNG dañado.", "data-loss");
      }
      return result.pages[0].download;
    }
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
    if (resource.folderId !== unitId || resource.archived || !needsDocumentProcessing(resource)) fail("El documento no pertenece a esta Unit.");
    // Existing snapshot infrastructure checks Drive ACL/version before and after reading.
    const nativeSlides = isGoogleSlides(resource);
    let original;
    try { original = nativeSlides ? await googleSlides.original(profile, resource) : await prepareResource(profile, resource); }
    catch (error) { throw logFailure(error, nativeSlides, "original"); }
    const fingerprint = processingFingerprint(resource);
    if (readyProcessing(resource) && resource.processing.processorVersion === processorVersion(resource)) {
      const saved = resource.processing.original;
      const matches = nativeSlides
        ? ["fileId", "name", "mimeType", "version", "modifiedTime"].every((key) => saved?.[key] === original[key])
        : saved?.path === original.path && saved.generation === original.generation && saved.checksums?.sha256 === original.checksums?.sha256;
      if (!matches) fail("El original cambió. Actualiza el borrador.");
      if (nativeSlides) await googleSlides.verify(resource.processing);
      return applyReady(unitId, resourceId, expectedRevision);
    }
    const attemptId = randomUUID(); const jobRef = jobs.doc(attemptId);
    const accepted = await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(resourceRef)).data();
      const unit = (await transaction.get(units.doc(unitId))).data();
      if (!unit?.draft || unit.draftRevision !== expectedRevision) fail("El borrador cambió. Recarga antes de procesar.", "aborted");
      if (!current || current.folderId !== unitId || current.archived || processingFingerprint(current) !== fingerprint) fail("El original cambió durante la solicitud.", "aborted");
      if (["pending", "processing"].includes(current.processing?.state) && current.processing.leaseUntil > clock()) return false;
      const processing = { state: "pending", jobId: attemptId, revision: attemptId, processorVersion: processorVersion(resource), sourceFingerprint: fingerprint, original, requestedAt: new Date(clock()).toISOString(), leaseUntil: clock() + 540000, requestedByUid: request.auth.uid };
      transaction.create(jobRef, { ...processing, unitId, resourceId });
      transaction.update(resourceRef, { processing });
      return true;
    });
    if (!accepted) return { state: "processing" };
    let rendered;
    try {
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        if (current?.processing?.jobId !== attemptId) fail("Solicitud reemplazada.", "aborted");
        transaction.update(jobRef, { state: "processing", startedAt: timestamp() });
        transaction.update(resourceRef, { "processing.state": "processing" });
      });
      const result = nativeSlides ? await googleSlides.render({ profile, resource, revision: attemptId }) : await convert({ revision: attemptId, processorVersion: processorVersion(resource), extension: officeExtension(resource), original });
      rendered = result;
      if (result?.processorVersion !== processorVersion(resource)) fail("Versión del procesador incompatible.", "data-loss");
      const download = nativeSlides ? await googleSlides.verify(result) : await verifyDerivative(result, attemptId);
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        if (current?.processing?.jobId !== attemptId || current.archived || processingFingerprint(current) !== fingerprint) fail("El original cambió durante el procesamiento. Reintenta desde el borrador actual.", "aborted");
        const processing = { ...current.processing, state: "ready", download, pageCount: result.pageCount, completedAt: new Date(clock()).toISOString(), textExtraction: null, ...(result.pages ? { sourceType: nativeSlides ? "google-slides" : "pptx", pages: result.pages } : {}) };
        transaction.update(resourceRef, { processing });
        transaction.update(jobRef, { state: "ready", download, pageCount: result.pageCount, completedAt: timestamp() });
      });
    } catch (error) {
      // Keep diagnostics fixed; converter stdout/paths and upstream credentials are never exposed.
      const safeError = logFailure(error, nativeSlides, "derivative");
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(resourceRef)).data();
        if (current?.processing?.jobId === attemptId && current.processing.state === "ready") return;
        transaction.update(jobRef, { state: "failed", errorCode: safeError.code, failedAt: timestamp() });
        if (current?.processing?.jobId === attemptId) transaction.update(resourceRef, { "processing.state": "failed", "processing.error": nativeSlides ? "No se pudo procesar la presentación de Google Slides" : safeError.message });
      });
      // An uncertain commit may already be ready. Never delete a committed revision.
      const current = (await resourceRef.get()).data();
      if (rendered?.processorVersion === PPTX_PROCESSOR_VERSION && current?.processing?.jobId === attemptId && current.processing.state === "failed") {
        await Promise.allSettled((rendered.pages || []).flatMap(page => [page, ...(page.builds || [])]).map((state, index) => state.download?.path === rasterTargetPath(attemptId, index) ? bucket.file(state.download.path).delete({ ignoreNotFound: true }) : Promise.resolve()));
      }
      if (nativeSlides && safeError.code !== "aborted" && safeError.code !== "resource-exhausted") fail("No se pudo procesar la presentación de Google Slides");
      throw safeError;
    }
    return applyReady(unitId, resourceId, expectedRevision);
  }

  async function prepareDelivery(profile, resource, options) {
    requireReady(resource);
    if (isGoogleSlides(resource)) {
      await googleSlides.original(profile, resource);
      return googleSlides.verify(resource.processing);
    }
    const original = await prepareResource(profile, resource, options);
    if (!officeExtension(resource)) return original;
    const processing = resource.processing;
    if (processing.original.path !== original.path || processing.original.generation !== original.generation || processing.original.checksums.sha256 !== original.checksums.sha256) fail("El original cambió. Procesa nuevamente el borrador.");
    if (isRasterSlides(resource)) {
      for (const state of processing.pages.flatMap(page => [page, ...(page.builds || [])])) {
        const [metadata] = await bucket.file(state.download.path, { generation: state.download.generation }).getMetadata();
        if (String(metadata.generation) !== state.download.generation || Number(metadata.size) !== state.download.sizeBytes || metadata.metadata?.sha256 !== state.download.checksums.sha256 || metadata.contentType !== "image/png") fail("Un estado de revelado no está disponible.", "data-loss");
      }
      return processing.download;
    }
    // Generation is immutable. Full bytes/hash were verified when the processor completed.
    const [metadata] = await bucket.file(processing.download.path, { generation: processing.download.generation }).getMetadata();
    if (String(metadata.generation) !== processing.download.generation || Number(metadata.size) !== processing.download.sizeBytes || metadata.metadata?.sha256 !== processing.download.checksums.sha256 || metadata.contentType !== "application/pdf") fail("El PDF procesado no está disponible.", "data-loss");
    return processing.download;
  }
  return { process, prepareDelivery, verifyDerivative };
}
module.exports = { createDocumentProcessing };
