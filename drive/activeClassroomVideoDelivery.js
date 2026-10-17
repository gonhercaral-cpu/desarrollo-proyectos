// Lossless ISO-BMFF fast-start. Only bounded moov metadata enters memory;
// encoded samples stream between generation-pinned private Storage objects.
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const POLICY = "mp4-faststart-co64-v1";
const MAX_MOOV_BYTES = 64 * 1024 * 1024; // Metadata allocation only, not a video size cap.
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
const fail = () => { throw new HttpsError("data-loss", "No se pudo preparar el video para reproducción local. El original se conserva."); };
function boxHeader(bytes, start, limit) {
  if (bytes.length < 8) fail();
  const type = bytes.toString("ascii", 4, 8); let size = bytes.readUInt32BE(0); let header = 8;
  if (size === 1) { if (bytes.length < 16) fail(); const large = bytes.readBigUInt64BE(8); if (large > BigInt(Number.MAX_SAFE_INTEGER)) fail(); size = Number(large); header = 16; }
  if (!size) size = limit - start;
  if (size < header || size > limit - start) fail();
  return { start, size, type, header };
}
async function readRange(file, start, end, signal) {
  const input = file.createReadStream({ start, end, decompress: false }); const chunks = []; let size = 0;
  const abort = () => input.destroy(signal.reason); signal?.addEventListener("abort", abort, { once: true });
  try { for await (const chunk of input) { signal?.throwIfAborted(); size += chunk.length; if (size > end - start + 1) fail(); chunks.push(chunk); } }
  finally { signal?.removeEventListener("abort", abort); input.destroy(); }
  if (size !== end - start + 1) fail();
  return Buffer.concat(chunks, size);
}
async function planFastStart(file, size, signal) {
  const boxes = []; let offset = 0;
  while (offset < size) {
    if (boxes.length >= 10000 || size - offset < 8) fail();
    const header = await readRange(file, offset, Math.min(size - 1, offset + 15), signal);
    const box = boxHeader(header, offset, size); boxes.push(box); offset += box.size;
  }
  const movies = boxes.filter(box => box.type === "moov"); const firstData = boxes.find(box => box.type === "mdat");
  if (movies.length !== 1 || !firstData || !boxes.some(box => box.type === "ftyp")) fail();
  const movie = movies[0];
  // Already streamable or fragmented: leave exact original bytes untouched.
  if (movie.start < firstData.start || boxes.some(box => ["moof", "sidx", "mfra"].includes(box.type))) return null;
  if (movie.size > MAX_MOOV_BYTES) throw new HttpsError("resource-exhausted", "El índice del video supera 64 MiB. Optimiza su contenedor antes de publicar; el original se conserva.");
  const moov = await readRange(file, movie.start, movie.start + movie.size - 1, signal);
  return { boxes, movie, firstData, moov };
}
function encodeBox(type, payload) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4, 4, "ascii"); return Buffer.concat([header, payload]);
}
function rewriteMoov(bytes, mapOffset = value => value, depth = 0) {
  if (depth > 12) fail();
  const result = []; let offset = 0;
  while (offset < bytes.length) {
    const box = boxHeader(bytes.subarray(offset, offset + 16), offset, bytes.length);
    const payload = bytes.subarray(offset + box.header, offset + box.size);
    if (CONTAINERS.has(box.type)) result.push(encodeBox(box.type, rewriteMoov(payload, mapOffset, depth + 1)));
    else if (box.type === "stco" || box.type === "co64") {
      if (payload.length < 8) fail(); const count = payload.readUInt32BE(4); const width = box.type === "stco" ? 4 : 8;
      if (payload.length !== 8 + count * width) fail();
      // Promote every table, avoiding offset overflow for files larger than 4 GiB
      // and avoiding iterative size/offset guessing when moov itself grows.
      const table = Buffer.alloc(8 + count * 8); payload.copy(table, 0, 0, 8);
      for (let index = 0; index < count; index++) {
        const original = width === 4 ? BigInt(payload.readUInt32BE(8 + index * width)) : payload.readBigUInt64BE(8 + index * width);
        if (original > BigInt(Number.MAX_SAFE_INTEGER)) fail();
        table.writeBigUInt64BE(BigInt(mapOffset(Number(original))), 8 + index * 8);
      }
      result.push(encodeBox("co64", table));
    } else if (box.type === "cmov" || box.type === "mvex") fail();
    else result.push(bytes.subarray(offset, offset + box.size));
    offset += box.size;
  }
  return Buffer.concat(result);
}
function relocatedMoov(plan) {
  const length = rewriteMoov(plan.moov).length;
  const ordered = plan.boxes.filter(box => box !== plan.movie); ordered.splice(ordered.indexOf(plan.firstData), 0, plan.movie);
  let position = 0; const regions = [];
  for (const box of ordered) { if (box.type === "mdat") regions.push({ ...box, position }); position += box === plan.movie ? length : box.size; }
  const moov = rewriteMoov(plan.moov, value => { const region = regions.find(box => value >= box.start + box.header && value < box.start + box.size); if (!region) fail(); return region.position + value - region.start; });
  if (moov.length !== length) fail();
  return { ordered, moov, size: position };
}
async function* relocatedStream(file, plan, layout, signal) {
  for (const box of layout.ordered) {
    signal?.throwIfAborted();
    if (box === plan.movie) { yield layout.moov; continue; }
    const input = file.createReadStream({ start: box.start, end: box.start + box.size - 1, decompress: false, highWaterMark: 65536 });
    const abort = () => input.destroy(signal.reason); signal?.addEventListener("abort", abort, { once: true });
    try { for await (const chunk of input) { signal?.throwIfAborted(); yield chunk; } } finally { signal?.removeEventListener("abort", abort); input.destroy(); }
  }
}
function createVideoDelivery({ db, bucket, descriptor, verifyDownload, now }) {
  return async function prepareVideo(download, signal) {
    if (download.mimeType !== "video/mp4") return download;
    const fingerprint = createHash("sha256").update(JSON.stringify([POLICY, download.path, download.generation, download.checksums.sha256])).digest("hex");
    const registry = db.collection("activeClassroomVideoSnapshots").doc(fingerprint);
    const existing = (await registry.get()).data(); if (existing) return verifyDownload(existing.download);
    const file = bucket.file(download.path, { generation: download.generation });
    const plan = await planFastStart(file, download.sizeBytes, signal);
    if (!plan) return download;
    const layout = relocatedMoov(plan); const path = `active-classroom/publications/files/${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
    const target = bucket.file(path); const hash = createHash("sha256"); const crc = target.crc32cGenerator(); let size = 0; let retained = false;
    const meter = new Transform({ highWaterMark: 65536, transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); crc.update(chunk); callback(null, chunk); } });
    try {
      await pipeline(Readable.from(relocatedStream(file, plan, layout, signal)), meter, target.createWriteStream({ resumable: true, chunkSize: 8 * 1024 * 1024, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "video/mp4", cacheControl: "private, no-store" } }), { signal });
      if (size !== layout.size) fail();
      await target.setMetadata({ metadata: { sha256: hash.digest("hex"), deliveredName: download.name, capturedAt: now(), deliveryPolicy: POLICY, sourceSha256: download.checksums.sha256, firebaseStorageDownloadTokens: null } });
      const [metadata] = await target.getMetadata(); if (Number(metadata.size) !== size || !crc.validate(metadata.crc32c)) fail();
      const result = descriptor(path, metadata);
      retained = true; // An uncertain commit acknowledgement must not delete referenced bytes.
      const selected = await db.runTransaction(async transaction => { const current = (await transaction.get(registry)).data(); if (current) return current.download; transaction.create(registry, { source: download, policy: POLICY, download: result }); return result; });
      retained = selected.path === path; return selected;
    } finally { if (!retained) await target.delete({ ignoreNotFound: true }).catch(() => {}); }
  };
}
module.exports = { planFastStart, rewriteMoov, relocatedMoov, relocatedStream, createVideoDelivery };
