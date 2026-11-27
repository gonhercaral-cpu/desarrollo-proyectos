// Enlaces versionados sobre el catálogo institucional. Nunca contiene PDFs ni datos de alumnos.
function createPrintLibraryHandler({ db, FieldValue, getActor, HttpsError }) {
  const invalid = (message) => { throw new HttpsError("invalid-argument", message); };
  function id(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(value)) invalid("Identificador no válido.");
    return value;
  }
  const types = new Set(["book", "flyer", "brochure", "trifold", "worksheet", "teaching", "advertising", "form", "other"]);
  return async (request) => {
    const actor = await getActor(request);
    if (!actor.isAdmin) throw new HttpsError("permission-denied", "Solo administración puede publicar materiales y plantillas.");
    const input = request.data || {};
    const template = input.kind === "template";
    if (!template && input.kind !== "material") invalid("Elige un material o una plantilla.");
    const recordId = id(template ? input.id || input.requestId : input.productId);
    const target = db.collection(template ? "printProductionTemplates" : "printMaterialLinks").doc(recordId);
    const sourceRef = db.collection("printDocuments").doc(id(input.sourceId));
    const versionId = id(input.requestId);
    return db.runTransaction(async (tx) => {
      const versionRef = target.collection("versions").doc(versionId);
      const [sourceDoc, previous, version, product] = await Promise.all([
        tx.get(sourceRef), tx.get(target), tx.get(versionRef),
        !template || input.productId ? tx.get(db.collection("printProducts").doc(id(input.productId))) : null,
      ]);
      if (version.exists) return { id: recordId, version: version.data().version };
      if (!sourceDoc.exists) throw new HttpsError("not-found", "No se encontró el documento definitivo.");
      const source = sourceDoc.data();
      if ((source.ownerUid !== actor.uid && source.libraryPublished !== true) ||
          source.certificateId || source.credentialId || !["local", "drive"].includes(source.origin)) {
        throw new HttpsError("permission-denied", "El documento debe ser reutilizable y estar autorizado.");
      }
      if (product && (!product.exists || product.data().deleted || product.data().active === false)) invalid("El producto ya no está activo.");
      const name = String(input.name || product?.data()?.name || "").trim().slice(0, 180);
      const type = input.type || "other";
      if (!name || !types.has(type)) invalid("Revisa el nombre y la categoría del material.");
      if (previous.exists && Number(input.version) !== previous.data().version) {
        throw new HttpsError("aborted", "Otra persona actualizó esta versión. Recarga el registro.");
      }
      const defaults = {};
      for (const key of ["duplex", "color"]) {
        if (typeof input.defaults?.[key] === "boolean") defaults[key] = input.defaults[key];
      }
      if (typeof input.defaults?.paper === "string") defaults.paper = input.defaults.paper.slice(0, 32);
      if (Number.isInteger(input.defaults?.copies) && input.defaults.copies > 0 && input.defaults.copies <= 10000) defaults.copies = input.defaults.copies;
      const versionNumber = (previous.data()?.version || 0) + 1;
      const record = {
        name, type, productId: product?.id || "", defaults, version: versionNumber, sourceId: sourceDoc.id,
        source: { id: sourceDoc.id, path: source.path, sha256: source.sha256, pages: source.pages,
          name: source.name, size: source.size, origin: source.origin },
        status: ["draft", "review", "approved", "archived"].includes(input.status) ? input.status : "draft",
        updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid,
      };
      tx.set(target, record);
      tx.create(versionRef, record);
      tx.update(sourceRef, { libraryPublished: true });
      return { id: recordId, version: versionNumber };
    });
  };
}
module.exports = { createPrintLibraryHandler };
