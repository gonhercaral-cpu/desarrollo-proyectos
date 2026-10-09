const { HttpsError } = require("firebase-functions/v2/https");
const { isRasterSlides, requireReady } = require("./activeClassroomProcessingModel");
// Admin-only preview: callers choose IDs, never Storage paths or generations.
function createBuildPreview({ db, bucket, getProfile, prepareResource, clock = Date.now }) {
  return async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = await getProfile(request.auth.uid);
    if (profile?.active !== true || profile.role !== "admin") throw new HttpsError("permission-denied", "Solo administradores pueden previsualizar borradores.");
    const { unitId, resourceId, pageObjectId, buildIndex = 0 } = request.data || {};
    if (![unitId, resourceId].every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)) || !Number.isInteger(buildIndex) || buildIndex < 0 || buildIndex > 50) throw new HttpsError("invalid-argument", "Vista previa inválida.");
    const resource = { id: resourceId, ...(await db.collection("activeClassroomResources").doc(resourceId).get()).data() };
    if (resource.folderId !== unitId || resource.archived) throw new HttpsError("not-found", "El recurso no pertenece a esta Unit.");
    requireReady(resource);
    // Includes Drive ACL/original version checks and immutable generation checks.
    const base = await prepareResource(profile, resource);
    let download = base;
    if (isRasterSlides(resource)) {
      const page = resource.processing.pages.find(item => item.pageObjectId === pageObjectId);
      download = buildIndex ? page?.builds?.[buildIndex - 1]?.download : page?.download;
      if (!download) throw new HttpsError("not-found", "Estado no encontrado.");
    } else if (buildIndex || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(download.mimeType)) throw new HttpsError("invalid-argument", "Formato sin vista previa.");
    const [url] = await bucket.file(download.path).getSignedUrl({ version: "v4", action: "read", expires: clock() + 15 * 60 * 1000, queryParams: { generation: download.generation } });
    return { url, mimeType: download.mimeType, sizeBytes: download.sizeBytes, sha256: download.checksums.sha256 };
  };
}
module.exports = { createBuildPreview };
