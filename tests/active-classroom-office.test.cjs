const assert = require("node:assert/strict");
const { test } = require("node:test");
const { officeExtension, processingFingerprint, readyProcessing, pdfSlides, PROCESSOR_VERSION } = require("../drive/activeClassroomProcessingModel");
const { snapshotResource } = require("../drive/activeClassroomUnit");
const { createProcessorClient } = require("../drive/activeClassroomProcessorClient");
const resource = { id: "main", source: "drive", name: "Clase.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", driveFileId: "original", driveVersion: "1" };

test("reconoce Office binario y exportaciones Google sin cambiar originales", () => {
  assert.equal(officeExtension(resource), "pptx");
  assert.equal(officeExtension({ mimeType: "application/vnd.google-apps.presentation" }), "pptx");
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
  assert.match(documentProcessingLabel({ ...resource, kind: "presentation", processing: { state: "ready", pageCount: 18 } }), /18 diapositivas/);
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
