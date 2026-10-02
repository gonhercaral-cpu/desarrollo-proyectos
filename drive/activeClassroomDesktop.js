const { HttpsError } = require("firebase-functions/v2/https");
const { pipeline } = require("node:stream/promises");

function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new HttpsError("invalid-argument", "Identificador inválido.");
  return value;
}
function versionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpsError("invalid-argument", "Versión inválida.");
  return value;
}
function requireActive(profile) {
  if (profile?.active !== true) throw new HttpsError("permission-denied", "Se requiere un perfil activo.");
}

function createDesktopHandlers({ db, getProfile, getRequestProfile, authorizeDevice, isDevice = () => false, resolveFile, bucket }) {
  const units = db.collection("activeClassroomUnits");
  async function authorize(request) {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profile = isDevice(request.auth) ? await authorizeDevice(request.auth) : await getProfile(request.auth.uid);
    requireActive(profile);
    return profile;
  }
  const deviceMetadata = (profile) => profile.activeClassroomDevice ? { device: { deviceId: profile.deviceId, deviceName: profile.deviceName || null, displayName: profile.displayName || "" } } : {};
  async function readManifest(unitId, requestedVersion) {
    const unit = units.doc(id(unitId));
    const version = requestedVersion == null ? (await unit.get()).data()?.publishedVersion : versionNumber(requestedVersion);
    if (!version) throw new HttpsError("not-found", "Unit sin publicaciones.");
    const manifest = (await unit.collection("publications").doc(String(version)).get()).data()?.manifest;
    if (!manifest) throw new HttpsError("not-found", "Publicación no encontrada.");
    return manifest;
  }
  async function list(request) {
    const profile = await authorize(request);
    const limit = request.data?.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpsError("invalid-argument", "Límite entre 1 y 50.");
    let query = units.orderBy("__name__").limit(limit + 1);
    if (request.data?.cursor) query = query.startAfter(id(request.data.cursor));
    const page = await query.get();
    const scanned = page.docs.slice(0, limit);
    const publications = [];
    for (const document of scanned) {
      if (!document.data().publishedVersion) continue;
      const manifest = await readManifest(document.id, document.data().publishedVersion);
      publications.push({ unitId: document.id, version: manifest.version, name: manifest.unit.name, levelId: manifest.unit.levelId, schemaVersion: manifest.schemaVersion, publishedAt: manifest.publishedAt, contentHash: manifest.integrity.contentHash });
    }
    // Cursor counts scanned Units, including drafts; keep paging even on an empty page.
    return { publications, nextCursor: page.docs.length > limit ? scanned.at(-1).id : null, ...deviceMetadata(profile) };
  }
  async function get(request) {
    const profile = await authorize(request);
    return { manifest: await readManifest(request.data?.unitId, request.data?.version), ...deviceMetadata(profile) };
  }
  async function resolveDownload(profile, data) {
    requireActive(profile);
    const manifest = await readManifest(data.unitId, versionNumber(Number(data.version)));
    const resource = manifest.resources.find((item) => item.resourceId === id(data.resourceId));
    if (!resource) throw new HttpsError("not-found", "El recurso no pertenece a esta publicación.");
    if (manifest.schemaVersion < 2 || !resource.download) throw new HttpsError("failed-precondition", "Publicación antigua sin archivos congelados. Publica una nueva versión desde la web.");
    // Recheck current Nube AES ACL; a publication must not bypass private folders/shares.
    if (resource.file.provider === "drive" && !profile.activeClassroomDevice) {
      const original = await resolveFile(profile, resource.file.fileId);
      if (original.trashed || original.capabilities?.canDownload === false) throw new HttpsError("permission-denied", "Original no disponible para este usuario.");
    }
    const download = resource.download;
    if (!/^active-classroom\/publications\/files\/[a-f0-9]{64}$/.test(download.path) || !/^\d+$/.test(download.generation)) throw new HttpsError("data-loss", "Referencia publicada inválida.");
    return download;
  }
  async function file(request, response) {
    response.set("Cache-Control", "private, no-store");
    response.set("Access-Control-Expose-Headers", "Content-Length, Content-Disposition, X-Content-SHA256");
    if (request.method !== "GET") return response.status(405).set("Allow", "GET").json({ error: "method-not-allowed" });
    try {
      const profile = await getRequestProfile(request);
      const download = await resolveDownload(profile, request.query);
      response.set({ "Content-Type": download.mimeType, "Content-Length": String(download.sizeBytes),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.name)}`,
        "X-Content-SHA256": download.checksums.sha256, "X-Content-Type-Options": "nosniff" });
      await pipeline(bucket.file(download.path, { generation: download.generation }).createReadStream(), response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      response.removeHeader("Content-Length");
      response.removeHeader("Content-Disposition");
      const code = String(error.code || "internal");
      const status = { unauthenticated: 401, "permission-denied": 403, "not-found": 404, "invalid-argument": 400, "failed-precondition": 409 }[code]
        || (code.startsWith("auth/") ? 401 : [403, 404].includes(Number(code)) ? Number(code) : 500);
      response.status(status).json({ error: status === 500 ? "internal" : code, message: status === 500 ? "No se pudo descargar el archivo publicado." : error.message });
    }
  }
  return { list, get, file, resolveDownload };
}

module.exports = { createDesktopHandlers };
