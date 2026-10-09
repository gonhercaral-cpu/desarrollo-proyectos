export const DRIVE_NEW_VERSION = "Hay una versión más reciente de este archivo en Nube AES.";
export const DRIVE_UNAVAILABLE = "El archivo original ya no está disponible en Nube AES";
export function unitOperationMessage(error) {
  if (/data-loss|internal|deadline-exceeded|unavailable/.test(error?.code || "")) return "No se pudo preparar el archivo. El borrador y las publicaciones se conservan. Reintenta.";
  if (/checksum|SHA-256|fingerprint|stale|reference mismatch/i.test(error?.message || "")) return "No se pudo verificar el archivo. Actualiza desde Nube AES o selecciona un reemplazo.";
  return error?.message || "No se pudo completar la operación.";
}

// Only draft references change. Frozen manifests and Storage generations stay intact.
export function replaceDraftResource(draft, oldId, newId = null, main = oldId === draft.mainPresentationId) {
  if (oldId && oldId === newId) return draft;
  const replace = values => [...new Set(values.flatMap(id => id === oldId ? newId ? [newId] : [] : [id]))];
  const general = main ? [...draft.generalResourceIds, ...draft.slides.flatMap(slide => slide.resourceIds)] : draft.generalResourceIds;
  const slides = main ? [] : draft.slides.map(slide => {
    const builds = (slide.builds || []).map(build => ({ ...build, ...(build.resourceId === oldId ? { resourceId: newId } : {}), layers: (build.layers || []).flatMap(layer => layer.resourceId === oldId ? newId ? [{ ...layer, resourceId: newId }] : [] : [layer]) })).filter(build => build.resourceId || build.layers.length).map((build, index) => ({ ...build, order: index + 1 }));
    return { ...slide, resourceIds: replace(slide.resourceIds), ...(slide.builds ? { builds, buildCount: builds.length, interactionMode: builds.length ? "builds" : "static", interaction: { ...slide.interaction, mode: builds.length ? "builds" : "static", buildCount: builds.length } } : {}) };
  });
  return { ...draft, mainPresentationId: main ? newId : draft.mainPresentationId, slides, generalResourceIds: replace(general).filter(id => id !== oldId && id !== (main ? newId : draft.mainPresentationId)), excludedResourceIds: [...new Set([...(draft.excludedResourceIds || []), ...(oldId ? [oldId] : [])])].filter(id => id !== newId) };
}

export function resourceUserState(resource, check, needsProcessing, ready) {
  if (check?.status === "unavailable") return "Original no disponible";
  if (check?.status === "changed") return "Nueva versión disponible";
  if (check?.status === "error" || resource.processing?.state === "failed") return "Error";
  if (needsProcessing && !ready) return "Procesando";
  return "Actualizado";
}
