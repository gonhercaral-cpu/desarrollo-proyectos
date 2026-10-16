const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeDraft, resourceIds, driveChanged, contentHash } = require("../drive/activeClassroomUnit");
const { checkOriginal } = require("../drive/activeClassroomFiles");
const example = require("../docs/active-classroom-manifest.example.json");
const draft = () => ({ name: "Unit 1", levelId: "level-1", status: "active", metadata: { tags: ["", " Inglés "] }, mainPresentationId: "main", generalResourceIds: ["audio"], slides: [{ slideId: "s1", index: 9, resourceIds: ["audio"] }] });

test("editor inicia con recursos vigentes y reordena conservando IDs y asociaciones", async () => {
  const { createUnitDraft, reorderSlides, canBeMainPresentation } = await import("../src/active-classroom/utils/unitDraft.js");
  const initial = createUnitDraft({ id: "unit", name: "Unit", parentId: "level" }, [
    { id: "audio", folderId: "unit" }, { id: "archived", folderId: "unit", archived: true }, { id: "foreign", folderId: "other" },
  ]);
  assert.deepEqual(initial.generalResourceIds, ["audio"]);
  const slides = [{ slideId: "a", index: 0, resourceIds: ["audio"] }, { slideId: "b", index: 1, resourceIds: [] }];
  assert.deepEqual(reorderSlides(slides, "a", 1), [{ ...slides[1], index: 0 }, { ...slides[0], index: 1 }]);
  assert.equal(reorderSlides(slides, "a", -1), slides);
  assert.equal(canBeMainPresentation({ source: "drive", mimeType: "application/pdf" }), true);
  assert.equal(canBeMainPresentation({ source: "storage", kind: "presentation" }), false);
});

test("normaliza índices, etiquetas vacías y asociaciones sin duplicar recursos", () => {
  const normalized = normalizeDraft(draft());
  assert.equal(normalized.slides[0].index, 0);
  assert.deepEqual(normalized.metadata.tags, ["Inglés"]);
  assert.deepEqual(resourceIds(normalized), ["main", "audio"]);
  assert.deepEqual(normalizeDraft({ ...draft(), metadata: {} }).metadata.tags, []);
  assert.throws(() => normalizeDraft({ ...draft(), slides: [draft().slides[0], draft().slides[0]] }));
  assert.throws(() => normalizeDraft({ ...draft(), generalResourceIds: ["main"] }));
});
test("checksum del contenido independiente del orden de claves, sensible al orden de slides", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
  assert.notEqual(contentHash(["s1", "s2"]), contentHash(["s2", "s1"]));
});
test("manifest documentado completo, serializable y con integridad verificable", () => {
  const { version, publishedAt, integrity, ...content } = example;
  assert.equal(version, 1);
  assert.ok(Number.isFinite(Date.parse(publishedAt)));
  assert.equal(contentHash(content), integrity.contentHash);
  assert.deepEqual(JSON.parse(JSON.stringify(example)), example);
  const references = resourceIds(example);
  for (const id of references) {
    const resource = example.resources.find((item) => item.resourceId === id);
    assert.ok(resource?.download?.endpoint);
    assert.match(resource.download.checksums.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(example.slides.map((slide) => slide.index), [0, 1]);
});
test("detecta versión, fecha, checksum, nombre y MIME de Drive; bloquea publicar original cambiado", () => {
  const resource = { name: "Clase.pdf", mimeType: "application/pdf", driveVersion: "1", driveModifiedTime: "2026-09-28", driveMd5Checksum: "abc" };
  const file = { name: resource.name, mimeType: resource.mimeType, version: "1", modifiedTime: resource.driveModifiedTime, md5Checksum: "abc" };
  assert.equal(driveChanged(resource, file), false);
  for (const field of ["name", "mimeType", "version", "modifiedTime", "md5Checksum"]) {
    assert.equal(driveChanged(resource, { ...file, [field]: "changed" }), true);
    assert.throws(() => checkOriginal(resource, { ...file, [field]: "changed" }), { code: "failed-precondition" });
  }
  assert.throws(() => checkOriginal(resource, { ...file, capabilities: { canDownload: false } }));
});
