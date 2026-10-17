const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createVideoDelivery } = require("../drive/activeClassroomVideoDelivery");
const { createPublicationFiles, descriptor } = require("../drive/activeClassroomFiles");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Requiere emuladores Firestore y Storage.");
test("Firestore/Storage: derivado faststart congelado, hash verificado, deduplicación concurrente e histórico intacto", async () => {
  const app = admin.initializeApp({ projectId: "security-rules-audit", storageBucket: "video-delivery-tests.appspot.com" }, "video-delivery-tests");
  const db = app.firestore(); const bucket = app.storage().bucket();
  const box = (type, payload = Buffer.alloc(0)) => { const header = Buffer.alloc(8); header.writeUInt32BE(8 + payload.length); header.write(type, 4); return Buffer.concat([header, payload]); };
  const ftyp = box("ftyp", Buffer.from("isom0000")); const mdat = box("mdat", Buffer.alloc(10000, 7));
  const stco = Buffer.alloc(12); stco.writeUInt32BE(1, 4); stco.writeUInt32BE(ftyp.length + 8, 8);
  const bytes = Buffer.concat([ftyp, mdat, box("moov", box("trak", box("mdia", box("minf", box("stbl", box("stco", stco))))))]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = `active-classroom/publications/files/${randomBytes(32).toString("hex")}`;
  const original = bucket.file(path);
  try {
    await original.save(bytes, { metadata: { contentType: "video/mp4", metadata: { sha256: sha, deliveredName: "Unit video.mp4", capturedAt: new Date().toISOString() } } });
    const download = descriptor(path, (await original.getMetadata())[0]);
    const files = createPublicationFiles({ db, bucket }); const prepare = createVideoDelivery({ db, bucket, descriptor, verifyDownload: files.verifyDownload, now: () => new Date().toISOString() });
    const results = await Promise.all([prepare(download), prepare(download)]);
    assert.deepEqual(results[0], results[1]); assert.notEqual(results[0].path, path);
    const output = (await bucket.file(results[0].path, { generation: results[0].generation }).download())[0];
    assert.equal(createHash("sha256").update(output).digest("hex"), results[0].checksums.sha256); assert.equal(output.length, results[0].sizeBytes);
    assert.ok(output.indexOf(Buffer.from("moov")) < output.indexOf(Buffer.from("mdat")));
    assert.deepEqual((await original.download())[0], bytes); assert.deepEqual(await files.verifyDownload(download), download);
    assert.deepEqual(await prepare(download), results[0]);
    assert.deepEqual(await files.verifyDownload(results[0]), results[0]);
    assert.equal((await bucket.getFiles({ prefix: "active-classroom/publications/files/" }))[0].length, 2, "copia perdedora concurrente se limpia");
  } finally { await bucket.deleteFiles({ prefix: "active-classroom/publications/files/" }); await app.delete(); }
});
