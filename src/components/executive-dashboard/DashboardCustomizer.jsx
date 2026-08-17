import { useMemo, useState } from "react";
import { DashboardIcon } from "./DashboardVisuals";
import { CHART_TYPES, getCatalogItem, getCompatibleChartTypes, WIDGET_CATALOG } from "./dashboardCatalog";

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
      <div className="ed-size-controls" aria-label="Tamaño del widget">
        <label title="Ancho en columnas">A<input type="number" min={catalog.minW} max="12" value={widget.width} onChange={(event) => onUpdate(widget.id, { width: Number(event.target.value) })} /></label>
        <label title="Alto en filas">H<input type="number" min={catalog.minH} max="40" value={widget.height} onChange={(event) => onUpdate(widget.id, { height: Number(event.target.value), settings: { autoHeight: false } })} /></label>
      </div>
      <button type="button" onClick={() => onConfigure(widget)} title="Configurar"><DashboardIcon name="settings" size={16} /></button>
      <button type="button" onClick={() => onUpdate(widget.id, { visible: widget.visible === false })} title={widget.visible === false ? "Mostrar" : "Ocultar"}><DashboardIcon name="eye" size={16} /></button>
      <button type="button" onClick={() => onRestore(widget.id)} title="Restaurar widget"><DashboardIcon name="reset" size={16} /></button>
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
  const metricOptions = getMetricOptions(widget.type, data, form.source, form.period);
  const periodOptions = getPeriodOptions(widget.type, data);

  function toggleMetric(value) {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.includes(value) ? current.metrics.filter((item) => item !== value) : [...current.metrics, value],
      series: current.metrics.includes(value) ? current.series.filter((item) => item !== value) : [...current.series, value],
    }));
  }

  function moveSeries(value, direction) {
    setForm((current) => {
      const series = [...current.series];
      const index = series.indexOf(value);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= series.length) return current;
      [series[index], series[target]] = [series[target], series[index]];
      return { ...current, series };
    });
  }

  function changeSource(source) {
    const values = getMetricOptions(widget.type, data, source).map((item) => item.value);
    setForm((current) => ({ ...current, source, metrics: values, series: values }));
  }

  function save() {
    const metrics = form.metrics.length ? form.metrics : metricOptions.slice(0, 1).map((item) => item.value);
    const orderedSeries = form.series.filter((item) => metrics.includes(item));
    onSave(widget.id, {
      title: form.title,
      chartType: form.chartType,
      filters: { category: form.category, source: form.source },
      period: form.period,
      metrics,
      series: orderedSeries.length ? orderedSeries : [...metrics],
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
          {widget.type === "donut" && <label>Fuente de datos<select value={form.source} onChange={(event) => changeSource(event.target.value)}><option value="projects">Proyectos</option><option value="support">Soporte técnico</option></select></label>}
          {supportsCategory && <label>Categoría<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{data.inventoryCategories.map((item) => <option key={item} value={item}>{item === "all" ? "Todas las categorías" : item}</option>)}</select></label>}
          {supportsLimit && <label>Elementos visibles<input type="number" min="3" max="12" value={form.limit} onChange={(event) => setForm((current) => ({ ...current, limit: Number(event.target.value) }))} /></label>}
          {widget.type === "sparkline" && <label>Indicador<select value={form.metric} onChange={(event) => setForm((current) => ({ ...current, metric: event.target.value }))}>{data.kpis.map((item) => <option key={item.label}>{item.label}</option>)}</select></label>}
          {periodOptions.length > 0 && <label>Periodo<select value={form.period} onChange={(event) => setForm((current) => ({ ...current, period: event.target.value }))}>{periodOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
          {metricOptions.length > 0 && <fieldset className="ed-metrics-fieldset"><legend>Datos / Métricas</legend>{orderedMetricOptions(metricOptions, form.series).map((item) => { const active = form.metrics.includes(item.value); const index = form.series.indexOf(item.value); return <div key={item.value} className={`ed-metric-option ${active ? "is-active" : ""}`}><label><input type="checkbox" checked={active} onChange={() => toggleMetric(item.value)} /><span><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}</span></label>{active && <span className="ed-series-order"><button type="button" onClick={() => moveSeries(item.value, -1)} disabled={index <= 0} aria-label={`Subir ${item.label}`}>↑</button><button type="button" onClick={() => moveSeries(item.value, 1)} disabled={index >= form.series.length - 1} aria-label={`Bajar ${item.label}`}>↓</button></span>}</div>; })}</fieldset>}
        </div>
        <footer><button type="button" className="ed-secondary-button" onClick={() => { onRestore(widget.id); onClose(); }}>Restaurar widget</button><button type="button" className="ed-secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="ed-primary-button" onClick={save}>Guardar configuración</button></footer>
      </section>
    </div>
  );
}

function createForm(widget, data) {
  const storedMetrics = Array.isArray(widget?.metrics) ? [...widget.metrics] : [];
  const source = widget?.filters?.source || "projects";
  const metrics = storedMetrics.length ? storedMetrics
    : widget?.type === "kpi" ? (data?.kpis || []).map((item) => item.label)
      : widget?.type === "modulos" ? (data?.moduleCards || []).map((item) => item.label)
        : widget?.type === "donut" ? (source === "support" ? data?.supportChartMetrics || [] : data?.projectChartMetrics || []).map((item) => item.key)
          : storedMetrics;
  return {
    title: widget?.title || "",
    category: widget?.filters?.category || widget?.settings?.category || "all",
    limit: Number(widget?.settings?.limit || 6),
    metric: widget?.settings?.metric || data?.kpis?.[0]?.label || "",
    chartType: widget?.chartType || getCompatibleChartTypes(widget?.type)[0] || "",
    period: widget?.period || "all",
    metrics,
    series: Array.isArray(widget?.series) && widget.series.length ? [...widget.series] : [...metrics],
    source,
  };
}

function getMetricOptions(type, data, source = "projects", period = "7d") {
  if (["inventario", "stock", "barras"].includes(type)) return [{ value: "minimum", label: "Mínimo" }, { value: "ideal", label: "Ideal" }, { value: "current", label: "Stock actual" }];
  if (["libros", "lineas"].includes(type)) return data.production.periods.map((item) => ({ value: item.key, label: item.label }));
  if (type === "certificados") return (data.certificates.periods?.[period] || data.certificates.series || []).map((item) => ({ value: item.key, label: item.label, detail: `${item.total} en ${periodLabel(period).toLowerCase()}` }));
  if (type === "donut") return (source === "support" ? data.supportChartMetrics : data.projectChartMetrics).map((item) => ({ value: item.key, label: item.label, detail: String(item.value) }));
  if (type === "kpi") return data.kpis.map((item) => ({ value: item.label, label: item.label }));
  if (type === "modulos") return data.moduleCards.map((item) => ({ value: item.label, label: item.label }));
  return [];
}

function getPeriodOptions(type, data) {
  if (["libros", "lineas"].includes(type)) return [{ value: "all", label: "Todos los periodos" }, { value: "week", label: "Semana pasada" }, { value: "month", label: "Mes pasado" }, { value: "twoMonths", label: "Hace 2 meses" }];
  if (type === "actividad") return [{ value: "all", label: "Toda la actividad" }, { value: "7d", label: "Últimos 7 días" }, { value: "30d", label: "Últimos 30 días" }];
  if (type === "certificados") return Object.keys(data.certificates.periods || {}).map((key) => ({ value: key, label: `Últimos ${key.replace("d", " días")}` }));
  return [];
}

function orderedMetricOptions(options, order) {
  const rank = new Map((order || []).map((key, index) => [key, index]));
  return [...options].sort((left, right) => (rank.get(left.value) ?? 999) - (rank.get(right.value) ?? 999));
}

function periodLabel(period) {
  return period?.endsWith("d") ? `Últimos ${period.slice(0, -1)} días` : "periodo seleccionado";
}

function saveLabel(state) {
  if (state === "saving") return "Guardando cambios…";
  if (state === "saved") return "Cambios guardados en tu cuenta";
  if (state === "local") return "Guardado local; Firestore no disponible";
  return "Diseño personal por usuario";
}
