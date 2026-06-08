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
        project.assignedToName?.toLowerCase().includes(search) ||
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

  if (loading) {
    return (
      <div className="visual-page">
        <div className="dashboard-loading-card">Cargando historial...</div>
      </div>
    );
  }

  return (
    <div className="visual-page">
      <div className="visual-page-header">
        <div>
          <h2>Historial de proyectos</h2>
          <p>
            Consulta proyectos eliminados, finalizados, cancelados o archivados.
          </p>
        </div>

        <div className="visual-page-actions">
          <div className="visual-search wide">
            <span>⌕</span>
            <input
              type="text"
              placeholder="Buscar en historial..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}

      <div className="all-metrics-grid">
        <SimpleMetric
          icon="▣"
          value={metrics.total}
          title="Total historial"
          detail="Proyectos registrados"
          color="blue"
        />

        <SimpleMetric
          icon="🗑"
          value={metrics.deleted}
          title="Eliminados"
          detail="Movidos al historial"
          color="red"
        />

        <SimpleMetric
          icon="✓"
          value={metrics.finished}
          title="Finalizados"
          detail="Proyectos cerrados"
          color="green"
        />

        <SimpleMetric
          icon="⨯"
          value={metrics.cancelled}
          title="Cancelados"
          detail="Proyectos detenidos"
          color="orange"
        />
      </div>

      <section className="visual-card filters-card">
        <div className="filters-card-top">
          <div className="section-title-row no-border no-margin">
            <span className="section-title-icon section-title-blue">☷</span>
            <h3>Filtros de historial</h3>
          </div>

          <div className="filter-pills compact">
            {["Todos", "Eliminado", "Finalizado", "Cancelado", "Archivado"].map(
              (filter) => (
                <button
                  key={filter}
                  className={statusFilter === filter ? "active" : ""}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter}
                </button>
              )
            )}
          </div>

          <button
            className="clear-filter-button"
            onClick={() => {
              setSearchText("");
              setStatusFilter("Todos");
            }}
          >
            ↻ Limpiar filtros
          </button>
        </div>
      </section>

      <section className="visual-card">
        <div className="list-header">
          <div className="section-title-row no-border no-margin">
            <span className="section-title-icon section-title-blue">▦</span>
            <h3>Proyectos en historial ({filteredProjects.length})</h3>
          </div>
        </div>

        <div className="visual-table-wrap">
          <table className="visual-table modern-projects-table">
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
                      <div className="project-name-cell">
                        <span className="project-table-icon">▧</span>

                        <div>
                          <strong>{project.title}</strong>
                          <small>{project.id.slice(0, 8).toUpperCase()}</small>
                        </div>
                      </div>
                    </td>

                    <td>{project.responsibleArea || "Sin área"}</td>

                    <td>
                      <div className="collaborator-cell">
                        <span className="avatar-mini">
                          {(project.assignedToName || "?")
                            .split(" ")
                            .map((word) => word[0])
                            .join("")
                            .slice(0, 2)}
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
                      <div className="table-progress">
                        <div className="table-progress-top">
                          <strong>{automaticProgress}%</strong>
                          <small>{progressLabel}</small>
                        </div>

                        <div className="area-progress-track">
                          <div
                            className="area-progress-fill"
                            style={{
                              width: `${automaticProgress}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className="table-actions">
                        <button onClick={() => onOpenProject(project.id)}>
                          Ver
                        </button>

                        {isAdmin && historyType === "Eliminado" && (
                          <button
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
            <div className="empty-state">
              <div>▯</div>
              <p>No hay proyectos en el historial con estos filtros.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SimpleMetric({ icon, value, title, detail, color }) {
  return (
    <div className={`simple-metric simple-${color}`}>
      <div className="simple-metric-icon">{icon}</div>

      <div>
        <strong>{value}</strong>
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function getBadgeColor(type) {
  if (type === "Eliminado") return "red";
  if (type === "Finalizado") return "green";
  if (type === "Cancelado") return "orange";
  if (type === "Archivado") return "blue";

  return "gold";
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