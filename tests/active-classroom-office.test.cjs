const assert = require("node:assert/strict");
const { test } = require("node:test");
const { officeExtension, processingFingerprint, readyProcessing, pdfSlides, PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");
const { snapshotResource } = require("../drive/activeClassroomUnit");
const { createProcessorClient } = require("../drive/activeClassroomProcessorClient");
const resource = { id: "main", source: "drive", name: "Clase.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", driveFileId: "original", driveVersion: "1" };

test("límite real de proveedor HTTP 413 devuelve error explícito", () => {
  const { processingError } = require("../drive/activeClassroomDriveContent");
  const error = processingError({ response: { status: 413 } });
  assert.equal(error.code, "resource-exhausted");
  assert.equal(error.details.reason, "providerSizeLimitExceeded");
});

test("reconoce Office binario y exportaciones Google sin cambiar originales", () => {
  assert.equal(officeExtension(resource), "pptx");
  assert.equal(officeExtension({ mimeType: "application/vnd.google-apps.presentation" }), null);
  assert.equal(officeExtension({ mimeType: "application/vnd.google-apps.document" }), "docx");
  assert.equal(officeExtension({ name: "A.DOC", mimeType: "application/octet-stream" }), "doc");
  assert.equal(officeExtension({ mimeType: "application/pdf" }), null);
});
test("slides reales conservan IDs y asociaciones por página; derivado tiene revisión propia", () => {
  const main = { ...resource, processing: { state: "ready", processorVersion: PROCESSOR_VERSION, sourceFingerprint: processingFingerprint(resource), pageCount: 3, revision: "revision1", download: { mimeType: "application/pdf" }, original: { mimeType: resource.mimeType } } };
  const previous = [{ slideId: "keep", index: 0, title: "Inicio", metadata: { pageNumber: 1, notes: "Nota" }, resourceIds: ["audio"] }];
  const slides = pdfSlides(main, previous);
  assert.deepEqual(slides.map(s => s.metadata.pageNumber), [1, 2, 3]);
  assert.equal(slides[0].slideId, "keep"); assert.deepEqual(slides[0].resourceIds, ["audio"]);
  assert.equal(readyProcessing({ ...main, driveVersion: "2" }), false);
  const snapshot = snapshotResource(main.id, main);
  assert.equal(snapshot.originalMime, resource.mimeType); assert.equal(snapshot.deliveryMime, "application/pdf");
  assert.equal(snapshot.file.fileId, "original"); assert.equal(snapshot.derivative.revision, "revision1");
  assert.equal(snapshot.derivative.textExtraction, null);
});
test("estado web distingue pendiente, procesamiento, PDF y error", async () => {
  const { needsOfficeProcessing, documentProcessingLabel } = await import("../src/active-classroom/utils/unitDraft.js");
  assert.equal(needsOfficeProcessing(resource), true);
  assert.match(documentProcessingLabel(resource), /Pendiente/);
  assert.match(documentProcessingLabel({ ...resource, processing: { state: "processing" } }), /Procesando/);
  assert.match(documentProcessingLabel({ ...resource, kind: "presentation", processing: { state: "ready", processorVersion: "pptx-builds-png-v1", pageCount: 18 } }), /18 diapositivas/);
  assert.match(documentProcessingLabel({ ...resource, processing: { state: "failed" } }), /Reintentar/);
});
test("procesador privado usa audiencia OIDC y capacidades firmadas limitadas a objeto/generación", async () => {
  const calls=[]; const data={revision:"a".repeat(36),processorVersion:PROCESSOR_VERSION,original:{path:"source",generation:"7",name:"Original.pptx"}};
  let metadata;
  const convert=createProcessorClient({clock:()=>1000,getUrl:()=>"https://office-abc-uc.a.run.app",getClient:async(audience)=>{
    assert.equal(audience,"https://office-abc-uc.a.run.app"); return {request:async(request)=>{assert.equal(request.timeout,420000);assert.ok(request.data.sourceUrl);assert.ok(request.data.uploadUrl);return {data:{revision:data.revision,processorVersion:PROCESSOR_VERSION,pageCount:18,sizeBytes:10,sha256:"b".repeat(64)}};}};
  },bucket:{file:(path)=>({getSignedUrl:async(options)=>{calls.push({path,options});return ["private-capability"];},setMetadata:async(value)=>{metadata=value;},getMetadata:async()=>[{generation:"9",contentType:"application/pdf",size:10,metadata:metadata.metadata}]})}});
  const result=await convert(data);
  assert.equal(calls[0].options.queryParams.generation,"7"); assert.equal(calls[0].options.expires,601000);
  assert.equal(calls[1].options.extensionHeaders["x-goog-if-generation-match"],"0");
  assert.equal(result.download.mimeType,"application/pdf"); assert.equal(result.download.generation,"9");
  assert.doesNotMatch(JSON.stringify(result),/private-capability/);
});
test("PPTX reales A/B (397967772 y 314467031 bytes) se rechazan antes de firmar o llamar al procesador", async () => {
  // sizeBytes medidos por Codex en los snapshots Nube AES de A (level-2-unit-07) y B (level-2-unit-09).
  for (const processorVersion of ["pptx-builds-png-v2", PROCESSOR_VERSION]) for (const sizeBytes of [397967772, 314467031, 250 * 1024 * 1024 + 1]) {
    const touched = [];
    const convert = createProcessorClient({ getUrl: () => "https://office-abc-uc.a.run.app", getClient: async () => { touched.push("auth"); return { request: async () => { touched.push("request"); } }; }, bucket: { file: () => ({ getSignedUrl: async () => { touched.push("sign"); return ["capability"]; } }) } });
    await assert.rejects(convert({ revision: "a".repeat(36), processorVersion, extension: "pptx", original: { path: "source", generation: "1", sizeBytes, name: "Real.pptx" } }), (error) => {
      assert.equal(error.code, "resource-exhausted"); assert.deepEqual(error.details, { reason: "processorSourceSizeLimit", sizeBytes, limitBytes: 262144000 });
      assert.doesNotMatch(error.message, /capability|source/); return true;
    });
    assert.deepEqual(touched, []);
  }
});
test("tamaño exactamente en el límite sigue la ruta normal y errores del procesador conservan código seguro", async () => {
  const { processingError } = require("../drive/activeClassroomDriveContent");
  const touched = []; const sentinel = Object.assign(new Error("remote"), { response: { status: 422, data: { error: "file-too-large" } } });
  const convert = createProcessorClient({ getUrl: () => "https://office-abc-uc.a.run.app", getClient: async () => ({ request: async (request) => { touched.push(request.url.split("/").pop()); throw sentinel; } }), bucket: { file: () => ({ getSignedUrl: async () => { touched.push("sign"); return ["capability"]; } }) } });
  const stages = [];
  await assert.rejects(convert({ revision: "a".repeat(36), processorVersion: "pptx-builds-png-v2", extension: "pptx", original: { path: "source", generation: "1", sizeBytes: 250 * 1024 * 1024, name: "Edge.pptx" } }, { onStage: async (stage) => { stages.push(stage); } }), (error) => error === sentinel);
  assert.deepEqual(touched, ["sign", "sign", "plan"]); assert.deepEqual(stages, ["processor-auth", "storage-sign", "planning"]);
  assert.equal(processingError(sentinel, true).message, "La presentación supera el tamaño permitido para conversión.");
  assert.equal(processingError({ response: { data: { error: "source-integrity-mismatch" } } }).code, "data-loss");
  assert.equal(processingError({ response: { status: 422, data: { error: "unknown https://secret" } } }).message, "No se pudo procesar el documento. Reintenta o revisa el original.");
});

// Raster-state budget for native Google Slides (opt-in). Measured: E 156, S 155, D 104 time out; C 65 succeeds.
const { HttpsError } = require("node:module").createRequire(require.resolve("../drive/package.json"))("firebase-functions/v2/https");
const { NATIVE_MAX_RASTER_STATES, nativeRasterBudgetError, isNativeRasterBudget } = require("../drive/activeClassroomProcessingModel");
function planOf(slideCount, stateCount) {
  const extra = stateCount - slideCount; // Each slide has one base state plus its steps.
  return { stateCount, slides: Array.from({ length: slideCount }, (_v, index) => ({ index, steps: Array.from({ length: Math.floor(extra / slideCount) + (index < extra % slideCount ? 1 : 0) }, () => ({})), warnings: [] })) };
}
function budgetClient(plan) {
  const touched = []; const stages = []; const sentinel = new Error("convert-reached");
  const convert = createProcessorClient({
    getUrl: () => "https://office-abc-uc.a.run.app",
    getClient: async () => ({ request: async (request) => { const name = request.url.split("/").pop(); touched.push(name); if (name === "plan") return { data: plan }; throw sentinel; } }),
    bucket: { file: () => ({ getSignedUrl: async (options) => { touched.push(options.contentType === "image/png" ? "sign-png" : "sign"); return ["capability"]; }, delete: async () => {} }) },
  });
  const data = { revision: "a".repeat(36), processorVersion: "pptx-builds-png-v2", extension: "pptx", original: { path: "source", generation: "1", sizeBytes: 1024, name: "Native.pptx" } };
  return { touched, stages, sentinel, run: (options = {}) => convert(data, { onStage: async (stage) => { stages.push(stage); }, ...options }) };
}
test("presupuesto raster: helper tipado solo reconoce el error propio con detalles válidos", () => {
  assert.equal(NATIVE_MAX_RASTER_STATES, 100);
  assert.equal(nativeRasterBudgetError(100), null); assert.equal(nativeRasterBudgetError(undefined), null); assert.equal(nativeRasterBudgetError(100.5), null);
  const error = nativeRasterBudgetError(156);
  assert.equal(error.code, "resource-exhausted"); assert.deepEqual(error.details, { reason: "processorRasterStateBudget", stateCount: 156, limit: 100 });
  assert.match(error.message, /156 estados.*hasta 100/); assert.equal(isNativeRasterBudget(error), true);
  for (const other of [new HttpsError("resource-exhausted", "x"), new HttpsError("resource-exhausted", "x", { reason: "processorSourceSizeLimit" }), new HttpsError("data-loss", "x", error.details),
    new HttpsError("resource-exhausted", "x", { reason: "processorRasterStateBudget", stateCount: 0, limit: 100 }), new HttpsError("resource-exhausted", "x", { reason: "processorRasterStateBudget", stateCount: 156, limit: 200 }), null]) assert.equal(isNativeRasterBudget(other), false);
});
test("presupuesto raster: planes reales E156/S155/D104 se rechazan tras /plan y antes de firmar PNG o /convert", async () => {
  for (const [slides, states] of [[105, 156], [50, 155], [40, 104], [40, 101]]) {
    const c = budgetClient(planOf(slides, states));
    await assert.rejects(c.run({ nativeSlidesFallback: true }), (error) => { assert.deepEqual(error.details, { reason: "processorRasterStateBudget", stateCount: states, limit: 100 }); return isNativeRasterBudget(error); });
    assert.deepEqual(c.touched, ["sign", "sign", "plan"]); assert.deepEqual(c.stages, ["processor-auth", "storage-sign", "planning"]);
  }
});
test("presupuesto raster: límite 100 sigue la ruta normal y llega a /convert", async () => {
  const c = budgetClient(planOf(65, 100));
  await assert.rejects(c.run({ nativeSlidesFallback: true }), (error) => error === c.sentinel);
  assert.equal(c.touched.filter(name => name === "sign-png").length, 100); assert.equal(c.touched.at(-1), "convert"); assert.equal(c.stages.at(-1), "converting");
});
test("presupuesto raster: opción por defecto (PPTX subido) conserva el límite 200 y continúa a /convert", async () => {
  for (const options of [undefined, {}, { nativeSlidesFallback: false }]) {
    const c = budgetClient(planOf(40, 104));
    await assert.rejects(c.run(options), (error) => error === c.sentinel);
    assert.equal(c.touched.filter(name => name === "sign-png").length, 104); assert.equal(c.touched.at(-1), "convert");
  }
});
test("presupuesto raster: plan inválido con 104 declarados es data-loss, no fallback", async () => {
  const plan = planOf(40, 104); plan.stateCount = 105;
  const c = budgetClient(plan);
  await assert.rejects(c.run({ nativeSlidesFallback: true }), (error) => error.code === "data-loss" && !isNativeRasterBudget(error));
  assert.deepEqual(c.touched, ["sign", "sign", "plan"]);
});
test("presupuesto raster: el límite de 250 MiB sigue antes de autenticar y sin llamar a la API", async () => {
  const touched = [];
  const convert = createProcessorClient({ getUrl: () => "https://office-abc-uc.a.run.app", getClient: async () => { touched.push("auth"); return { request: async () => touched.push("request") }; }, bucket: { file: () => ({ getSignedUrl: async () => { touched.push("sign"); return ["capability"]; } }) } });
  await assert.rejects(convert({ revision: "a".repeat(36), processorVersion: "pptx-builds-png-v2", extension: "pptx", original: { path: "source", generation: "1", sizeBytes: 250 * 1024 * 1024 + 1, name: "Big.pptx" } }, { nativeSlidesFallback: true }), (error) => error.details.reason === "processorSourceSizeLimit");
  assert.deepEqual(touched, []);
});
