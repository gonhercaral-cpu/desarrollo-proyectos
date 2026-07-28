import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSupplies,
  getSupplyStockPercentage,
  getSupplyStockStatus,
  matchesSupplyAttentionFilter,
  normalizeSupplyNumber,
  SUPPLY_STOCK_SORT_OPTIONS,
} from "../src/utils/supplyStock.js";

test("conserva la clasificación histórica de stock", () => {
  assert.equal(getSupplyStockStatus({ currentStock: 0, minStock: 10, idealStock: 20 }).label, "Crítico");
  assert.equal(getSupplyStockStatus({ currentStock: 5, minStock: 10, idealStock: 20 }).label, "Bajo");
  assert.equal(getSupplyStockStatus({ currentStock: 15, minStock: 10, idealStock: 20 }).label, "Normal");
  assert.equal(getSupplyStockStatus({ currentStock: 20, minStock: 10, idealStock: 20 }).label, "Óptimo");
});

test("normaliza números históricos sin propagar NaN", () => {
  assert.equal(normalizeSupplyNumber(" 12 "), 12);
  assert.equal(normalizeSupplyNumber("dato inválido"), 0);
  assert.equal(getSupplyStockStatus({ currentStock: "dato inválido" }).currentStock, 0);
});

test("detecta atención y mínimos sin configurar", () => {
  const belowIdeal = { currentStock: 15, minStock: 10, idealStock: 20 };
  const unconfigured = { currentStock: 15, minStock: 0, idealStock: 0 };

  assert.equal(matchesSupplyAttentionFilter(belowIdeal, "attention"), true);
  assert.equal(matchesSupplyAttentionFilter(belowIdeal, "below-ideal"), true);
  assert.equal(matchesSupplyAttentionFilter(unconfigured, "unconfigured"), true);
  assert.equal(getSupplyStockStatus(unconfigured).hasThresholds, false);
});

test("calcula barra segura y limitada al ideal", () => {
  assert.equal(getSupplyStockPercentage({ currentStock: 15, idealStock: 20 }), 75);
  assert.equal(getSupplyStockPercentage({ currentStock: 30, idealStock: 20 }), 100);
  assert.equal(getSupplyStockPercentage({ currentStock: -5, idealStock: 20 }), 0);
  assert.equal(getSupplyStockPercentage({ currentStock: 10, idealStock: 0 }), null);
});

test("ordena urgencia por estado, stock y nombre", () => {
  const supplies = [
    { name: "Óptimo", currentStock: 30, minStock: 10, idealStock: 20 },
    { name: "Bajo B", currentStock: 5, minStock: 10, idealStock: 20 },
    { name: "Crítico", currentStock: 0, minStock: 10, idealStock: 20 },
    { name: "Bajo A", currentStock: 3, minStock: 10, idealStock: 20 },
  ];

  supplies.sort((a, b) => compareSupplies(a, b, SUPPLY_STOCK_SORT_OPTIONS.STATUS_URGENT));

  assert.deepEqual(supplies.map((supply) => supply.name), [
    "Crítico",
    "Bajo A",
    "Bajo B",
    "Óptimo",
  ]);
});
