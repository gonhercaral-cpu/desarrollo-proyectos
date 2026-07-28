import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSupplies,
  getSupplyMinimumMarker,
  getSupplyStockPercentage,
  getSupplyStockStatus,
  matchesSupplyAttentionFilter,
  normalizeSupplyNumber,
  SUPPLY_STOCK_SORT_OPTIONS,
} from "../src/utils/supplyStock.js";

test("clasifica stock con una sola escala crítica, baja e ideal", () => {
  assert.equal(getSupplyStockStatus({ currentStock: 0, minStock: 10, idealStock: 20 }).label, "Crítico");
  assert.equal(getSupplyStockStatus({ currentStock: 5, minStock: 10, idealStock: 20 }).label, "Crítico");
  assert.equal(getSupplyStockStatus({ currentStock: 10, minStock: 10, idealStock: 20 }).label, "Crítico");
  assert.equal(getSupplyStockStatus({ currentStock: 15, minStock: 10, idealStock: 20 }).label, "Bajo");
  assert.equal(getSupplyStockStatus({ currentStock: 20, minStock: 10, idealStock: 20 }).label, "Ideal");
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
  assert.equal(getSupplyStockStatus(unconfigured).label, "Sin configuración");
  assert.equal(getSupplyStockStatus(unconfigured).requiresAttention, false);
});

test("calcula barra segura y limitada al ideal", () => {
  assert.equal(getSupplyStockPercentage({ currentStock: 15, idealStock: 20 }), 75);
  assert.equal(getSupplyStockPercentage({ currentStock: 30, idealStock: 20 }), 100);
  assert.equal(getSupplyStockPercentage({ currentStock: -5, idealStock: 20 }), 0);
  assert.equal(getSupplyStockPercentage({ currentStock: 10, idealStock: 0 }), null);
  assert.equal(getSupplyMinimumMarker({ minStock: 5, idealStock: 20 }), 25);
  assert.equal(getSupplyMinimumMarker({ minStock: 0, idealStock: 20 }), null);
});

test("ordena urgencia por estado, stock y nombre", () => {
  const supplies = [
    { name: "Ideal", currentStock: 30, minStock: 10, idealStock: 20 },
    { name: "Crítico B", currentStock: 5, minStock: 10, idealStock: 20 },
    { name: "Agotado", currentStock: 0, minStock: 10, idealStock: 20 },
    { name: "Crítico A", currentStock: 3, minStock: 10, idealStock: 20 },
    { name: "Bajo", currentStock: 15, minStock: 10, idealStock: 20 },
  ];

  supplies.sort((a, b) => compareSupplies(a, b, SUPPLY_STOCK_SORT_OPTIONS.STATUS_URGENT));

  assert.deepEqual(supplies.map((supply) => supply.name), [
    "Agotado",
    "Crítico A",
    "Crítico B",
    "Bajo",
    "Ideal",
  ]);
});
