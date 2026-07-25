import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import MaterialCorrectionDetail from "../components/material-corrections/MaterialCorrectionDetail";
import MaterialCorrectionFilters from "../components/material-corrections/MaterialCorrectionFilters";
import MaterialCorrectionRow from "../components/material-corrections/MaterialCorrectionRow";
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
  reorderMaterialCorrectionReports,
  subscribeToMaterialCorrectionReports,
} from "../services/materialCorrectionsService";

const EMPTY_FILTERS = {
  status: "",
  priority: "",
  level: "",
  book: "",
  unit: "",
  lesson: "",
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
  ["new", "Nuevos"],
  ["reviewing", "En revisión"],
  ["correcting", "En corrección"],
  ["publishing", "Pendientes de publicación"],
  ["urgent", "Urgentes"],
  ["completedWeek", "Completados esta semana"],
];

function updateReportQuery(reportId) {
  const url = new URL(window.location.href);
  if (reportId) url.searchParams.set("reportId", reportId);
  else url.searchParams.delete("reportId");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function MaterialCorrections() {
  const { isAdmin } = useAuth();
  const [reports, setReports] = useState([]);
  const [assignees, setAssignees] = useState([]);
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
    if (!draggedId || draggedId === targetId || sortMode !== "manual") return;
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
      await reorderMaterialCorrectionReports(mergedIds);
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
        isAdmin={isAdmin}
        onBack={closeReport}
        onDeleted={closeReport}
      />
    );
  }

  return (
    <section className="material-corrections-page">
      <header className="material-corrections-header">
        <div>
          <span>Desarrollo de Material</span>
          <h2>Correcciones de material</h2>
          <p>Recepción, corrección y publicación de errores académicos.</p>
        </div>
        <a href="/reportar-error-material" target="_blank" rel="noreferrer" className="material-public-form-link">
          Abrir formulario público
        </a>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="material-stats-grid">
        {STAT_CARDS.map(([key, label]) => (
          <article key={key} className={key === "urgent" ? "urgent" : ""}>
            <strong>{stats[key]}</strong>
            <span>{label}</span>
          </article>
        ))}
        <article>
          <strong>{stats.averageDays ? `${stats.averageDays} d` : "—"}</strong>
          <span>Tiempo promedio de resolución</span>
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
        {sortMode === "manual" && <span>{reorderBusy ? "Guardando orden…" : "Arrastra filas para ordenar"}</span>}
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
                    draggable={sortMode === "manual" && !reorderBusy}
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
