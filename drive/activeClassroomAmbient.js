const { randomUUID, createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { HttpsError } = require("firebase-functions/v2/https");
const { requireClassroom } = require("./activeClassroomPermissions");
const { resourceKind } = require("./activeClassroom");
const { contentHash } = require("./activeClassroomUnit");
const { downloadRange } = require("./activeClassroomDesktop");
const { validateMusicResources } = require("./activeClassroomBackgroundMusic");
const { DEFAULT_PLAYLIST_ID } = require("./activeClassroomUnitMusic");
const identifier = value => { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new HttpsError("invalid-argument", "Identificador de música inválido."); return value; };
const title = value => { if (typeof value !== "string" || !value.trim() || value.length > 160) throw new HttpsError("invalid-argument", "Título de música inválido."); return value.trim(); };
function emptyCatalog() { return { schemaVersion: 1, ambientCatalogVersion: 0, tracks: [], playlists: [], integrity: { algorithm: "sha256", contentHash: contentHash({ schemaVersion: 1, tracks: [], playlists: [] }) } }; }
function trackFromDownload(download, name, source = "migrated") {
  const sha256 = download?.checksums?.sha256;
  if (!/^[a-f0-9]{64}$/.test(sha256 || "") || !Number.isSafeInteger(download.sizeBytes) || download.sizeBytes < 0 || !/^active-classroom\/publications\/files\/[a-f0-9]{64}$/.test(download.path || "") || !/^\d+$/.test(download.generation || "")) throw new HttpsError("data-loss", "Archivo de música no verificado.");
  validateMusicResources([{ resourceId: sha256 }], [{ id: sha256, mimeType: download.mimeType }]);
  return { id: sha256, title: title(name || download.name), sourceType: "file", source, mime: download.mimeType, size: download.sizeBytes, sha256, storagePath: download.path, generation: download.generation, order: 0, active: true };
}
function createAmbientHandlers({ db, bucket, getProfile, authorize, getRequestProfile, resolveFile, prepareResource, verifyDownload, now = () => new Date().toISOString() }) {
  const current = db.collection("activeClassroomAmbientMusic").doc("catalog");
  const resources = db.collection("activeClassroomResources");
  const read = async () => (await current.get()).data() || emptyCatalog();
  async function editor(request, permission) { if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión."); return requireClassroom(await getProfile(request.auth.uid), permission); }
  async function change(operation, expectedVersion) {
    return db.runTransaction(async transaction => {
      const previous = (await transaction.get(current)).data() || emptyCatalog();
      if (expectedVersion !== undefined && previous.ambientCatalogVersion !== expectedVersion) throw new HttpsError("aborted", "El catálogo cambió. Recarga antes de guardar la música predeterminada.");
      const next = operation(structuredClone(previous));
      next.tracks = next.tracks.map((track, order) => ({ ...track, order }));
      if (next.tracks.length > 200) throw new HttpsError("resource-exhausted", "La biblioteca admite hasta 200 pistas.");
      if (contentHash({ tracks: next.tracks, playlists: next.playlists }) === contentHash({ tracks: previous.tracks, playlists: previous.playlists }) && next.migrated === previous.migrated) return previous;
      next.ambientCatalogVersion = previous.ambientCatalogVersion + 1; next.updatedAt = now();
      next.integrity = { algorithm: "sha256", contentHash: contentHash({ schemaVersion: 1, tracks: next.tracks, playlists: next.playlists }) };
      transaction.create(current.collection("versions").doc(String(next.ambientCatalogVersion)), next); transaction.set(current, next); return next;
    });
  }
  const add = (track, replaced) => change(catalog => {
    const position = replaced ? catalog.tracks.findIndex(item => item.id === replaced) : catalog.tracks.length;
    if (replaced && position < 0) throw new HttpsError("not-found", "La pista que quieres reemplazar ya no está disponible.");
    if (replaced === track.id) return catalog;
    if (replaced) catalog.tracks = catalog.tracks.filter(item => item.id !== replaced);
    if (!catalog.tracks.some(item => item.sha256 === track.sha256)) catalog.tracks.splice(position, 0, track);
    if (replaced) catalog.playlists = catalog.playlists.map(list => ({ ...list, trackIds: [...new Set(list.trackIds.map(id => id === replaced ? track.id : id))] }));
    return catalog;
  });
  async function imported(request) {
    const profile = await editor(request, "importDrive"); const file = await resolveFile(profile, identifier(request.data?.driveFileId));
    if (!file?.id || file.trashed || file.capabilities?.canDownload === false || resourceKind(file) !== "audio") throw new HttpsError("failed-precondition", "Selecciona un archivo de audio disponible en Nube AES.");
    const resource = { id: `ambient-${createHash("sha256").update(file.id).digest("hex")}`, source: "drive", name: file.name, mimeType: file.mimeType, driveFileId: file.id, driveModifiedTime: file.modifiedTime || "", driveVersion: String(file.version || ""), driveMd5Checksum: file.md5Checksum || "", sourceName: file.name };
    const download = await prepareResource(profile, resource);
    if (request.data?.replaceId) requireClassroom(profile, "orderMaterial");
    return { catalog: await add(trackFromDownload(download, request.data?.title || file.name, "drive"), request.data?.replaceId && identifier(request.data.replaceId)) };
  }
  async function upload(request) {
    const profile = await editor(request, "uploadMaterial"); const data = request.data || {};
    if (data.action === "prepare") {
      const name = title(data.name); const mime = title(data.mime); validateMusicResources([{ resourceId: "upload" }], [{ id: "upload", mimeType: mime }]);
      if (!Number.isSafeInteger(data.size) || data.size < 1 || data.size >= 250 * 1024 * 1024) throw new HttpsError("invalid-argument", "El archivo de audio debe ser menor de 250 MiB. Para archivos mayores utiliza Nube AES.");
      const id = randomUUID(); const storagePath = `active-classroom/resources/${id}/${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
      await resources.doc(id).create({ id, folderId: "ambient", scope: "ambient", source: "storage", name, mimeType: mime, sizeBytes: data.size, storagePath, kind: "audio", createdByUid: request.auth.uid, createdByName: profile.name || profile.email || "Colaborador", archived: false, published: false, state: "pending", createdAt: now() });
      return { resourceId: id, storagePath };
    }
    if (data.action !== "finish") throw new HttpsError("invalid-argument", "Acción de carga inválida.");
    const document = await resources.doc(identifier(data.resourceId)).get(); const resource = { ...document.data(), id: document.id };
    if (!document.exists || resource.scope !== "ambient" || resource.createdByUid !== request.auth.uid) throw new HttpsError("permission-denied", "Esta carga no pertenece al usuario.");
    const [metadata] = await bucket.file(resource.storagePath).getMetadata();
    if (Number(metadata.size) !== resource.sizeBytes || metadata.contentType !== resource.mimeType || metadata.metadata?.uploadedByUid !== request.auth.uid) throw new HttpsError("data-loss", "El audio cargado no coincide con la referencia.");
    if (data.replaceId) requireClassroom(profile, "orderMaterial");
    const download = await prepareResource(profile, resource); const catalog = await add(trackFromDownload(download, data.title || resource.name, "storage"), data.replaceId && identifier(data.replaceId));
    await document.ref.update({ state: "ready", retainedByPublication: true, archived: true }); return { catalog };
  }
  async function edit(request) {
    await editor(request, "orderMaterial"); const data = request.data || {};
    return { catalog: await change(catalog => {
      if (data.action === "rename") { const track = catalog.tracks.find(item => item.id === identifier(data.id)); if (!track) throw new HttpsError("not-found", "Pista no encontrada."); track.title = title(data.title); }
      else if (data.action === "remove") { const id = identifier(data.id); catalog.tracks = catalog.tracks.filter(item => item.id !== id); catalog.playlists = catalog.playlists.map(list => ({ ...list, trackIds: list.trackIds.filter(trackId => trackId !== id) })); }
      else if (data.action === "order") {
        if (!Array.isArray(data.ids) || data.ids.length !== catalog.tracks.length || new Set(data.ids).size !== data.ids.length || data.ids.some(id => !catalog.tracks.some(track => track.id === id))) throw new HttpsError("invalid-argument", "Orden de música inválido.");
        catalog.tracks = data.ids.map(id => catalog.tracks.find(track => track.id === id));
      } else if (data.action === "set-default") {
        if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) throw new HttpsError("invalid-argument", "Versión de catálogo inválida.");
        if (data.id !== null && !catalog.tracks.some(track => track.id === data.id && track.active)) throw new HttpsError("failed-precondition", "La pista ya no está disponible.");
        catalog.playlists = catalog.playlists.filter(playlist => playlist.id !== DEFAULT_PLAYLIST_ID);
        catalog.playlists.push({ id: DEFAULT_PLAYLIST_ID, title: "Música predeterminada del módulo", trackIds: data.id ? [data.id] : [] });
      } else throw new HttpsError("invalid-argument", "Acción de música inválida.");
      return catalog;
    }, data.action === "set-default" ? data.expectedVersion : undefined) };
  }
  async function migrate(request) {
    const profile = await editor(request, "orderMaterial"); if ((await read()).migrated) return { catalog: await read(), migrated: 0, failures: [] };
    const units = await db.collection("activeClassroomUnits").get(); const found = []; const failures = [];
    for (const unit of units.docs) {
      const publications = await unit.ref.collection("publications").get();
      for (const publication of publications.docs) {
        const manifest = publication.data().manifest;
        for (const music of manifest?.backgroundMusic || []) {
          try { const resource = manifest.resources.find(item => item.resourceId === music.resourceId); const download = await verifyDownload(resource.download); found.push(trackFromDownload(download, music.title)); }
          catch { failures.push({ unitId: unit.id, resourceId: music.resourceId, message: "No se pudo recuperar la copia publicada." }); }
        }
      }
      for (const music of unit.data().draft?.backgroundMusic || []) {
        try { const document = await resources.doc(identifier(music.resourceId)).get(); if (!document.exists) throw new Error("missing"); const download = await prepareResource(profile, { ...document.data(), id: document.id }); found.push(trackFromDownload(download, music.title)); }
        catch { failures.push({ unitId: unit.id, resourceId: music.resourceId, message: "No se pudo recuperar el audio del borrador. La referencia anterior se conserva." }); }
      }
    }
    const catalog = await change(catalog => { for (const track of found) if (!catalog.tracks.some(item => item.sha256 === track.sha256)) catalog.tracks.push(track); catalog.migrated = !failures.length; return catalog; });
    return { catalog, migrated: found.length, failures };
  }
  async function version(data) {
    const version = Number(data.version); if (!Number.isSafeInteger(version) || version < 1) throw new HttpsError("invalid-argument", "Versión de música inválida.");
    const catalog = (await current.collection("versions").doc(String(version)).get()).data(); const track = catalog?.tracks.find(item => item.id === identifier(data.trackId));
    if (!track) throw new HttpsError("not-found", "Pista no disponible en esta versión."); return track;
  }
  async function list(request) { await authorize(request); return { catalog: await read() }; }
  async function preview(request) {
    await editor(request, "access"); const track = await version(request.data || {});
    const [url] = await bucket.file(track.storagePath, { generation: track.generation }).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 5 * 60 * 1000, queryParams: { generation: track.generation } }); return { url };
  }
  async function file(request, response) {
    response.set("Cache-Control", "private, no-store");
    if (request.method !== "GET") return response.status(405).set("Allow", "GET").end();
    try {
      const profile = await getRequestProfile(request); if (!profile?.activeClassroomDevice) requireClassroom(profile); else if (profile.active !== true) throw new HttpsError("permission-denied", "Equipo no autorizado.");
      const track = await version(request.query); const range = downloadRange(request.headers.range, track.size);
      response.status(range ? 206 : 200).set({ "Content-Type": track.mime, "Content-Length": String(range ? range.end - range.start + 1 : track.size), "Accept-Ranges": "bytes", "X-Content-SHA256": track.sha256, "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,X-Content-SHA256", "X-Content-Type-Options": "nosniff" });
      if (range) response.set("Content-Range", `bytes ${range.start}-${range.end}/${track.size}`);
      await pipeline(bucket.file(track.storagePath, { generation: track.generation }).createReadStream({ ...range, decompress: false }), response);
    } catch (error) { if (response.headersSent) return response.destroy(); response.removeHeader("Content-Length"); response.status(error.httpStatus || { unauthenticated: 401, "permission-denied": 403, "not-found": 404, "invalid-argument": 400 }[error.code] || 500).json({ error: error.code || "internal", message: "No se pudo leer la música ambiente." }); }
  }
  return { list, imported, upload, edit, migrate, preview, file };
}
module.exports = { createAmbientHandlers, emptyCatalog, trackFromDownload };
