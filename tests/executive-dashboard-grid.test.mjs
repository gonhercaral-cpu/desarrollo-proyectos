import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultDashboardLayout, normalizeDashboardLayout } from "../src/components/executive-dashboard/dashboardCatalog.js";
import { getWidgetSizeMode, gridItemsCollide, updateGridItem } from "../src/components/executive-dashboard/dashboardGridEngine.js";

test("migra layout legado conservando distribución y campos nuevos", () => {
  const layout = normalizeDashboardLayout([
    { id: "kpi", type: "kpi", w: 12, hidden: false },
    { id: "priorities", type: "alertas", w: 8 },
    { id: "attention", type: "atencion", w: 4, hidden: true },
  ]);
  assert.deepEqual(layout.map(({ x, y, width }) => ({ x, y, width })), [
    { x: 0, y: 0, width: 12 },
    { x: 0, y: 7, width: 8 },
    { x: 8, y: 7, width: 4 },
  ]);
  assert.equal(layout[2].visible, false);
  assert.ok(Array.isArray(layout[0].metrics));
  assert.ok(Array.isArray(layout[0].series));
  assert.equal(typeof layout[0].filters, "object");
});

test("migra orden de series desde métricas guardadas", () => {
  const [inventory] = normalizeDashboardLayout([
    { id: "inventory", type: "inventario", x: 0, y: 0, width: 6, height: 8, metrics: ["current", "minimum"] },
  ]);
  assert.deepEqual(inventory.series, ["current", "minimum"]);
  assert.deepEqual(inventory.metrics, ["current", "minimum"]);
});

test("mover widget reacomoda colisiones sin superposición", () => {
  const original = getDefaultDashboardLayout();
  const moved = updateGridItem(original, "immediate-attention", { x: 0, y: 7 }, { minWidth: 3, minHeight: 5 });
  for (let index = 0; index < moved.length; index += 1) {
    for (let other = index + 1; other < moved.length; other += 1) {
      assert.equal(gridItemsCollide(moved[index], moved[other]), false, `${moved[index].id} colisiona con ${moved[other].id}`);
    }
  }
});

test("resize respeta mínimos y límite de 12 columnas", () => {
  const original = getDefaultDashboardLayout();
  const resized = updateGridItem(original, "inventory-current", { width: 20, height: 1 }, { minWidth: 5, minHeight: 6 });
  const inventory = resized.find((item) => item.id === "inventory-current");
  assert.equal(inventory.width, 12);
  assert.equal(inventory.height, 6);
  assert.equal(inventory.x, 0);
});

test("modo responsive usa histéresis y no oscila cerca del breakpoint", () => {
  assert.equal(getWidgetSizeMode(519, "normal"), "compact");
  assert.equal(getWidgetSizeMode(535, "compact"), "compact");
  assert.equal(getWidgetSizeMode(553, "compact"), "normal");
  assert.equal(getWidgetSizeMode(821, "normal"), "expanded");
  assert.equal(getWidgetSizeMode(800, "expanded"), "expanded");
  assert.equal(getWidgetSizeMode(779, "expanded"), "normal");
});
