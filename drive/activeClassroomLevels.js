const { HttpsError } = require("firebase-functions/v2/https");

// Keep stable IDs: renames/order/status never rewrite immutable manifests.
function createLevelHandler({ db, getProfile, timestamp }) {
  return async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = await getProfile(request.auth.uid);
    if (profile?.role !== "admin" || profile.active !== true) throw new HttpsError("permission-denied", "Solo administradores activos pueden gestionar niveles.");
    const { action, levelId, name, active, position } = request.data || {};
    if (action === "reorder") {
      const ids = request.data.levelIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 400 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))) throw new HttpsError("invalid-argument", "Orden de niveles inválido.");
      return db.runTransaction(async transaction => {
        const levels = await transaction.get(db.collection("activeClassroomFolders").where("kind", "==", "level"));
        if (levels.size !== ids.length || levels.docs.some(doc => !ids.includes(doc.id))) throw new HttpsError("aborted", "Los niveles cambiaron. Recarga antes de ordenar.");
        ids.forEach((id, index) => transaction.update(db.collection("activeClassroomFolders").doc(id), { position: index, updatedAt: timestamp(), updatedByUid: request.auth.uid }));
        return { ordered: true };
      });
    }
    if (!["create", "update", "delete"].includes(action)) throw new HttpsError("invalid-argument", "Acción de nivel inválida.");
    if (action !== "create" && !/^[a-zA-Z0-9_-]{1,200}$/.test(levelId || "")) throw new HttpsError("invalid-argument", "Nivel inválido.");
    const folders = db.collection("activeClassroomFolders");
    const ref = action === "create" ? folders.doc() : folders.doc(levelId);
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (action !== "create" && (!existing.exists || existing.data().kind !== "level")) throw new HttpsError("not-found", "Nivel no encontrado.");
      if (action === "delete") {
        const children = await transaction.get(folders.where("parentId", "==", ref.id).limit(1));
        const drafts = await transaction.get(db.collection("activeClassroomUnits").where("draft.levelId", "==", ref.id).limit(1));
        if (!children.empty || !drafts.empty) throw new HttpsError("failed-precondition", "Este nivel contiene Units. Desactívalo o reasigna sus Units antes de eliminarlo.");
        // Legacy publications also retain level IDs. Read only their tiny level field;
        // never download manifests/files or require a new collection-group index.
        const publishedUnits = await transaction.get(db.collection("activeClassroomUnits").where("publishedVersion", ">", 0).select("publishedVersion"));
        const histories = await Promise.all(publishedUnits.docs.map(unit => transaction.get(unit.ref.collection("publications").select("manifest.unit.levelId"))));
        if (histories.some(history => history.docs.some(version => version.data().manifest?.unit?.levelId === ref.id))) throw new HttpsError("failed-precondition", "Este nivel pertenece a publicaciones existentes. Desactívalo para conservar esas clases.");
        transaction.delete(ref);
        return { id: ref.id, deleted: true };
      }
      const value = { updatedAt: timestamp(), updatedByUid: request.auth.uid };
      if (action === "create" || name !== undefined) {
        if (typeof name !== "string" || !name.trim() || name.trim().length > 160) throw new HttpsError("invalid-argument", "Escribe un nombre de nivel de hasta 160 caracteres.");
        value.name = name.trim();
      }
      if (active !== undefined && typeof active !== "boolean") throw new HttpsError("invalid-argument", "Estado de nivel inválido.");
      if (position !== undefined && (!Number.isSafeInteger(position) || position < 0)) throw new HttpsError("invalid-argument", "Orden de nivel inválido.");
      if (active !== undefined) value.active = active;
      if (position !== undefined) value.position = position;
      if (action === "create") transaction.create(ref, { ...value, kind: "level", parentId: null, active: active ?? true, position: position ?? 999, createdAt: timestamp(), createdByUid: request.auth.uid });
      else transaction.update(ref, value);
      return { id: ref.id };
    });
  };
}
module.exports = { createLevelHandler };
