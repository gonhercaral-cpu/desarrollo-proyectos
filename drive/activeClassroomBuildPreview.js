const { studioRef } = require("./activeClassroomStudio");
const { canClassroom } = require("./activeClassroomPermissions");
const { HttpsError } = require("firebase-functions/v2/https");
const { isGoogleSlides, isRasterSlides, requireReady } = require("./activeClassroomProcessingModel");
// Admin-only preview: callers choose IDs, never Storage paths or generations.
function createBuildPreview({ db, bucket, getProfile, prepareResource, preparePreviewSource, verifyDownload, originalPreview, clock = Date.now }) {
  return async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = await getProfile(request.auth.uid);
    if (!canClassroom(profile)) throw new HttpsError("permission-denied", "No tienes acceso a borradores de Active Classroom.");
    const { unitId, resourceId, pageObjectId, buildIndex = 0, baseline = false, original = false } = request.data || {};
    if (![unitId, resourceId].every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)) || typeof baseline !== "boolean" || typeof original !== "boolean" || (original && baseline) || ((original || baseline) && buildIndex !== 0) || !Number.isInteger(buildIndex) || buildIndex < 0 || buildIndex > 50) throw new HttpsError("invalid-argument", "Vista previa inválida.");
    const resource = { id: resourceId, ...(await db.collection("activeClassroomResources").doc(resourceId).get()).data() };
    if (resource.folderId !== unitId || resource.archived) throw new HttpsError("not-found", "El recurso no pertenece a esta Unit.");
    requireReady(resource);
    if (original) {
      if (!isGoogleSlides(resource) || !resource.processing.pages?.some(page => page.pageObjectId === pageObjectId) || !originalPreview) throw new HttpsError("failed-precondition", "No hay una vista original disponible para esta diapositiva.");
      try { return await originalPreview(profile, resource, pageObjectId); }
      catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("unavailable", "Google Slides no pudo generar la vista previa original.");
      }
    }
    // Includes Drive ACL/original version checks and immutable generation checks.
    let download;
    let animation;
    if (isRasterSlides(resource)) {
      if (preparePreviewSource) await preparePreviewSource(profile, resource);
      else await prepareResource(profile, resource);
      const page = resource.processing.pages.find(item => item.pageObjectId === pageObjectId);
      if (baseline) {
        const review = (await studioRef(db, resourceId).get()).data();
        if (review?.sourceFingerprint === resource.processing.sourceFingerprint) {
          download = review.baseline?.find(item => item.pageObjectId === pageObjectId)?.download;
        } else download = null;
      } else download = buildIndex ? page?.builds?.[buildIndex - 1]?.download : page?.download;
      if (!download) throw new HttpsError("not-found", "Estado no encontrado.");
      if (!baseline && !buildIndex && page.animation) animation = page.animation;
    } else {
      download = await prepareResource(profile, resource);
      if (baseline || buildIndex || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(download.mimeType)) throw new HttpsError("invalid-argument", "Formato sin vista previa.");
    }
    if (verifyDownload) await verifyDownload(download);
    const [url] = await bucket.file(download.path).getSignedUrl({ version: "v4", action: "read", expires: clock() + 15 * 60 * 1000, queryParams: { generation: download.generation } });
    let animated;
    if (animation) {
      const sign = async (asset) => {
        if (verifyDownload) await verifyDownload(asset);
        return { url: (await bucket.file(asset.path).getSignedUrl({ version: "v4", action: "read", expires: clock() + 15 * 60 * 1000, queryParams: { generation: asset.generation } }))[0], mimeType: asset.mimeType };
      };
      try {
        animated = { background: await sign(animation.background.download), images: await Promise.all(animation.images.map(async image => ({ ...await sign(image.download), x: image.x, y: image.y, width: image.width, height: image.height }))) };
      } catch { /* Preview keeps the complete static slide if optional assets cannot be signed. */ }
    }
    return { url, mimeType: download.mimeType, sizeBytes: download.sizeBytes, sha256: download.checksums.sha256, ...(animated ? { animation: animated } : {}) };
  };
}
module.exports = { createBuildPreview };
