// Fase 7 — Publicaciones editoriales inmutables.
// Una publicación apunta a un snapshot (versionId) y a exportaciones terminadas.
// Los cambios posteriores del documento NO deben alterar una publicación existente:
// por eso la publicación congela referencias (versionId + exports[] con
// storagePath/downloadUrl), nunca punteros vivos al documento.

export const EDITORIAL_PUBLICATION_STATES = [
  ["unpublished", "Sin publicar"],
  ["published", "Publicada"],
  ["unpublished_after_release", "Despublicada tras publicación"],
  ["archived", "Archivada"],
];

const VALID_STATES = new Set(EDITORIAL_PUBLICATION_STATES.map(([value]) => value));

// Sólo documentos aprobados o listos para impresión pueden publicarse.
export const PUBLISHABLE_REVIEW_STATUSES = new Set(["approved", "ready_for_print"]);

// Variantes de PDF elegibles para publicar.
export const EDITORIAL_PUBLICATION_VARIANTS = [
  ["student", "PDF Alumno"],
  ["teacher", "PDF Maestro"],
  ["review", "PDF Revisión"],
  ["print", "PDF Imprenta"],
];

export function getPublicationStateLabel(state) {
  return EDITORIAL_PUBLICATION_STATES.find(([value]) => value === state)?.[1] || "Sin publicar";
}

export function getPublicationVariantLabel(variant) {
  return EDITORIAL_PUBLICATION_VARIANTS.find(([value]) => value === variant)?.[1] || variant || "";
}

// ¿El documento puede publicarse en su estado de revisión actual?
export function canPublishReviewStatus(reviewStatus) {
  return PUBLISHABLE_REVIEW_STATUSES.has(String(reviewStatus || ""));
}

// Un export es publicable sólo si terminó (completed) y tiene archivo.
export function isPublishableExport(exportItem) {
  return Boolean(
    exportItem &&
      exportItem.status === "completed" &&
      exportItem.storagePath &&
      (exportItem.downloadUrl || exportItem.downloadURL)
  );
}

// Una versión es un snapshot válido sólo si quedó lista en Storage.
export function isPublishableVersion(version) {
  return Boolean(version && version.status === "ready" && version.storagePath);
}

// Congela una referencia de export dentro de la publicación (copia, no puntero).
function freezeExportReference(exportItem) {
  return {
    exportId: String(exportItem.id || ""),
    type: exportItem.type || "",
    variant: exportItem.variant || "",
    storagePath: exportItem.storagePath || "",
    downloadUrl: exportItem.downloadUrl || exportItem.downloadURL || "",
    sizeBytes: Number(exportItem.sizeBytes || 0),
    versionId: exportItem.versionId || "",
  };
}

// Construye el payload inmutable de una publicación nueva a partir de una versión
// (snapshot) y exportaciones terminadas seleccionadas. No incluye timestamps de
// servidor; el servicio los agrega. `revision` incrementa por documento.
export function buildPublicationPayload({
  documentId,
  version,
  exports = [],
  variant = "student",
  revision = 1,
  notes = "",
  reviewStatus = "",
  user = {},
} = {}) {
  if (!isPublishableVersion(version)) {
    throw new Error("La versión seleccionada no es un snapshot listo.");
  }
  const publishable = exports.filter(isPublishableExport);
  if (publishable.length === 0) {
    throw new Error("Selecciona al menos una exportación terminada.");
  }
  if (!canPublishReviewStatus(reviewStatus)) {
    throw new Error("Sólo se publican documentos aprobados o listos para imprenta.");
  }
  return {
    documentId: String(documentId || ""),
    status: "published",
    revision: Number(revision) > 0 ? Number(revision) : 1,
    variant,
    reviewStatusAtPublish: reviewStatus,
    // Snapshot congelado.
    versionId: String(version.id || ""),
    versionNumber: Number(version.number || version.versionNumber || 0),
    versionStoragePath: version.storagePath || "",
    pageCount: Number(version.pageCount || 0),
    // Exportaciones congeladas.
    exports: publishable.map(freezeExportReference),
    notes: String(notes || ""),
    publishedByUid: String(user.uid || user.id || ""),
    publishedByName: String(user.name || user.email || "Usuario"),
  };
}

// Campos inmutables: una vez publicada, estas claves no pueden cambiar. Sólo
// `status`, `notes` y metadatos de despublicación/archivo pueden mutar.
export const IMMUTABLE_PUBLICATION_KEYS = [
  "documentId",
  "revision",
  "variant",
  "versionId",
  "versionStoragePath",
  "pageCount",
  "exports",
  "publishedByUid",
  "createdAt",
];

// Valida que una actualización no toque campos inmutables. Devuelve las claves
// inmutables violadas (vacío = actualización permitida).
export function findImmutableViolations(previous = {}, next = {}) {
  return IMMUTABLE_PUBLICATION_KEYS.filter((key) => {
    if (!(key in next)) return false;
    return JSON.stringify(next[key]) !== JSON.stringify(previous[key]);
  });
}

// Transiciones de estado permitidas.
const STATE_TRANSITIONS = {
  unpublished: new Set(["published"]),
  published: new Set(["unpublished_after_release", "archived"]),
  unpublished_after_release: new Set(["published", "archived"]),
  archived: new Set([]),
};

export function canTransitionPublication(fromState, toState) {
  if (!VALID_STATES.has(fromState) || !VALID_STATES.has(toState)) return false;
  return STATE_TRANSITIONS[fromState]?.has(toState) || false;
}

export function normalizePublication(value = {}) {
  return {
    ...value,
    status: VALID_STATES.has(value.status) ? value.status : "unpublished",
    revision: Number(value.revision) > 0 ? Number(value.revision) : 1,
    exports: Array.isArray(value.exports) ? value.exports : [],
  };
}

// Siguiente número de revisión publicada para un documento.
export function nextPublicationRevision(publications = []) {
  const revisions = publications
    .filter((item) => item && item.documentId)
    .map((item) => Number(item.revision || 0));
  return (revisions.length ? Math.max(...revisions) : 0) + 1;
}
