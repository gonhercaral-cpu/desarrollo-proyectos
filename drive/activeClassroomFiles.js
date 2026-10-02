const { createHash, randomUUID } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { HttpsError } = require("firebase-functions/v2/https");
const { getDriveContentDescriptor } = require("./fileContent");
const { contentHash, driveChanged } = require("./activeClassroomUnit");

const ROOT = "active-classroom/publications";
const MAX_BYTES = 250 * 1024 * 1024;
function unavailable() { throw new HttpsError("failed-precondition", "El original cambió o no está disponible. Actualiza el borrador desde Nube AES."); }
function checkOriginal(resource, file) {
  if (file.trashed || file.capabilities?.canDownload === false || driveChanged(resource, file)) unavailable();
}
function descriptor(path, metadata) {
  if (!/^[a-f0-9]{64}$/.test(metadata.metadata?.sha256 || "")) throw new HttpsError("data-loss", "La copia publicada no tiene checksum válido.");
  return {
    endpoint: "activeClassroomPublicationFile", provider: "storage", path,
    generation: String(metadata.generation), name: metadata.metadata.deliveredName,
    mimeType: metadata.contentType, sizeBytes: Number(metadata.size),
    checksums: { sha256: metadata.metadata.sha256, md5Base64: metadata.md5Hash || null, crc32cBase64: metadata.crc32c || null },
    capturedAt: metadata.metadata.capturedAt,
  };
}

// Only publications materialize bytes. Imports continue to store Drive references.
// A deterministic source fingerprint reuses snapshots across Units and versions.
function createPublicationFiles({ db, bucket, resolveFile, openDrive, now = () => new Date().toISOString() }) {
  async function prepareResource(profile, resource) {
    let source, delivery, open;
    if (resource.source === "drive") {
      const file = await resolveFile(profile, resource.driveFileId);
      checkOriginal(resource, file);
      delivery = getDriveContentDescriptor(file);
      source = { provider: "drive", id: file.id, version: String(file.version || ""), modifiedTime: file.modifiedTime || "", md5: file.md5Checksum || "", mimeType: file.mimeType, name: file.name };
      // A stable source token is required even for native Google exports.
      if (!source.version && !source.modifiedTime && !source.md5) unavailable();
      open = () => openDrive(file, delivery);
    } else {
      if (!resource.storagePath?.startsWith(`active-classroom/resources/${resource.id}/`)) throw new HttpsError("failed-precondition", "Ruta del recurso inválida.");
      const [metadata] = await bucket.file(resource.storagePath).getMetadata();
      source = { provider: "storage", path: resource.storagePath, generation: String(metadata.generation), name: resource.name, mimeType: resource.mimeType };
      delivery = { deliveredName: resource.name, deliveredMimeType: metadata.contentType || resource.mimeType };
      open = async () => bucket.file(source.path, { generation: source.generation }).createReadStream();
    }
    const registry = db.collection("activeClassroomFileSnapshots").doc(contentHash(source));
    const existing = (await registry.get()).data();
    if (existing) return existing.download;
    // Unique immutable objects plus a transactional registry avoid overwrites even
    // when two publications prepare the same source simultaneously.
    const path = `${ROOT}/files/${contentHash(randomUUID())}`;
    const staging = bucket.file(path);
    let retained = false;
    const hash = createHash("sha256");
    const md5 = createHash("md5");
    let size = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_BYTES) return callback(new HttpsError("resource-exhausted", "Máximo 250 MiB por archivo publicado."));
      hash.update(chunk); md5.update(chunk); callback(null, chunk);
    } });
    try {
      await pipeline(await open(), meter, staging.createWriteStream({ resumable: false, metadata: { contentType: delivery.deliveredMimeType, cacheControl: "private, no-store" } }));
      if (source.provider === "drive" && source.md5 && md5.digest("hex") !== source.md5) throw new HttpsError("data-loss", "El checksum descargado no coincide con el original de Drive.");
      if (resource.source === "drive") checkOriginal(resource, await resolveFile(profile, resource.driveFileId));
      await staging.setMetadata({ metadata: { sha256: hash.digest("hex"), deliveredName: delivery.deliveredName, capturedAt: now() } });
      const [metadata] = await staging.getMetadata();
      const download = descriptor(path, metadata);
      // An uncertain transaction acknowledgement may already have committed.
      // Keep the object on that error; never delete bytes another manifest uses.
      retained = true;
      const selected = await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(registry)).data();
        if (current) return current.download;
        transaction.create(registry, { source, download });
        return download;
      });
      retained = selected.path === path;
      return selected;
    } finally {
      if (!retained) await staging.delete({ ignoreNotFound: true }).catch(() => {});
    }
  }
  return { prepareResource };
}

module.exports = { createPublicationFiles, checkOriginal, descriptor };
