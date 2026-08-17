import { useMemo, useState } from "react";
import { DashboardIcon } from "./DashboardVisuals";
import { CHART_TYPES, getCatalogItem, getCompatibleChartTypes, WIDGET_CATALOG, WIDGET_WIDTH_OPTIONS } from "./dashboardCatalog";

export function DashboardCustomizer({ open, layout, saveState, onClose, onAdd, onRestore, onToggle }) {
  const widgetsByType = useMemo(() => new Map(layout.map((item) => [item.type, item])), [layout]);
  if (!open) return null;
  return (
    <aside className="ed-customizer" aria-label="Catálogo de widgets">
      <header><div><span><DashboardIcon name="modules" /></span><div><h2>Personalizar dashboard</h2><p>{saveLabel(saveState)}</p></div></div><button type="button" className="ed-icon-button" onClick={onClose} aria-label="Cerrar"><DashboardIcon name="close" /></button></header>
      <div className="ed-customizer-help"><DashboardIcon name="drag" /><p>Arrastra desde encabezado. Redimensiona desde bordes. Cuadrícula evita colisiones y guarda al soltar.</p></div>
      <div className="ed-catalog-list">
        {WIDGET_CATALOG.map((item) => {
          const existing = widgetsByType.get(item.type);
          return (
            <div className="ed-catalog-item" key={item.type}>
              <span><DashboardIcon name={item.icon} size={18} /></span>
              <div><strong>{item.label}</strong><small>{item.description}</small>{existing && <button type="button" className="ed-catalog-visibility" onClick={() => onToggle(existing.id, { visible: existing.visible === false })}>{existing.visible === false ? "Mostrar" : "Ocultar"}</button>}</div>
              <button type="button" onClick={() => onAdd(item.type)} title={`Agregar ${item.label}`}><DashboardIcon name="plus" size={17} /></button>
              {existing?.visible !== false && <i>Activo</i>}
            </div>
          );
        })}
      </div>
      <footer><button type="button" className="ed-secondary-button" onClick={onRestore}>Restaurar diseño predeterminado</button><button type="button" className="ed-primary-button" onClick={onClose}>Listo</button></footer>
    </aside>
  );
}

export function WidgetEditBar({ widget, onUpdate, onRemove, onConfigure, onRestore, onMoveStart }) {
  const catalog = getCatalogItem(widget.type);
  return (
    <div className="ed-widget-editbar">
      <button type="button" className="ed-drag-handle" onPointerDown={onMoveStart} title="Arrastrar y soltar"><DashboardIcon name="drag" size={17} /><span>{catalog.label}</span></button>
      <select value={widget.width} aria-label="Ancho del widget" onChange={(event) => onUpdate(widget.id, { width: Number(event.target.value) })}>
        {WIDGET_WIDTH_OPTIONS.filter((width) => width >= catalog.minW).map((width) => <option key={width} value={width}>{width === 12 ? "Ancho completo" : `${Math.round(width / 12 * 100)}%`}</option>)}
      </select>
      <select value={widget.height} aria-label="Alto del widget" onChange={(event) => onUpdate(widget.id, { height: Number(event.target.value) })}>
        {[...new Set([widget.height, catalog.minH, catalog.minH + 2, catalog.minH + 4, catalog.minH + 6])].sort((left, right) => left - right).map((height) => <option key={height} value={height}>{height} filas</option>)}
      </select>
      <button type="button" onClick={() => onConfigure(widget)} title="Configurar"><DashboardIcon name="settings" size={16} /></button>
      <button type="button" onClick={() => onUpdate(widget.id, { visible: widget.visible === false })} title={widget.visible === false ? "Mostrar" : "Ocultar"}>{widget.visible === false ? "Mostrar" : "Ocultar"}</button>
      <button type="button" onClick={() => onRestore(widget.id)} title="Restaurar widget">Restaurar</button>
      <button type="button" className="is-danger" onClick={() => onRemove(widget.id)} title="Quitar"><DashboardIcon name="close" size={16} /></button>
    </div>
  );
}

