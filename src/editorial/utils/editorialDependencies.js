// Fase 7 — Protección de archivos con dependencias.
// Una versión (snapshot) o exportación referenciada por una publicación NO puede
// eliminarse mientras la publicación exista (published o histórica). Esto evita
// romper publicaciones inmutables que apuntan a esos archivos.

function activePublications(publications = []) {
  // Las archivadas conservan historial: siguen protegiendo sus dependencias.
  return (Array.isArray(publications) ? publications : []).filter((item) => item && item.status);
}

// Publicaciones que dependen de una versión.
export function publicationsUsingVersion(publications, versionId) {
  const id = String(versionId || "");
  if (!id) return [];
  return activePublications(publications).filter((pub) => pub.versionId === id);
}

// Publicaciones que dependen de una exportación.
export function publicationsUsingExport(publications, exportId) {
  const id = String(exportId || "");
  if (!id) return [];
  return activePublications(publications).filter((pub) =>
    Array.isArray(pub.exports) && pub.exports.some((ref) => ref.exportId === id)
  );
}

// ¿Se puede borrar la versión? Devuelve { allowed, blockedBy }.
export function canDeleteVersion(publications, versionId) {
  const blockedBy = publicationsUsingVersion(publications, versionId);
  return { allowed: blockedBy.length === 0, blockedBy };
}

// ¿Se puede borrar la exportación?
export function canDeleteExport(publications, exportId) {
  const blockedBy = publicationsUsingExport(publications, exportId);
  return { allowed: blockedBy.length === 0, blockedBy };
}

// Mensaje legible de bloqueo.
export function dependencyBlockMessage(blockedBy = []) {
  if (!blockedBy.length) return "";
  const revisions = blockedBy.map((pub) => `rev. ${pub.revision || "?"}`).join(", ");
  return `Bloqueado: usado por ${blockedBy.length} publicación(es) (${revisions}).`;
}
