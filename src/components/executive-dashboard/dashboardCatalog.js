export const DASHBOARD_PREFERENCE_VERSION = 1;

export const WIDGET_CATALOG = [
  { type: "kpi", label: "Indicadores KPI", description: "Indicadores principales con tendencia.", icon: "dashboard", defaultW: 12, minW: 6 },
  { type: "alertas", label: "Prioridades del día", description: "Pendientes críticos y estados operativos.", icon: "alert", defaultW: 8, minW: 5 },
  { type: "atencion", label: "Atención inmediata", description: "Alertas operativas ordenadas por prioridad.", icon: "bell", defaultW: 4, minW: 3 },
  { type: "mensajes", label: "Mensajes", description: "Mensajes sin revisar.", icon: "messages", defaultW: 3, minW: 3 },
  { type: "agenda", label: "Agenda", description: "Actividad del equipo para hoy.", icon: "calendar", defaultW: 3, minW: 3 },
  { type: "proyectos", label: "Proyectos", description: "Proyectos activos y en revisión.", icon: "projects", defaultW: 3, minW: 3 },
  { type: "ideas", label: "Ideas", description: "Ideas nuevas o pendientes.", icon: "ideas", defaultW: 3, minW: 3 },
  { type: "compras", label: "Compras", description: "Solicitudes por aprobar.", icon: "purchase", defaultW: 3, minW: 3 },
  { type: "imprenta", label: "Imprenta rápida", description: "Existencias clave de insumos.", icon: "print", defaultW: 8, minW: 6 },
  { type: "inventario", label: "Inventario actual", description: "Mínimo, ideal y stock por material.", icon: "inventory", defaultW: 6, minW: 5 },
  { type: "stock", label: "Stock mínimo / ideal / actual", description: "Comparativa agrupada de stock.", icon: "inventory", defaultW: 6, minW: 5 },
  { type: "soporte", label: "Soporte técnico", description: "Equipos y mantenimientos.", icon: "support", defaultW: 3, minW: 3 },
  { type: "mantenimientos", label: "Mantenimientos", description: "Vencidos y próximos.", icon: "maintenance", defaultW: 3, minW: 3 },
  { type: "equipos", label: "Equipos inoperativos", description: "Equipos que requieren servicio.", icon: "equipment", defaultW: 3, minW: 3 },
  { type: "certificados", label: "Certificados entregados", description: "Entregas de últimos siete días.", icon: "certificate", defaultW: 6, minW: 4 },
  { type: "libros", label: "Libros producidos", description: "Producción por periodos.", icon: "books", defaultW: 8, minW: 6 },
  { type: "modulos", label: "Módulos clave", description: "Resumen compacto de módulos.", icon: "modules", defaultW: 4, minW: 4 },
  { type: "actividad", label: "Actividad reciente", description: "Feed combinado de operación.", icon: "activity", defaultW: 4, minW: 4 },
  { type: "barras", label: "Gráfica de barras", description: "Gráfica configurable por fuente.", icon: "chartBar", defaultW: 6, minW: 4 },
  { type: "lineas", label: "Gráfica de líneas", description: "Tendencia configurable.", icon: "chartLine", defaultW: 6, minW: 4 },
  { type: "donut", label: "Gráfica donut", description: "Distribución por estado.", icon: "donut", defaultW: 4, minW: 3 },
  { type: "sparkline", label: "Sparkline", description: "Mini tendencia de un indicador.", icon: "sparkline", defaultW: 3, minW: 3 },
];

export const DEFAULT_DASHBOARD_LAYOUT = [
  { id: "kpi-overview", type: "kpi", w: 12, title: "" },
  { id: "daily-priorities", type: "alertas", w: 8, title: "Prioridades del día" },
  { id: "immediate-attention", type: "atencion", w: 4, title: "Atención inmediata" },
  { id: "quick-printshop", type: "imprenta", w: 8, title: "Imprenta rápida", settings: { limit: 6 } },
  { id: "key-modules", type: "modulos", w: 4, title: "Módulos clave" },
  { id: "inventory-current", type: "inventario", w: 6, title: "Inventario actual", settings: { category: "all", limit: 7 } },
  { id: "certificates-delivered", type: "certificados", w: 6, title: "Certificados entregados" },
  { id: "books-produced", type: "libros", w: 8, title: "Libros producidos" },
  { id: "recent-activity", type: "actividad", w: 4, title: "Actividad reciente", settings: { limit: 6 } },
];

export const WIDGET_WIDTH_OPTIONS = [3, 4, 6, 8, 12];

export function getCatalogItem(type) {
  return WIDGET_CATALOG.find((item) => item.type === type) || WIDGET_CATALOG[0];
}

export function createWidgetFromCatalog(type, index = Date.now()) {
  const item = getCatalogItem(type);
  return {
    id: `${type}-${index}`,
    type,
    w: item.defaultW,
    title: item.label,
    settings: {},
  };
}

export function normalizeDashboardLayout(layout) {
  if (!Array.isArray(layout) || layout.length === 0) {
    return DEFAULT_DASHBOARD_LAYOUT.map(cloneWidget);
  }

  const validTypes = new Set(WIDGET_CATALOG.map((item) => item.type));
  return layout
    .filter((widget) => widget?.id && validTypes.has(widget.type))
    .map((widget) => {
      const catalog = getCatalogItem(widget.type);
      const width = WIDGET_WIDTH_OPTIONS.includes(Number(widget.w))
        ? Number(widget.w)
        : catalog.defaultW;
      return {
        id: String(widget.id),
        type: widget.type,
        w: Math.max(catalog.minW, width),
        title: typeof widget.title === "string" ? widget.title.slice(0, 80) : catalog.label,
        hidden: widget.hidden === true,
        settings: widget.settings && typeof widget.settings === "object" ? { ...widget.settings } : {},
      };
    });
}

export function getDefaultDashboardLayout() {
  return DEFAULT_DASHBOARD_LAYOUT.map(cloneWidget);
}

function cloneWidget(widget) {
  return { ...widget, settings: { ...(widget.settings || {}) } };
}
