const { createHash, randomUUID } = require("node:crypto");
const { Transform, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { request: httpRequest } = require("node:http");
const { request: httpsRequest } = require("node:https");
const { HttpsError } = require("firebase-functions/v2/https");
const { getDriveContentDescriptor } = require("./fileContent");
const { contentHash, driveChanged } = require("./activeClassroomUnit");
const { googleErrorReason, processingError } = require("./activeClassroomDriveContent");
const { maxFileBytes: MAX_BYTES, uploadHighWaterMarkBytes, transferTimeoutSeconds } = require("./activeClassroomPublicationLimits.json");

const ROOT = "active-classroom/publications";
function checkSize(size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new HttpsError("data-loss", "Tamaño de archivo inválido.");
  if (size > MAX_BYTES) throw new HttpsError("resource-exhausted", "El archivo supera el límite operativo de publicación de 10 GiB.");
}
function unavailable() { throw new HttpsError("failed-precondition", "El original cambió o no está disponible. Actualiza el borrador desde Nube AES."); }
function checkOriginal(resource, file) {
  if (file.trashed || file.capabilities?.canDownload === false || driveChanged(resource, file)) unavailable();
}
function descriptor(path, metadata) {
  checkSize(Number(metadata.size));
  if (!/^\d+$/.test(String(metadata.generation))) throw new HttpsError("data-loss", "Generación del archivo inválida.");
  if (!/^[a-f0-9]{64}$/.test(metadata.metadata?.sha256 || "")) throw new HttpsError("data-loss", "La copia publicada no tiene checksum válido.");
  return {
    endpoint: "activeClassroomPublicationFile", provider: "storage", path,
    generation: String(metadata.generation), name: metadata.metadata.deliveredName,
    mimeType: metadata.contentType, sizeBytes: Number(metadata.size),
    checksums: { sha256: metadata.metadata.sha256, md5Base64: metadata.md5Hash || null, crc32cBase64: metadata.crc32c || null },
    capturedAt: metadata.metadata.capturedAt,
  };
}

async function streamToStorage(staging, delivery, open, meter, signal) {
  // The URI is a private upload capability, never persisted in manifests or logs.
  // Node HTTP connects cancellation/backpressure directly to the socket.
  const [uri] = await staging.createResumableUpload({ preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: delivery.deliveredMimeType, cacheControl: "private, no-store" } });
  const controller = new AbortController();
  const uploadSignal = AbortSignal.any([signal, controller.signal]);
  let transfer, response;
  try {
    const input = await open();
    let output;
    response = new Promise((resolve, reject) => {
      output = (uri.startsWith("https:") ? httpsRequest : httpRequest)(uri, { method: "PUT", signal: uploadSignal }, (incoming) => {
        incoming.resume();
        incoming.on("error", reject);
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) reject(new HttpsError(incoming.statusCode === 413 ? "resource-exhausted" : "unavailable", incoming.statusCode === 413 ? "El proveedor rechazó el archivo por superar su límite de tamaño." : `Storage rechazó la transferencia (HTTP ${incoming.statusCode}).`));
        else incoming.on("end", resolve);
      });
      output.on("error", reject);
    });
    transfer = pipeline(input, meter, output, { signal: uploadSignal });
    await Promise.all([response, transfer]);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled([response, transfer]);
    // Cancel incomplete provider state too. 499 means cancellation succeeded;
    // completed/expired sessions may already return 404. Do not expose the URI.
    await fetch(uri, { method: "DELETE", signal: AbortSignal.timeout(10000) }).then((response) => response.body?.cancel()).catch(() => {});
    throw error;
  }
}