export function WidgetSettings({ widget, data, onSave, onRestore, onClose }) {
  const [form, setForm] = useState(() => createForm(widget, data));
  if (!widget) return null;
  const chartTypes = getCompatibleChartTypes(widget.type);
  const supportsCategory = ["inventario", "stock", "barras"].includes(widget.type);
  const supportsLimit = ["imprenta", "inventario", "stock", "barras", "actividad"].includes(widget.type);
  const metricOptions = getMetricOptions(widget.type, data);
  const periodOptions = getPeriodOptions(widget.type);

  function toggleMetric(value) {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.includes(value) ? current.metrics.filter((item) => item !== value) : [...current.metrics, value],
    }));
  }

  function save() {
    const metrics = form.metrics.length ? form.metrics : metricOptions.slice(0, 1).map((item) => item.value);
    onSave(widget.id, {
      title: form.title,
      chartType: form.chartType,
      filters: { category: form.category },
      period: form.period,
      metrics,
      settings: { limit: form.limit, metric: form.metric },
    });
    onClose();
  }

  return (
    <div className="ed-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ed-settings-modal" role="dialog" aria-modal="true" aria-labelledby="widget-settings-title">
        <header><div><h2 id="widget-settings-title">Configurar widget</h2><p>{getCatalogItem(widget.type).label}</p></div><button type="button" className="ed-icon-button" onClick={onClose}><DashboardIcon name="close" /></button></header>
        <div className="ed-settings-fields">
          <label>Título<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={80} placeholder={getCatalogItem(widget.type).label} /></label>
          {chartTypes.length > 0 && <label>Tipo de gráfica<select value={form.chartType} onChange={(event) => { const chartType = event.target.value; setForm((current) => ({ ...current, chartType })); onSave(widget.id, { chartType }); }}>{CHART_TYPES.filter((item) => chartTypes.includes(item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
          {supportsCategory && <label>Categoría<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{data.inventoryCategories.map((item) => <option key={item} value={item}>{item === "all" ? "Todas las categorías" : item}</option>)}</select></label>}
          {supportsLimit && <label>Elementos visibles<input type="number" min="3" max="12" value={form.limit} onChange={(event) => setForm((current) => ({ ...current, limit: Number(event.target.value) }))} /></label>}
          {widget.type === "sparkline" && <label>Indicador<select value={form.metric} onChange={(event) => setForm((current) => ({ ...current, metric: event.target.value }))}>{data.kpis.map((item) => <option key={item.label}>{item.label}</option>)}</select></label>}
          {periodOptions.length > 0 && <label>Periodo<select value={form.period} onChange={(event) => setForm((current) => ({ ...current, period: event.target.value }))}>{periodOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
          {metricOptions.length > 0 && <fieldset><legend>Métricas visibles</legend>{metricOptions.map((item) => <label key={item.value} className="ed-check-option"><input type="checkbox" checked={form.metrics.includes(item.value)} onChange={() => toggleMetric(item.value)} />{item.label}</label>)}</fieldset>}
        </div>
        <footer><button type="button" className="ed-secondary-button" onClick={() => { onRestore(widget.id); onClose(); }}>Restaurar widget</button><button type="button" className="ed-secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="ed-primary-button" onClick={save}>Guardar configuración</button></footer>
      </section>
    </div>
  );
}

function createForm(widget, data) {
  const storedMetrics = Array.isArray(widget?.metrics) ? [...widget.metrics] : [];
  const metrics = storedMetrics.length ? storedMetrics
    : widget?.type === "kpi" ? (data?.kpis || []).map((item) => item.label)
      : widget?.type === "modulos" ? (data?.moduleCards || []).map((item) => item.label)
        : storedMetrics;
  return {
    title: widget?.title || "",
    category: widget?.filters?.category || widget?.settings?.category || "all",
    limit: Number(widget?.settings?.limit || 6),
    metric: widget?.settings?.metric || data?.kpis?.[0]?.label || "",
    chartType: widget?.chartType || getCompatibleChartTypes(widget?.type)[0] || "",
    period: widget?.period || "all",
    metrics,
  };
}

function getMetricOptions(type, data) {
  if (["inventario", "stock", "barras"].includes(type)) return [{ value: "minimum", label: "Mínimo" }, { value: "ideal", label: "Ideal" }, { value: "current", label: "Stock actual" }];
  if (["libros", "lineas"].includes(type)) return data.production.periods.map((item) => ({ value: item.key, label: item.label }));
  if (type === "kpi") return data.kpis.map((item) => ({ value: item.label, label: item.label }));
  if (type === "modulos") return data.moduleCards.map((item) => ({ value: item.label, label: item.label }));
  return [];
}

function getPeriodOptions(type) {
  if (["libros", "lineas"].includes(type)) return [{ value: "all", label: "Todos los periodos" }, { value: "week", label: "Semana pasada" }, { value: "month", label: "Mes pasado" }, { value: "twoMonths", label: "Hace 2 meses" }];
  if (type === "actividad") return [{ value: "all", label: "Toda la actividad" }, { value: "7d", label: "Últimos 7 días" }, { value: "30d", label: "Últimos 30 días" }];
  return [];
}

function saveLabel(state) {
  if (state === "saving") return "Guardando cambios…";
  if (state === "saved") return "Cambios guardados en tu cuenta";
  if (state === "local") return "Guardado local; Firestore no disponible";
  return "Diseño personal por usuario";
}
