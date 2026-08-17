import { useMemo, useState } from "react";
import { DashboardIcon } from "./DashboardVisuals";
import { getCatalogItem, WIDGET_CATALOG, WIDGET_WIDTH_OPTIONS } from "./dashboardCatalog";

export function DashboardCustomizer({ open, layout, saveState, onClose, onAdd, onRestore }) {
  const activeTypes = useMemo(() => new Set(layout.filter((item) => !item.hidden).map((item) => item.type)), [layout]);
  if (!open) return null;
  return (
    <aside className="ed-customizer" aria-label="Catálogo de widgets">
      <header><div><span><DashboardIcon name="modules" /></span><div><h2>Personalizar dashboard</h2><p>{saveLabel(saveState)}</p></div></div><button type="button" className="ed-icon-button" onClick={onClose} aria-label="Cerrar"><DashboardIcon name="close" /></button></header>
      <div className="ed-customizer-help"><DashboardIcon name="drag" /><p>Arrastra tarjetas para ordenar. Ajusta tamaño y configuración desde cada widget.</p></div>
      <div className="ed-catalog-list">
        {WIDGET_CATALOG.map((item) => (
          <div className="ed-catalog-item" key={item.type}>
            <span><DashboardIcon name={item.icon} size={18} /></span><div><strong>{item.label}</strong><small>{item.description}</small></div>
            <button type="button" onClick={() => onAdd(item.type)} title={`Agregar ${item.label}`}><DashboardIcon name="plus" size={17} /></button>
            {activeTypes.has(item.type) && <i>Activo</i>}
          </div>
        ))}
      </div>
      <footer><button type="button" className="ed-secondary-button" onClick={onRestore}>Restaurar diseño predeterminado</button><button type="button" className="ed-primary-button" onClick={onClose}>Listo</button></footer>
    </aside>
  );
}

export function WidgetEditBar({ widget, onUpdate, onRemove, onConfigure, onDragStart, onDragEnd }) {
  const catalog = getCatalogItem(widget.type);
  return (
    <div className="ed-widget-editbar">
      <button type="button" className="ed-drag-handle" draggable onDragStart={(event) => onDragStart(event, widget.id)} onDragEnd={onDragEnd} title="Arrastrar para ordenar"><DashboardIcon name="drag" size={17} /><span>{catalog.label}</span></button>
      <select value={widget.w} aria-label="Ancho del widget" onChange={(event) => onUpdate(widget.id, { w: Number(event.target.value) })}>
        {WIDGET_WIDTH_OPTIONS.filter((width) => width >= catalog.minW).map((width) => <option key={width} value={width}>{width === 12 ? "Ancho completo" : `${Math.round(width / 12 * 100)}%`}</option>)}
      </select>
      <button type="button" onClick={() => onConfigure(widget)} title="Configurar"><DashboardIcon name="settings" size={16} /></button>
      <button type="button" onClick={() => onUpdate(widget.id, { hidden: true })} title="Ocultar">Ocultar</button>
      <button type="button" className="is-danger" onClick={() => onRemove(widget.id)} title="Quitar"><DashboardIcon name="close" size={16} /></button>
    </div>
  );
}

export function WidgetSettings({ widget, data, onSave, onClose }) {
  const [title, setTitle] = useState(widget?.title || "");
  const [category, setCategory] = useState(widget?.settings?.category || "all");
  const [limit, setLimit] = useState(Number(widget?.settings?.limit || 6));
  const [metric, setMetric] = useState(widget?.settings?.metric || data?.kpis?.[0]?.label || "");
  if (!widget) return null;
  const supportsCategory = ["inventario", "stock", "barras"].includes(widget.type);
  const supportsLimit = ["imprenta", "inventario", "stock", "barras", "actividad"].includes(widget.type);
  const supportsMetric = widget.type === "sparkline";
  return (
    <div className="ed-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ed-settings-modal" role="dialog" aria-modal="true" aria-labelledby="widget-settings-title">
        <header><div><h2 id="widget-settings-title">Configurar widget</h2><p>{getCatalogItem(widget.type).label}</p></div><button type="button" className="ed-icon-button" onClick={onClose}><DashboardIcon name="close" /></button></header>
        <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder={getCatalogItem(widget.type).label} /></label>
        {supportsCategory && <label>Categoría<select value={category} onChange={(event) => setCategory(event.target.value)}>{data.inventoryCategories.map((item) => <option key={item} value={item}>{item === "all" ? "Todas las categorías" : item}</option>)}</select></label>}
        {supportsLimit && <label>Elementos visibles<input type="number" min="3" max="12" value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label>}
        {supportsMetric && <label>Indicador<select value={metric} onChange={(event) => setMetric(event.target.value)}>{data.kpis.map((item) => <option key={item.label}>{item.label}</option>)}</select></label>}
        <footer><button type="button" className="ed-secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="ed-primary-button" onClick={() => { onSave(widget.id, { title, settings: { category, limit, metric } }); onClose(); }}>Guardar configuración</button></footer>
      </section>
    </div>
  );
}

function saveLabel(state) {
  if (state === "saving") return "Guardando cambios…";
  if (state === "saved") return "Cambios guardados en tu cuenta";
  if (state === "local") return "Guardado local; Firestore no disponible";
  return "Diseño personal por usuario";
}
