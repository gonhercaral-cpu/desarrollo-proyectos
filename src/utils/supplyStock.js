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
  optimal: {
    key: "optimal",
    label: "Ideal",
    tone: "green",
    icon: "✓",
    priority: 2,
  },
  unconfigured: {
    key: "unconfigured",
    label: "Sin configuración",
    tone: "gray",
    icon: "i",
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
  const cachedStatus = supply?._stockStatus;
  if (
    cachedStatus &&
    cachedStatus.currentStock === currentStock &&
    cachedStatus.minStock === minStock &&
    cachedStatus.idealStock === idealStock
  ) {
    return cachedStatus;
  }

  const hasMinimum = minStock > 0;
  const hasIdeal = idealStock > 0;
  let baseStatus;
  let description;

  if (currentStock <= 0) {
    baseStatus = STOCK_STATUS.critical;
    description = "Sin existencias";
  } else if (!hasMinimum || !hasIdeal) {
    baseStatus = STOCK_STATUS.unconfigured;
  } else if (currentStock <= minStock) {
    baseStatus = STOCK_STATUS.critical;
    description = "En el nivel mínimo";
  } else if (currentStock < idealStock) {
    baseStatus = STOCK_STATUS.low;
    description = "Por debajo del nivel ideal";
  } else {
    baseStatus = STOCK_STATUS.optimal;
    description = "Stock saludable";
  }

  const belowMinimum = hasMinimum && currentStock < minStock;
  const belowIdeal = hasIdeal && currentStock < idealStock;

  return {
    ...baseStatus,
    description,
    currentStock,
    minStock,
    idealStock,
    outOfStock: currentStock <= 0,
    belowMinimum,
    belowIdeal,
    hasMinimum,
    hasIdeal,
    hasThresholds: hasMinimum && hasIdeal,
    requiresAttention: baseStatus.key === "critical" || baseStatus.key === "low",
  };
}

export function getSupplyStockPercentage(supply) {
  const { currentStock, idealStock, hasIdeal } = getSupplyStockStatus(supply);
  if (!hasIdeal) return null;

  const percentage = (currentStock / idealStock) * 100;
  if (!Number.isFinite(percentage)) return null;

  return Math.min(Math.max(percentage, 0), 100);
}

export function getSupplyMinimumMarker(supply) {
  const { minStock, idealStock, hasMinimum, hasIdeal } = getSupplyStockStatus(supply);
  if (!hasMinimum || !hasIdeal) return null;

  const percentage = (minStock / idealStock) * 100;
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

export function formatSupplyUpdatedAt(value, timeZone = "America/Tijuana") {
  const milliseconds = getSupplyDateMs(value);
  if (!milliseconds) return null;

  const date = new Date(milliseconds);
  return {
    date: new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(date),
    time: new Intl.DateTimeFormat("es-MX", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date),
  };
}

export function formatSupplyUnit(unit, quantity) {
  const normalizedUnit = String(unit || "Pieza").trim() || "Pieza";
  if (Math.abs(normalizeSupplyNumber(quantity)) === 1) return normalizedUnit;

  const irregularPlurals = {
    Resma: "Resmas",
    Paquete: "Paquetes",
    Pieza: "Piezas",
    Caja: "Cajas",
    Rollo: "Rollos",
    Litro: "Litros",
    Metro: "Metros",
    Kilogramo: "Kilogramos",
  };

  return irregularPlurals[normalizedUnit] || normalizedUnit;
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
