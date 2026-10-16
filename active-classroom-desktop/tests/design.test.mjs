import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { JSDOM } from "jsdom";

test("interfaz aprobada conserva estados, acciones, versión y datos reales", async t => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  const { unitCard } = await server.ssrLoadModule("/src/ui/library-view.ts");
  const { sidebarMarkup } = await server.ssrLoadModule("/src/ui/shell.ts");
  const packageInfo = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  const local = { unit: { unitId: "u", name: "Clase <local>", levelId: "level-1" }, version: 1, integrity: { contentHash: "a".repeat(64) }, resources: [] };
  const remote = { unitId: "u", name: "Clase <real>", levelId: "level-1", version: 1, contentHash: local.integrity.contentHash };
  const base = { unitId: "u", local, remote, busy: false, percent: 42, progressLabel: "Vídeo", disableSync: false, opening: false, activating: false };
  for (const [patch, label, tone] of [
    [{}, "Actualizada", "positive"],
    [{ remote: { ...remote, version: 2 } }, "Actualización disponible", "update"],
    [{ busy: true, disableSync: true }, "Descargando", "pending"],
    [{ local: undefined }, "No descargada", "pending"],
    [{ error: "Error <seguro>" }, "Error", "error"],
  ]) await t.test(label, () => {
    const dom = new JSDOM(unitCard({ ...base, ...patch })); const root = dom.window.document;
    assert.equal(root.querySelector(".sync-label").textContent, label);
    assert.ok(root.querySelector(`.sync-label.is-${tone}`));
    assert.equal(root.querySelector("h2").textContent, "Clase <real>");
    assert.equal(root.querySelector("h2").children.length, 0);
    assert.match(root.querySelector(".unit-versions").textContent, /Publicada: v/);
    assert.equal(root.querySelector("[data-open]").disabled, !({ ...base, ...patch }.local));
    assert.equal(root.querySelector("[data-sync]").disabled, !!patch.disableSync);
    assert.ok(root.querySelector("[data-unit-action='sync']"));
    assert.ok(root.querySelector("[data-unit-action='open']"));
    if (patch.busy) { assert.equal(root.querySelector("progress").value, 42); assert.ok(root.querySelector("[data-cancel]")); }
    if (patch.error) assert.equal(root.querySelector("[role='alert']").textContent, patch.error);
    dom.window.close();
  });
  await t.test("sidebar separa sincronización, configuración y versión instalada", () => {
    const dom = new JSDOM(sidebarMarkup({ levels: ["level-1", "level-2"], selectedLevel: "level-2", state: "Sincronizado", deviceName: "Aula <4>", busy: true }));
    const root = dom.window.document; const footer = root.querySelector("footer");
    assert.equal(footer.children.length, 3);
    assert.equal(footer.children[0].className, "sidebar-sync");
    assert.equal(footer.children[1].className, "sidebar-settings");
    assert.equal(footer.children[2].textContent, `v${packageInfo.version}`);
    assert.equal(root.querySelector(".sidebar-sync strong").textContent, "Sincronizando");
    assert.equal(root.querySelector(".sidebar-device").textContent, "Aula <4>");
    assert.equal(root.querySelector("[data-sidebar-refresh]").disabled, true);
    assert.ok(root.querySelector('[data-level="level-2"].is-selected'));
    assert.equal(root.querySelectorAll("[data-desktop-about]").length, 2);
    dom.window.close();
  });
});
