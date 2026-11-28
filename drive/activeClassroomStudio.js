const { HttpsError } = require("firebase-functions/v2/https");
const { requireClassroom } = require("./activeClassroomPermissions");
const { isGoogleSlides, officeExtension, processingFingerprint, readyProcessing } = require("./activeClassroomProcessingModel");

const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const invalid = message => { throw new HttpsError("invalid-argument", message); };
const conflict = message => { throw new HttpsError("aborted", message); };
const pending = (processing, now) => ["pending", "processing"].includes(processing?.state) && processing.leaseUntil > now;
const geometry = { x: [-60000000, 60000000], y: [-60000000, 60000000], width: [1, 60000000], height: [1, 60000000], fontSize: [100, 10000] };
const exportPptx = { exported: true, deliveredMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

function normalizeStudioEdits(value) {
  if (!Array.isArray(value) || value.length > 100) invalid("El borrador admite hasta 100 correcciones.");
  const seen = new Set();
  let totalText = 0;
  return value.map(edit => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) invalid("Corrección inválida.");
    const { slideIndex, id, ...changes } = edit;
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 199 || typeof id !== "string" || !/^[0-9]{1,10}$/.test(id)) invalid("Elemento de diapositiva inválido.");
    const key = `${slideIndex}:${id}`;
    if (seen.has(key) || Object.keys(changes).length === 0) invalid("Cada elemento debe tener una sola corrección.");
    seen.add(key);
    for (const [field, entry] of Object.entries(changes)) {
      if (field === "text") {
        // eslint-disable-next-line no-control-regex
        if (typeof entry !== "string" || entry.length > 3000 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff\ufffe\uffff]/u.test(entry)) invalid("Usa texto de un solo párrafo y hasta 3000 caracteres.");
        totalText += entry.length;
        if (totalText > 24000) invalid("El texto de las correcciones supera el límite del borrador.");
      } else {
        const bounds = Object.hasOwn(geometry, field) && geometry[field];
        if (!bounds || !Number.isInteger(entry) || entry < bounds[0] || entry > bounds[1]) invalid("Propiedad de Studio inválida.");
      }
    }
    return { slideIndex, id, ...changes };
  });
}

function studioRef(db, resourceId) {
  // This collection is accessible only through the authorized server handlers.
  return db.collection("activeClassroomStudioDrafts").doc(resourceId);
}

