const { canClassroom } = require("./activeClassroomPermissions");
const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const GOOGLE_TYPES = {
  "application/vnd.google-apps.presentation": "presentation",
  "application/vnd.google-apps.document": "document",
};
const EXTENSION_TYPES = {
  ppt: "presentation", pptx: "presentation", pdf: "document",
  doc: "document", docx: "document", txt: "document",
  mp3: "audio", wav: "audio", m4a: "audio",
  mp4: "video", webm: "video", jpg: "image", jpeg: "image", png: "image", webp: "image",
};

function resourceKind(file) {
  if (GOOGLE_TYPES[file.mimeType]) return GOOGLE_TYPES[file.mimeType];
  if (String(file.mimeType).startsWith("application/vnd.google-apps.")) return null;
  return EXTENSION_TYPES[String(file.name || "").toLowerCase().split(".").pop()] || null;
}

function requireId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Identificador de archivo o Unit inválido.");
  }
  return value;
}

function activeDraftResourceIds(draft) {
  if (!draft) return [];
  const excluded = new Set(draft.excludedResourceIds || []);
  return [...new Set([draft.mainPresentationId, ...(draft.backgroundMusic || []).map(track => track.resourceId), ...(draft.generalResourceIds || []),
    ...(draft.slides || []).flatMap(slide => [slide.interaction?.initialResourceId, ...(slide.resourceIds || []),
      ...(slide.builds || []).flatMap(step => (step.layers || []).map(layer => layer.resourceId))])
  ].filter(id => id && !excluded.has(id)))];
}

// Uses the existing Drive client and location/private/share authorization from index.js.
function createImportDriveReference({ db, getProfile, resolveFile, timestamp }) {
  return async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = await getProfile(request.auth.uid);
    if (!canClassroom(profile, "importDrive")) {
      throw new HttpsError("permission-denied", "No tienes permiso para importar desde Nube AES.");
    }
    const folderId = requireId(request.data?.folderId);
    const driveFileId = requireId(request.data?.driveFileId);
    const file = await resolveFile(profile, driveFileId);
    if (!file?.id || file.trashed) throw new HttpsError("not-found", "Archivo no disponible en Nube AES.");
    const kind = resourceKind(file);
    if (!kind) throw new HttpsError("invalid-argument", "Formato no compatible con Active Classroom.");
    if (file.capabilities?.canDownload === false) {
      throw new HttpsError("permission-denied", "Drive no permite descargar este archivo.");
    }
    const id = `drive-${createHash("sha256").update(JSON.stringify([folderId, driveFileId])).digest("hex")}`;
    const resourceRef = db.collection("activeClassroomResources").doc(id);
    const unitRef = db.collection("activeClassroomFolders").doc(folderId);
    return db.runTransaction(async (transaction) => {
      const unit = await transaction.get(unitRef);
      const unitData = unit.data();
      if (!unit.exists || unitData.kind !== "unit" || unitData.active !== true) {
        throw new HttpsError("failed-precondition", "Selecciona una Unit activa.");
      }
      const level = await transaction.get(db.collection("activeClassroomFolders").doc(unitData.parentId));
      if (!level.exists || level.data().kind !== "level" || level.data().active !== true) {
        throw new HttpsError("failed-precondition", "El Nivel de la Unit no está activo.");
      }
      const existing = await transaction.get(resourceRef);
      const draft = (await transaction.get(db.collection("activeClassroomUnits").doc(folderId))).data()?.draft;
      if (existing.exists) {
        const associated = activeDraftResourceIds(draft).includes(id);
        // Reuse identity, not the historical association. Never touch frozen versions.
        if (existing.data().archived) transaction.update(resourceRef, { archived: false, updatedAt: timestamp(), updatedByUid: request.auth.uid });
        return { id, alreadyImported: associated, knownResource: true, reused: !associated };
      }
      const now = timestamp();
      transaction.create(resourceRef, {
        schemaVersion: 2,
        source: "drive",
        folderId,
        levelId: unitData.parentId,
        name: String(file.name || "Archivo").slice(0, 160),
        mimeType: file.mimeType,
        kind,
        sizeBytes: file.size === undefined || file.size === "" ? null : Number(file.size),
        storagePath: "",
        driveFileId,
        driveModifiedTime: file.modifiedTime || "",
        driveVersion: String(file.version || ""),
        driveMd5Checksum: file.md5Checksum || "",
        driveParentIds: file.parents || [],
        sourceName: file.name,
        sourceCheckedAt: now,
        association: { scope: "unit", presentationResourceId: null, slideId: null },
        version: 1,
        publishedVersion: null,
        publishedAt: null,
        published: false,
        archived: false,
        createdAt: now,
        createdByUid: request.auth.uid,
        createdByName: profile.name || profile.email || "Administrador",
        updatedAt: now,
        updatedByUid: request.auth.uid,
        updatedByName: profile.name || profile.email || "Administrador",
      });
      return { id, alreadyImported: false };
    });
  };
}

module.exports = { createImportDriveReference, resourceKind, activeDraftResourceIds };
