import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  getActiveProjects,
  softDeleteProject,
} from "../services/projectsService";
import { subscribeToUnreadProjectNotifications } from "../services/notificationsService";
import { calculateAutomaticProgress } from "../utils/progressUtils";
import { buildUnreadActivityByProject } from "../utils/projectNotificationActivity";
import UserAvatar from "../components/UserAvatar";
import ProjectActivityIndicator from "../components/ProjectActivityIndicator";

export default function AllProjects({ onOpenProject, onEditProject }) {
  const { profile, currentUser, firebaseUser, isAdmin } = useAuth();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [unreadProjectNotifications, setUnreadProjectNotifications] = useState([]);

  const [searchText, setSearchText] = useState("");
  const [activeQuickFilter, setActiveQuickFilter] = useState("Todos");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showFullDepartmentSummary, setShowFullDepartmentSummary] =
    useState(false);
  const [showFullRecentProjects, setShowFullRecentProjects] = useState(false);
  const [showFullAlerts, setShowFullAlerts] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setMessage("");

    try {
      const data = await getActiveProjects();
      setProjects(data);
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron cargar todos los proyectos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const currentUserId =
    currentUser?.uid ||
    firebaseUser?.uid ||
    profile?.uid ||
    profile?.id ||
    "";

  useEffect(() => {
    return subscribeToUnreadProjectNotifications(
      currentUserId,
      setUnreadProjectNotifications
    );
  }, [currentUserId]);

  const unreadActivityByProject = useMemo(
    () => buildUnreadActivityByProject(unreadProjectNotifications),
    [unreadProjectNotifications]
  );

  async function handleDeleteProject(project) {
    if (!isAdmin) {
      setMessage("No tienes permiso para eliminar proyectos.");
      return;
    }

    const confirmDelete = window.confirm(
      `¿Seguro que deseas eliminar el proyecto "${project.title}"?\n\nNo se borrará definitivamente. Se moverá al historial y podrás restaurarlo después.`
    );

    if (!confirmDelete) return;

    setDeletingProjectId(project.id);
    setMessage("");

    try {
      await softDeleteProject(project.id, profile);
      await loadProjects();
      setMessage("El proyecto fue movido al historial correctamente.");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "No se pudo eliminar el proyecto.");
    } finally {
      setDeletingProjectId("");
    }
  }

  function getDaysDifference(deadline) {
    const date = parseDate(deadline);

    if (!date) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    date.setHours(0, 0, 0, 0);

    const diff = date.getTime() - today.getTime();

    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function isClosedProject(project) {
    return (
      project.status === "Finalizado" ||
      project.status === "Terminado" ||
      project.status === "Cancelado" ||
      project.status === "Eliminado" ||
      project.deleted === true
    );
  }

  function isOverdue(project) {
    const days = getDaysDifference(project.deadline);

    return days !== null && days < 0 && !isClosedProject(project);
  }

  function renderDeadlineLabel(project) {
    const days = getDaysDifference(project.deadline);

    if (days === null) return "Sin fecha";
    if (days < 0) return `${Math.abs(days)} día(s) vencido`;
    if (days === 0) return "Vence hoy";

    return `${days} días restantes`;
  }

  const departments = useMemo(() => {
    return [
      ...new Set(
        projects
          .map((project) => getProjectDepartmentName(project))
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
  }, [projects]);

  const responsiblePeople = useMemo(() => {
    return [
      ...new Set(
        projects.map((project) => project.assignedToName).filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const search = searchText.trim().toLowerCase();
      const departmentName = getProjectDepartmentName(project);

      const matchesSearch =
        !search ||
        project.title?.toLowerCase().includes(search) ||
        project.description?.toLowerCase().includes(search) ||
        departmentName.toLowerCase().includes(search) ||
        project.responsibleArea?.toLowerCase().includes(search) ||
        project.assignedToName?.toLowerCase().includes(search);

      const matchesQuick =
        activeQuickFilter === "Todos" ||
        (activeQuickFilter === "En curso" && !isClosedProject(project)) ||
        (activeQuickFilter === "Por revisar" &&
          project.status === "Listo para revisión") ||
        (activeQuickFilter === "Atrasados" && isOverdue(project));

      const matchesDepartment =
        !departmentFilter || departmentName === departmentFilter;

      const matchesResponsible =
        !responsibleFilter || project.assignedToName === responsibleFilter;

      const matchesPriority =
        !priorityFilter || project.priority === priorityFilter;

      const matchesStatus = !statusFilter || project.status === statusFilter;

      return (
        matchesSearch &&
        matchesQuick &&
        matchesDepartment &&
        matchesResponsible &&
        matchesPriority &&
        matchesStatus
      );
    });
  }, [
    projects,
    searchText,
    activeQuickFilter,
    departmentFilter,
    responsibleFilter,
    priorityFilter,
    statusFilter,
  ]);

  const metrics = useMemo(() => {
    const total = projects.length;

    const active = projects.filter((project) => !isClosedProject(project)).length;

    const overdue = projects.filter(isOverdue).length;

    const highPriority = projects.filter(
      (project) => project.priority === "Alta" && !isClosedProject(project)
    ).length;

    const review = projects.filter(
      (project) => project.status === "Listo para revisión"
    ).length;

    return { total, active, overdue, highPriority, review };
  }, [projects]);

  const departmentSummary = useMemo(() => {
    const map = new Map();

    projects.forEach((project) => {
      const department = getProjectDepartmentName(project) || "Sin departamento";

      if (!map.has(department)) {
        map.set(department, {
          department,
          total: 0,
          progressTotal: 0,
        });
      }

      const item = map.get(department);

      item.total += 1;
      item.progressTotal += calculateAutomaticProgress(project);
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        average:
          item.total === 0 ? 0 : Math.round(item.progressTotal / item.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [projects]);

  const visibleDepartmentSummary = showFullDepartmentSummary
    ? departmentSummary
    : departmentSummary.slice(0, 5);

  const recentProjects = useMemo(() => {
    return projects
      .slice()
      .sort((a, b) => {
        const dateA = parseDate(a.updatedAt || a.createdAt);
        const dateB = parseDate(b.updatedAt || b.createdAt);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return dateB.getTime() - dateA.getTime();
      });
  }, [projects]);

  const visibleRecentProjects = showFullRecentProjects
    ? recentProjects
    : recentProjects.slice(0, 4);

  const alertItems = useMemo(() => {
    const overdueProjects = projects.filter(isOverdue);

    const highPriorityProjects = projects.filter(
      (project) => project.priority === "Alta" && !isClosedProject(project)
    );

    const reviewProjects = projects.filter(
      (project) => project.status === "Listo para revisión"
    );

    const correctionProjects = projects.filter(
      (project) => project.status === "Correcciones solicitadas"
    );

    return [
      {
        type: "red",
        title: `${overdueProjects.length} proyectos atrasados`,
        detail: "Requieren seguimiento inmediato.",
        projects: overdueProjects,
      },
      {
        type: "orange",
        title: `${highPriorityProjects.length} proyectos de alta prioridad`,
        detail: "Enfócate en prioridades estratégicas.",
        projects: highPriorityProjects,
      },
      {
        type: "gold",
        title: `${reviewProjects.length} proyectos por revisar`,
        detail: "Están listos para revisión administrativa.",
        projects: reviewProjects,
      },
      {
        type: "purple",
        title: `${correctionProjects.length} proyectos con correcciones`,
        detail: "Requieren seguimiento después de observaciones.",
        projects: correctionProjects,
      },
    ];
  }, [projects]);

  const visibleAlertItems = showFullAlerts ? alertItems : alertItems.slice(0, 2);

  function clearFilters() {
    setSearchText("");
    setActiveQuickFilter("Todos");
    setDepartmentFilter("");
    setResponsibleFilter("");
    setPriorityFilter("");
    setStatusFilter("");
  }

  if (loading) {
    return (
      <div className="all-projects-redesign">
        <div className="dashboard-loading-card">Cargando proyectos...</div>
      </div>
    );
  }

  return (
    <div className="all-projects-redesign">
      <section className="module-topbar all-projects-module-topbar">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <ProjectIcon name="projects" />
          </span>

          <div>
            <p className="module-topbar-kicker">Administración</p>
            <h1>Todos los proyectos</h1>
            <p>
              Supervisa proyectos activos, responsables, avances, alertas y prioridades del área.
            </p>
          </div>
        </div>

        <label className="module-topbar-search all-projects-topbar-search">
          <span>
            <ProjectIcon name="search" />
          </span>
          <input
            type="text"
            placeholder="Buscar proyecto, responsable o departamento..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
      </section>

      {message && <div className="message-box">{message}</div>}

      <section className="all-projects-metrics-grid">
        <ProjectMetric
          icon="folder"
          value={metrics.total}
          title="Total activos"
          detail="Proyectos visibles"
          color="blue"
        />

        <ProjectMetric
          icon="check"
          value={metrics.active}
          title="En operación"
          detail="No cerrados"
          color="green"
        />

        <ProjectMetric
          icon="alert"
          value={metrics.overdue}
          title="Atrasados"
          detail="Requieren seguimiento"
          color="red"
        />

        <ProjectMetric
          icon="flag"
          value={metrics.highPriority}
          title="Alta prioridad"
          detail="Prioridades activas"
          color="orange"
        />

        <ProjectMetric
          icon="review"
          value={metrics.review}
          title="Por revisar"
          detail="Revisión administrativa"
          color="teal"
        />
      </section>

      <section className="all-projects-panel all-projects-alerts-wide-panel">
        <SectionHeader
          icon="alert"
          title="Alertas importantes"
          action={showFullAlerts ? "Ver menos" : "Ver todas"}
          onAction={() => setShowFullAlerts((current) => !current)}
        />

        <div className="all-projects-alert-list all-projects-alert-list-wide">
          {visibleAlertItems.map((alert) => (
            <div
              className={`all-projects-alert-card all-projects-alert-${alert.type}`}
              key={alert.title}
            >
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>

              {alert.projects.length > 0 && (
                <div className="alert-project-links">
                  {alert.projects.slice(0, 3).map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => onOpenProject(project.id)}
                    >
                      {project.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="all-projects-filter-panel">
        <div className="all-projects-filter-top">
          <div className="all-projects-panel-heading compact">
            <span>
              <ProjectIcon name="filter" />
            </span>
            <div>
              <h2>Filtros de trabajo</h2>
              <p>Refina la vista sin salir del tablero.</p>
            </div>
          </div>

          <div className="all-projects-quick-tabs">
            {["Todos", "En curso", "Por revisar", "Atrasados"].map((filter) => (
              <button
                key={filter}
                type="button"
                className={activeQuickFilter === filter ? "active" : ""}
                onClick={() => setActiveQuickFilter(filter)}
              >
                {filter}
                {filter === "Atrasados" && <span className="red-dot" />}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="all-projects-clear-button"
            onClick={clearFilters}
          >
            <ProjectIcon name="refresh" />
            Limpiar filtros
          </button>
        </div>

        <div className="all-projects-filter-grid">
          <SelectFilter
            label="Departamento"
            value={departmentFilter}
            onChange={setDepartmentFilter}
            placeholder="Todos los departamentos"
            options={departments}
          />

          <SelectFilter
            label="Responsable"
            value={responsibleFilter}
            onChange={setResponsibleFilter}
            placeholder="Todos los responsables"
            options={responsiblePeople}
          />

          <SelectFilter
            label="Prioridad"
            value={priorityFilter}
            onChange={setPriorityFilter}
            placeholder="Todas las prioridades"
            options={["Alta", "Media", "Baja"]}
          />

          <SelectFilter
            label="Estado"
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="Todos los estados"
            options={[
              "Por iniciar",
              "En planeación",
              "En proceso",
              "En espera de información",
              "Listo para revisión",
              "Correcciones solicitadas",
              "Aprobado para entrega",
              "Pausado",
            ]}
          />
        </div>
      </section>

      <div className="all-projects-workspace-grid">
        <main className="all-projects-main-column">
          <section className="all-projects-panel all-projects-table-panel">
            <div className="all-projects-panel-header">
              <div className="all-projects-panel-heading">
                <span>
                  <ProjectIcon name="list" />
                </span>
                <div>
                  <h2>Proyectos registrados</h2>
                  <p>Mostrando {filteredProjects.length} de {projects.length} proyecto(s)</p>
                </div>
              </div>

              <div className="all-projects-count-badge">
                {filteredProjects.length} visibles
              </div>
            </div>

            <div className="visual-table-wrap all-projects-table-wrap">
              <table className="visual-table modern-projects-table all-projects-modern-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Departamento</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Prioridad</th>
                    <th>Fecha límite</th>
                    <th>Avance</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredProjects.map((project) => {
                    const progress = calculateAutomaticProgress(project);
                    const unreadActivity = unreadActivityByProject[project.id];

                    return (
                      <tr
                        key={project.id}
                        className={unreadActivity ? "project-has-new-activity" : ""}
                      >
                        <td data-label="Proyecto">
                          <div className="project-name-cell all-project-name-cell">
                            <span className="project-table-icon all-project-table-icon">
                              <ProjectIcon name="project" />
                            </span>

                            <div>
                              <strong>{project.title}</strong>
                              <small>{project.id.slice(0, 8).toUpperCase()}</small>
                              <ProjectActivityIndicator
                                activity={unreadActivity}
                                compact
                              />
                            </div>
                          </div>
                        </td>

                        <td data-label="Departamento">{getProjectDepartmentName(project)}</td>

                        <td data-label="Responsable">
                          <div className="collaborator-cell">
                            <span className="avatar-mini all-projects-responsible-avatar">
                              <UserAvatar
                                userId={project.assignedToUid || project.assignedToId}
                                name={project.assignedToName || "Sin responsable"}
                              />
                            </span>

                            {project.assignedToName || "Sin responsable"}
                          </div>
                        </td>

                        <td data-label="Estado">
                          <Badge color={isOverdue(project) ? "red" : "blue"}>
                            {isOverdue(project)
                              ? "Atrasado"
                              : project.status || "Sin estado"}
                          </Badge>
                        </td>

                        <td data-label="Prioridad">
                          <Badge
                            color={
                              project.priority === "Alta"
                                ? "orange"
                                : project.priority === "Media"
                                ? "gold"
                                : "green"
                            }
                          >
                            {project.priority || "Sin prioridad"}
                          </Badge>
                        </td>

                        <td data-label="Fecha límite">
                          <strong>{formatPlainDate(project.deadline)}</strong>
                          <small className={isOverdue(project) ? "danger-text" : ""}>
                            {renderDeadlineLabel(project)}
                          </small>
                        </td>

                        <td data-label="Avance">
                          <div className="table-progress all-projects-progress-cell">
                            <strong>{progress}%</strong>

                            <div className="area-progress-track">
                              <div
                                className="area-progress-fill"
                                style={{ width: `${progress}%` }}
                                role="progressbar"
                                aria-label={`Avance de ${project.title}`}
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow={progress}
                              />
                            </div>
                          </div>
                        </td>

                        <td data-label="Acciones">
                          <div className="table-actions all-projects-table-actions">
                            <button className="project-action-view" type="button" onClick={() => onOpenProject(project.id)} aria-label={`Ver ${project.title}`}>
                              <ProjectIcon name="view" />
                              Ver
                            </button>

                            {onEditProject && (
                              <button className="project-action-edit" type="button" onClick={() => onEditProject(project.id)} aria-label={`Editar ${project.title}`}>
                                <ProjectIcon name="edit" />
                                Editar
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                type="button"
                                className="danger-table-button"
                                disabled={deletingProjectId === project.id}
                                onClick={() => handleDeleteProject(project)}
                              >
                                <ProjectIcon name="trash" />
                                {deletingProjectId === project.id
                                  ? "Eliminando..."
                                  : "Eliminar"}
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
                <EmptyState text="No hay proyectos activos con estos filtros." />
              )}
            </div>
          </section>
        </main>

        <aside className="all-projects-side-column">
          <section className="all-projects-panel all-projects-side-panel">
            <SectionHeader
              icon="department"
              title="Resumen por departamento"
              action={showFullDepartmentSummary ? "Ver menos" : "Ver detalle"}
              onAction={() =>
                setShowFullDepartmentSummary((current) => !current)
              }
            />

            <div className="all-projects-department-list">
              {visibleDepartmentSummary.length === 0 ? (
                <EmptyState text="No hay departamentos para mostrar." />
              ) : (
                visibleDepartmentSummary.map((item) => (
                  <div className="all-projects-department-row" key={item.department}>
                    <div>
                      <strong>{item.department}</strong>
                      <small>{item.total} proyecto(s)</small>
                    </div>

                    <div className="area-progress-track">
                      <div
                        className="area-progress-fill"
                        style={{ width: `${item.average}%` }}
                      />
                    </div>

                    <span>{item.average}%</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="all-projects-panel all-projects-side-panel">
            <SectionHeader
              icon="clock"
              title="Proyectos recientes"
              action={showFullRecentProjects ? "Ver menos" : "Ver todos"}
              onAction={() =>
                setShowFullRecentProjects((current) => !current)
              }
            />

            <div className="all-projects-recent-list">
              {visibleRecentProjects.length === 0 ? (
                <EmptyState text="No hay proyectos recientes." />
              ) : (
                visibleRecentProjects.map((project) => (
                  <button
                    type="button"
                    className={`all-projects-recent-card${
                      unreadActivityByProject[project.id]
                        ? " project-has-new-activity"
                        : ""
                    }`}
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span>
                      <ProjectIcon name="project" />
                    </span>

                    <div>
                      <strong>{project.title}</strong>

                      <div>
                        <Badge color="blue">
                          {project.status || "Sin estado"}
                        </Badge>

                        <small>
                          {formatDate(project.updatedAt || project.createdAt)}
                        </small>
                      </div>
                      <ProjectActivityIndicator
                        activity={unreadActivityByProject[project.id]}
                        compact
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

        </aside>
      </div>
    </div>
  );
}

function ProjectMetric({ icon, value, title, detail, color }) {
  return (
    <div className={`all-projects-metric-card ${color}`}>
      <div className="all-projects-metric-icon">
        <ProjectIcon name={icon} />
      </div>

      <div>
        <strong>{value}</strong>
        <span>{title}</span>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function SelectFilter({ label, value, onChange, placeholder, options }) {
  return (
    <label className="select-filter all-projects-select-filter">
      <span>{label}</span>

      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>

        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionHeader({ icon, title, action, onAction }) {
  return (
    <div className="all-projects-side-header">
      <div>
        <span>
          <ProjectIcon name={icon} />
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
    <div className="empty-state all-projects-empty-state">
      <div>
        <ProjectIcon name="empty" />
      </div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function ProjectIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    className: "all-projects-svg-icon",
    "aria-hidden": "true",
  };

  const icons = {
    projects: (
      <svg {...commonProps}>
        <path d="M4 6.7C4 5.2 5.2 4 6.7 4h10.6C18.8 4 20 5.2 20 6.7v10.6c0 1.5-1.2 2.7-2.7 2.7H6.7C5.2 20 4 18.8 4 17.3V6.7Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    search: (
      <svg {...commonProps}>
        <path d="M10.8 17.2a6.4 6.4 0 1 0 0-12.8 6.4 6.4 0 0 0 0 12.8Z" stroke="currentColor" strokeWidth="1.9" />
        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
    folder: (
      <svg {...commonProps}>
        <path d="M3.8 7.5c0-1.3 1-2.3 2.3-2.3h4l2 2.2h5.8c1.3 0 2.3 1 2.3 2.3v7.2c0 1.3-1 2.3-2.3 2.3H6.1c-1.3 0-2.3-1-2.3-2.3V7.5Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M7.5 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    check: (
      <svg {...commonProps}>
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    alert: (
      <svg {...commonProps}>
        <path d="M12 3.8 21 19H3L12 3.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 9v4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 16.5h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    flag: (
      <svg {...commonProps}>
        <path d="M6 20V4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M7 5h9.5l-1.4 3 1.4 3H7V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
    review: (
      <svg {...commonProps}>
        <path d="M6.5 4.5h11A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V6a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="m8.5 12.4 2 2 5-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
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
    department: (
      <svg {...commonProps}>
        <path d="M4.5 10.5h6v9h-6v-9ZM13.5 4.5h6v15h-6v-15Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.5 13h2M15.5 7h2M15.5 10h2M15.5 13h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    clock: (
      <svg {...commonProps}>
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    empty: (
      <svg {...commonProps}>
        <path d="M12 4 13.7 9.4 19 11l-5.3 1.6L12 18l-1.7-5.4L5 11l5.3-1.6L12 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
    view: (
      <svg {...commonProps}>
        <path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
    edit: (
      <svg {...commonProps}>
        <path d="m5 16-.7 3.7L8 19l9.8-9.8-3-3L5 16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m13.8 7.2 3 3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
    trash: (
      <svg {...commonProps}>
        <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  };

  return icons[name] || icons.project;
}

function getProjectDepartmentName(project) {
  return (
    project?.departmentName ||
    project?.responsibleDepartmentName ||
    project?.responsibleArea ||
    "Sin departamento"
  );
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

function formatPlainDate(value) {
  const date = parseDate(value);

  if (!date) return "Sin fecha";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
