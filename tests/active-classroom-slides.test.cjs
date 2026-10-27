const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { Readable } = require("node:stream");
const { createGoogleSlidesProcessor, pngDimensions, downloadThumbnail } = require("../drive/activeClassroomSlides");
const { openActiveClassroomDrive, processingError } = require("../drive/activeClassroomDriveContent");
const { needsDocumentProcessing, officeExtension, processingFingerprint, pdfSlides, SLIDES_PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");
const { normalizeDraft } = require("../drive/activeClassroomUnit");

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

test("IDs Google con dos puntos se conservan al procesar y guardar borrador", async () => {
  const f = fixture(["page:valid"]);
  const processing = { ...await f.processor.render({ profile: {}, resource, revision: "colon" }), state: "ready", sourceFingerprint: processingFingerprint(resource) };
  await f.processor.verify(processing);
  const slides = pdfSlides({ ...resource, processing });
  const draft = normalizeDraft({ name: "Unit", levelId: "level", status: "active", mainPresentationId: resource.id, generalResourceIds: [], slides });
  assert.equal(draft.slides[0].metadata.pageObjectId, "page:valid");
});

test("descarga temporal usa HTTPS acotado y valida MIME, sin persistir contentUrl", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.hostname, "slides.googleusercontent.com"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
    requests++;
    return new Response(png, { headers: { "Content-Type": requests === 1 ? "image/png" : "text/html", "Content-Length": String(png.length) } });
  });
  assert.deepEqual(await downloadThumbnail("https://slides.googleusercontent.com/file?temporary-secret"), png);
  await assert.rejects(downloadThumbnail("https://slides.googleusercontent.com/file?temporary-secret"), { code: "data-loss" });
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

test("exportación Workspace grande usa files.download LRO y stream, nunca files.export", async () => {
  const { openSlidesExport, PPTX_MIME } = require("../drive/activeClassroomDriveContent");
  const size = 39 * 1024 * 1024;
  let polls = 0, waits = 0;
  const drive = { files: { download: async request => { assert.equal(request.mimeType, PPTX_MIME); return { data: { done: false, name: "operations/test" } }; }, export: () => assert.fail("No usar export con límite 10 MB") }, operations: { get: async () => { polls++; return { data: { done: true, response: { downloadUri: "https://drive.usercontent.google.com/export?private-capability" } } }; } } };
  const stream = await openSlidesExport(drive, "source", { wait: async ms => { assert.equal(ms, 10000); waits++; }, request: async (_url, options) => {
    assert.equal(options.redirect, "manual"); let sent = 0;
    return new Response(new ReadableStream({ pull(controller) { if (sent === size) return controller.close(); const chunk = new Uint8Array(65536); sent += chunk.length; controller.enqueue(chunk); } }));
  } });
  let received = 0, largest = 0;
  for await (const chunk of stream) { received += chunk.length; largest = Math.max(largest, chunk.length); }
  assert.equal(received, size); assert.ok(largest <= 131072); assert.equal(polls, 1); assert.equal(waits, 1);
  drive.files.download = async () => ({ data: { done: true, response: { downloadUri: "https://attacker.example/private" } } });
  await assert.rejects(openSlidesExport(drive, "source", { request: () => assert.fail("No enviar credenciales a otro host") }), { code: "data-loss" });
});

