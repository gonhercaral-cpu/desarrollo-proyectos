import { AUDIT_ENTITY_FILTERS, AUDIT_RANGE_FILTERS } from "../../utils/digitalSignage";
import {
  ActiveFilterSummary,
  ActivityTimeline,
  AuditActivitySummary,
  LogMetric,
} from "./SignageLogTimeline";

export default function SignageHistoryPanel({
  logs,
  totalCount,
  stats,
  search,
  entityFilter,
  rangeFilter,
  onSearchChange,
  onEntityFilterChange,
  onRangeFilterChange,
  onClearFilters,
  SignageIcon,
  TypeBadge,
  InfoPair,
}) {
  const activeFilters = [
    search.trim() ? `Búsqueda: ${search.trim()}` : null,
    entityFilter !== "all" ? `Tipo: ${AUDIT_ENTITY_FILTERS.find((option) => option.value === entityFilter)?.label || entityFilter}` : null,
    rangeFilter !== "7" ? `Rango: ${AUDIT_RANGE_FILTERS.find((option) => option.value === rangeFilter)?.label || rangeFilter}` : null,
  ].filter(Boolean);

  return (
    <section className="signage-panel signage-log-page signage-history-panel">
      <div className="signage-panel-heading">
        <div>
          <h2>Historial</h2>
          <p>Actividad administrativa registrada en Digital Signage. Solo lectura.</p>
        </div>
        <span className="signage-soft-badge">{logs.length} de {totalCount} registros</span>
      </div>

      <div className="signage-log-kpis signage-history-kpis">
        <LogMetric icon="history" label="Cambios hoy" value={stats.changesToday} tone="device" SignageIcon={SignageIcon} />
        <LogMetric icon="play" label="Publicaciones" value={stats.publications} tone="online" SignageIcon={SignageIcon} />
        <LogMetric icon="edit" label="Ediciones" value={stats.edits} tone="offline" SignageIcon={SignageIcon} />
        <LogMetric icon="warning" label="Eliminaciones/archivados" value={stats.removals} tone="error" SignageIcon={SignageIcon} />
      </div>

      <div className="signage-log-toolbar signage-history-toolbar">
        <label className="signage-search">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar usuario, acción o elemento..."
          />
          <SignageIcon name="search" />
        </label>

        <label className="signage-filter">
          <SignageIcon name="filter" />
          <select value={entityFilter} onChange={(event) => onEntityFilterChange(event.target.value)}>
            {AUDIT_ENTITY_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="signage-history-ranges">
          {AUDIT_RANGE_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={rangeFilter === option.value ? "active" : ""}
              onClick={() => onRangeFilterChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="visual-outline-button signage-log-clear" onClick={onClearFilters}>
          Limpiar filtros
        </button>
      </div>

      <ActiveFilterSummary filters={activeFilters} />

      <ActivityTimeline
        kind="audit"
        logs={logs}
        emptyIcon="history"
        emptyTitle="Aún no hay actividad registrada"
        emptyHelper="Las acciones administrativas aparecerán aquí."
        sidebar={<AuditActivitySummary logs={logs} stats={stats} InfoPair={InfoPair} />}
        SignageIcon={SignageIcon}
        TypeBadge={TypeBadge}
      />
    </section>
  );
}