function createStudioHandlers({ db, getProfile, prepareResource, inspect, timestamp, clock = Date.now }) {
  async function authorize(request, action) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = requireClassroom(await getProfile(uid), action);
    const { unitId, resourceId } = request.data || {};
    if (!validId(unitId) || !validId(resourceId)) invalid("Presentación de Studio inválida.");
    const resourceRef = db.collection("activeClassroomResources").doc(resourceId);
    return { uid, profile, unitId, resourceId, resourceRef, draftRef: studioRef(db, resourceId) };
  }

  function verifyResource(resource, unitId) {
    if (!resource || resource.folderId !== unitId || resource.archived || (!isGoogleSlides(resource) && officeExtension(resource) !== "pptx")) {
      throw new HttpsError("not-found", "La presentación no está disponible en esta unidad.");
    }
    return processingFingerprint(resource);
  }

  function visibleDraft(saved, fingerprint) {
    return {
      revision: saved?.revision || 0,
      reviewRevision: saved?.reviewRevision || 0,
      appliedRevision: saved?.sourceFingerprint === fingerprint ? saved.appliedRevision || 0 : 0,
      edits: saved?.sourceFingerprint === fingerprint ? saved.edits : [],
      status: saved?.sourceFingerprint === fingerprint ? saved.status || "pending" : "pending",
      priority: saved?.sourceFingerprint === fingerprint ? saved.priority || "normal" : "normal",
      assigneeUid: saved?.sourceFingerprint === fingerprint ? saved.assigneeUid || "" : "",
      assigneeName: saved?.sourceFingerprint === fingerprint ? saved.assigneeName || "" : "",
      notes: saved?.sourceFingerprint === fingerprint ? saved.notes || "" : "",
      updatedAt: saved?.sourceFingerprint === fingerprint ? saved.updatedAtIso || null : null,
    };
  }

  return {
    async get(request) {
      const { unitId, resourceRef, draftRef } = await authorize(request, "access");
      const [resource, saved] = await Promise.all([resourceRef.get(), draftRef.get()]);
      return visibleDraft(saved.data(), verifyResource(resource.data(), unitId));
    },
    async inspect(request) {
      const { profile, unitId, resourceRef, resourceId } = await authorize(request, "orderMaterial");
      const { slideIndex } = request.data;
      if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 199) invalid("Diapositiva inválida.");
      const resource = { id: resourceId, ...(await resourceRef.get()).data() };
      verifyResource(resource, unitId);
      if (!readyProcessing(resource) || !resource.processing.pages?.[slideIndex]) throw new HttpsError("failed-precondition", "Convierte la presentación antes de editar sus elementos.");
      const original = await prepareStudioSource(prepareResource, profile, resource);
      if (!isGoogleSlides(resource) && original.generation !== resource.processing.original.generation) conflict("El archivo original cambió. Actualiza la conversión.");
      try { return await inspect(original, slideIndex); }
      catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("failed-precondition", "El procesador no pudo leer los elementos editables de esta diapositiva.");
      }
    },
    async save(request) {
      const { uid, unitId, resourceRef, draftRef } = await authorize(request, "orderMaterial");
      const { expectedRevision } = request.data;
      const edits = normalizeStudioEdits(request.data.edits);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid("Revisión de Studio inválida.");
      return db.runTransaction(async transaction => {
        const resource = (await transaction.get(resourceRef)).data();
        const saved = (await transaction.get(draftRef)).data();
        const fingerprint = verifyResource(resource, unitId);
        if ((saved?.revision || 0) !== expectedRevision) conflict("El borrador de Studio cambió. Recarga para continuar.");
        if (!readyProcessing(resource) || pending(resource.processing, clock())) conflict("Espera a que termine la conversión antes de guardar.");
        if (edits.some(edit => !resource.processing.pages?.[edit.slideIndex])) invalid("La diapositiva ya no existe.");
        const sameSource = saved?.sourceFingerprint === fingerprint;
        if (sameSource && JSON.stringify(saved.edits) === JSON.stringify(edits)) return visibleDraft(saved, fingerprint);
        const draft = {
          unitId, sourceFingerprint: fingerprint, revision: expectedRevision + 1, edits,
          reviewRevision: (saved?.reviewRevision || 0) + 1,
          appliedRevision: sameSource ? saved.appliedRevision || 0 : 0,
          status: "in-review", notes: sameSource ? saved.notes || "" : "",
          priority: sameSource ? saved.priority || "normal" : "normal",
          assigneeUid: sameSource ? saved.assigneeUid || "" : "",
          assigneeName: sameSource ? saved.assigneeName || "" : "",
          updatedByUid: uid, updatedAt: timestamp(), updatedAtIso: new Date(clock()).toISOString(),
        };
        if (sameSource && saved.baseline) draft.baseline = saved.baseline;
        transaction.set(draftRef, draft);
        return visibleDraft(draft, fingerprint);
      });
    },
    async review(request) {
      const { status, notes, expectedRevision, expectedReviewRevision, priority, assigneeUid } = request.data || {};
      if (!["in-review", "changes-requested", "approved"].includes(status) || typeof notes !== "string" || notes.length > 280 || !Number.isSafeInteger(expectedRevision) || !Number.isSafeInteger(expectedReviewRevision)) invalid("Revisión inválida.");
      const { uid, profile, unitId, resourceRef, draftRef } = await authorize(request, status === "approved" ? "publishVersions" : "orderMaterial");
      if (priority !== undefined && !["low", "normal", "high"].includes(priority)) invalid("Prioridad inválida.");
      let assigneeName = "";
      if (assigneeUid !== undefined) {
        requireClassroom(profile, "managePermissions");
        if (assigneeUid) {
          if (!validId(assigneeUid) || assigneeUid.startsWith("ac-device-")) invalid("Revisor inválido.");
          const assignee = requireClassroom(await getProfile(assigneeUid), "orderMaterial");
          assigneeName = assignee.name || assignee.email || "Colaborador";
        }
      }
      return db.runTransaction(async transaction => {
        const resource = (await transaction.get(resourceRef)).data();
        const saved = (await transaction.get(draftRef)).data();
        const fingerprint = verifyResource(resource, unitId);
        if ((saved?.revision || 0) !== expectedRevision || (saved?.reviewRevision || 0) !== expectedReviewRevision || (saved && saved.sourceFingerprint !== fingerprint)) conflict("El borrador cambió. Recarga antes de revisar.");
        if (status === "approved" && (!readyProcessing(resource) || (saved?.revision && saved.appliedRevision !== saved.revision))) {
          throw new HttpsError("failed-precondition", "Genera la conversión del borrador antes de aprobarla.");
        }
        if (status === "approved" && resource.processing.pages?.some(page => page.warnings?.length) && !notes.trim()) {
          throw new HttpsError("failed-precondition", "Justifica las advertencias de conversión en las notas antes de aprobar.");
        }
        const review = {
          ...saved,
          ...(priority === undefined ? {} : { priority }),
          ...(assigneeUid === undefined ? {} : { assigneeUid, assigneeName }),
          unitId, sourceFingerprint: fingerprint, revision: expectedRevision, reviewRevision: expectedReviewRevision + 1, edits: saved?.edits || [], appliedRevision: saved?.appliedRevision || 0, status, notes: notes.trim(), updatedByUid: uid, updatedAt: timestamp(), updatedAtIso: new Date(clock()).toISOString() };
        transaction.set(draftRef, review);
        return visibleDraft(review, fingerprint);
      });
    },
  };
}

function prepareStudioSource(prepareResource, profile, resource) {
  if (!isGoogleSlides(resource)) return prepareResource(profile, resource);
  return prepareResource(profile, resource, { deliveryOverride: { ...exportPptx, deliveredName: `${resource.name.replace(/\.pptx$/i, "").slice(0, 140)}.pptx` } });
}

module.exports = { createStudioHandlers, normalizeStudioEdits, prepareStudioSource, studioRef };
