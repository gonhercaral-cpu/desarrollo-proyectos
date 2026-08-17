import { useState } from "react";
import { DashboardCustomizer, WidgetSettings } from "../components/executive-dashboard/DashboardCustomizer";
import { DashboardGrid } from "../components/executive-dashboard/DashboardGrid";
import { DashboardIcon } from "../components/executive-dashboard/DashboardVisuals";
import { useExecutiveDashboard } from "../hooks/useExecutiveDashboard";

export default function ExecutiveDashboard({ onOpenModule }) {
  const dashboard = useExecutiveDashboard();
  const [editing, setEditing] = useState(false);
  const [settingsWidget, setSettingsWidget] = useState(null);
  const visibleWidgets = dashboard.layout.filter((widget) => widget.visible !== false);

  if (dashboard.loading) {
    return (
      <main className="executive-dashboard workspace-dashboard-page ed-loading-page">
        <div className="ed-heading-skeleton" />
        <div className="ed-kpi-skeleton">{Array.from({ length: 6 }).map((_, index) => <i key={index} />)}</div>
        <div className="ed-panel-skeleton" />
      </main>
    );
  }

  if (!dashboard.data) {
    return (
      <main className="executive-dashboard workspace-dashboard-page">
        <div className="ed-page-error"><DashboardIcon name="alert" size={30} /><h2>Dashboard no disponible</h2><p>{dashboard.error || "No fue posible cargar información."}</p><button type="button" onClick={() => dashboard.refresh()}>Reintentar</button></div>
      </main>
    );
  }

  return (
    <main className={`executive-dashboard workspace-dashboard-page ${editing ? "is-editing" : ""}`}>
      <header className="ed-page-header">
        <div className="ed-page-title"><span><DashboardIcon name="dashboard" size={27} /></span><div><h1>Dashboard ejecutivo</h1><p>Visión general de la operación del día</p></div></div>
        <div className="ed-header-actions">
          <div className="ed-update-meta"><span><DashboardIcon name="calendar" size={16} />{formatFullDate(dashboard.data.generatedAt)}</span><small>Actualizado: {formatTime(dashboard.data.generatedAt)}</small></div>
          <button type="button" className="ed-secondary-button ed-personalize-button" onClick={() => setEditing((value) => !value)}><DashboardIcon name="settings" size={17} />{editing ? "Terminar" : "Personalizar dashboard"}</button>
          <button type="button" className="ed-primary-button" onClick={() => dashboard.refresh()} disabled={dashboard.refreshing}><DashboardIcon name="refresh" size={17} />{dashboard.refreshing ? "Actualizando…" : "Actualizar"}</button>
        </div>
      </header>

      <DashboardCustomizer open={editing} layout={dashboard.layout} saveState={dashboard.saveState} onClose={() => setEditing(false)} onAdd={dashboard.addWidget} onRestore={dashboard.restoreDefault} onToggle={dashboard.updateWidget} />

      {dashboard.error && <div className="ed-warning"><DashboardIcon name="alert" size={17} /><span>{dashboard.error}</span></div>}

      {(editing || visibleWidgets.length) ? (
        <DashboardGrid layout={dashboard.layout} editing={editing} dashboard={dashboard} data={dashboard.data} onOpenModule={onOpenModule} onSettings={setSettingsWidget} />
      ) : (
        <div className="ed-empty-dashboard"><DashboardIcon name="modules" size={32} /><h2>Dashboard vacío</h2><p>Agrega widgets desde catálogo para construir tu vista.</p><button type="button" className="ed-primary-button" onClick={() => setEditing(true)}>Abrir catálogo</button></div>
      )}

      <WidgetSettings key={settingsWidget?.id || "closed"} widget={settingsWidget} data={dashboard.data} onSave={dashboard.updateWidget} onRestore={dashboard.restoreWidget} onClose={() => setSettingsWidget(null)} />
    </main>
  );
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(date);
}
