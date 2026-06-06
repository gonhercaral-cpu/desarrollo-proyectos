import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../services/firebase";

const PROJECTS_COLLECTION = "projects";

export default function AllProjects({ onOpenProject, onEditProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [searchText, setSearchText] = useState("");
  const [activeQuickFilter, setActiveQuickFilter] = useState("Todos");
  const [areaFilter, setAreaFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showFullAreaSummary, setShowFullAreaSummary] = useState(false);
  const [showFullRecentProjects, setShowFullRecentProjects] = useState(false);
  const [showFullAlerts, setShowFullAlerts] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setMessage("");

    try {
      const projectsRef = collection(db, PROJECTS_COLLECTION);
      const q = query(projectsRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

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

  function getDaysDifference(deadline) {
    const date = parseDate(deadline);

    if (!date) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    date.setHours(0, 0, 0, 0);

    const diff = date.getTime() - today.getTime();

    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function isOverdue(project) {
    const days = getDaysDifference(project.deadline);

    return (
      days !== null &&
      days < 0 &&
      project.status !== "Finalizado" &&
      project.status !== "Cancelado"
    );
  }

  function renderDeadlineLabel(project) {
    const days = getDaysDifference(project.deadline);

    if (days === null) return "Sin fecha";
    if (days < 0) return `${Math.abs(days)} día(s) vencido`;
    if (days === 0) return "Vence hoy";

    return `${days} días restantes`;
  }

  const areas = useMemo(() => {
    return [
      ...new Set(
        projects.map((project) => project.responsibleArea).filter(Boolean)
      ),
    ];
  }, [projects]);

  const responsiblePeople = useMemo(() => {
    return [
      ...new Set(
        projects.map((project) => project.assignedToName).filter(Boolean)
      ),
    ];
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const search = searchText.trim().toLowerCase();

      const matchesSearch =
        !search ||
        project.title?.toLowerCase().includes(search) ||
        project.description?.toLowerCase().includes(search) ||
        project.responsibleArea?.toLowerCase().includes(search) ||
        project.assignedToName?.toLowerCase().includes(search);

      const matchesQuick =
        activeQuickFilter === "Todos" ||
        (activeQuickFilter === "En curso" &&
          project.status !== "Finalizado" &&
          project.status !== "Cancelado") ||
        (activeQuickFilter === "Por revisar" &&
          project.status === "Listo para revisión") ||
        (activeQuickFilter === "Atrasados" && isOverdue(project));

      const matchesArea = !areaFilter || project.responsibleArea === areaFilter;

      const matchesResponsible =
        !responsibleFilter || project.assignedToName === responsibleFilter;

      const matchesPriority =
        !priorityFilter || project.priority === priorityFilter;

      const matchesStatus = !statusFilter || project.status === statusFilter;

      return (
        matchesSearch &&
        matchesQuick &&
        matchesArea &&
        matchesResponsible &&
        matchesPriority &&
        matchesStatus
      );
    });
  }, [
    projects,
    searchText,
    activeQuickFilter,
    areaFilter,
    responsibleFilter,
    priorityFilter,
    statusFilter,
  ]);

  const metrics = useMemo(() => {
    const total = projects.length;

    const active = projects.filter(
      (project) =>
        project.status !== "Finalizado" && project.status !== "Cancelado"
    ).length;

    const overdue = projects.filter(isOverdue).length;

    const highPriority = projects.filter(
      (project) =>
        project.priority === "Alta" &&
        project.status !== "Finalizado" &&
        project.status !== "Cancelado"
    ).length;

    const finished = projects.filter(
      (project) => project.status === "Finalizado"
    ).length;

    return { total, active, overdue, highPriority, finished };
  }, [projects]);

  const areaSummary = useMemo(() => {
    const map = new Map();

    projects.forEach((project) => {
      const area = project.responsibleArea || "Sin área";

      if (!map.has(area)) {
        map.set(area, {
          area,
          total: 0,
          progressTotal: 0,
        });
      }

      const item = map.get(area);

      item.total += 1;
      item.progressTotal += Number(project.progress || 0);
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        average:
          item.total === 0 ? 0 : Math.round(item.progressTotal / item.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [projects]);

  const visibleAreaSummary = showFullAreaSummary
    ? areaSummary
    : areaSummary.slice(0, 5);

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
      (project) =>
        project.priority === "Alta" &&
        project.status !== "Finalizado" &&
        project.status !== "Cancelado"
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
    setAreaFilter("");
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
        subtitle="Administra, filtra y supervisa todos los proyectos del área."
      >
        <div className="visual-search wide">
          <span>⌕</span>
          <input
            type="text"
            placeholder="Buscar proyecto, responsable o área..."
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
          title="Total proyectos"
          detail="100% del total"
          color="blue"
        />

        <SimpleMetric
          icon="✓"
          value={metrics.active}
          title="Activos"
          detail="En ejecución"
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
          icon="✓"
          value={metrics.finished}
          title="Finalizados"
          detail="Proyectos cerrados"
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
                label="Área"
                value={areaFilter}
                onChange={setAreaFilter}
                placeholder="Todas las áreas"
                options={areas}
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
                  "Finalizado",
                  "Cancelado",
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
                    <th>Área</th>
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
                          <strong>{Number(project.progress || 0)}%</strong>

                          <div className="area-progress-track">
                            <div
                              className="area-progress-fill"
                              style={{
                                width: `${Number(project.progress || 0)}%`,
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredProjects.length === 0 && (
                <EmptyState text="No hay proyectos con estos filtros." />
              )}
            </div>
          </section>
        </main>

        <aside className="all-projects-side">
          <section className="visual-card">
            <SectionHeader
              title="Resumen por área"
              action={showFullAreaSummary ? "Ver menos" : "Ver detalle"}
              onAction={() => setShowFullAreaSummary((current) => !current)}
            />

            <div className="area-summary-list">
              {visibleAreaSummary.length === 0 ? (
                <EmptyState text="No hay áreas para mostrar." />
              ) : (
                visibleAreaSummary.map((item) => (
                  <div className="area-summary-item" key={item.area}>
                    <span>{item.area}</span>

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