// Only publications materialize bytes. Imports continue to store Drive references.
// A deterministic source fingerprint reuses snapshots across Units and versions.
function createPublicationFiles({ db, bucket, resolveFile, openDrive, now = () => new Date().toISOString() }) {
  async function verifyDownload(download) {
    if (!download?.path?.startsWith(`${ROOT}/files/`) || !/^\d+$/.test(download.generation || "") || !/^[a-f0-9]{64}$/.test(download.checksums?.sha256 || "")) throw new HttpsError("data-loss", "Referencia publicada inválida.");
    const [metadata] = await bucket.file(download.path, { generation: download.generation }).getMetadata();
    const actual = descriptor(download.path, metadata);
    if (actual.generation !== download.generation || actual.sizeBytes !== download.sizeBytes || actual.mimeType !== download.mimeType || actual.checksums.sha256 !== download.checksums.sha256) throw new HttpsError("data-loss", "La copia publicada no coincide con su tamaño, generación o SHA-256.");
    return download;
  }
  async function prepareResource(profile, resource, { signal = AbortSignal.timeout(transferTimeoutSeconds * 1000), snapshotId } = {}) {
    let source, delivery, open, expectedSize, sourceFile, sourceMetadata;
    if (resource.source === "drive") {
      const file = await resolveFile(profile, resource.driveFileId);
      checkOriginal(resource, file);
      delivery = getDriveContentDescriptor(file);
      source = { provider: "drive", id: file.id, version: String(file.version || ""), modifiedTime: file.modifiedTime || "", md5: file.md5Checksum || "", mimeType: file.mimeType, name: file.name };
      // A stable source token is required even for native Google exports.
      if (!source.version && !source.modifiedTime && !source.md5) unavailable();
      open = () => openDrive(file, delivery);
      if (!delivery.exported && file.size != null && file.size !== "") expectedSize = Number(file.size);
    } else {
      if (!resource.storagePath?.startsWith(`active-classroom/resources/${resource.id}/`)) throw new HttpsError("failed-precondition", "Ruta del recurso inválida.");
      const [metadata] = await bucket.file(resource.storagePath).getMetadata();
      sourceMetadata = metadata;
      expectedSize = Number(metadata.size);
      source = { provider: "storage", path: resource.storagePath, generation: String(metadata.generation), name: resource.name, mimeType: resource.mimeType };
      delivery = { deliveredName: resource.name, deliveredMimeType: metadata.contentType || resource.mimeType };
      sourceFile = bucket.file(source.path, { generation: source.generation });
    }
    if (expectedSize !== undefined) checkSize(expectedSize);
    const registry = db.collection("activeClassroomFileSnapshots").doc(contentHash(source));
    const existing = (await registry.get()).data();
    if (existing) return verifyDownload(existing.download);
    // Unique immutable objects plus a transactional registry avoid overwrites even
    // when two publications prepare the same source simultaneously.
    const path = `${ROOT}/files/${contentHash(snapshotId || randomUUID())}`;
    const staging = bucket.file(path);
    // A retried task can remove its own unregistered object after a hard timeout.
    // Registered complete snapshots were returned above and must never be removed.
    if (snapshotId) await staging.delete({ ignoreNotFound: true });
    let retained = false;
    const hash = createHash("sha256");
    const md5 = createHash("md5");
    const crc32c = staging.crc32cGenerator();
    let size = 0;
    const meter = new Transform({ highWaterMark: uploadHighWaterMarkBytes, transform(chunk, _encoding, callback) {
      size += chunk.length;
      try { checkSize(size); } catch (error) { return callback(error); }
      hash.update(chunk); md5.update(chunk); crc32c.update(chunk); callback(null, chunk);
    } });
    try {
      if (sourceFile) {
        // GCS rewrite pins the source generation and copies bytes inside Storage.
        // Replace custom metadata: never copy Firebase download tokens to private snapshots.
        signal?.throwIfAborted();
        await sourceFile.copy(staging, { preconditionOpts: { ifGenerationMatch: 0 }, contentType: delivery.deliveredMimeType, cacheControl: "private, no-store", metadata: { firebaseStorageDownloadTokens: null } });
        signal?.throwIfAborted();
        const [copied] = await staging.getMetadata();
        if (Number(copied.size) !== expectedSize || (sourceMetadata.crc32c && copied.crc32c !== sourceMetadata.crc32c) || (sourceMetadata.md5Hash && copied.md5Hash !== sourceMetadata.md5Hash)) throw new HttpsError("data-loss", "La copia Storage no coincide con el original.");
        // Hash the immutable destination incrementally; no download/re-upload.
        await pipeline(staging.createReadStream({ decompress: false }), meter, new Writable({ write(_chunk, _encoding, callback) { callback(); } }), { signal });
      } else {
        await streamToStorage(staging, delivery, open, meter, signal);
      }
      if (expectedSize !== undefined && size !== expectedSize) throw new HttpsError("data-loss", "El tamaño transferido no coincide con el original.");
      if (source.provider === "drive" && source.md5 && md5.digest("hex") !== source.md5) throw new HttpsError("data-loss", "El checksum descargado no coincide con el original de Drive.");
      if (resource.source === "drive") checkOriginal(resource, await resolveFile(profile, resource.driveFileId));
      await staging.setMetadata({ metadata: { sha256: hash.digest("hex"), deliveredName: delivery.deliveredName, capturedAt: now(), firebaseStorageDownloadTokens: null } });
      const [metadata] = await staging.getMetadata();
      if (Number(metadata.size) !== size) throw new HttpsError("data-loss", "El tamaño almacenado no coincide con los bytes transferidos.");
      if (!crc32c.validate(metadata.crc32c)) throw new HttpsError("data-loss", "El checksum de Storage no coincide con los bytes transferidos.");
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
    } catch (error) {
      if (Number(error?.response?.status || error?.code) === 413 || googleErrorReason(error) === "exportSizeLimitExceeded") throw processingError(error);
      if (error?.code === "FILE_NO_UPLOAD" || error?.code === "CONTENT_DOWNLOAD_MISMATCH") throw new HttpsError("data-loss", "El checksum de Storage no coincide con los bytes transferidos.");
      throw error;
    } finally {
      if (!retained) {
        await staging.delete({ ignoreNotFound: true }).catch(() => {});
      }
    }
  }
  return { prepareResource, verifyDownload };
}

module.exports = { createPublicationFiles, checkOriginal, descriptor };
