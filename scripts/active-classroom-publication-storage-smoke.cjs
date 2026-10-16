// Private synthetic fixture; no Units, users or Firestore documents are changed.
// Use the Cloud Build identity, or a token supplied in memory by local gcloud.
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const { createRequire } = require("node:module");
const { Storage } = require("../drive/node_modules/@google-cloud/storage");
// Match Storage's auth dependency (Drive uses a different gaxios major).
const { OAuth2Client } = createRequire(require.resolve("../drive/node_modules/@google-cloud/storage"))("google-auth-library");
const { createPublicationFiles } = require("../drive/activeClassroomFiles");

async function main() {
  const options = { projectId: "sistema-desarrollo-proyectos" };
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    options.authClient = new OAuth2Client();
    options.authClient.setCredentials({ access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
  }
  const bucket = new Storage(options).bucket("sistema-desarrollo-proyectos.firebasestorage.app");
  const id = `deployment-smoke-${randomUUID()}`;
  const size = 300 * 1024 * 1024;
  const block = Buffer.alloc(65536, 7);
  const expected = createHash("sha256");
  for (let offset = 0; offset < size; offset += block.length) expected.update(block);
  const expectedHash = expected.digest("hex");
  const registry = new Map();
  const db = {
    collection: () => ({ doc: (key) => ({ key, get: async () => ({ data: () => registry.get(key) }) }) }),
    runTransaction: async (operation) => operation({
      get: async (ref) => ({ data: () => registry.get(ref.key) }),
      create: (ref, value) => registry.set(ref.key, value),
    }),
  };
  const originalPath = `active-classroom/resources/${id}/fixture.bin`;
  const cleanup = new Set([originalPath]);
  const source = { id, name: "fixture.bin", mimeType: "application/octet-stream", version: "1", size: String(size) };
  const files = createPublicationFiles({ db, bucket, resolveFile: async () => source,
    openDrive: async () => Readable.from((async function* () {
      for (let offset = 0; offset < size; offset += block.length) {
        if (offset && offset % (64 * 1024 * 1024) === 0) console.log(`Stream progress: ${offset / 1024 / 1024} MiB`);
        yield block;
      }
    })()),
  });
  try {
    const streamed = await files.prepareResource({}, { id, source: "drive", driveFileId: id, driveVersion: "1", name: source.name, mimeType: source.mimeType }, { snapshotId: `${id}:stream` });
    cleanup.add(streamed.path);
    assert.equal(streamed.sizeBytes, size);
    assert.equal(streamed.checksums.sha256, expectedHash);
    await files.verifyDownload(streamed);
    await bucket.file(streamed.path, { generation: streamed.generation }).copy(bucket.file(originalPath), { metadata: { firebaseStorageDownloadTokens: null } });
    let sourceReads = 0;
    const copyingBucket = { file: (path, options) => {
      const file = bucket.file(path, options);
      if (path === originalPath) file.createReadStream = () => { sourceReads++; throw new Error("Source download forbidden"); };
      return file;
    } };
    const copying = createPublicationFiles({ db, bucket: copyingBucket });
    const copied = await copying.prepareResource({}, { id, storagePath: originalPath, name: source.name, mimeType: source.mimeType }, { snapshotId: `${id}:copy` });
    cleanup.add(copied.path);
    assert.equal(copied.sizeBytes, size);
    assert.equal(copied.checksums.sha256, expectedHash);
    assert.equal(sourceReads, 0);
    const [metadata] = await bucket.file(copied.path).getMetadata();
    assert.ok(!metadata.metadata?.firebaseStorageDownloadTokens);
    await copying.verifyDownload(copied);
    console.log(JSON.stringify({ sizeBytes: size, sha256: expectedHash, streaming: "passed", serverSideCopy: "passed", sourceReads, generationVerified: true }));
  } finally {
    // Deterministic fixture IDs also cover cleanup if prepareResource rejects.
    const { contentHash } = require("../drive/activeClassroomUnit");
    for (const suffix of ["stream", "copy"]) cleanup.add(`active-classroom/publications/files/${contentHash(`${id}:${suffix}`)}`);
    for (const path of cleanup) await bucket.file(path).delete({ ignoreNotFound: true });
    console.log("Private smoke fixtures removed");
  }
}
main().catch((error) => {
  const safe = String(error.message).replaceAll(process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "no-token", "[redacted]").replace(/https?:\/\/\S+/g, "[url]");
  console.error(`Storage smoke failed: ${error.code || error.name}: ${safe}`);
  console.error(String(error.stack).split("\n").filter((line) => line.trim().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});
