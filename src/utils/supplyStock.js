export const SUPPLY_STOCK_SORT_OPTIONS = {
  STATUS_URGENT: "status-urgent",
  STATUS_IDEAL: "status-ideal",
  NAME_ASC: "name-asc",
  NAME_DESC: "name-desc",
  STOCK_ASC: "stock-asc",
  STOCK_DESC: "stock-desc",
  MIN_ASC: "min-asc",
  MIN_DESC: "min-desc",
  IDEAL_ASC: "ideal-asc",
  IDEAL_DESC: "ideal-desc",
  UPDATED_DESC: "updated-desc",
  UPDATED_ASC: "updated-asc",
};

const STOCK_STATUS = {
  critical: {
    key: "critical",
    label: "Crítico",
    tone: "red",
    icon: "!",
    priority: 0,
  },
  low: {
    key: "low",
    label: "Bajo",
    tone: "orange",
    icon: "↓",
    priority: 1,
  },
  normal: {
    key: "normal",
    label: "Normal",
    tone: "blue",
    icon: "•",
    priority: 2,
  },
  optimal: {
    key: "optimal",
    label: "Óptimo",
    tone: "green",
    icon: "✓",
    priority: 3,
  },
};

export function normalizeSupplyNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;

  const number = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(number) ? number : fallback;
}

export function getSupplyStockStatus(supply) {
  const currentStock = normalizeSupplyNumber(supply?.currentStock);
  const minStock = normalizeSupplyNumber(supply?.minStock);
  const idealStock = normalizeSupplyNumber(supply?.idealStock);
  let baseStatus = STOCK_STATUS.normal;

  // Conserva exactamente la clasificación operativa previa del módulo.
  if (currentStock <= 0) {
    baseStatus = STOCK_STATUS.critical;
  } else if (minStock > 0 && currentStock < minStock) {
    baseStatus = STOCK_STATUS.low;
  } else if (idealStock > 0 && currentStock >= idealStock) {
    baseStatus = STOCK_STATUS.optimal;
  }

  const belowMinimum = minStock > 0 && currentStock < minStock;
  const belowIdeal = idealStock > 0 && currentStock < idealStock;

  return {
    ...baseStatus,
    currentStock,
    minStock,
    idealStock,
    outOfStock: currentStock <= 0,
    belowMinimum,
    belowIdeal,
    hasMinimum: minStock > 0,
    hasIdeal: idealStock > 0,
    hasThresholds: minStock > 0 || idealStock > 0,
    requiresAttention: currentStock <= 0 || belowMinimum || belowIdeal,
  };
}

export function getSupplyStockPercentage(supply) {
  const { currentStock, idealStock, hasIdeal } = getSupplyStockStatus(supply);
  if (!hasIdeal) return null;

  const percentage = (currentStock / idealStock) * 100;
  if (!Number.isFinite(percentage)) return null;

  return Math.min(Math.max(percentage, 0), 100);
}

export function matchesSupplyAttentionFilter(supply, filter) {
  const status = getSupplyStockStatus(supply);

  if (filter === "attention") return status.requiresAttention;
  if (filter === "out-of-stock") return status.outOfStock;
  if (filter === "below-minimum") return status.belowMinimum;
  if (filter === "below-ideal") return status.belowIdeal;
  if (filter === "unconfigured") return !status.hasThresholds;

  return true;
}

export function normalizeSupplySearchText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");
}

export function getSupplySearchText(supply) {
  const presentationCodes = Array.isArray(supply?.barcodePresentations)
    ? supply.barcodePresentations.map((presentation) => presentation?.barcode)
    : [];

  return normalizeSupplySearchText([
    supply?.name,
    supply?.description,
    supply?.notes,
    supply?.category,
    supply?.barcode,
    supply?.code,
    supply?.sku,
    supply?.id,
    supply?.supplier,
    supply?.color,
    supply?.size,
    supply?.weight,
    ...presentationCodes,
  ].filter(Boolean).join(" "));
}

export function getSupplyDateMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareSupplies(a, b, sortBy = SUPPLY_STOCK_SORT_OPTIONS.STATUS_URGENT) {
  const statusA = getSupplyStockStatus(a);
  const statusB = getSupplyStockStatus(b);
  const nameComparison = String(a?.name || "").localeCompare(
    String(b?.name || ""),
    "es",
    { sensitivity: "base" }
  );
  const updatedA = getSupplyDateMs(a?.updatedAt || a?.createdAt);
  const updatedB = getSupplyDateMs(b?.updatedAt || b?.createdAt);

  const numericComparison = (field, direction = 1) => (
    normalizeSupplyNumber(a?.[field]) - normalizeSupplyNumber(b?.[field])
  ) * direction;

  let comparison = 0;

  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.NAME_ASC) comparison = nameComparison;
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.NAME_DESC) comparison = -nameComparison;
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.STOCK_ASC) comparison = numericComparison("currentStock");
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.STOCK_DESC) comparison = numericComparison("currentStock", -1);
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.MIN_ASC) comparison = numericComparison("minStock");
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.MIN_DESC) comparison = numericComparison("minStock", -1);
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.IDEAL_ASC) comparison = numericComparison("idealStock");
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.IDEAL_DESC) comparison = numericComparison("idealStock", -1);
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.UPDATED_DESC) comparison = updatedB - updatedA;
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.UPDATED_ASC) comparison = updatedA - updatedB;
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.STATUS_URGENT) {
    comparison = statusA.priority - statusB.priority;
  }
  if (sortBy === SUPPLY_STOCK_SORT_OPTIONS.STATUS_IDEAL) {
    comparison = statusB.priority - statusA.priority;
  }

  if (comparison !== 0) return comparison;

  const stockComparison = statusA.currentStock - statusB.currentStock;
  if (stockComparison !== 0) return stockComparison;

  return nameComparison;
}
