const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { Readable } = require("node:stream");
const { createGoogleSlidesProcessor, pngDimensions, downloadThumbnail } = require("../drive/activeClassroomSlides");
const { openActiveClassroomDrive, processingError } = require("../drive/activeClassroomDriveContent");
const { needsDocumentProcessing, officeExtension, processingFingerprint, pdfSlides, SLIDES_PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");

const png = readFileSync(require.resolve("../active-classroom-desktop/public/active-classroom-icon.png"));
const dimensions = pngDimensions(png);
const source = { id: "native", name: "Songs", mimeType: "application/vnd.google-apps.presentation", version: "1", modifiedTime: "2026-10-05T01:00:00Z", size: "100000000" };
const resource = { id: "main", source: "drive", driveFileId: source.id, name: source.name, mimeType: source.mimeType, driveVersion: source.version, driveModifiedTime: source.modifiedTime };
function memoryBucket() {
  const objects = new Map(); let generation = 0;
  return { objects, file(path, options = {}) {
    const existing = () => { const object = objects.get(path); assert.ok(object, "Objeto ausente"); if (options.generation) assert.equal(object.metadata.generation, options.generation); return object; };
    return {
      async save(bytes, settings) { assert.equal(settings.preconditionOpts.ifGenerationMatch, 0); assert.equal(objects.has(path), false); objects.set(path, { bytes, metadata: { ...settings.metadata, generation: String(++generation), size: bytes.length } }); },
      async getMetadata() { return [existing().metadata]; },
      async download() { return [existing().bytes]; },
      async delete() { objects.delete(path); },
    };
  } };
}
function fixture(ids = ["page_z", "page_a", "page_m"], overrides = {}) {
  const bucket = memoryBucket(); const calls = []; const downloads = []; const waits = [];
  const slides = { presentations: {
    get: async () => ({ data: { revisionId: "revision-original", slides: ids.map((objectId) => ({ objectId })) } }),
    pages: { getThumbnail: async (request) => { calls.push(request); return { data: { ...dimensions, contentUrl: `https://slides.googleusercontent.com/${request.pageObjectId}?temporary-secret` } }; } },
  } };
  const processor = createGoogleSlidesProcessor({ bucket, resolveFile: async () => ({ ...source }), getSlides: async () => slides, wait: async (ms) => waits.push(ms), download: async (url) => { downloads.push(url); return png; }, ...overrides });
  return { processor, bucket, calls, downloads, waits, slides };
}

test("PPT/PPTX binarios usan media; nunca export, incluso con descriptor antiguo", async () => {
  for (const mimeType of ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]) {
    let gets = 0;
    const drive = { files: { get: async (request, options) => { gets++; assert.equal(request.alt, "media"); assert.equal(options.responseType, "stream"); return { data: Readable.from("binary") }; }, export: () => { throw new Error("Export prohibido"); } } };
    const stream = await openActiveClassroomDrive(drive, { id: "binary", mimeType }, { exported: true });
    let content = ""; for await (const chunk of stream) content += chunk;
    assert.equal(content, "binary"); assert.equal(gets, 1);
  }
  await assert.rejects(openActiveClassroomDrive({}, source, {}), { code: "failed-precondition" });
  assert.equal(officeExtension({ ...resource, name: "Slides.pptx" }), null);
  assert.equal(needsDocumentProcessing(resource), true);
});

test("Google Slides pequeño: orden API, PNG LARGE, descarga inmediata y manifest sin URL temporal", async () => {
  const f = fixture(); const rendered = await f.processor.render({ profile: {}, resource, revision: "attempt-1" });
  assert.deepEqual(rendered.pages.map((page) => page.pageObjectId), ["page_z", "page_a", "page_m"]);
  assert.deepEqual(rendered.pages.map((page) => page.index), [0, 1, 2]);
  for (const call of f.calls) { assert.equal(call["thumbnailProperties.thumbnailSize"], "LARGE"); assert.equal(call["thumbnailProperties.mimeType"], "PNG"); }
  assert.equal(f.downloads.length, 3); assert.deepEqual(f.waits, [1100, 1100]);
  assert.equal(rendered.sourceType, "google-slides");
  assert.equal(await f.processor.verify(rendered), rendered.download);
  assert.doesNotMatch(JSON.stringify(rendered), /contentUrl|googleusercontent|temporary-secret/);
  const processed = { ...resource, processing: { ...rendered, state: "ready", sourceFingerprint: processingFingerprint(resource) } };
  const draft = pdfSlides(processed, [{ slideId: "legacy", index: 0, title: "Keep", metadata: { pageNumber: 1, notes: "Keep note" }, resourceIds: ["audio"] }]);
  assert.equal(draft[0].slideId, "legacy"); assert.deepEqual(draft[0].resourceIds, ["audio"]);
  assert.equal(draft[1].metadata.presentationResourceId.startsWith("gs-"), true);
  const reordered = pdfSlides({ ...processed, processing: { ...processed.processing, pages: [...rendered.pages].reverse() } }, draft);
  assert.equal(reordered[2].slideId, "legacy"); assert.deepEqual(reordered[2].resourceIds, ["audio"]);
  assert.equal(reordered[2].metadata.pageObjectId, "page_z");
});

