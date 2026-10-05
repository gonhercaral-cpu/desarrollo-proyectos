const { createHash } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");
const { crc32 } = require("node:zlib");
const { HttpsError } = require("firebase-functions/v2/https");
const { checkOriginal, descriptor } = require("./activeClassroomFiles");
const { SLIDES_PROCESSOR_VERSION, slidesTargetPath } = require("./activeClassroomProcessingModel");

const MAX_PNG_BYTES = 20 * 1024 * 1024;
function pngDimensions(bytes) {
  if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.subarray(-12).toString("hex") !== "0000000049454e44ae426082") throw new HttpsError("data-loss", "Thumbnail PNG inválida.");
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (!width || !height || Math.max(width, height) > 1600) throw new HttpsError("data-loss", "Dimensiones PNG inválidas.");
  let offset = 8; let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const end = offset + 8 + length;
    if (end + 4 > bytes.length || crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) throw new HttpsError("data-loss", "Checksum PNG inválido.");
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") hasImageData = true;
    offset = end + 4;
  }
  if (offset !== bytes.length || !hasImageData) throw new HttpsError("data-loss", "Datos PNG incompletos.");
  return { width, height };
}
async function downloadThumbnail(url) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || !(target.hostname === "googleusercontent.com" || target.hostname.endsWith(".googleusercontent.com"))) throw new HttpsError("data-loss", "URL thumbnail inválida.");
  const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) { const error = new Error("Thumbnail HTTP"); error.status = response.status; throw error; }
  if (!response.headers.get("content-type")?.startsWith("image/png") || Number(response.headers.get("content-length")) > MAX_PNG_BYTES) throw new HttpsError("data-loss", "Contenido thumbnail inválido.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_PNG_BYTES) throw new HttpsError("resource-exhausted", "Thumbnail demasiado grande.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function createGoogleSlidesProcessor({ bucket, resolveFile, getSlides, download = downloadThumbnail, wait = sleep, clock = Date.now }) {
  async function original(profile, resource) {
    const file = await resolveFile(profile, resource.driveFileId);
    checkOriginal(resource, file);
    if (resource.source !== "drive" || file.mimeType !== "application/vnd.google-apps.presentation" || (!file.version && !file.modifiedTime)) throw new HttpsError("failed-precondition", "Referencia Google Slides inválida.");
    return { provider: "drive", fileId: file.id, name: file.name, mimeType: file.mimeType, version: String(file.version || ""), modifiedTime: file.modifiedTime || "" };
  }
  async function render({ profile, resource, revision }) {
    await original(profile, resource); // Existing Nube AES ACL, no new auth system.
    const slides = await getSlides(); const presentationId = resource.driveFileId;
    const uploaded = []; const pages = []; let bytesTotal = 0;
    const deadline = clock() + 450000;
    async function retry(operation) {
      for (let attempt = 0; ; attempt++) {
        if (clock() > deadline) throw new HttpsError("deadline-exceeded", "Procesamiento Google Slides agotó el tiempo.");
        try { return await operation(); } catch (error) {
          const status = Number(error?.response?.status || error.status || error.code);
          if (![429, 500, 502, 503, 504].includes(status) || attempt >= 6) throw error;
          await wait(Math.min(32000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500));
        }
      }
    }
    const read = async () => (await retry(() => slides.presentations.get({ presentationId, fields: "presentationId,revisionId,slides(objectId)" }, { timeout: 20000 }))).data;
    try {
      const presentation = await read();
      if (!Array.isArray(presentation.slides) || !presentation.slides.length || presentation.slides.length > 200 || new Set(presentation.slides.map((page) => page.objectId)).size !== presentation.slides.length) throw new HttpsError("resource-exhausted", "Google Slides requiere entre 1 y 200 diapositivas únicas.");
      for (const [index, slide] of presentation.slides.entries()) {
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(slide.objectId || "")) throw new HttpsError("data-loss", "Identificador de slide inválido.");
        if (index) await wait(1100); // Stay below the documented 60 expensive reads/user/minute.
        const thumbnail = (await retry(() => slides.presentations.pages.getThumbnail({ presentationId, pageObjectId: slide.objectId, "thumbnailProperties.mimeType": "PNG", "thumbnailProperties.thumbnailSize": "LARGE" }, { timeout: 20000 }))).data;
        // Fetch immediately; this access-bearing URL never enters persisted metadata or logs.
        const bytes = await retry(() => download(thumbnail.contentUrl));
        if (bytes.length > MAX_PNG_BYTES) throw new HttpsError("resource-exhausted", "Thumbnail demasiado grande.");
        const dimensions = pngDimensions(bytes);
        if (dimensions.width !== thumbnail.width || dimensions.height !== thumbnail.height) throw new HttpsError("data-loss", "Dimensiones thumbnail inconsistentes.");
        bytesTotal += bytes.length;
        if (bytesTotal > 250 * 1024 * 1024) throw new HttpsError("resource-exhausted", "Máximo 250 MiB de imágenes por presentación.");
        const path = slidesTargetPath(revision, slide.objectId); const sha256 = createHash("sha256").update(bytes).digest("hex");
        const file = bucket.file(path); uploaded.push(path);
        await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "image/png", cacheControl: "private, no-store", metadata: { sha256, deliveredName: `slide-${index + 1}.png`, capturedAt: new Date(clock()).toISOString(), processingRevision: revision, pageObjectId: slide.objectId, width: String(dimensions.width), height: String(dimensions.height) } } });
        const [metadata] = await file.getMetadata(); const frozen = descriptor(path, metadata);
        const [stored] = await bucket.file(path, { generation: frozen.generation }).download();
        if (stored.length !== bytes.length || frozen.sizeBytes !== bytes.length || createHash("sha256").update(stored).digest("hex") !== sha256) throw new HttpsError("data-loss", "PNG almacenada corrupta.");
        pages.push({ pageObjectId: slide.objectId, index, storagePath: path, size: bytes.length, sha256, ...dimensions, download: frozen });
      }
      const after = await read();
      if ((presentation.revisionId && after.revisionId !== presentation.revisionId) || JSON.stringify(after.slides) !== JSON.stringify(presentation.slides)) throw new HttpsError("aborted", "Google Slides cambió durante el procesamiento. Actualiza el borrador.");
      await original(profile, resource);
      return { revision, processorVersion: SLIDES_PROCESSOR_VERSION, sourceType: "google-slides", pageCount: pages.length, pages, download: pages[0].download };
    } catch (error) {
      await Promise.all(uploaded.map((path) => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => {})));
      throw error;
    }
  }
  async function verify(processing) {
    if (processing.processorVersion !== SLIDES_PROCESSOR_VERSION || !Array.isArray(processing.pages) || processing.pages.length !== processing.pageCount || !processing.pages.length || processing.pages.length > 200 || new Set(processing.pages.map((page) => page.pageObjectId)).size !== processing.pages.length) throw new HttpsError("data-loss", "Derivados Google Slides incompletos.");
    const first = processing.pages[0].download;
    if (!first || processing.download?.path !== first.path || processing.download.generation !== first.generation || processing.download.checksums?.sha256 !== first.checksums?.sha256 || processing.download.sizeBytes !== first.sizeBytes || processing.download.mimeType !== "image/png") throw new HttpsError("data-loss", "Derivado principal inválido.");
    for (const [index, page] of processing.pages.entries()) {
      if (page.index !== index || !/^[a-zA-Z0-9_-]{1,200}$/.test(page.pageObjectId || "") || page.storagePath !== slidesTargetPath(processing.revision, page.pageObjectId) || page.download?.path !== page.storagePath || page.download.endpoint !== "activeClassroomPublicationFile" || page.download.provider !== "storage" || !/^\d+$/.test(page.download.generation || "") || page.download.mimeType !== "image/png" || !/^[a-f0-9]{64}$/.test(page.sha256 || "") || page.sha256 !== page.download.checksums?.sha256 || !Number.isSafeInteger(page.size) || page.size < 45 || page.size > MAX_PNG_BYTES || page.size !== page.download.sizeBytes || !Number.isInteger(page.width) || !Number.isInteger(page.height) || Math.min(page.width, page.height) < 1 || Math.max(page.width, page.height) > 1600) throw new HttpsError("data-loss", "Referencia thumbnail inválida.");
      const [metadata] = await bucket.file(page.storagePath, { generation: page.download.generation }).getMetadata();
      if (String(metadata.generation) !== page.download.generation || Number(metadata.size) !== page.size || metadata.contentType !== "image/png" || metadata.metadata?.sha256 !== page.sha256 || metadata.metadata?.processingRevision !== processing.revision || metadata.metadata?.pageObjectId !== page.pageObjectId || Number(metadata.metadata?.width) !== page.width || Number(metadata.metadata?.height) !== page.height) throw new HttpsError("data-loss", "Thumbnail congelada no disponible.");
    }
    return processing.download;
  }
  return { original, render, verify };
}
module.exports = { createGoogleSlidesProcessor, pngDimensions, downloadThumbnail };
