const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { resourceKind } = require("./activeClassroom");
const { needsDocumentProcessing, isGoogleSlides, slideResourceId, readyProcessing, requireReady, pdfSlides } = require("./activeClassroomProcessingModel");

const MAX_RESOURCES = 200;
const MAX_SLIDES = 200;
function fail(message, code = "invalid-argument") { throw new HttpsError(code, message); }
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail("Texto inválido o demasiado largo.");
  return value.trim();
}
function id(value) { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) fail("Identificador inválido."); return value; }
function ids(value, max = MAX_RESOURCES) {
  if (!Array.isArray(value) || value.length > max) fail(`Máximo ${max} elementos.`);
  const result = value.map(id);
  if (new Set(result).size !== result.length) fail("Hay identificadores duplicados.");
  return result;
}
function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) fail("Número fuera de rango."); return value; }

function normalizeDraft(input) {
  if (!input || typeof input !== "object") fail("Borrador inválido.");
  if (!["active", "inactive"].includes(input.status)) fail("Estado inválido.");
  if (!Array.isArray(input.slides) || input.slides.length > MAX_SLIDES) fail(`Máximo ${MAX_SLIDES} diapositivas.`);
  const metadata = input.metadata || {};
  const slides = input.slides.map((slide, index) => ({
    slideId: id(slide.slideId), index, title: text(slide.title || "", 160),
    metadata: { pageNumber: slide.metadata?.pageNumber == null ? null : integer(slide.metadata.pageNumber, 1, MAX_SLIDES), notes: text(slide.metadata?.notes || "", 1000), ...(slide.metadata?.pageObjectId ? { pageObjectId: id(slide.metadata.pageObjectId), presentationResourceId: id(slide.metadata.presentationResourceId) } : {}) },
    resourceIds: ids(slide.resourceIds || []),
  }));
  ids(slides.map(({ slideId }) => slideId), MAX_SLIDES);
  const draft = {
    name: text(input.name, 56, true), description: text(input.description || "", 4000),
    levelId: id(input.levelId), status: input.status,
    metadata: {
      code: text(metadata.code || "", 80), language: text(metadata.language || "", 40),
      estimatedMinutes: integer(metadata.estimatedMinutes ?? 0, 0, 10000),
      tags: (Array.isArray(metadata.tags ?? []) && (metadata.tags || []).length <= 20 ? (metadata.tags || []) : fail("Máximo 20 etiquetas.")).map((tag) => text(tag, 60)).filter(Boolean),
    },
    mainPresentationId: input.mainPresentationId ? id(input.mainPresentationId) : null,
    generalResourceIds: ids(input.generalResourceIds || []), slides,
  };
  if (draft.generalResourceIds.includes(draft.mainPresentationId)) fail("La presentación principal debe estar separada de recursos generales.");
  if (resourceIds(draft).length > MAX_RESOURCES) fail(`Máximo ${MAX_RESOURCES} recursos por Unit.`);
  return draft;
}

function resourceIds(draft) {
  return [...new Set([draft.mainPresentationId, ...draft.generalResourceIds, ...draft.slides.flatMap((slide) => slide.resourceIds)].filter(Boolean))];
}
function isMainPresentation(resource) {
  return resource?.source === "drive" && (resource.kind === "presentation" || resource.mimeType === "application/pdf" || /\.pdf$/i.test(resource.name));
}
function fileReference(resource) {
  return resource.source === "drive" ? {
    provider: "drive", fileId: resource.driveFileId, modifiedTime: resource.driveModifiedTime || "",
    version: resource.driveVersion || "", checksums: { md5: resource.driveMd5Checksum || null },
    originalName: resource.sourceName || resource.name,
  } : { provider: "storage", path: resource.storagePath, checksums: { md5: resource.storageMd5Hash || null } };
}
function snapshotResource(resourceId, resource) {
  const iso = (value) => value?.toDate ? value.toDate().toISOString() : typeof value === "string" ? value : null;
  const processing = readyProcessing(resource) ? resource.processing : null;
  return { resourceId, name: resource.name, mimeType: resource.mimeType, originalMime: resource.mimeType, deliveryMime: processing?.download.mimeType || resource.mimeType, kind: resource.kind, sizeBytes: resource.sizeBytes ?? null, file: fileReference(resource),
    ...(isGoogleSlides(resource) ? { sourceType: "google-slides" } : {}),
    ...(processing ? {
      original: { ...fileReference(resource), name: resource.sourceName || resource.name, mimeType: resource.mimeType, ...(isGoogleSlides(resource) ? {} : { snapshot: processing.original }) },
      derivative: { revision: processing.revision, processorVersion: processing.processorVersion, sourceFingerprint: processing.sourceFingerprint, pageCount: processing.pageCount, processedAt: processing.completedAt, textExtraction: null, file: processing.download, ...(isGoogleSlides(resource) ? { pages: processing.pages } : {}) },
    } : {}),
    timestamps: { createdAt: iso(resource.createdAt), updatedAt: iso(resource.updatedAt), sourceCheckedAt: iso(resource.sourceCheckedAt) } };
}
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function contentHash(value) { return createHash("sha256").update(stableStringify(value)).digest("hex"); }
function driveChanged(resource, file) {
  return (resource.driveModifiedTime || "") !== (file.modifiedTime || "")
    || (resource.driveVersion || "") !== String(file.version || "")
    || (resource.driveMd5Checksum || "") !== (file.md5Checksum || "")
    || (resource.sourceName || resource.name) !== file.name || resource.mimeType !== file.mimeType;
}