test("Google Slides conserva builds de PPTX exportado, IDs nativos y verificación integral", async () => {
  const { rasterTargetPath, PPTX_PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");
  let verified = 0;
  const f = fixture(["native-page"], {
    rasterize: async ({ revision }) => {
      const state = { download: { path: rasterTargetPath(revision, 0) }, width: 1600, height: 900 };
      return { revision, processorVersion: PPTX_PROCESSOR_VERSION, pageCount: 1, pages: [{ index: 0, pageObjectId: "pptx-0", ...state, builds: [{ order: 1, download: { path: rasterTargetPath(revision, 1) } }] }], download: state.download };
    }, verifyRaster: async (result, revision) => { verified++; assert.equal(result.processorVersion, PPTX_PROCESSOR_VERSION); assert.equal(result.revision, revision); assert.equal(result.pages[0].builds.length, 1); return result.download; },
  });
  const rendered = await f.processor.render({ profile: {}, resource, revision: "native-reveal" });
  assert.equal(rendered.processorVersion, SLIDES_PROCESSOR_VERSION); assert.equal(rendered.pages[0].pageObjectId, "native-page");
  assert.equal(rendered.pages[0].builds.length, 1); assert.equal(f.calls.length, 0);
  assert.equal(await f.processor.verify(rendered), rendered.download); assert.equal(verified, 1);
});

test("LRO ya listo no se sondea; conserva resource key y autenticación solo hacia Google", async () => {
  const { openSlidesExport } = require("../drive/activeClassroomDriveContent");
  const drive = { files: { download: async () => ({ data: { done: true, metadata: { resourceKey: "key" }, response: { downloadUri: "https://www.googleapis.com/download/drive/file" } } }) }, operations: { get: () => assert.fail("No sondear operación ya terminada") }, context: { _options: { auth: { getRequestHeaders: async () => new Headers({ Authorization: "Bearer test" }) } } } };
  const stream = await openSlidesExport(drive, "file", { request: async (url, options) => { assert.equal(url.hostname, "www.googleapis.com"); assert.equal(options.headers.get("X-Goog-Drive-Resource-Keys"), "file/key"); assert.equal(options.headers.get("Authorization"), "Bearer test"); return new Response("export"); } });
  let value = ""; for await (const chunk of stream) value += chunk;
  assert.equal(value, "export");
});

test("export PPTX medido sobre el límite usa miniaturas de TODAS las páginas con advertencia; boundary exacto no", async () => {
  const { sourceTooLargeError, PROCESSOR_MAX_SOURCE_BYTES } = require("../drive/activeClassroomProcessingModel");
  assert.equal(PROCESSOR_MAX_SOURCE_BYTES, 250 * 1024 * 1024);
  assert.equal(sourceTooLargeError(PROCESSOR_MAX_SOURCE_BYTES), null);
  assert.equal(sourceTooLargeError(undefined), null);
  assert.equal(sourceTooLargeError(PROCESSOR_MAX_SOURCE_BYTES + 1).details.reason, "processorSourceSizeLimit");
  const ids = ["page_z", "page_a", "page_m", "page_b"]; const stages = []; let rasterizeArgs;
  const f = fixture(ids, { rasterize: async (args) => { rasterizeArgs = args; throw sourceTooLargeError(397967772); } });
  const rendered = await f.processor.render({ profile: {}, resource, revision: "big-export", onStage: async (stage) => { stages.push(stage); } });
  assert.equal(typeof rasterizeArgs.onStage, "function");
  assert.deepEqual(rendered.pages.map((page) => page.pageObjectId), ids);
  assert.deepEqual(rendered.pages.map((page) => page.index), [0, 1, 2, 3]);
  assert.equal(rendered.pageCount, ids.length); assert.equal(f.calls.length, ids.length);
  for (const page of rendered.pages) assert.deepEqual(page.warnings, ["animation-export-unavailable-manual", "animation-export-too-large-manual"]);
  assert.equal(await f.processor.verify(rendered), rendered.download);
  assert.ok(stages.indexOf("export-download") < stages.indexOf("thumbnail-fallback") && stages.includes("thumbnail-fetch") && stages.includes("thumbnail-storage") && stages.includes("presentation-recheck"));
});

test("presupuesto raster nativo usa miniaturas completas con advertencia de complejidad, idempotente", async () => {
  const { nativeRasterBudgetError } = require("../drive/activeClassroomProcessingModel");
  const ids = ["page_z", "page:a", "page_m"]; const warnings = ["animation-export-unavailable-manual", "animation-export-complexity-manual"];
  for (const states of [104, 155, 156]) {
    const stages = []; const f = fixture(ids, { rasterize: async () => { throw nativeRasterBudgetError(states); } });
    const first = await f.processor.render({ profile: {}, resource, revision: `budget-${states}-a`, onStage: async (stage) => { stages.push(stage); } });
    assert.deepEqual(first.pages.map((page) => page.pageObjectId), ids); assert.deepEqual(first.pages.map((page) => page.index), [0, 1, 2]);
    assert.equal(first.pageCount, ids.length); assert.equal(f.calls.length, ids.length);
    for (const page of first.pages) { assert.deepEqual(page.warnings, warnings); assert.equal(page.builds, undefined); }
    assert.equal(await f.processor.verify(first), first.download);
    assert.ok(stages.indexOf("export-download") < stages.indexOf("thumbnail-fallback") && stages.includes("presentation-recheck"));
    const second = await f.processor.render({ profile: {}, resource, revision: `budget-${states}-b` });
    assert.deepEqual(second.pages.map((page) => [page.pageObjectId, page.index, page.warnings]), first.pages.map((page) => [page.pageObjectId, page.index, page.warnings]));
  }
});

test("sin fallback para resource-exhausted falsificado que no es el presupuesto raster tipado", async () => {
  const { HttpsError } = require("node:module").createRequire(require.resolve("../drive/package.json"))("firebase-functions/v2/https");
  for (const details of [undefined, { reason: "processorRasterStateBudget" }, { reason: "processorRasterStateBudget", stateCount: 0, limit: 100 }, { reason: "processorRasterStateBudget", stateCount: 100, limit: 100 }, { reason: "processorRasterStateBudget", stateCount: 201, limit: 100 }, { reason: "processorRasterStateBudget", stateCount: 150, limit: 200 }, { reason: "other", stateCount: 150, limit: 100 }, { reason: "processorSourceSizeLimit" }]) {
    const failure = new HttpsError("resource-exhausted", "timeout", details);
    const f = fixture(["page_a"], { rasterize: async () => { throw failure; } });
    await assert.rejects(f.processor.render({ profile: {}, resource, revision: "forged" }), (error) => error === failure);
    assert.equal(f.calls.length, 0); assert.equal(f.bucket.objects.size, 0);
  }
});

test("sin fallback para 401/403/404, indisponibilidad, corrupción ni errores de tamaño ajenos al límite medido", async () => {
  const { HttpsError } = require("node:module").createRequire(require.resolve("../drive/package.json"))("firebase-functions/v2/https");
  const failures = [
    ...[401, 403, 404, 503].map((status) => Object.assign(new Error("remote"), { response: { status } })),
    new HttpsError("resource-exhausted", "PNG demasiado grande"), new HttpsError("data-loss", "corrupto"), new HttpsError("unavailable", "caída"),
    Object.assign(new Error("remote"), { code: "unimplemented-ish" }),
  ];
  for (const failure of failures) {
    const f = fixture(["page_a", "page_b"], { rasterize: async () => { throw failure; } });
    await assert.rejects(f.processor.render({ profile: {}, resource, revision: "no-fallback" }), (error) => error === failure);
    assert.equal(f.calls.length, 0); assert.equal(f.bucket.objects.size, 0);
  }
  const small = fixture(["page_a"], { rasterize: async () => { const error = new Error("x"); error.code = "unimplemented"; throw error; } });
  const rendered = await small.processor.render({ profile: {}, resource, revision: "unsupported" });
  assert.deepEqual(rendered.pages[0].warnings, ["animation-export-unavailable-manual"]);
});

function fakeDb(seed) {
  const store = new Map(Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]));
  const ref = (path) => ({ path, async get() { return { data: () => store.has(path) ? structuredClone(store.get(path)) : undefined }; } });
  const write = (path, patch) => {
    const doc = store.get(path) || {};
    for (const [key, value] of Object.entries(patch)) { const parts = key.split("."); let target = doc; for (const part of parts.slice(0, -1)) target = target[part] ??= {}; target[parts.at(-1)] = value; }
    store.set(path, doc);
  };
  return { store, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), runTransaction: async (work) => work({ get: (item) => item.get(), update: (item, patch) => write(item.path, patch), create: (item, value) => { assert.equal(store.has(item.path), false); store.set(item.path, structuredClone(value)); } }) };
}
async function failedProcessing(failure) {
  const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
  const db = fakeDb({
    "activeClassroomUnits/unit-7": { draft: { slides: [], generalResourceIds: [], mainPresentationId: "main" }, draftRevision: 1 },
    "activeClassroomResources/main": { folderId: "unit-7", source: "drive", name: source.name, mimeType: source.mimeType, driveFileId: "file-A", driveVersion: "1", driveModifiedTime: source.modifiedTime },
  });
  const googleSlides = { original: async () => ({ fileId: "file-A", name: source.name, mimeType: source.mimeType, version: "1", modifiedTime: source.modifiedTime }),
    render: async ({ onStage }) => { await onStage("converting"); await onStage("export-download"); throw failure; }, verify: async () => assert.fail("no verify") };
  const processing = createDocumentProcessing({ db, bucket: {}, getProfile: async () => ({ active: true, role: "admin" }), prepareResource: async () => assert.fail("no original"), convert: async () => assert.fail("no convert"), googleSlides, timestamp: () => "ts" });
  const logs = []; const original = console.error; console.error = (...args) => logs.push(args);
  let thrown;
  try { await processing.process({ auth: { uid: "admin" }, data: { unitId: "unit-7", resourceId: "main", expectedRevision: 1 } }); } catch (error) { thrown = error; } finally { console.error = original; }
  const job = [...db.store].find(([path]) => path.startsWith("activeClassroomProcessingJobs/"));
  return { thrown, logs, job: job[1], jobId: job[0].split("/")[1], resource: db.store.get("activeClassroomResources/main") };
}

