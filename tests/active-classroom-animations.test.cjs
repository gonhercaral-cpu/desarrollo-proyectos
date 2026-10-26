const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const { animationTargetPath, validateAnimationPlan, verifyAnimation, addPublishedAnimations, attachConvertedAnimations } = require("../drive/activeClassroomAnimations");
const { createProcessorClient } = require("../drive/activeClassroomProcessorClient");
const { rasterTargetPath, PPTX_PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");
const revision = "12345678-1234-1234-1234-123456789abc";
const png = Buffer.alloc(24); png.write("89504e470d0a1a0a", "hex"); png.writeUInt32BE(1600, 16); png.writeUInt32BE(900, 20);
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const hash = value => createHash("sha256").update(value).digest("hex");
const rectangle = { x: 10, y: 20, width: 30, height: 40 };
const plan = [{ slideIndex: 0, images: [{ ...rectangle, sha256: hash(gif), sizeBytes: gif.length }] }];
function storage() {
  const files = new Map();
  for (const [asset, data, mime] of [["background", png, "image/png"], ["gif-0", gif, "image/gif"]]) files.set(animationTargetPath(revision, 0, asset), { data, metadata: { size: String(data.length), contentType: mime, generation: "7", metadata: {} } });
  return { files, file(path) { const value = files.get(path); assert.ok(value, `unexpected path ${path}`); return { async getMetadata() { return [value.metadata]; }, async setMetadata(update) { Object.assign(value.metadata, update); }, createReadStream() { return Readable.from([value.data]); } }; } };
}
const converted = [{ slideIndex: 0, background: { width: 1600, height: 900, sizeBytes: png.length, sha256: hash(png) }, images: [{ sizeBytes: gif.length, sha256: hash(gif) }] }];

test("plan GIF limita composición, tipos, cantidad y tamaño sin afectar estados estáticos", () => {
  assert.equal(validateAnimationPlan(plan, [{ steps: [] }]), plan);
  assert.deepEqual(validateAnimationPlan(undefined, [{ steps: [] }]), []);
  for (const mutate of [p => { p[0].images[0].width = 95; }, p => { p[0].slideIndex = 5; }, p => { p[0].images[0].sha256 = "bad"; }, p => { p.push(p[0]); }, p => { p[0].images[0].sizeBytes = 16 * 1024 * 1024; }]) {
    const value = structuredClone(plan); mutate(value); assert.throws(() => validateAnimationPlan(value, [{ steps: [] }]), { code: "data-loss" });
  }
  assert.throws(() => validateAnimationPlan(plan, [{ steps: [["shape"]] }]), { code: "data-loss" });
});

test("derivado híbrido exige paths exactos, bytes, hash, generación y geometría", async () => {
  const bucket = storage(); const pages = [{ width: 1600, height: 900 }];
  await attachConvertedAnimations(bucket, revision, pages, plan, converted);
  await verifyAnimation(bucket, pages[0].animation, revision, 0, pages[0], true);
  const bad = structuredClone(pages[0].animation); bad.images[0].download.path = "private/other";
  await assert.rejects(verifyAnimation(bucket, bad, revision, 0, pages[0], true), { code: "data-loss" });
  bucket.files.get(animationTargetPath(revision, 0, "gif-0")).data = Buffer.alloc(gif.length);
  await assert.rejects(verifyAnimation(bucket, pages[0].animation, revision, 0, pages[0], true), { code: "data-loss" });
});

test("publicación conserva PNG principal compatible y agrega GIF/fondo como recursos offline", async () => {
  const bucket = storage(); const pages = [{ width: 1600, height: 900 }];
  await attachConvertedAnimations(bucket, revision, pages, plan, converted);
  const base = { resourceId: "main", name: "Clase", download: { mimeType: "image/png", path: "full-static" }, derivative: { revision } };
  const resources = addPublishedAnimations([base], [{ resourceId: "main", animation: pages[0].animation }]);
  assert.equal(resources.length, 3); assert.equal(resources[0].download.path, "full-static");
  assert.equal(resources.find(r => r.resourceId === resources[0].animation.backgroundResourceId).download.mimeType, "image/png");
  assert.equal(resources.find(r => r.resourceId === resources[0].animation.images[0].resourceId).download.mimeType, "image/gif");
  assert.equal(base.animation, undefined);
  const limited = addPublishedAnimations([base], [{ resourceId: "main", animation: pages[0].animation }], 2);
  assert.equal(limited.length, 1); assert.equal(limited[0].animation, undefined); assert.match(limited[0].animationWarning, /límite/);
});

test("resultado opcional no puede sustituir bytes GIF originales ni dimensiones del fondo", async () => {
  for (const mutate of [value => { value[0].images[0].sha256 = "a".repeat(64); }, value => { value[0].background.width = 900; }, value => { value.push(value[0]); }]) {
    const value = structuredClone(converted); mutate(value);
    await assert.rejects(attachConvertedAnimations(storage(), revision, [{ width: 1600, height: 900 }], plan, value), { code: "data-loss" });
  }
});

for (const broken of [false, true]) test(`cliente integra GIF opcional o conserva PNG ante fallo: ${broken}`, async () => {
  const bucket = storage(); const deleted = [];
  bucket.files.set(rasterTargetPath(revision, 0), { data: png, metadata: { size: String(png.length), generation: "7", contentType: "image/png", metadata: {} } });
  const rawFile = bucket.file.bind(bucket);
  bucket.file = path => {
    if (!bucket.files.has(path)) bucket.files.set(path, { metadata: {} });
    return { ...rawFile(path), name: path, async getSignedUrl() { return [`https://storage.googleapis.com/local-test/${path}?X-Goog-Signature=test`]; }, async delete() { deleted.push(path); } };
  };
  const slides = [{ index: 0, steps: [], warnings: [] }];
  const stages = [];
  const convert = createProcessorClient({ bucket, getUrl: () => "https://processor.a.run.app", getClient: async () => ({ async request(request) {
    if (request.url.endsWith("/plan")) return { data: { slides, stateCount: 1, animationPlan: plan } };
    assert.equal(request.data.animationUploadUrls[0].imageUrls.length, 1);
    const animations = structuredClone(converted);
    if (broken) animations[0].images[0].sha256 = "a".repeat(64);
    return { data: { revision, processorVersion: PPTX_PROCESSOR_VERSION, pageCount: 1, slides, states: [converted[0].background], animations } };
  } }) });
  const result = await convert({ revision, processorVersion: PPTX_PROCESSOR_VERSION, extension: "pptx", original: { path: "original", generation: "1", name: "Class.pptx" } }, { onStage: async stage => stages.push(stage) });
  assert.deepEqual(stages, ["planning", "converting", "verifying"]);
  assert.equal(result.pages[0].download.mimeType, "image/png");
  assert.equal(!!result.pages[0].animation, !broken);
  assert.equal(deleted.length, broken ? 2 : 0);
});
