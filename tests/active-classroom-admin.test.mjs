import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceDraftResource, resourceUserState } from "../src/active-classroom/utils/draftResources.js";

const draft = () => ({ name: "Unit", levelId: "level-1", mainPresentationId: "main", generalResourceIds: ["audio"], slides: [{ slideId: "s1", index: 0, resourceIds: ["pdf"], metadata: { presentationResourceId: "old-raster" }, interaction: { mode: "builds" }, builds: [{ order: 1, resourceId: "old-build" }] }] });
test("quitar presentación limpia slides/builds y conserva recursos como generales sin mutar original", () => {
  const old = draft(), before = JSON.stringify(old);
  const next = replaceDraftResource(old, "main");
  assert.equal(next.mainPresentationId, null);
  assert.deepEqual(next.slides, []);
  assert.deepEqual(next.generalResourceIds, ["audio", "pdf"]);
  assert.deepEqual(next.excludedResourceIds, ["main"]);
  assert.equal(JSON.stringify(old), before);
});
test("reemplazar presentación no hereda derivados y permite reimportar original quitado", () => {
  const old = { ...draft(), excludedResourceIds: ["replacement"] };
  const next = replaceDraftResource(old, "main", "replacement");
  assert.equal(next.mainPresentationId, "replacement");
  assert.deepEqual(next.slides, []);
  assert.deepEqual(next.excludedResourceIds, ["main"]);
  assert.equal(replaceDraftResource(old, "main", "main"), old);
});
test("reemplazar recurso actualiza todas sus asociaciones y assets manuales; quitar no deja builds vacíos", () => {
  const old = draft(); old.slides[0].builds = [{ order: 1, layers: [{ kind: "image", resourceId: "audio" }] }];
  const replacement = replaceDraftResource(old, "audio", "image");
  assert.deepEqual(replacement.generalResourceIds, ["image"]);
  assert.equal(replacement.slides[0].builds[0].layers[0].resourceId, "image");
  const removed = replaceDraftResource(old, "audio");
  assert.equal(removed.slides[0].buildCount, 0);
  assert.equal(removed.slides[0].interaction.mode, "static");
});
test("estados de recursos distinguen cambios, ausencias, red y procesamiento", () => {
  assert.equal(resourceUserState({}, { status: "changed" }, false, true), "Nueva versión disponible");
  assert.equal(resourceUserState({}, { status: "unavailable" }, false, true), "Original no disponible");
  assert.equal(resourceUserState({}, { status: "error" }, false, true), "Error");
  assert.equal(resourceUserState({}, null, true, false), "Procesando");
  assert.equal(resourceUserState({}, { status: "current" }, false, true), "Actualizado");
});
