import { useMemo, useState } from "react";
import { DashboardCustomizer, WidgetEditBar, WidgetSettings } from "../components/executive-dashboard/DashboardCustomizer";
import { DashboardWidget } from "../components/executive-dashboard/DashboardWidgets";
import { DashboardIcon } from "../components/executive-dashboard/DashboardVisuals";
import { useExecutiveDashboard } from "../hooks/useExecutiveDashboard";

export default function ExecutiveDashboard({ onOpenModule }) {
  const dashboard = useExecutiveDashboard();
  const [editing, setEditing] = useState(false);
  const [settingsWidget, setSettingsWidget] = useState(null);
  const [draggedId, setDraggedId] = useState("");
  const visibleLayout = useMemo(() => dashboard.layout.filter((widget) => editing || !widget.hidden), [dashboard.layout, editing]);
  const fullWidgets = visibleLayout.filter((widget) => widget.w >= 12);
  const mainWidgets = visibleLayout.filter((widget) => widget.w > 4 && widget.w < 12);
  const sideWidgets = visibleLayout.filter((widget) => widget.w <= 4);

  function handleDragStart(event, id) {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function handleDrop(event, targetId) {
    event.preventDefault();
    dashboard.moveWidget(event.dataTransfer.getData("text/plain") || draggedId, targetId);
    setDraggedId("");
  }

  if (dashboard.loading) {
    return (
      <main className="executive-dashboard ed-loading-page">
        <div className="ed-heading-skeleton" />
        <div className="ed-kpi-skeleton">{Array.from({ length: 6 }).map((_, index) => <i key={index} />)}</div>
        <div className="ed-panel-skeleton" />
      </main>
    );
  }

  if (!dashboard.data) {
    return (
      <main className="executive-dashboard">
        <div className="ed-page-error"><DashboardIcon name="alert" size={30} /><h2>Dashboard no disponible</h2><p>{dashboard.error || "No fue posible cargar información."}</p><button type="button" onClick={() => dashboard.refresh()}>Reintentar</button></div>
      </main>
    );
  }

  return (
    <main className={`executive-dashboard ${editing ? "is-editing" : ""}`}>
      <header className="ed-page-header">
        <div className="ed-page-title"><span><DashboardIcon name="dashboard" size={27} /></span><div><h1>Dashboard ejecutivo</h1><p>Visión general de la operación del día</p></div></div>
        <div className="ed-header-actions">
          <div className="ed-update-meta"><span><DashboardIcon name="calendar" size={16} />{formatFullDate(dashboard.data.generatedAt)}</span><small>Actualizado: {formatTime(dashboard.data.generatedAt)}</small></div>
          <button type="button" className="ed-secondary-button ed-personalize-button" onClick={() => setEditing((value) => !value)}><DashboardIcon name="settings" size={17} />{editing ? "Terminar" : "Personalizar dashboard"}</button>
          <button type="button" className="ed-primary-button" onClick={() => dashboard.refresh()} disabled={dashboard.refreshing}><DashboardIcon name="refresh" size={17} />{dashboard.refreshing ? "Actualizando…" : "Actualizar"}</button>
        </div>
      </header>

      {dashboard.error && <div className="ed-warning"><DashboardIcon name="alert" size={17} /><span>{dashboard.error}</span></div>}

      {visibleLayout.length ? (
        <section className="ed-widget-grid">
          {fullWidgets.map((widget) => <WidgetSlot key={widget.id} widget={widget} editing={editing} draggedId={draggedId} dashboard={dashboard} data={dashboard.data} onOpenModule={onOpenModule} onSettings={setSettingsWidget} onDragStart={handleDragStart} onDrop={handleDrop} onDragEnd={() => setDraggedId("")} />)}
          {(mainWidgets.length > 0 || sideWidgets.length > 0) && <div className="ed-dashboard-columns">
            <div className="ed-main-widgets">
              {mainWidgets.map((widget) => <WidgetSlot key={widget.id} widget={widget} editing={editing} draggedId={draggedId} dashboard={dashboard} data={dashboard.data} onOpenModule={onOpenModule} onSettings={setSettingsWidget} onDragStart={handleDragStart} onDrop={handleDrop} onDragEnd={() => setDraggedId("")} main />)}
            </div>
            <div className="ed-side-widgets">
              {sideWidgets.map((widget) => <WidgetSlot key={widget.id} widget={widget} editing={editing} draggedId={draggedId} dashboard={dashboard} data={dashboard.data} onOpenModule={onOpenModule} onSettings={setSettingsWidget} onDragStart={handleDragStart} onDrop={handleDrop} onDragEnd={() => setDraggedId("")} />)}
            </div>
          </div>}
        </section>
      ) : (
        <div className="ed-empty-dashboard"><DashboardIcon name="modules" size={32} /><h2>Dashboard vacío</h2><p>Agrega widgets desde catálogo para construir tu vista.</p><button type="button" className="ed-primary-button" onClick={() => setEditing(true)}>Abrir catálogo</button></div>
      )}

      <DashboardCustomizer open={editing} layout={dashboard.layout} saveState={dashboard.saveState} onClose={() => setEditing(false)} onAdd={dashboard.addWidget} onRestore={dashboard.restoreDefault} />
      <WidgetSettings widget={settingsWidget} data={dashboard.data} onSave={dashboard.updateWidget} onClose={() => setSettingsWidget(null)} />
    </main>
  );
}

function WidgetSlot({ widget, editing, draggedId, dashboard, data, onOpenModule, onSettings, onDragStart, onDrop, onDragEnd, main = false }) {
  return (
    <article
      className={`ed-widget-slot ${widget.hidden ? "is-hidden" : ""} ${draggedId === widget.id ? "is-dragging" : ""}`}
      style={{ "--widget-span": widget.w, "--main-span": widget.w >= 8 ? 8 : 4 }}
      onDragOver={(event) => editing && event.preventDefault()}
      onDrop={(event) => editing && onDrop(event, widget.id)}
      data-main={main ? "true" : "false"}
    >
      {editing && <WidgetEditBar widget={widget} onUpdate={dashboard.updateWidget} onRemove={dashboard.removeWidget} onConfigure={onSettings} onDragStart={onDragStart} onDragEnd={onDragEnd} />}
      {widget.hidden ? (
        <button type="button" className="ed-hidden-widget" onClick={() => dashboard.updateWidget(widget.id, { hidden: false })}><DashboardIcon name="plus" />Mostrar {widget.title || widget.type}</button>
      ) : (
        <DashboardWidget widget={widget} data={data} onOpenModule={onOpenModule} onUpdateWidget={dashboard.updateWidget} />
      )}
    </article>
  );
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(date);
}
