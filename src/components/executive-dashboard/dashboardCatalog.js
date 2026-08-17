import { findOpenGridPosition, packDashboardLayout } from "./dashboardGridEngine.js";

export const DASHBOARD_PREFERENCE_VERSION = 3;

export const CHART_TYPES = [
  { value: "bar", label: "Barras" },
  { value: "horizontalBar", label: "Barras horizontales" },
  { value: "line", label: "Líneas" },
  { value: "area", label: "Área" },
  { value: "pie", label: "Pastel" },
  { value: "donut", label: "Dona" },
];

export const WIDGET_CATALOG = [
  widget("kpi", "Indicadores KPI", "Indicadores principales con tendencia.", "dashboard", 12, 7, 6, 4),
  widget("alertas", "Prioridades del día", "Pendientes críticos y estados operativos.", "alert", 8, 7, 5, 4),
  widget("atencion", "Atención inmediata", "Alertas operativas ordenadas por prioridad.", "bell", 4, 7, 3, 4),
  widget("mensajes", "Mensajes", "Mensajes sin revisar.", "messages", 3, 5, 3, 4),
  widget("agenda", "Agenda", "Actividad del equipo para hoy.", "calendar", 3, 5, 3, 4),
  widget("proyectos", "Proyectos", "Proyectos activos y en revisión.", "projects", 3, 5, 3, 4),
  widget("ideas", "Ideas", "Ideas nuevas o pendientes.", "ideas", 3, 5, 3, 4),
  widget("compras", "Compras", "Solicitudes por aprobar.", "purchase", 3, 5, 3, 4),
  widget("imprenta", "Imprenta rápida", "Existencias clave de insumos.", "print", 8, 7, 6, 4),
  widget("inventario", "Inventario actual", "Mínimo, ideal y stock por material.", "inventory", 6, 8, 5, 6, ["bar", "horizontalBar", "line", "area"]),
  widget("stock", "Stock mínimo / ideal / actual", "Comparativa agrupada de stock.", "inventory", 6, 8, 5, 6, ["bar", "horizontalBar", "line", "area"]),
  widget("soporte", "Soporte técnico", "Equipos y mantenimientos.", "support", 3, 5, 3, 4),
  widget("mantenimientos", "Mantenimientos", "Vencidos y próximos.", "maintenance", 3, 5, 3, 4),
  widget("equipos", "Equipos inoperativos", "Equipos que requieren servicio.", "equipment", 3, 5, 3, 4),
  widget("certificados", "Certificados entregados", "Entregas de últimos siete días.", "certificate", 6, 8, 4, 6, ["bar", "horizontalBar", "line", "area", "pie", "donut"]),
  widget("libros", "Libros producidos", "Producción por periodos.", "books", 8, 8, 6, 6, ["line", "area", "bar"]),
  widget("modulos", "Módulos clave", "Resumen compacto de módulos.", "modules", 4, 7, 4, 4),
  widget("actividad", "Actividad reciente", "Feed combinado de operación.", "activity", 4, 9, 4, 4),
  widget("barras", "Gráfica de barras", "Gráfica configurable por fuente.", "chartBar", 6, 8, 4, 6, ["bar", "horizontalBar", "line", "area"]),
  widget("lineas", "Gráfica de líneas", "Tendencia configurable.", "chartLine", 6, 8, 4, 6, ["line", "area", "bar"]),
  widget("donut", "Gráfica donut", "Distribución por estado.", "donut", 4, 7, 3, 5, ["donut", "pie"]),
  widget("sparkline", "Sparkline", "Mini tendencia de un indicador.", "sparkline", 3, 5, 3, 4),
];

export const DEFAULT_DASHBOARD_LAYOUT = [
  positioned("kpi-overview", "kpi", 0, 0, 12, 7, ""),
  positioned("daily-priorities", "alertas", 0, 7, 8, 7, "Prioridades del día"),
  positioned("immediate-attention", "atencion", 8, 7, 4, 7, "Atención inmediata"),
  positioned("quick-printshop", "imprenta", 0, 14, 8, 7, "Imprenta rápida", { limit: 6 }),
  positioned("key-modules", "modulos", 8, 14, 4, 7, "Módulos clave"),
  positioned("inventory-current", "inventario", 0, 21, 6, 8, "Inventario actual", { limit: 7 }, { category: "all" }, "bar", ["minimum", "ideal", "current"], ["minimum", "ideal", "current"]),
  positioned("certificates-delivered", "certificados", 6, 21, 6, 8, "Certificados entregados", {}, {}, "bar", ["delivered"], ["delivered"], "7d"),
  positioned("books-produced", "libros", 0, 29, 8, 8, "Libros producidos", {}, {}, "line", ["week", "month", "twoMonths"], ["week", "month", "twoMonths"], "all"),
  positioned("recent-activity", "actividad", 8, 29, 4, 9, "Actividad reciente", { limit: 6 }, {}, "", [], [], "all"),
];

