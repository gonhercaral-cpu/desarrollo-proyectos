import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  getActiveProjects,
  softDeleteProject,
} from "../services/projectsService";
import { calculateAutomaticProgress } from "../utils/progressUtils";

export default function AllProjects({ onOpenProject, onEditProject }) {
  const { profile, isAdmin } = useAuth();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");

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
      <div className="visual-page">
        <div className="dashboard-loading-card">Cargando proyectos...</div>
      </div>
    );
  }

  return (
    <div className="visual-page">
      <PageHeader
        title="Todos los proyectos"
        subtitle="Administra, filtra y supervisa todos los proyectos activos del área."
      >
        <div className="visual-search wide">
          <span>⌕</span>
          <input
            type="text"
            placeholder="Buscar proyecto, responsable o departamento..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>

        <button className="visual-outline-button">☷ Filtros</button>
        <button className="visual-primary-button">＋ Nuevo proyecto</button>
      </PageHeader>

      {message && <div className="message-box">{message}</div>}

      <div className="all-metrics-grid">
        <SimpleMetric
          icon="▣"
          value={metrics.total}
          title="Total activos"
          detail="Proyectos visibles"
          color="blue"
        />

        <SimpleMetric
          icon="✓"
          value={metrics.active}
          title="En operación"
          detail="No cerrados"
          color="green"
        />

        <SimpleMetric
          icon="◷"
          value={metrics.overdue}
          title="Atrasados"
          detail="Requieren seguimiento"
          color="red"
        />

        <SimpleMetric
          icon="⚑"
          value={metrics.highPriority}
          title="Alta prioridad"
          detail="Prioridades activas"
          color="orange"
        />

        <SimpleMetric
          icon="☑"
          value={metrics.review}
          title="Por revisar"
          detail="Revisión administrativa"
          color="teal"
        />
      </div>

      <div className="all-projects-layout">
        <main className="all-projects-main">
          <section className="visual-card filters-card">
            <div className="filters-card-top">
              <div className="section-title-row no-border no-margin">
                <span className="section-title-icon section-title-blue">⌕</span>
                <h3>Filtros avanzados</h3>
              </div>

              <div className="filter-pills compact">
                {["Todos", "En curso", "Por revisar", "Atrasados"].map(
                  (filter) => (
                    <button
                      key={filter}
                      className={activeQuickFilter === filter ? "active" : ""}
                      onClick={() => setActiveQuickFilter(filter)}
                    >
                      {filter}
                      {filter === "Atrasados" && <span className="red-dot" />}
                    </button>
                  )
                )}
              </div>

              <button className="clear-filter-button" onClick={clearFilters}>
                ↻ Limpiar filtros
              </button>
            </div>

            <div className="advanced-filters-grid">
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

              <button className="visual-primary-button apply-filter-button">
                Aplicar filtros
              </button>
            </div>
          </section>

          <section className="visual-card">
            <div className="list-header">
              <div className="section-title-row no-border no-margin">
                <span className="section-title-icon section-title-blue">▦</span>
                <h3>Lista de proyectos ({filteredProjects.length})</h3>
              </div>

              <div className="sort-control">
                <span>Ordenar por:</span>
                <select>
                  <option>Fecha límite más próxima</option>
                  <option>Más recientes</option>
                  <option>Mayor avance</option>
                </select>
              </div>
            </div>

            <div className="visual-table-wrap">
              <table className="visual-table modern-projects-table">
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
                  {filteredProjects.map((project) => (
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

                      <td>{getProjectDepartmentName(project)}</td>

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
                        <Badge color={isOverdue(project) ? "red" : "blue"}>
                          {isOverdue(project)
                            ? "Atrasado"
                            : project.status || "Sin estado"}
                        </Badge>
                      </td>

                      <td>
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

                      <td>
                        <strong>{formatPlainDate(project.deadline)}</strong>
                        <small
                          className={isOverdue(project) ? "danger-text" : ""}
                        >
                          {renderDeadlineLabel(project)}
                        </small>
                      </td>

                      <td>
                        <div className="table-progress">
                          <strong>{calculateAutomaticProgress(project)}%</strong>

                          <div className="area-progress-track">
                            <div
                              className="area-progress-fill"
                              style={{
                                width: `${calculateAutomaticProgress(project)}%`,
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

                          {onEditProject && (
                            <button onClick={() => onEditProject(project.id)}>
                              Editar
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              className="danger-table-button"
                              disabled={deletingProjectId === project.id}
                              onClick={() => handleDeleteProject(project)}
                            >
                              {deletingProjectId === project.id
                                ? "Eliminando..."
                                : "Eliminar"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredProjects.length === 0 && (
                <EmptyState text="No hay proyectos activos con estos filtros." />
              )}
            </div>
          </section>
        </main>

        <aside className="all-projects-side">
          <section className="visual-card">
            <SectionHeader
              title="Resumen por departamento"
              action={
                showFullDepartmentSummary ? "Ver menos" : "Ver detalle"
              }
              onAction={() =>
                setShowFullDepartmentSummary((current) => !current)
              }
            />

            <div className="area-summary-list">
              {visibleDepartmentSummary.length === 0 ? (
                <EmptyState text="No hay departamentos para mostrar." />
              ) : (
                visibleDepartmentSummary.map((item) => (
                  <div
                    className="area-summary-item"
                    key={item.department}
                  >
                    <span>{item.department}</span>

                    <Badge color="blue">{item.total}</Badge>

                    <div className="area-progress-track">
                      <div
                        className="area-progress-fill"
                        style={{ width: `${item.average}%` }}
                      />
                    </div>

                    <strong>{item.average}%</strong>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionHeader
              title="Proyectos recientes"
              action={showFullRecentProjects ? "Ver menos" : "Ver todos"}
              onAction={() =>
                setShowFullRecentProjects((current) => !current)
              }
            />

            <div className="recent-project-list">
              {visibleRecentProjects.length === 0 ? (
                <EmptyState text="No hay proyectos recientes." />
              ) : (
                visibleRecentProjects.map((project) => (
                  <button
                    type="button"
                    className="recent-project-item recent-project-button"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className="recent-icon">▧</span>

                    <div>
                      <strong>{project.title}</strong>

                      <div className="recent-project-meta">
                        <Badge color="blue">
                          {project.status || "Sin estado"}
                        </Badge>

                        <small>
                          {formatDate(project.updatedAt || project.createdAt)}
                        </small>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionHeader
              title="Alertas importantes"
              action={showFullAlerts ? "Ver menos" : "Ver todas"}
              onAction={() => setShowFullAlerts((current) => !current)}
            />

            <div className="alerts-side-list">
              {visibleAlertItems.map((alert) => (
                <div
                  className={`side-alert ${
                    alert.type === "red"
                      ? "red-side-alert"
                      : alert.type === "orange"
                      ? "orange-side-alert"
                      : alert.type === "gold"
                      ? "gold-side-alert"
                      : "purple-side-alert"
                  }`}
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
        </aside>
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle, children }) {
  return (
    <div className="visual-page-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      <div className="visual-page-actions">{children}</div>
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

function SelectFilter({ label, value, onChange, placeholder, options }) {
  return (
    <label className="select-filter">
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

function SectionHeader({ title, action, onAction }) {
  return (
    <div className="mini-section-header">
      <div>
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
    <div className="empty-state">
      <div>▯</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
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