test("fallo persiste etapa/código reales del procesador y registra contexto seguro sin remapear a mensaje genérico", async () => {
  const failure = Object.assign(new Error("https://storage.googleapis.com/b/o?X-Goog-Signature=secret-signature"), { response: { status: 422, data: { error: "file-too-large", body: "secret-remote-body" } } });
  const { thrown, logs, job, jobId, resource } = await failedProcessing(failure);
  assert.equal(thrown.code, "resource-exhausted"); assert.equal(thrown.message, "La presentación supera el tamaño permitido para conversión.");
  assert.equal(resource.processing.state, "failed"); assert.equal(resource.processing.error, thrown.message);
  assert.deepEqual([resource.processing.errorCode, resource.processing.errorStage, resource.processing.errorReason], ["resource-exhausted", "export-download", "file-too-large"]);
  assert.equal(resource.processing.stage, "converting");
  assert.deepEqual([job.state, job.errorCode, job.errorStage, job.errorReason, job.upstreamStatus], ["failed", "resource-exhausted", "export-download", "file-too-large", 422]);
  const [message, details] = logs[0];
  assert.equal(message, "Active Classroom document processing failed");
  assert.deepEqual(details, { jobId, resourceId: "main", unitId: "unit-7", fileId: "file-A", processorVersion: SLIDES_PROCESSOR_VERSION, stage: "export-download", code: "resource-exhausted", sourceType: "google-slides", upstreamStatus: 422, reason: "", processorError: "file-too-large", slideIndex: null, pageObjectId: null });
  assert.doesNotMatch(JSON.stringify([logs, resource, job]), /secret|X-Goog|googleapis\.com/);
});

test("error sin clasificar conserva mensaje genérico de Slides pero guarda etapa y estado upstream", async () => {
  const failure = Object.assign(new Error("https://private.example?token=secret-token"), { response: { status: 403, data: { error: { errors: [{ reason: "insufficientFilePermissions" }] } } } });
  const { thrown, logs, job, resource } = await failedProcessing(failure);
  assert.equal(thrown.code, "failed-precondition"); assert.equal(thrown.message, "No se pudo procesar la presentación de Google Slides");
  assert.deepEqual([resource.processing.errorStage, resource.processing.errorReason, job.upstreamStatus], ["export-download", "insufficientFilePermissions", 403]);
  assert.equal(logs[0][1].reason, "insufficientFilePermissions");
  assert.doesNotMatch(JSON.stringify([logs, resource, job]), /secret|private\.example/);
});
