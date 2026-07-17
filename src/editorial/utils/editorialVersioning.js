function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["createdAt", "updatedAt", "updatedBy", "updatedByUid"].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, comparable(child)]));
}

function changed(left, right) {
  return JSON.stringify(comparable(left)) !== JSON.stringify(comparable(right));
}

export function compareEditorialSnapshots(previous = {}, current = {}) {
  const previousPages = new Map((previous.pages || []).map((page) => [page.id, page]));
  const currentPages = new Map((current.pages || []).map((page) => [page.id, page]));
  const addedPages = [...currentPages.keys()].filter((id) => !previousPages.has(id));
  const removedPages = [...previousPages.keys()].filter((id) => !currentPages.has(id));
  const modifiedPages = [];
  let modifiedElements = 0;
  [...currentPages.keys()].filter((id) => previousPages.has(id)).forEach((id) => {
    const before = previousPages.get(id);
    const after = currentPages.get(id);
    if (changed({ ...before, elements: undefined }, { ...after, elements: undefined })) modifiedPages.push(id);
    const beforeElements = new Map((before.elements || []).map((element) => [element.id, element]));
    const afterElements = new Map((after.elements || []).map((element) => [element.id, element]));
    const ids = new Set([...beforeElements.keys(), ...afterElements.keys()]);
    ids.forEach((elementId) => { if (changed(beforeElements.get(elementId), afterElements.get(elementId))) modifiedElements += 1; });
  });
  return {
    addedPages, removedPages, modifiedPages, modifiedElements,
    structureChanged: changed(previous.sections || [], current.sections || []),
    academicMetadataChanged: changed(previous.academicMetadata || {}, current.academicMetadata || {}),
  };
}

export function normalizeVersionSummary(version = {}) {
  return {
    id: version.id || "", name: version.name || "Versión", description: version.description || "",
    versionNumber: Number(version.versionNumber || 1), pageCount: Number(version.pageCount || 0),
    createdBy: version.createdBy || {}, createdAt: version.createdAt || null, storagePath: version.storagePath || "",
  };
}

export function prepareEditorialRestoreDocument(value, depth = 0) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => prepareEditorialRestoreDocument(item, depth + 1));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => depth > 0 || !["id", "createdAt", "updatedAt", "updatedBy", "updatedByUid"].includes(key))
    .map(([key, child]) => [key, prepareEditorialRestoreDocument(child, depth + 1)]));
}
