import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AmbientLibrary, validateAmbient } from "../src/offline/ambient.ts";
import { canonical, sha256 } from "../src/offline/manifest.ts";
import { DiskCache } from "./disk-cache.mjs";
async function catalog(version, contents) {
  const bytes = new Map(); const tracks = [];
  for (const [order, text] of contents.entries()) { const data = new TextEncoder().encode(text); const hash = await sha256(data); bytes.set(hash, data); tracks.push({ id: hash, title: text, sourceType: "file", mime: "audio/mpeg", size: data.length, sha256: hash, storagePath: `active-classroom/publications/files/${hash}`, generation: "12", order, active: true }); }
  const value = { schemaVersion: 1, ambientCatalogVersion: version, tracks, playlists: [] };
  value.integrity = { algorithm: "sha256", contentHash: await sha256(new TextEncoder().encode(canonical({ schemaVersion: 1, tracks, playlists: [] }))) }; return { value, bytes };
}
test("catálogo global incremental reutiliza SHA, activa completo y restaura offline sin Units", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ambient-test-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new DiskCache(directory); const versions = []; let remote = await catalog(1, ["Calma"]); let downloads = 0; let fail = false;
  const nativeCall = cache.call.bind(cache);
  cache.call = async (action, input) => { const result = await nativeCall(action,input); if (action === "ambient-commit") versions.push(structuredClone(input)); return result; };
  const api = { async call() { return { catalog: remote.value }; }, async downloadAmbient(version, track, write) { assert.equal(version, remote.value.ambientCatalogVersion); downloads++; const data = remote.bytes.get(track.id); await write(data.subarray(0, 2)); if (fail) throw new Error("Offline"); await write(data.subarray(2)); } };
  const library = new AmbientLibrary(cache, api); await library.sync(); assert.equal(downloads, 1);
  await library.sync(); assert.equal(downloads, 1);
  remote = await catalog(2, ["Calma", "Writing"]); fail = true; await assert.rejects(library.sync(), /Offline/);
  assert.equal(library.catalog.ambientCatalogVersion, 1); assert.equal(versions.at(-1).ambientCatalogVersion, 1); assert.deepEqual(await readdir(join(directory, "temporary")), []);
  fail = false; await library.sync(); assert.equal(library.catalog.ambientCatalogVersion, 2); assert.equal(downloads, 3);
  const offline = new AmbientLibrary(cache, { call() { throw new Error("No Internet"); } }); assert.equal((await offline.restore()).tracks.length, 2);
  await assert.rejects(offline.sync(), /No Internet/); assert.equal(offline.catalog.ambientCatalogVersion, 2);
  const before = downloads; remote = await catalog(3, ["Calma", "Writing"]); await library.sync(); assert.equal(downloads, before);
});
test("catálogo rechaza hash, MIME, paths y duplicados; cierre cancela antes de activación", async () => {
  const remote = await catalog(1, ["Calma"]); const corrupt = structuredClone(remote.value); corrupt.tracks[0].title = "Alterado"; await assert.rejects(validateAmbient(corrupt), { code: "integrity" });
  for (const patch of [{ mime: "video/mp4" }, { storagePath: "../../secret" }, { generation: "x" }]) { const invalid = structuredClone(remote.value); Object.assign(invalid.tracks[0], patch); await assert.rejects(validateAmbient(invalid), { code: "integrity" }); }
  let committed = false; const library = new AmbientLibrary({ call: async action => { if (action === "ambient-read") return null; committed = true; }, has: async () => true }, { call: async () => ({ catalog: remote.value }) });
  library.close(); await assert.rejects(library.sync()); assert.equal(committed, false);
});

test("cambiar predeterminada usa playlist compatible 1.0.18 y restaura offline sin descargar audio repetido", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ambient-default-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new DiskCache(directory); let remote = await catalog(1, ["Calma", "Writing"]); let downloads = 0;
  async function setDefault(index, version) {
    remote.value.ambientCatalogVersion = version;
    remote.value.playlists = [{ id: "module-default", title: "Predeterminada", trackIds: [remote.value.tracks[index].id] }];
    remote.value.integrity.contentHash = await sha256(new TextEncoder().encode(canonical({ schemaVersion: 1, tracks: remote.value.tracks, playlists: remote.value.playlists })));
  }
  await setDefault(1, 1);
  const api = { async call() { return { catalog: remote.value }; }, async downloadAmbient(_version, track, write) { downloads++; await write(remote.bytes.get(track.id)); } };
  const library = new AmbientLibrary(cache, api); await library.sync(); assert.equal(downloads, 2);
  await setDefault(0, 2); await library.sync(); assert.equal(downloads, 2);
  const offline = new AmbientLibrary(new DiskCache(directory), { call() { throw new Error("Sin red"); } });
  const restored = await offline.restore(); assert.equal(restored.playlists[0].trackIds[0], remote.value.tracks[0].id);
});
