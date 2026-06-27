import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  getProjectHistory,
  restoreProject,
} from "../services/projectsService";
import {
  calculateAutomaticProgress,
  getProgressLabel,
} from "../utils/progressUtils";

export default function ProjectHistory({ onOpenProject }) {
  const { profile, isAdmin } = useAuth();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [restoringProjectId, setRestoringProjectId] = useState("");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [showFullRecent, setShowFullRecent] = useState(false);
  const [showFullTypes, setShowFullTypes] = useState(false);

  async function loadHistory() {
    setLoading(true);
    setMessage("");

    try {
      const data = await getProjectHistory();
      setProjects(data);
    } catch (error) {
      console.error(error);
      setMessage("No se pudo cargar el historial de proyectos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleRestoreProject(project) {
    if (!isAdmin) {
      setMessage("No tienes permiso para restaurar proyectos.");
      return;
    }

    const confirmRestore = window.confirm(
      `¿Seguro que deseas restaurar el proyecto "${project.title}"?\n\nEl proyecto volverá a aparecer en Todos los proyectos.`
    );

    if (!confirmRestore) return;

    setRestoringProjectId(project.id);
    setMessage("");

    try {
      await restoreProject(project.id, profile);
      await loadHistory();
      setMessage("El proyecto fue restaurado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "No se pudo restaurar el proyecto.");
    } finally {
      setRestoringProjectId("");
    }
  }

  function getHistoryType(project) {
    if (project.deleted === true || project.status === "Eliminado") {
      return "Eliminado";
    }

    if (
      project.status === "Finalizado" ||
      project.status === "Terminado" ||
      project.closedAt ||
      project.finishedAt
    ) {
      return "Finalizado";
    }

    if (project.status === "Cancelado" || project.cancelledAt) {
      return "Cancelado";
    }

    if (project.archived === true) {
      return "Archivado";
    }

    return project.status || "Sin estado";
  }

  function getHistoryDate(project) {
    if (project.deletedAt) return project.deletedAt;
    if (project.finishedAt) return project.finishedAt;
    if (project.cancelledAt) return project.cancelledAt;
    if (project.archivedAt) return project.archivedAt;
    if (project.closedAt) return project.closedAt;

    return project.updatedAt || project.createdAt;
  }

  function getHistoryUser(project) {
    if (project.deletedByName) return project.deletedByName;
    if (project.finishedByName) return project.finishedByName;
    if (project.cancelledByName) return project.cancelledByName;
    if (project.archivedByName) return project.archivedByName;

    return "No registrado";
  }

  function getProjectProgressForHistory(project) {
    const historyType = getHistoryType(project);

    if (historyType === "Finalizado") {
      return 100;
    }

    if (historyType === "Cancelado") {
      return calculateAutomaticProgress({
        ...project,
        status: project.previousStatus || project.originalStatus || project.status,
      });
    }

    if (historyType === "Eliminado") {
      return calculateAutomaticProgress({
        ...project,
        status:
          project.previousStatus ||
          project.originalStatus ||
          project.statusBeforeDelete ||
          project.lastStatus ||
          project.status,
      });
    }

    return calculateAutomaticProgress(project);
  }

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const search = searchText.trim().toLowerCase();
      const historyType = getHistoryType(project);

      const matchesSearch =
        !search ||
        project.title?.toLowerCase().includes(search) ||
        project.description?.toLowerCase().includes(search) ||
        project.responsibleArea?.toLowerCase().includes(search) ||
        project.departmentName?.toLowerCase().includes(search) ||
        project.assignedToName?.toLowerCase().includes(search) ||
        getHistoryUser(project).toLowerCase().includes(search) ||
        historyType.toLowerCase().includes(search);

      const matchesStatus =
        statusFilter === "Todos" || historyType === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [projects, searchText, statusFilter]);

  const metrics = useMemo(() => {
    return {
      total: projects.length,
      deleted: projects.filter(
        (project) => getHistoryType(project) === "Eliminado"
      ).length,
      finished: projects.filter(
        (project) => getHistoryType(project) === "Finalizado"
      ).length,
      cancelled: projects.filter(
        (project) => getHistoryType(project) === "Cancelado"
      ).length,
    };
  }, [projects]);

  const typeSummary = useMemo(() => {
    const types = ["Eliminado", "Finalizado", "Cancelado", "Archivado"];

    return types
      .map((type) => {
        const count = projects.filter((project) => getHistoryType(project) === type)
          .length;

        return {
          type,
          count,
          percentage: projects.length === 0 ? 0 : Math.round((count / projects.length) * 100),
        };
      })
      .filter((item) => item.count > 0);
  }, [projects]);

  const visibleTypeSummary = showFullTypes ? typeSummary : typeSummary.slice(0, 4);

  const recentHistory = useMemo(() => {
    return projects
      .slice()
      .sort((a, b) => {
        const dateA = parseDate(getHistoryDate(a));
        const dateB = parseDate(getHistoryDate(b));

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return dateB.getTime() - dateA.getTime();
      });
  }, [projects]);

  const visibleRecent = showFullRecent ? recentHistory : recentHistory.slice(0, 4);

  function clearFilters() {
    setSearchText("");
    setStatusFilter("Todos");
  }

  if (loading) {
    return (
      <div className="project-history-redesign">
        <div className="dashboard-loading-card">Cargando historial...</div>
      </div>
    );
  }

  return (
    <div className="project-history-redesign">
      <section className="module-topbar project-history-module-topbar">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <HistoryIcon name="history" />
          </span>

          <div className="module-topbar-copy">
            <p className="module-topbar-kicker">Administración</p>
            <h1>Historial de proyectos</h1>
            <p>
              Consulta proyectos eliminados, finalizados, cancelados o archivados y restaura registros cuando sea necesario.
            </p>
          </div>
        </div>

        <label className="module-topbar-search project-history-topbar-search">
          <span>
            <HistoryIcon name="search" />
          </span>
          <input
            type="text"
            placeholder="Buscar por proyecto, responsable, área o tipo..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
      </section>

      {message && <div className="message-box">{message}</div>}

      <section className="project-history-metrics-grid">
        <HistoryMetric
          icon="archive"
          value={metrics.total}
          title="Total historial"
          detail="Registros conservados"
          color="blue"
        />

        <HistoryMetric
          icon="trash"
          value={metrics.deleted}
          title="Eliminados"
          detail="Movidos al historial"
          color="red"
        />

        <HistoryMetric
          icon="check"
          value={metrics.finished}
          title="Finalizados"
          detail="Cerrados correctamente"
          color="green"
        />

        <HistoryMetric
          icon="x"
          value={metrics.cancelled}
          title="Cancelados"
          detail="Detenidos antes del cierre"
          color="orange"
        />
      </section>

      <section className="project-history-filter-panel">
        <div className="project-history-filter-top">
          <div className="project-history-panel-heading compact">
            <span>
              <HistoryIcon name="filter" />
            </span>

            <div>
              <h2>Filtros de historial</h2>
              <p>Refina la consulta por tipo de registro.</p>
            </div>
          </div>

          <div className="project-history-quick-tabs">
            {["Todos", "Eliminado", "Finalizado", "Cancelado", "Archivado"].map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  className={statusFilter === filter ? "active" : ""}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            className="project-history-clear-button"
            onClick={clearFilters}
          >
            <HistoryIcon name="refresh" />
            Limpiar filtros
          </button>
        </div>
      </section>

      <div className="project-history-workspace-grid">
        <main className="project-history-main-column">
          <section className="project-history-panel project-history-table-panel">
            <div className="project-history-panel-header">
              <div className="project-history-panel-heading">
                <span>
                  <HistoryIcon name="list" />
                </span>

                <div>
                  <h2>Proyectos en historial</h2>
                  <p>
                    Mostrando {filteredProjects.length} de {projects.length} proyecto(s)
                  </p>
                </div>
              </div>

              <span className="project-history-count-badge">
                {filteredProjects.length} visibles
              </span>
            </div>

            <div className="visual-table-wrap project-history-table-wrap">
              <table className="visual-table modern-projects-table project-history-modern-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Área</th>
                    <th>Responsable</th>
                    <th>Tipo</th>
                    <th>Fecha</th>
                    <th>Registrado por</th>
                    <th>Avance</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredProjects.map((project) => {
                    const historyType = getHistoryType(project);
                    const automaticProgress = getProjectProgressForHistory(project);
                    const progressLabel = getProgressLabel(automaticProgress);

                    return (
                      <tr key={project.id}>
                        <td>
                          <div className="project-name-cell project-history-name-cell">
                            <span className="project-table-icon project-history-table-icon">
                              <HistoryIcon name="project" />
                            </span>

                            <div>
                              <strong>{project.title}</strong>
                              <small>{project.id.slice(0, 8).toUpperCase()}</small>
                            </div>
                          </div>
                        </td>

                        <td>{project.responsibleArea || project.departmentName || "Sin área"}</td>

                        <td>
                          <div className="collaborator-cell">
                            <span className="avatar-mini project-history-responsible-avatar">
                              {getInitials(project.assignedToName)}
                            </span>

                            {project.assignedToName || "Sin responsable"}
                          </div>
                        </td>

                        <td>
                          <Badge color={getBadgeColor(historyType)}>
                            {historyType}
                          </Badge>
                        </td>

                        <td>
                          <strong>{formatDate(getHistoryDate(project))}</strong>
                        </td>

                        <td>{getHistoryUser(project)}</td>

                        <td>
                          <div className="table-progress project-history-progress-cell">
                            <div className="project-history-progress-top">
                              <strong>{automaticProgress}%</strong>
                              <small>{progressLabel}</small>
                            </div>

                            <div className="area-progress-track">
                              <div
                                className="area-progress-fill"
                                style={{ width: `${automaticProgress}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        <td>
                          <div className="table-actions project-history-table-actions">
                            <button type="button" onClick={() => onOpenProject(project.id)}>
                              Ver
                            </button>

                            {isAdmin && historyType === "Eliminado" && (
                              <button
                                type="button"
                                className="restore-table-button"
                                disabled={restoringProjectId === project.id}
                                onClick={() => handleRestoreProject(project)}
                              >
                                {restoringProjectId === project.id
                                  ? "Restaurando..."
                                  : "Restaurar"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredProjects.length === 0 && (
                <EmptyState text="No hay proyectos en el historial con estos filtros." />
              )}
            </div>
          </section>
        </main>

        <aside className="project-history-side-column">
          <section className="project-history-panel project-history-side-panel">
            <SectionHeader
              icon="chart"
              title="Resumen por tipo"
              action={showFullTypes ? "Ver menos" : "Ver detalle"}
              onAction={() => setShowFullTypes((current) => !current)}
            />

            <div className="project-history-type-list">
              {visibleTypeSummary.length === 0 ? (
                <EmptyState text="No hay tipos de historial para mostrar." />
              ) : (
                visibleTypeSummary.map((item) => (
                  <div className="project-history-type-row" key={item.type}>
                    <div>
                      <strong>{item.type}</strong>
                      <small>{item.count} proyecto(s)</small>
                    </div>

                    <div className="area-progress-track">
                      <div
                        className={`area-progress-fill ${getTypeFillClass(item.type)}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>

                    <span>{item.percentage}%</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="project-history-panel project-history-side-panel">
            <SectionHeader
              icon="clock"
              title="Últimos movimientos"
              action={showFullRecent ? "Ver menos" : "Ver todos"}
              onAction={() => setShowFullRecent((current) => !current)}
            />

            <div className="project-history-recent-list">
              {visibleRecent.length === 0 ? (
                <EmptyState text="No hay movimientos recientes." />
              ) : (
                visibleRecent.map((project) => {
                  const historyType = getHistoryType(project);

                  return (
                    <button
                      type="button"
                      className="project-history-recent-card"
                      key={project.id}
                      onClick={() => onOpenProject(project.id)}
                    >
                      <span>
                        <HistoryIcon name="project" />
                      </span>

                      <div>
                        <strong>{project.title}</strong>

                        <div>
                          <Badge color={getBadgeColor(historyType)}>
                            {historyType}
                          </Badge>
                          <small>{formatDate(getHistoryDate(project))}</small>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="project-history-panel project-history-info-panel">
            <div className="project-history-info-icon">
              <HistoryIcon name="info" />
            </div>
            <h3>Historial seguro</h3>
            <p>
              Los proyectos eliminados se conservan aquí para consulta y, si eres administrador, pueden restaurarse sin perder su trazabilidad.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function HistoryMetric({ icon, value, title, detail, color }) {
  return (
    <div className={`project-history-metric-card ${color}`}>
      <div className="project-history-metric-icon">
        <HistoryIcon name={icon} />
      </div>

      <div>
        <strong>{value}</strong>
        <span>{title}</span>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, action, onAction }) {
  return (
    <div className="project-history-side-header">
      <div>
        <span>
          <HistoryIcon name={icon} />
        </span>
        <h3>{title}</h3>
      </div>

      {action && (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state project-history-empty-state">
      <div>
        <HistoryIcon name="empty" />
      </div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function HistoryIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    className: "project-history-svg-icon",
    "aria-hidden": "true",
  };

  const icons = {
    history: (
      <svg {...commonProps}>
        <path d="M7 7h7a6 6 0 1 1-5.2 9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7V3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7H3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    search: (
      <svg {...commonProps}>
        <path d="M10.8 17.2a6.4 6.4 0 1 0 0-12.8 6.4 6.4 0 0 0 0 12.8Z" stroke="currentColor" strokeWidth="1.9" />
        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
    archive: (
      <svg {...commonProps}>
        <path d="M4 7.3h16v11c0 1-.8 1.7-1.7 1.7H5.7c-1 0-1.7-.8-1.7-1.7v-11Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 5.7c0-.9.7-1.7 1.7-1.7h13.6c.9 0 1.7.7 1.7 1.7v1.6h-17V5.7ZM9 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    trash: (
      <svg {...commonProps}>
        <path d="M5 7h14M9 7V5.4C9 4.6 9.6 4 10.4 4h3.2c.8 0 1.4.6 1.4 1.4V7M18 7l-.7 11.2c-.1 1-.8 1.8-1.8 1.8h-7c-1 0-1.8-.8-1.8-1.8L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    check: (
      <svg {...commonProps}>
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    x: (
      <svg {...commonProps}>
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    filter: (
      <svg {...commonProps}>
        <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
    refresh: (
      <svg {...commonProps}>
        <path d="M19 8a7 7 0 1 0 1 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M19 4v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    list: (
      <svg {...commonProps}>
        <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
    project: (
      <svg {...commonProps}>
        <path d="M5 5.8C5 4.8 5.8 4 6.8 4h7.4L19 8.8v9.4c0 1-.8 1.8-1.8 1.8H6.8c-1 0-1.8-.8-1.8-1.8V5.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 4v5h5M8.5 13h7M8.5 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    chart: (
      <svg {...commonProps}>
        <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    clock: (
      <svg {...commonProps}>
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    info: (
      <svg {...commonProps}>
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 10.6v5.2M12 7.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
    empty: (
      <svg {...commonProps}>
        <path d="M12 4 13.7 9.4 19 11l-5.3 1.6L12 18l-1.7-5.4L5 11l5.3-1.6L12 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  };

  return icons[name] || icons.project;
}

function getInitials(name) {
  return (name || "?")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
}

function getBadgeColor(type) {
  if (type === "Eliminado") return "red";
  if (type === "Finalizado") return "green";
  if (type === "Cancelado") return "orange";
  if (type === "Archivado") return "blue";

  return "gold";
}

function getTypeFillClass(type) {
  if (type === "Eliminado") return "project-history-fill-red";
  if (type === "Finalizado") return "project-history-fill-green";
  if (type === "Cancelado") return "project-history-fill-orange";
  if (type === "Archivado") return "project-history-fill-blue";

  return "";
}

function parseDate(value) {
  if (!value) return null;

  const date =
    typeof value === "string"
      ? new Date(`${value}T00:00:00`)
      : value?.toDate?.() || new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function formatDate(value) {
  const date = parseDate(value);

  if (!date) return "Sin fecha";

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
