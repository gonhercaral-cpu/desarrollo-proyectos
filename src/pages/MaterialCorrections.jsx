import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import MaterialCorrectionDetail from "../components/material-corrections/MaterialCorrectionDetail";
import MaterialCorrectionFilters from "../components/material-corrections/MaterialCorrectionFilters";
import MaterialCorrectionRow from "../components/material-corrections/MaterialCorrectionRow";
import MaterialCorrectionIcon from "../components/material-corrections/MaterialCorrectionIcon";
import {
  MATERIAL_CORRECTION_GROUP_OPTIONS,
  MATERIAL_CORRECTION_SORT_OPTIONS,
} from "../material-corrections/constants";
import {
  applyMaterialCorrectionFilters,
  calculateMaterialCorrectionStats,
  groupMaterialCorrectionReports,
  sortMaterialCorrectionReports,
} from "../material-corrections/utils";
import {
  listMaterialCorrectionAssignees,
  listActiveMaterialCorrectionLevels,
  reorderMaterialCorrectionReports,
  subscribeToMaterialCorrectionReports,
} from "../services/materialCorrectionsService";

const EMPTY_FILTERS = {
  status: "",
  priority: "",
  level: "",
  unit: "",
  materialType: "",
  errorType: "",
  reporter: "",
  campus: "",
  assigned: "",
  evidence: "",
  dateFrom: "",
  dateTo: "",
  pendingInPerson: false,
  pendingOnline: false,
};

const STAT_CARDS = [
  { key: "new", label: "Nuevos", hint: "Sin revisar", icon: "new", tone: "total" },
  { key: "reviewing", label: "En revisión", hint: "Validación activa", icon: "review", tone: "pending" },
  { key: "correcting", label: "En corrección", hint: "Trabajo en curso", icon: "correction", tone: "process" },
  { key: "publishing", label: "Pendientes de publicación", hint: "Por distribuir", icon: "publish", tone: "publish" },
  { key: "urgent", label: "Urgentes", hint: "Atención prioritaria", icon: "urgent", tone: "urgent" },
  { key: "completedWeek", label: "Completados esta semana", hint: "Últimos 7 días", icon: "completed", tone: "delivered" },
];

