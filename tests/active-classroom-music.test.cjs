const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeDraft, resourceIds, contentHash } = require("../drive/activeClassroomUnit");
const { normalizeBackgroundMusic, validateMusicResources, freezeBackgroundMusic } = require("../drive/activeClassroomBackgroundMusic");
const draft = { name: "Unit", levelId: "kids", status: "active", slides: [], generalResourceIds: [], backgroundMusic: [{ resourceId: "audio", title: "Trabajo tranquilo", sourceType: "file" }] };
test("música del borrador entra en congelado sin convertirla en recurso general", () => {
  const normalized = normalizeDraft(draft);
  assert.deepEqual(resourceIds(normalized), ["audio"]);
  assert.equal(normalized.backgroundMusic[0].order, 0);
  assert.deepEqual(normalized.generalResourceIds, []);
  assert.throws(() => normalizeDraft({ ...draft, excludedResourceIds: ["audio"] }));
  assert.throws(() => normalizeBackgroundMusic([draft.backgroundMusic[0], draft.backgroundMusic[0]]));
  assert.throws(() => normalizeBackgroundMusic([{ resourceId: "audio", title: "YouTube", sourceType: "external", url: "https://youtube.com/" }]));
});
test("solo audio válido; tamaño/hash/generación y orden congelados, publicación previa intacta", () => {
  const tracks = normalizeBackgroundMusic(draft.backgroundMusic);
  assert.throws(() => validateMusicResources(tracks, [{ id: "audio", mimeType: "video/mp4" }]));
  validateMusicResources(tracks, [{ id: "audio", mimeType: "audio/mpeg" }]);
  const file = { mimeType: "audio/mpeg", sizeBytes: 5500000, checksums: { sha256: "a".repeat(64) }, path: "active-classroom/files/audio", generation: "12" };
  const previous = freezeBackgroundMusic(tracks, new Map([["audio", file]])); const hash = contentHash(previous);
  tracks[0].title = "Otro título"; file.checksums.sha256 = "b".repeat(64);
  assert.equal(previous[0].sha256, "a".repeat(64)); assert.equal(previous[0].title, "Trabajo tranquilo"); assert.equal(contentHash(previous), hash);
  assert.equal(previous[0].size, 5500000); assert.equal(previous[0].generation, "12");
  assert.deepEqual(normalizeBackgroundMusic(), []); assert.deepEqual(freezeBackgroundMusic([], new Map()), []);
  assert.equal(normalizeDraft({ ...draft, backgroundMusic: undefined }).backgroundMusic, undefined);
});
