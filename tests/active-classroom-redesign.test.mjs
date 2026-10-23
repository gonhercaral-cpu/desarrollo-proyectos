import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readWebPreferences, writeWebPreferences } from "../src/active-classroom/utils/webPreferences.js";
import { normalizeLibraryPreferences } from "../src/active-classroom/utils/libraryPreferences.js";
const require = createRequire(import.meta.url);
const { normalizeUnitMusic, selectedTrack, catalogResource } = require("../drive/activeClassroomUnitMusic.js");
const { normalizeDraft } = require("../drive/activeClassroomUnit.js");

test("preferencias pequeñas/medianas/grandes, migración local y aislamiento de usuarios", () => {
  const previous = { localStorage: globalThis.localStorage, window: globalThis.window };
  const values = new Map([["active-classroom-web-preferences", JSON.stringify({ view: "list", sort: "date" })]]);
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  globalThis.window = { dispatchEvent() {} };
  try {
    assert.equal(readWebPreferences("admin").view, "list");
    writeWebPreferences({ view: "grid", thumbnailSize: "small", showCover: false, pageSize: 24 }, "admin");
    writeWebPreferences({ view: "list", thumbnailSize: "large" }, "another");
    assert.equal(readWebPreferences("admin").thumbnailSize, "small");
    assert.equal(readWebPreferences("admin").showCover, false);
    assert.equal(readWebPreferences("admin").pageSize, 24);
    assert.equal(readWebPreferences("another").thumbnailSize, "large");
    assert.equal(readWebPreferences("another").view, "list");
    values.set("active-classroom-web-preferences:admin", "{broken");
    assert.equal(readWebPreferences("admin").thumbnailSize, "medium");
    globalThis.localStorage.setItem = () => { throw new Error("quota"); };
    assert.equal(writeWebPreferences({ thumbnailSize: "large" }, "admin").thumbnailSize, "large");
    assert.equal(normalizeLibraryPreferences({ thumbnailSize: "unknown", showCover: "false", pageSize: -1 }).showCover, true);
  } finally { Object.assign(globalThis, previous); }
});

test("selección usa catálogo existente y playlist predeterminada sin copiar originales", () => {
  const first = { id: "a".repeat(64), title: "Calma", active: true, mime: "audio/mpeg", sha256: "a".repeat(64), size: 12, storagePath: `active-classroom/publications/files/${"b".repeat(64)}`, generation: "1" };
  const second = { ...first, id: "c".repeat(64), sha256: "c".repeat(64), title: "Writing" };
  const catalog = { tracks: [first, second], playlists: [{ id: "module-default", trackIds: [second.id] }] };
  assert.equal(selectedTrack(catalog, { mode: "inherit", trackId: null }), second);
  assert.equal(selectedTrack(catalog, { mode: "custom", trackId: first.id }), first);
  assert.equal(selectedTrack(catalog, { mode: "none", trackId: null }), null);
  assert.equal(selectedTrack({ ...catalog, playlists: [{ id: "module-default", trackIds: [] }] }, { mode: "inherit" }), null);
  assert.throws(() => selectedTrack(catalog, { mode: "custom", trackId: "d".repeat(64) }));
  const resource = catalogResource(first, "unit");
  assert.equal(resource.ambientDownload.path, first.storagePath); assert.equal(resource.ambientDownload.generation, first.generation); assert.equal(resource.ambientDownload.checksums.sha256, first.sha256);
  for (const invalid of [null, { mode: "custom", trackId: "../x" }, { mode: "none", trackId: first.id }, { mode: "inherit", trackId: first.id }, { mode: "invalid" }]) assert.throws(() => normalizeUnitMusic(invalid));
  const legacy = { name: "Unit", status: "active", levelId: "level", slides: [], generalResourceIds: [], backgroundMusic: [{ resourceId: "old", title: "Playlist anterior" }] };
  assert.equal(normalizeDraft(legacy).unitMusic, undefined);
  assert.equal(normalizeDraft({ ...legacy, unitMusic: { mode: "inherit", trackId: null } }).backgroundMusic[0].resourceId, "old");
});