export const WIDGET_WIDTH_OPTIONS = [3, 4, 6, 8, 12];

export function getCatalogItem(type) {
  return WIDGET_CATALOG.find((item) => item.type === type) || WIDGET_CATALOG[0];
}

export function getCompatibleChartTypes(type) {
  return getCatalogItem(type).chartTypes || [];
}

export function createWidgetFromCatalog(type, index = Date.now(), currentLayout = []) {
  const item = getCatalogItem(type);
  const position = findOpenGridPosition(currentLayout, item.defaultW, item.defaultH);
  return normalizeWidget({
    id: `${type}-${index}`,
    type,
    ...position,
    width: item.defaultW,
    height: item.defaultH,
    title: item.label,
    visible: true,
    chartType: item.chartTypes?.[0] || "",
    filters: {},
    period: "all",
    metrics: defaultMetrics(type),
    series: defaultMetrics(type),
    settings: {},
  });
}

export function normalizeDashboardLayout(layout) {
  if (!Array.isArray(layout) || layout.length === 0) return getDefaultDashboardLayout();
  const validTypes = new Set(WIDGET_CATALOG.map((item) => item.type));
  const normalized = [];
  layout.filter((item) => item?.id && validTypes.has(item.type)).forEach((item) => {
    const hasPosition = Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y));
    const next = normalizeWidget({ ...item, x: hasPosition ? item.x : 0, y: hasPosition ? item.y : 0 });
    normalized.push(hasPosition ? next : { ...next, ...findOpenGridPosition(normalized, next.width, next.height) });
  });
  return packDashboardLayout(normalized);
}

export function getDefaultDashboardLayout() {
  return DEFAULT_DASHBOARD_LAYOUT.map(cloneWidget);
}

export function getDefaultWidget(item) {
  const exact = DEFAULT_DASHBOARD_LAYOUT.find((widget) => widget.id === item.id);
  if (exact) return cloneWidget(exact);
  const fresh = createWidgetFromCatalog(item.type, item.id.replace(`${item.type}-`, "") || Date.now());
  return { ...fresh, id: item.id, x: item.x, y: item.y };
}

function normalizeWidget(item) {
  const catalog = getCatalogItem(item.type);
  const width = clampDimension(item.width ?? item.w, catalog.defaultW, catalog.minW, 12);
  const height = clampDimension(item.height ?? item.h, catalog.defaultH, catalog.minH, 40);
  const chartTypes = catalog.chartTypes || [];
  const legacyCategory = item.settings?.category;
  const visible = typeof item.visible === "boolean" ? item.visible : item.hidden !== true;
  return {
    id: String(item.id),
    type: item.type,
    x: clampDimension(item.x, 0, 0, 12 - width),
    y: clampDimension(item.y, 0, 0, 10000),
    width,
    height,
    w: width,
    h: height,
    visible,
    hidden: !visible,
    chartType: chartTypes.includes(item.chartType) ? item.chartType : chartTypes[0] || "",
    filters: {
      ...(item.filters && typeof item.filters === "object" ? item.filters : {}),
      ...(legacyCategory && !item.filters?.category ? { category: legacyCategory } : {}),
    },
    period: typeof item.period === "string" ? item.period : "all",
    metrics: Array.isArray(item.metrics) ? item.metrics.map(String) : defaultMetrics(item.type),
    series: Array.isArray(item.series) ? item.series.map(String) : Array.isArray(item.metrics) ? item.metrics.map(String) : defaultMetrics(item.type),
    settings: item.settings && typeof item.settings === "object" ? { ...item.settings } : {},
    title: typeof item.title === "string" ? item.title.slice(0, 80) : catalog.label,
  };
}

function widget(type, label, description, icon, defaultW, defaultH, minW, minH, chartTypes = []) {
  return { type, label, description, icon, defaultW, defaultH, minW, minH, chartTypes };
}

function positioned(id, type, x, y, width, height, title, settings = {}, filters = {}, chartType = "", metrics = [], series = metrics, period = "all") {
  return normalizeWidget({ id, type, x, y, width, height, title, visible: true, chartType, filters, period, metrics, series, settings });
}

function defaultMetrics(type) {
  if (["inventario", "stock", "barras"].includes(type)) return ["minimum", "ideal", "current"];
  if (type === "certificados") return ["delivered"];
  if (["libros", "lineas"].includes(type)) return ["week", "month", "twoMonths"];
  return [];
}

function cloneWidget(item) {
  return {
    ...item,
    filters: { ...(item.filters || {}) },
    metrics: [...(item.metrics || [])],
    series: [...(item.series || [])],
    settings: { ...(item.settings || {}) },
  };
}

function clampDimension(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(maximum, Math.max(minimum, safe));
}
