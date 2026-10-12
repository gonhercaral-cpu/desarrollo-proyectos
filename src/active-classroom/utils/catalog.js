import { activeDraftResourceIds } from "./draftResources.js";
export function unitCatalog(folders, documents, resources) {
  const byId = new Map(documents.map(document => [document.id, document]));
  return folders.filter(folder => folder.kind === "unit").map(folder => {
    const document = byId.get(folder.id) || {}; const draft = document.draft;
    const ids = draft ? new Set(activeDraftResourceIds(draft)) : null;
    const files = resources.filter(file => file.folderId === folder.id && !file.archived && (!ids || ids.has(file.id)));
    const version = document.publishedVersion || 0;
    const processing = files.some(file => file.processing?.state === "processing");
    const failed = document.publicationJob?.state === "failed" || files.some(file => file.processing?.state === "failed");
    const changed = version > 0 && document.draftRevision > document.publishedDraftRevision;
    return { ...folder, document, files, version, level: folders.find(level => level.id === folder.parentId), state: failed ? "Error" : processing || ["pending", "publishing"].includes(document.publicationJob?.state) ? "Procesando" : changed ? "Actualización disponible" : version ? "Publicado" : "Borrador", responsible: document.updatedByName || folder.updatedByName || "", updatedAt: document.updatedAt || folder.updatedAt };
  });
}
export function catalogMetrics(folders, catalog) { return { levels: folders.filter(folder => folder.kind === "level" && folder.active !== false).length, published: catalog.filter(unit => unit.version > 0).length, pending: catalog.filter(unit => unit.state === "Actualización disponible").length, drafts: catalog.filter(unit => unit.state === "Borrador" || unit.state === "Actualización disponible").length }; }
export function filterCatalog(catalog, { search = "", level = "", status = "all", type = "all", sort = "name" } = {}) {
  const text = search.trim().toLocaleLowerCase("es");
  return catalog.filter(unit => (!level || unit.parentId === level) && (!text || [unit.name, unit.level?.name, ...unit.files.map(file => file.name)].join(" ").toLocaleLowerCase("es").includes(text)) && (status === "all" || (status === "published" ? unit.version > 0 : unit.state === status || status === "draft" && unit.state === "Borrador")) && (type === "all" || unit.files.some(file => type === "pdf" ? /pdf/i.test(file.mimeType) : file.kind === type))).sort((a, b) => sort === "date" ? (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0) : a.name.localeCompare(b.name, "es"));
}
