// Fase 7 — Vinculación con proyectos existentes.
// Un documento editorial puede vincularse a un proyecto operativo. Las métricas
// se DERIVAN del documento/publicaciones; no se duplican manualmente.

// Registro de vínculo (se guarda en el proyecto operativo).
export function buildEditorialLinkRecord({ project = {}, document = {}, user = {} } = {}) {
  return {
    editorialProjectId: String(project.id || ""),
    editorialProjectName: String(project.name || ""),
    editorialDocumentId: String(document.id || ""),
    editorialDocumentTitle: String(document.title || project.name || ""),
    linkedByUid: String(user.uid || user.id || ""),
    linkedByName: String(user.name || user.email || "Usuario"),
  };
}

// Deriva métricas mostrables en el proyecto a partir del estado editorial.
// No persiste números: se calcula al vuelo desde documento + publicaciones.
export function deriveEditorialMetrics({ document = {}, pages = [], publications = [] } = {}) {
  const published = publications.filter((pub) => pub && pub.status === "published");
  const latest = published.reduce(
    (best, pub) => (Number(pub.revision || 0) > Number(best?.revision || 0) ? pub : best),
    null
  );
  return {
    reviewStatus: document.reviewState?.status || "draft",
    pageCount: pages.length || Number(document.pageCount || 0),
    revision: document.currentVersionNumber || 0,
    preflightErrors: Number(document.preflightSummary?.error || 0),
    isPublished: published.length > 0,
    latestPublishedRevision: latest ? Number(latest.revision || 0) : 0,
    publicationCount: publications.length,
  };
}

// ¿El documento ya está vinculado al proyecto?
export function isLinked(links = [], editorialDocumentId) {
  const id = String(editorialDocumentId || "");
  return (Array.isArray(links) ? links : []).some(
    (link) => link && link.editorialDocumentId === id
  );
}

// Quita un vínculo (desvincular) sin tocar otros.
export function removeLink(links = [], editorialDocumentId) {
  const id = String(editorialDocumentId || "");
  return (Array.isArray(links) ? links : []).filter(
    (link) => link && link.editorialDocumentId !== id
  );
}
