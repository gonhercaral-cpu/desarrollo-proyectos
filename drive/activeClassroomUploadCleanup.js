const { HttpsError } = require("firebase-functions/v2/https");
const { requireClassroom } = require("./activeClassroomPermissions");
// Storage rules allow only two Firestore reads. Rollback stays server-side so
// profile, grant and retained-resource checks never exceed that provider limit.
function createUploadCleanup({ db, bucket, getProfile, timestamp }) {
  return async request => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    requireClassroom(await getProfile(request.auth.uid), "uploadMaterial");
    const { resourceId, fileName } = request.data || {};
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(resourceId || "") || !/^[a-z0-9._-]{1,160}$/.test(fileName || "")) throw new HttpsError("invalid-argument", "Archivo temporal inválido.");
    const file = bucket.file(`active-classroom/resources/${resourceId}/${fileName}`);
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch (error) { if (Number(error.code) === 404) return { discarded: true }; throw error; }
    if (metadata.metadata?.uploadedByUid !== request.auth.uid) throw new HttpsError("permission-denied", "El archivo temporal no pertenece a esta subida.");
    await db.runTransaction(async transaction => {
      const resource = await transaction.get(db.collection("activeClassroomResources").doc(resourceId));
      if (resource.exists) throw new HttpsError("failed-precondition", "El archivo ya está asociado; quítalo del borrador.");
      // Reserve discarded IDs, preventing a concurrent resource association.
      transaction.set(db.collection("activeClassroomDiscardedUploads").doc(resourceId), { ownerUid: request.auth.uid, discardedAt: timestamp() });
    });
    await file.delete({ ifGenerationMatch: metadata.generation });
    return { discarded: true };
  };
}
module.exports = { createUploadCleanup };
