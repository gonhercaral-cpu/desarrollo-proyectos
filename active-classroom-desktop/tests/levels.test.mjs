import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PublicationApi } from "../src/offline/remote.ts";
import { setLibraryLevels, libraryLevelIds, levelName, validLibraryLevels } from "../src/offline/levels.ts";
afterEach(() => setLibraryLevels([]));
test("Desktop recibe nivel nuevo/renombrado, orden y estado sin cambiar manifests", async () => {
  const levels = [{ id: "custom-level", name: "Adultos C1", position: 1, active: true }, { id: "level-1", name: "Principiantes", position: 0, active: true }, { id: "inactive", name: "Archivo", position: 2, active: false }];
  const api = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: { publications: [], levels, nextCursor: null } })));
  assert.deepEqual(await api.list(), []);
  assert.equal(levelName("custom-level"), "Adultos C1"); assert.equal(levelName("level-1"), "Principiantes");
  assert.deepEqual(libraryLevelIds([]), ["level-1", "custom-level"]);
  assert.deepEqual(libraryLevelIds(["inactive"]), ["level-1", "custom-level", "inactive"]);
});
test("catálogo legado sigue funcionando; metadata inválida rechazada", async () => {
  assert.equal(levelName("level-5"), "Nivel 5");
  assert.equal(validLibraryLevels([{}]), false); assert.equal(validLibraryLevels("bad"), false);
  const api = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: { publications: [], levels: [{}], nextCursor: null } })));
  await assert.rejects(api.list(), { code: "response" });
});
