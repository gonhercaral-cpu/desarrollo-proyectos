import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PublicationApi } from "../src/offline/remote.ts";
import { setLibraryLevels, libraryLevelIds, levelName, levelIcon, validLibraryLevels } from "../src/offline/levels.ts";
afterEach(() => setLibraryLevels([]));
test("Desktop recibe nivel nuevo/renombrado, orden y estado sin cambiar manifests", async () => {
  const levels = [{ id: "custom-level", name: "Adultos C1", position: 1, active: true, icon: "🎓" }, { id: "level-1", name: "Principiantes", position: 0, active: true }, { id: "inactive", name: "Archivo", position: 2, active: false }];
  const api = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: { publications: [], levels, nextCursor: null } })));
  assert.deepEqual(await api.list(), []);
  assert.equal(levelName("custom-level"), "Adultos C1"); assert.equal(levelName("level-1"), "Principiantes");
  assert.equal(levelIcon("custom-level"), "🎓"); assert.equal(levelIcon("level-1"), "");
  assert.deepEqual(libraryLevelIds([]), ["level-1", "custom-level"]);
  assert.deepEqual(libraryLevelIds(["inactive"]), ["level-1", "custom-level", "inactive"]);
});
test("catálogo legado sigue funcionando; metadata inválida rechazada", async () => {
  assert.equal(levelName("level-5"), "Nivel 5");
  assert.equal(validLibraryLevels([{}]), false); assert.equal(validLibraryLevels("bad"), false);
  const api = new PublicationApi(async () => "token", async () => new Response(JSON.stringify({ result: { publications: [], levels: [{}], nextCursor: null } })));
  await assert.rejects(api.list(), { code: "response" });
});
test("nombres y orden sobreviven reinicio offline sin tocar caché de Units", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } });
  try {
    setLibraryLevels([{ id: "offline-level", name: "Conversación offline", position: 0, active: true, icon: "📚" }]);
    const restarted = await import("../src/offline/levels.ts?offline-restart");
    assert.equal(restarted.levelName("offline-level"), "Conversación offline");
    assert.equal(restarted.levelIcon("offline-level"), "📚");
    assert.deepEqual(restarted.libraryLevelIds([]), ["offline-level"]);
    assert.deepEqual([...saved.keys()], ["active-classroom-levels"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});
test("íconos vacíos, desconocidos o inválidos conservan fallback y niveles", () => {
  for (const icon of [undefined, "", "  ", null, {}, "x".repeat(33)]) {
    setLibraryLevels([{ id: "level-1", name: "Nivel 1", position: 0, active: true, icon }]);
    assert.equal(levelIcon("level-1"), "");
    assert.deepEqual(libraryLevelIds([]), ["level-1"]);
  }
  assert.equal(levelIcon("unknown"), "");
});
