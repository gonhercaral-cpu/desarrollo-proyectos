const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeInteraction, interactionResourceIds } = require("../drive/activeClassroomInteraction");
const { normalizeDraft, contentHash, resourceIds } = require("../drive/activeClassroomUnit");
const { pdfSlides, PPTX_PROCESSOR_VERSION, processingFingerprint, slideResourceId } = require("../drive/activeClassroomProcessingModel");
const { createBuildPreview } = require("../drive/activeClassroomBuildPreview");
const layer = { type: "answer", text: "Respuesta", x: 10, y: 20, width: 40, height: 10, color: "#102954", fontSize: 3 };
const steps = [{ order: 1, layers: [layer] }, { order: 2, layers: [{ type: "image", resourceId: "answer-image", x: 30, y: 40, width: 20, height: 10 }] }];

test("modelo manual normaliza estática, pasos, orden y assets sin alterar recursos asociados", () => {
  assert.equal(normalizeInteraction({}).interaction.mode, "static");
  const interaction = normalizeInteraction({ interactionMode: "builds", builds: steps });
  assert.equal(interaction.buildCount, 2); assert.deepEqual(interactionResourceIds(interaction), ["answer-image"]);
  const draft = normalizeDraft({ name: "Unit", status: "active", levelId: "level", mainPresentationId: "main", generalResourceIds: [], slides: [{ slideId: "slide", title: "", resourceIds: ["audio"], metadata: {}, ...interaction }] });
  assert.deepEqual(resourceIds(draft), ["main", "audio", "answer-image"]);
  const hash = contentHash(draft); draft.slides[0].builds[0].layers[0].text = "Nueva respuesta"; assert.notEqual(contentHash(draft), hash);
});

test("rechaza paths, HTML como tipo, posición fuera del slide y orden inválido", () => {
  for (const mutate of [value => { value.builds[0].order = 2; }, value => { value.builds[0].layers[0].x = 80; }, value => { value.builds[0].layers[0].type = "html"; }, value => { value.builds[1].layers[0].resourceId = "../../secret"; }]) {
    const value = { interactionMode: "builds", builds: structuredClone(steps) }; mutate(value); assert.throws(() => normalizeInteraction(value), { code: "invalid-argument" });
  }
});

test("PPTX genera IDs estables, conserva edición manual y desactivar revela estado final", () => {
  const resource = { id: "main", source: "drive", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", driveFileId: "pptx", driveVersion: "1", name: "Class.pptx" };
  resource.processing = { state: "ready", processorVersion: PPTX_PROCESSOR_VERSION, sourceFingerprint: processingFingerprint(resource), pageCount: 1, download: { mimeType: "image/png" }, pages: [{ pageObjectId: "pptx-0", builds: [{ order: 1 }, { order: 2 }] }] };
  const [slide] = pdfSlides(resource); assert.equal(slide.buildCount, 2); assert.equal(slide.builds[1].resourceId, slideResourceId("main", "pptx-0-build-2"));
  const manual = { ...slide, ...normalizeInteraction({ interactionMode: "builds", builds: steps }) };
  assert.deepEqual(pdfSlides(resource, [manual])[0].builds, steps);
  const disabled = { ...slide, ...normalizeInteraction({ interactionMode: "static", interaction: { source: "manual" } }) };
  assert.equal(pdfSlides(resource, [disabled])[0].metadata.presentationResourceId, slide.builds[1].resourceId);
});

test("edición web previsualiza acumulativamente y reordena pasos sin perder posición", async () => {
  const { manualInteraction, moveBuild, visibleBuildLayers } = await import("../src/active-classroom/utils/slideInteraction.js");
  const first = manualInteraction(steps); assert.deepEqual(visibleBuildLayers(first.builds, 0), []); assert.equal(visibleBuildLayers(first.builds, 2).length, 2);
  const moved = moveBuild(first.builds, 1, -1); assert.equal(moved[0].layers[0].resourceId, "answer-image"); assert.deepEqual(moved.map(step => step.order), [1, 2]);
  assert.equal(manualInteraction([], "static").buildCount, 0);
});

test("preview exige admin y recurso de Unit; nunca acepta paths del cliente", async () => {
  let signed = 0;
  const preview = createBuildPreview({ getProfile: async uid => ({ active: true, role: uid }), db: { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ folderId: "unit", source: "storage", mimeType: "image/png", kind: "image" }) }) }) }) }, prepareResource: async () => ({ path: "private/frozen", generation: "7", mimeType: "image/png", sizeBytes: 10, checksums: { sha256: "a".repeat(64) } }), bucket: { file(path) { assert.equal(path, "private/frozen"); return { async getSignedUrl(options) { signed++; assert.equal(options.queryParams.generation, "7"); return ["https://storage.googleapis.com/signed"]; } }; } } });
  await assert.rejects(preview({ auth: { uid: "teacher" }, data: { unitId: "unit", resourceId: "asset" } }), { code: "permission-denied" });
  await assert.rejects(preview({ auth: { uid: "admin" }, data: { unitId: "other", resourceId: "asset" } }), { code: "not-found" });
  await assert.rejects(preview({ auth: { uid: "admin" }, data: { unitId: "unit", resourceId: "../../secret" } }), { code: "invalid-argument" });
  assert.equal((await preview({ auth: { uid: "admin" }, data: { unitId: "unit", resourceId: "asset", path: "arbitrary" } })).sha256, "a".repeat(64)); assert.equal(signed, 1);
});