test("Google Slides grande supera límite de exportación sin llamar a Drive export", async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `page_${index}`);
  const f = fixture(ids);
  const result = await f.processor.render({ profile: {}, resource, revision: "large-original" });
  assert.equal(result.pageCount, 100); assert.equal(f.calls.length, 100);
  assert.equal(result.processorVersion, SLIDES_PROCESSOR_VERSION);
  assert.equal(f.bucket.objects.size, 100);
});

test("fallo de thumbnail elimina intento parcial, reintento usa otra revisión; 429 reintenta", async () => {
  const f = fixture(); const normal = f.slides.presentations.pages.getThumbnail;
  f.slides.presentations.pages.getThumbnail = async (request) => { if (request.pageObjectId === "page_a") { const error = new Error("private-url"); error.status = 403; throw error; } return normal(request); };
  await assert.rejects(f.processor.render({ profile: {}, resource, revision: "failed" }), { status: 403 });
  assert.equal(f.bucket.objects.size, 0);
  let retried = false;
  f.slides.presentations.pages.getThumbnail = async (request) => { if (!retried) { retried = true; const error = new Error("quota"); error.status = 429; throw error; } return normal(request); };
  const result = await f.processor.render({ profile: {}, resource, revision: "retry" });
  assert.equal(result.pageCount, 3); assert.equal(f.bucket.objects.size, 3); assert.ok(f.waits.some((ms) => ms >= 1000));
  await f.processor.verify(result);
  const broken = structuredClone(result); broken.pages[1].download.generation = "invalid";
  await assert.rejects(f.processor.verify(broken), { code: "data-loss" });
});

test("PNG corrupto y original cambiado nunca aceptan derivados parciales", async () => {
  const damaged = Buffer.from(png); damaged[damaged.length - 20] ^= 1;
  assert.throws(() => pngDimensions(damaged), { code: "data-loss" });
  const corrupt = fixture(undefined, { download: async () => Buffer.from("not png") });
  await assert.rejects(corrupt.processor.render({ profile: {}, resource, revision: "corrupt" }), { code: "data-loss" });
  assert.equal(corrupt.bucket.objects.size, 0);
  const changed = fixture(); let reads = 0;
  const get = changed.slides.presentations.get;
  changed.slides.presentations.get = async () => { const value = await get(); if (reads++) value.data.revisionId = "new"; return value; };
  await assert.rejects(changed.processor.render({ profile: {}, resource, revision: "changed" }), { code: "aborted" });
  assert.equal(changed.bucket.objects.size, 0);
});

test("exportSizeLimitExceeded deja de ser Internal; URLs y errores upstream no se exponen", async () => {
  const error = processingError({ response: { data: { error: { errors: [{ reason: "other" }, { reason: "exportSizeLimitExceeded" }] } } } });
  assert.equal(error.code, "resource-exhausted"); assert.equal(error.details.reason, "exportSizeLimitExceeded");
  const safe = processingError(new Error("https://secret-url?credential=secret"), true);
  assert.equal(safe.message, "No se pudo procesar la presentación de Google Slides");
  await assert.rejects(downloadThumbnail("https://attacker.example/file.png"), { code: "data-loss" });
  await assert.rejects(downloadThumbnail("https://user:password@slides.googleusercontent.com/file.png"), { code: "data-loss" });
});

test("editor bloquea Google Slides legado hasta reprocesar como PNG", async () => {
  const { documentProcessingReady, documentProcessingLabel } = await import("../src/active-classroom/utils/unitDraft.js");
  const old = { ...resource, kind: "presentation", processing: { state: "ready", processorVersion: "office-pdf-v1", pageCount: 18 } };
  assert.equal(documentProcessingReady(old), false); assert.match(documentProcessingLabel(old), /Pendiente/);
  const ready = { ...old, processing: { ...old.processing, processorVersion: SLIDES_PROCESSOR_VERSION } };
  assert.equal(documentProcessingReady(ready), true); assert.match(documentProcessingLabel(ready), /18 diapositivas/);
});