function createUnitHandlers({ db, getProfile, resolveFile, prepareResource, timestamp, now = () => new Date().toISOString() }) {
  async function authorize(request) {
    if (!request.auth?.uid) fail("Debes iniciar sesión.", "unauthenticated");
    const profile = await getProfile(request.auth.uid);
    if (profile?.active !== true || profile.role !== "admin") fail("Solo administradores activos pueden editar Units.", "permission-denied");
    return profile;
  }
  const unitRef = (unitId) => db.collection("activeClassroomUnits").doc(id(unitId));
  const folderRef = (unitId) => db.collection("activeClassroomFolders").doc(id(unitId));
  const resourceRef = (resourceId) => db.collection("activeClassroomResources").doc(id(resourceId));
  function revision(data, expected) {
    integer(expected, 0, Number.MAX_SAFE_INTEGER);
    if ((data?.draftRevision || 0) !== expected) fail("Otro administrador modificó el borrador. Recarga antes de guardar.", "aborted");
  }
  async function readResources(transaction, draft, unitId) {
    const result = [];
    for (const resourceId of resourceIds(draft)) {
      const snapshot = await transaction.get(resourceRef(resourceId));
      if (!snapshot.exists || snapshot.data().folderId !== unitId || snapshot.data().archived) fail("Un recurso ya no pertenece a esta Unit o fue eliminado.", "failed-precondition");
      result.push({ id: resourceId, ...snapshot.data() });
    }
    if (draft.mainPresentationId && !isMainPresentation(result.find((resource) => resource.id === draft.mainPresentationId))) fail("Elige PPT/PPTX, Google Slides o PDF de Nube AES como presentación principal.");
    return result;
  }
  async function validateFolders(transaction, unitId, draft) {
    const folder = await transaction.get(folderRef(unitId));
    if (!folder.exists || folder.data().kind !== "unit") fail("Unit no encontrada.", "not-found");
    const level = await transaction.get(folderRef(draft.levelId));
    if (!level.exists || level.data().kind !== "level" || level.data().active !== true) fail("Selecciona un Nivel activo.", "failed-precondition");
    return folder;
  }

  async function save(request) {
    const profile = await authorize(request);
    const unitId = id(request.data?.unitId);
    const draft = normalizeDraft(request.data?.draft);
    if (Buffer.byteLength(JSON.stringify(draft), "utf8") > 700000) fail("El borrador supera 700 KB.", "resource-exhausted");
    return db.runTransaction(async (transaction) => {
      const stored = (await transaction.get(unitRef(unitId))).data();
      revision(stored, request.data.expectedRevision);
      await validateFolders(transaction, unitId, draft);
      const resources = await readResources(transaction, draft, unitId);
      const main = resources.find((resource) => resource.id === draft.mainPresentationId);
      if (needsDocumentProcessing(main) && readyProcessing(main)) draft.slides = pdfSlides(main, draft.slides);
      const draftRevision = (stored?.draftRevision || 0) + 1;
      transaction.set(unitRef(unitId), {
        schemaVersion: 1, draft, draftRevision, publishedVersion: stored?.publishedVersion || 0,
        publishedDraftRevision: stored?.publishedDraftRevision || 0,
        updatedAt: timestamp(), updatedByUid: request.auth.uid,
      }, { merge: true });
      // Keep the existing library's IDs and catalog in sync without migrating resources.
      transaction.update(folderRef(unitId), {
        name: draft.name, parentId: draft.levelId, active: draft.status === "active",
        updatedAt: timestamp(), updatedByUid: request.auth.uid,
      });
      return { draftRevision, draft, updatedByName: profile.name || "Administrador" };
    });
  }

  async function publish(request) {
    const profile = await authorize(request);
    const unitId = id(request.data?.unitId);
    // Network/file IO must stay outside retriable Firestore transactions.
    const prepared = await db.runTransaction(async (transaction) => {
      const stored = (await transaction.get(unitRef(unitId))).data();
      if (!stored?.draft) fail("Guarda el borrador antes de publicar.", "failed-precondition");
      revision(stored, request.data.expectedRevision);
      const draft = normalizeDraft(stored.draft);
      if (draft.status !== "active" || !draft.mainPresentationId || !draft.slides.length) fail("Publicar requiere Unit activa, presentación principal y diapositivas.", "failed-precondition");
      await validateFolders(transaction, unitId, draft);
      const resources = await readResources(transaction, draft, unitId);
      for (const resource of resources) requireReady(resource);
      const main = resources.find((resource) => resource.id === draft.mainPresentationId);
      if (needsDocumentProcessing(main) && contentHash(draft.slides) !== contentHash(pdfSlides(main, draft.slides))) fail("Aplica las diapositivas procesadas antes de publicar.", "failed-precondition");
      return resources;
    });
    const files = new Map();
    for (const resource of prepared) files.set(resource.id, await prepareResource(profile, resource));
    return db.runTransaction(async (transaction) => {
      const stored = (await transaction.get(unitRef(unitId))).data();
      if (!stored?.draft) fail("Guarda el borrador antes de publicar.", "failed-precondition");
      revision(stored, request.data.expectedRevision);
      const draft = normalizeDraft(stored.draft);
      if (draft.status !== "active" || !draft.mainPresentationId || !draft.slides.length) fail("Publicar requiere Unit activa, presentación principal y diapositivas.", "failed-precondition");
      await validateFolders(transaction, unitId, draft);
      const resources = await readResources(transaction, draft, unitId);
      for (const resource of resources) requireReady(resource);
      if (contentHash(resources.map((resource) => snapshotResource(resource.id, resource))) !== contentHash(prepared.map((resource) => snapshotResource(resource.id, resource)))) fail("Los recursos cambiaron durante la publicación. Reintenta.", "aborted");
      const deliveredIds = (references) => [...new Set(references.flatMap((resourceId) => {
        const resource = resources.find((item) => item.id === resourceId);
        return isGoogleSlides(resource) ? resource.processing.pages.map((page, index) => index === 0 ? resourceId : slideResourceId(resourceId, page.pageObjectId)) : [resourceId];
      }))];
      const content = {
        schemaVersion: 2, unit: { unitId, name: draft.name, description: draft.description, levelId: draft.levelId, status: draft.status, metadata: draft.metadata },
        mainPresentationId: draft.mainPresentationId, generalResourceIds: deliveredIds(draft.generalResourceIds),
        slides: draft.slides.map((draftSlide) => {
          const slide = { ...draftSlide, resourceIds: deliveredIds(draftSlide.resourceIds) };
          const main = resources.find((resource) => resource.id === draft.mainPresentationId);
          const download = files.get(draft.mainPresentationId);
          const page = isGoogleSlides(main) ? main.processing.pages[slide.index] : null;
          const delivered = page?.download || download;
          return needsDocumentProcessing(main) ? { ...slide, metadata: { ...slide.metadata, ...(page ? { pageObjectId: page.pageObjectId, storagePath: page.storagePath, size: page.size, sha256: page.sha256, width: page.width, height: page.height } : {}), delivery: { resourceId: page ? slide.metadata.presentationResourceId : main.id, revision: main.processing.revision, generation: delivered.generation, mimeType: delivered.mimeType, sizeBytes: delivered.sizeBytes, checksum: delivered.checksums.sha256 } } } : slide;
        }), resources: resources.flatMap((resource) => {
          const snapshot = snapshotResource(resource.id, resource);
          if (!isGoogleSlides(resource)) return [{ ...snapshot, deliveryMime: files.get(resource.id).mimeType, download: files.get(resource.id) }];
          const derivative = { ...snapshot.derivative };
          delete derivative.pages;
          return resource.processing.pages.map((page, index) => ({ ...snapshot, resourceId: index === 0 ? resource.id : slideResourceId(resource.id, page.pageObjectId), name: `${resource.name} · ${index + 1}`, deliveryMime: "image/png", pageObjectId: page.pageObjectId, index, width: page.width, height: page.height, derivative: { ...derivative, file: page.download }, download: page.download }));
        }),
      };
      if (content.resources.length > MAX_RESOURCES) fail(`Máximo ${MAX_RESOURCES} archivos por publicación, incluyendo diapositivas PNG.`, "resource-exhausted");
      if (new Set(content.resources.map((resource) => resource.resourceId)).size !== content.resources.length) fail("Identificadores de archivos publicados duplicados.", "data-loss");
      const hash = contentHash(content);
      const previous = stored.publishedVersion
        ? await transaction.get(unitRef(unitId).collection("publications").doc(String(stored.publishedVersion))) : null;
      if (previous?.data()?.contentHash === hash) {
        transaction.update(unitRef(unitId), { publishedDraftRevision: stored.draftRevision });
        return { version: stored.publishedVersion, unchanged: true };
      }
      const version = (stored.publishedVersion || 0) + 1;
      const manifest = { ...content, version, publishedAt: now(), integrity: { algorithm: "sha256", contentHash: hash } };
      if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > 700000) fail("El manifest supera 700 KB. Reduce notas o asociaciones.", "resource-exhausted");
      transaction.create(unitRef(unitId).collection("publications").doc(String(version)), {
        version, manifest, contentHash: hash, draftRevision: stored.draftRevision,
        publishedAt: timestamp(), publishedByUid: request.auth.uid,
      });
      transaction.update(unitRef(unitId), { publishedVersion: version, publishedDraftRevision: stored.draftRevision });
      // Retain originals referenced by immutable publications. Never alter their publication flags.
      for (const resource of resources) if (!resource.retainedByPublication) transaction.update(resourceRef(resource.id), { retainedByPublication: true });
      return { version, unchanged: false };
    });
  }

  async function checkDrive(request) {
    const profile = await authorize(request);
    const unitId = id(request.data?.unitId);
    const selectedIds = ids(request.data?.resourceIds);
    const results = [];
    for (const resourceId of selectedIds) {
      try {
        const resource = (await resourceRef(resourceId).get()).data();
        if (!resource || resource.folderId !== unitId || resource.source !== "drive") fail("Referencia Drive no válida.");
        const file = await resolveFile(profile, resource.driveFileId);
        if (file.trashed) fail("Original eliminado de Drive.", "not-found");
        results.push({ resourceId, status: driveChanged(resource, file) ? "changed" : "current", observedVersion: String(file.version || ""), modifiedTime: file.modifiedTime || "" });
      } catch (error) { results.push({ resourceId, status: "unavailable", message: error instanceof HttpsError ? error.message : "No se pudo consultar el original en Nube AES." }); }
    }
    return { results, checkedAt: now() };
  }

  async function refreshDrive(request) {
    const profile = await authorize(request);
    const unitId = id(request.data?.unitId);
    const ref = resourceRef(request.data?.resourceId);
    const before = (await ref.get()).data();
    if (!before || before.folderId !== unitId || before.source !== "drive") fail("Referencia Drive no válida.");
    const file = await resolveFile(profile, before.driveFileId);
    if (file.trashed || file.capabilities?.canDownload === false) fail("Original no disponible para descargar.", "failed-precondition");
    const kind = resourceKind(file);
    if (!kind) fail("El nuevo formato del original no es compatible.");
    return db.runTransaction(async (transaction) => {
      const stored = (await transaction.get(unitRef(unitId))).data();
      revision(stored, request.data.expectedRevision);
      if (!stored?.draft) fail("Guarda el borrador antes de actualizar archivos.", "failed-precondition");
      const current = (await transaction.get(ref)).data();
      if (!current || current.folderId !== unitId || current.driveFileId !== before.driveFileId) fail("La referencia cambió. Recarga el borrador.", "aborted");
      if (current.driveVersion !== before.driveVersion || current.driveModifiedTime !== before.driveModifiedTime) fail("Otro administrador actualizó el original. Recarga.", "aborted");
      const updated = {
        name: text(file.name, 160, true), sourceName: file.name, mimeType: file.mimeType, kind,
        sizeBytes: file.size == null || file.size === "" ? null : Number(file.size),
        driveModifiedTime: file.modifiedTime || "", driveVersion: String(file.version || ""),
        driveMd5Checksum: file.md5Checksum || "", driveParentIds: file.parents || [],
        sourceCheckedAt: timestamp(), version: (current.version || 1) + 1,
        ...(current.processing ? { processing: { state: "pending", sourceFingerprint: null } } : {}),
        updatedAt: timestamp(), updatedByUid: request.auth.uid, updatedByName: profile.name || "Administrador",
      };
      if (stored.draft.mainPresentationId === ref.id && !isMainPresentation({ ...current, ...updated })) fail("El original ya no es una presentación compatible.");
      const draftRevision = stored.draftRevision + 1;
      transaction.update(ref, updated);
      transaction.update(unitRef(unitId), { draftRevision, updatedAt: timestamp(), updatedByUid: request.auth.uid });
      return { draftRevision };
    });
  }
  return { save, publish, checkDrive, refreshDrive };
}

module.exports = { createUnitHandlers, normalizeDraft, resourceIds, isMainPresentation, snapshotResource, stableStringify, contentHash, driveChanged };