function updateReportQuery(reportId) {
  const url = new URL(window.location.href);
  if (reportId) url.searchParams.set("reportId", reportId);
  else url.searchParams.delete("reportId");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function MaterialCorrections() {
  const { isAdmin, uid } = useAuth();
  const [reports, setReports] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [levels, setLevels] = useState([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortMode, setSortMode] = useState("recent");
  const [groupMode, setGroupMode] = useState("none");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState(
    () => new URLSearchParams(window.location.search).get("reportId") || ""
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reorderBusy, setReorderBusy] = useState(false);
  const draggedIdRef = useRef("");

  useEffect(() => {
    const unsubscribe = subscribeToMaterialCorrectionReports(
      (nextReports) => {
        setReports(nextReports);
        setLoading(false);
      },
      (subscriptionError) => {
        setError(
          subscriptionError?.code === "permission-denied"
            ? "Reglas pendientes de despliegue o perfil sin permiso para Correcciones de material."
            : subscriptionError.message || "No se pudieron cargar reportes."
        );
        setLoading(false);
      }
    );
    listMaterialCorrectionAssignees()
      .then(setAssignees)
      .catch((assigneeError) => setError(assigneeError.message));
    listActiveMaterialCorrectionLevels()
      .then(setLevels)
      .catch((levelError) => setError(levelError.message));
    return unsubscribe;
  }, []);

  const stats = useMemo(() => calculateMaterialCorrectionStats(reports), [reports]);
  const filtered = useMemo(
    () => applyMaterialCorrectionFilters(reports, filters, search),
    [reports, filters, search]
  );
  const ordered = useMemo(
    () => sortMaterialCorrectionReports(filtered, sortMode),
    [filtered, sortMode]
  );
  const grouped = useMemo(
    () => groupMaterialCorrectionReports(ordered, groupMode),
    [ordered, groupMode]
  );

  function openReport(reportId) {
    setSelectedReportId(reportId);
    updateReportQuery(reportId);
  }

  function closeReport() {
    setSelectedReportId("");
    updateReportQuery("");
  }

  async function handleDrop(targetId) {
    const draggedId = draggedIdRef.current;
    draggedIdRef.current = "";
    if (!isAdmin || !draggedId || draggedId === targetId || sortMode !== "manual") return;
    const visibleIds = ordered.map((report) => report.id);
    const from = visibleIds.indexOf(draggedId);
    const to = visibleIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const movedVisibleIds = [...visibleIds];
    movedVisibleIds.splice(from, 1);
    movedVisibleIds.splice(to, 0, draggedId);

    const allActive = sortMaterialCorrectionReports(
      reports.filter((report) => !report.deleted && !report.archived),
      "manual"
    ).map((report) => report.id);
    const visibleSet = new Set(visibleIds);
    let visibleIndex = 0;
    const mergedIds = allActive.map((id) => (
      visibleSet.has(id) ? movedVisibleIds[visibleIndex++] : id
    ));

    setReorderBusy(true);
    setError("");
    try {
      await reorderMaterialCorrectionReports(mergedIds, { isAdmin });
    } catch (reorderError) {
      setError(reorderError.message);
    } finally {
      setReorderBusy(false);
    }
  }

  if (selectedReportId) {
    return (
      <MaterialCorrectionDetail
        reportId={selectedReportId}
        assignees={assignees}
        levels={levels}
        isAdmin={isAdmin}
        currentUserId={uid}
        onBack={closeReport}
        onDeleted={closeReport}
      />
    );
  }

  return (
    <section className="material-corrections-page purchase-requests-page purchase-redesign visual-page">
      <header className="module-topbar purchase-module-topbar material-corrections-module-topbar">
        <div className="module-topbar-main">
          <div className="module-topbar-module-icon purchase-topbar-module-icon">
            <MaterialCorrectionIcon className="purchase-svg-icon" />
          </div>
          <div className="module-topbar-copy">
            <p className="module-topbar-kicker">DESARROLLO DE MATERIAL</p>
            <h1>Correcciones de material</h1>
            <p>Recepción, corrección y publicación de errores académicos.</p>
          </div>
        </div>
        <div className="module-topbar-actions purchase-topbar-actions compact">
          <a
            href="/reportar-error-material"
            target="_blank"
            rel="noreferrer"
            className="module-topbar-button primary purchase-topbar-button material-public-form-link"
          >
            <MaterialCorrectionIcon name="new" className="purchase-svg-icon" />
            Abrir formulario público
          </a>
        </div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="material-stats-grid purchase-module-metrics-grid">
        {STAT_CARDS.map((card) => (
          <article
            key={card.key}
            className={`material-stat-card purchase-module-metric-card metric-${card.tone}`}
          >
            <MaterialCorrectionIcon name={card.icon} className="material-stat-icon" />
            <div>
              <span>{card.label}</span>
              <strong>{stats[card.key]}</strong>
              <p>{card.hint}</p>
            </div>
          </article>
        ))}
        <article className="material-stat-card purchase-module-metric-card metric-time">
          <MaterialCorrectionIcon name="time" className="material-stat-icon" />
          <div>
            <span>Tiempo promedio</span>
            <strong>{stats.averageDays ? `${stats.averageDays} d` : "—"}</strong>
            <p>Resolución total</p>
          </div>
        </article>
      </div>

      <section className="material-corrections-toolbar">
        <label className="material-search">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Folio, descripción, material, página, unidad o reportante"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Ordenar
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
            {MATERIAL_CORRECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Agrupar
          <select value={groupMode} onChange={(event) => setGroupMode(event.target.value)}>
            {MATERIAL_CORRECTION_GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={() => setFiltersOpen((current) => !current)}>
          {filtersOpen ? "Ocultar filtros" : "Filtros"}
        </button>
      </section>

      {filtersOpen && (
        <MaterialCorrectionFilters
          filters={filters}
          reports={reports}
          assignees={assignees}
          onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
          onClear={() => setFilters(EMPTY_FILTERS)}
        />
      )}

      <div className="material-list-meta">
        <span>{ordered.length} reporte{ordered.length === 1 ? "" : "s"}</span>
        {sortMode === "manual" && (
          <span>
            {isAdmin
              ? (reorderBusy ? "Guardando orden…" : "Arrastra filas para ordenar")
              : "Orden manual administrado por Dirección"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="material-empty-state">Cargando reportes…</div>
      ) : ordered.length === 0 ? (
        <div className="material-empty-state">
          <strong>Sin reportes</strong>
          <p>No hay resultados con búsqueda y filtros actuales.</p>
        </div>
      ) : (
        <div className="material-correction-groups">
          {grouped.map((group) => (
            <section key={group.key}>
              {group.label && <h3>{group.label} <span>{group.reports.length}</span></h3>}
              <div className="material-correction-list">
                {group.reports.map((report) => (
                  <MaterialCorrectionRow
                    key={report.id}
                    report={report}
                    onOpen={openReport}
                    draggable={isAdmin && sortMode === "manual" && !reorderBusy}
                    onDragStart={() => {
                      draggedIdRef.current = report.id;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(report.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
