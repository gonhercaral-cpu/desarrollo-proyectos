import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { selectUnitMusic } from "../src/player/unit-music.ts";
import { canonical, sha256, validateManifest } from "../src/offline/manifest.ts";
const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));

test("música individual tiene prioridad, herencia sigue módulo y legado conserva comportamiento 1.0.18", () => {
  const frozen = [{ id: "frozen", resourceId: "frozen" }];
  const global = [{ id: "a", resourceId: "a" }, { id: "b", resourceId: "b" }];
  const manifest = { backgroundMusic: frozen };
  assert.deepEqual(selectUnitMusic(manifest, { tracks: global }), { tracks: global, global: true });
  assert.deepEqual(selectUnitMusic(manifest, { tracks: global, defaultTrackIds: ["b"] }), { tracks: global, global: true });
  assert.deepEqual(selectUnitMusic(manifest, { tracks: global, defaultTrackIds: [] }), { tracks: global, global: true });
  assert.deepEqual(selectUnitMusic({ ...manifest, unitMusic: { mode: "custom", trackId: "frozen" } }, { tracks: global, defaultTrackIds: ["a"] }), { tracks: frozen, global: false });
  assert.deepEqual(selectUnitMusic({ ...manifest, unitMusic: { mode: "inherit", trackId: null } }, { tracks: global, defaultTrackIds: ["b"] }), { tracks: [global[1]], global: true });
  assert.deepEqual(selectUnitMusic({ ...manifest, unitMusic: { mode: "inherit", trackId: null } }, { tracks: global, defaultTrackIds: [] }), { tracks: [], global: true });
  assert.deepEqual(selectUnitMusic({ ...manifest, unitMusic: { mode: "inherit", trackId: null } }), { tracks: frozen, global: false });
  assert.deepEqual(selectUnitMusic({ ...manifest, unitMusic: { mode: "none", trackId: null } }, { tracks: global }), { tracks: [], global: false });
});

test("manifest anterior sigue válido; selección individual no puede apuntar a audio ausente", async () => {
  await validateManifest(example);
  const manifest = structuredClone(example);
  async function seal() {
    const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
    manifest.integrity.contentHash = await sha256(new TextEncoder().encode(canonical(content)));
    return manifest;
  }
  manifest.unitMusic = { mode: "inherit", trackId: null };
  await validateManifest(await seal());
  manifest.unitMusic = { mode: "custom", trackId: "a".repeat(64) };
  await assert.rejects(validateManifest(await seal()), { code: "manifest" });
  manifest.unitMusic = { mode: "none", trackId: "a".repeat(64) };
  await assert.rejects(validateManifest(await seal()), { code: "manifest" });
});
