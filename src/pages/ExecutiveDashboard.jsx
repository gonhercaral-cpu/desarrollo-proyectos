import { useEffect, useMemo, useState } from "react";
import { getDashboardProjects } from "../services/projectsService";

const ACTIVE_STATUSES = [
  "Aprobado",
  "Asignado",
  "En planeación",
  "En proceso",
  "En espera de información",
  "Listo para revisión",
  "Correcciones solicitadas",
  "Aprobado para entrega",
  "Pausado",
];

const CLOSED_STATUSES = ["Finalizado", "Cancelado"];

export default function ExecutiveDashboard({ onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    try {
      const data = await getDashboardProjects();
      setProjects(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error(error);
      setMessage("No se pudo cargar el dashboard ejecutivo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function getTodayOnly() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function parseDeadline(deadline) {
    if (!deadline) return null;

    const date = new Date(`${deadline}T00:00:00`);
    date.setHours(0, 0, 0, 0);

    return date;
  }

  function getDaysDifference(deadline) {
    const date = parseDeadline(deadline);

    if (!date) return null;

    const today = getTodayOnly();
    const diff = date.getTime() - today.getTime();

    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function isClosed(project) {
    return CLOSED_STATUSES.includes(project.status);
  }

  function isActive(project) {
    return ACTIVE_STATUSES.includes(project.status);
  }

  function isOverdue(project) {
    const days = getDaysDifference(project.deadline);
    return days !== null && days < 0 && !isClosed(project);
  }

  function isDueSoon(project) {
    const days = getDaysDifference(project.deadline);
    return days !== null && days >= 0 && days <= 7 && !isClosed(project);
  }

  function formatLastUpdated(date) {
    if (!date) return "Sin actualizar";

    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderDaysLabel(project) {
    const days = getDaysDifference(project.deadline);

    if (days === null) {
      return "Sin fecha";
    }

    if (days < 0) {
      return `${Math.abs(days)} día(s) atrasado`;
    }

    if (days === 0) {
      return "Vence hoy";
    }

    return `Faltan ${days} día(s)`;
  }

  const metrics = useMemo(() => {
    const active = projects.filter(isActive);
    const overdue = projects.filter(isOverdue);
    const dueSoon = projects.filter(isDueSoon);
    const readyForReview = projects.filter(
      (project) => project.status === "Listo para revisión"
    );
    const corrections = projects.filter(
      (project) => project.status === "Correcciones solicitadas"
    );
    const highPriority = projects.filter(
      (project) => project.priority === "Alta" && !isClosed(project)
    );
    const finished = projects.filter(
      (project) => project.status === "Finalizado"
    );

    const averageProgress =
      active.length === 0
        ? 0
        : Math.round(
            active.reduce(
              (total, project) => total + Number(project.progress || 0),
              0
            ) / active.length
          );

    return {
      total: projects.length,
      active: active.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      readyForReview: readyForReview.length,
      corrections: corrections.length,
      highPriority: highPriority.length,
      finished: finished.length,
      averageProgress,
    };
  }, [projects]);

  const overdueProjects = useMemo(() => {
    return projects
      .filter(isOverdue)
      .sort(
        (a, b) =>
          getDaysDifference(a.deadline) - getDaysDifference(b.deadline)
      );
  }, [projects]);

  const readyForReviewProjects = useMemo(() => {
    return projects.filter((project) => project.status === "Listo para revisión");
  }, [projects]);

  const dueSoonProjects = useMemo(() => {
    return projects
      .filter(isDueSoon)
      .sort(
        (a, b) =>
          getDaysDifference(a.deadline) - getDaysDifference(b.deadline)
      )
      .slice(0, 8);
  }, [projects]);

  const projectsByAssignee = useMemo(() => {
    const map = new Map();

    projects
      .filter((project) => !isClosed(project))
      .forEach((project) => {
        const name = project.assignedToName || "Sin responsable";

        if (!map.has(name)) {
          map.set(name, {
            name,
            total: 0,
            overdue: 0,
            readyForReview: 0,
            highPriority: 0,
          });
        }

        const item = map.get(name);

        item.total += 1;

        if (isOverdue(project)) item.overdue += 1;
        if (project.status === "Listo para revisión") item.readyForReview += 1;
        if (project.priority === "Alta") item.highPriority += 1;
      });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [projects]);

  const projectsByArea = useMemo(() => {
    const map = new Map();

    projects
      .filter((project) => !isClosed(project))
      .forEach((project) => {
        const area = project.responsibleArea || "Sin área";

        if (!map.has(area)) {
          map.set(area, {
            area,
            total: 0,
            overdue: 0,
            readyForReview: 0,
            corrections: 0,
            highPriority: 0,
            dueSoon: 0,
            finished: 0,
            progressTotal: 0,
          });
        }

        const item = map.get(area);

        item.total += 1;
        item.progressTotal += Number(project.progress || 0);

        if (isOverdue(project)) item.overdue += 1;
        if (isDueSoon(project)) item.dueSoon += 1;
        if (project.status === "Listo para revisión") item.readyForReview += 1;
        if (project.status === "Correcciones solicitadas") item.corrections += 1;
        if (project.priority === "Alta") item.highPriority += 1;
        if (project.status === "Finalizado") item.finished += 1;
      });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        averageProgress:
          item.total === 0 ? 0 : Math.round(item.progressTotal / item.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [projects]);

  if (loading) {
    return (
      <div className="executive-dashboard">
        <div className="dashboard-loading-card">
          Cargando dashboard ejecutivo...
        </div>
      </div>
    );
  }

  return (
    <div className="executive-dashboard">
      <div className="dashboard-topbar">
        <div>
          <h2>Dashboard Ejecutivo</h2>
          <p>
            Vista general del avance, carga de trabajo y prioridades del área.
          </p>
        </div>

        <div className="dashboard-top-actions">
          <span className="last-updated">
            ◷ Última actualización: {formatLastUpdated(lastUpdated)}
          </span>

          <button className="dashboard-refresh-button" onClick={loadDashboard}>
            ↻ Actualizar dashboard
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}

      <div className="dashboard-metrics-grid visual-metrics-grid">
        <MetricCard
          icon="▣"
          title="Activos"
          value={metrics.active}
          color="blue"
        />

        <MetricCard
          icon="◷"
          title="Atrasados"
          value={metrics.overdue}
          color="red"
        />

        <MetricCard
          icon="⌕"
          title="Por revisar"
          value={metrics.readyForReview}
          color="gold"
        />

        <MetricCard
          icon="✎"
          title="Correcciones"
          value={metrics.corrections}
          color="purple"
        />

        <MetricCard
          icon="⚑"
          title="Alta prioridad"
          value={metrics.highPriority}
          color="orange"
        />

        <MetricCard
          icon="▣"
          title="Próximos"
          value={metrics.dueSoon}
          color="green"
        />

        <MetricCard
          icon="✓"
          title="Finalizados"
          value={metrics.finished}
          color="teal"
        />

        <MetricCard
          icon="◔"
          title="Avance promedio"
          value={`${metrics.averageProgress}%`}
          color="blue"
        />
      </div>

      <div className="dashboard-grid dashboard-grid-large">
        <section className="visual-card">
          <div className="visual-card-header">
            <h3>Estado general del área</h3>
            <span>ⓘ</span>
          </div>

          <div className="general-status-content">
            <div>
              <span className="status-label">Avance promedio</span>
              <strong className="status-percentage">
                {metrics.averageProgress}%
              </strong>

              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${metrics.averageProgress}%` }}
                />
              </div>

              <div className="progress-scale">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>

            <p>
              El área se encuentra en ejecución con proyectos activos y
              prioridades identificadas. Mantengamos el ritmo y enfoque en las
              entregas clave.
            </p>

            <div className="status-watermark">◎</div>
          </div>
        </section>

        <section className="visual-card">
          <div className="visual-card-header">
            <h3>Atención requerida</h3>
            <span>ⓘ</span>
          </div>

          <div className="alerts-grid">
            <AlertCard
              color="red"
              icon="⚠"
              value={metrics.overdue}
              title="proyecto atrasado"
              detail="Requiere seguimiento inmediato."
            />

            <AlertCard
              color="gold"
              icon="⌕"
              value={metrics.readyForReview}
              title="proyectos por revisar"
              detail="No hay proyectos listos para revisión."
            />

            <AlertCard
              color="orange"
              icon="⚑"
              value={metrics.highPriority}
              title="proyecto de alta prioridad"
              detail="Enfoque en prioridades estratégicas."
            />
          </div>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="visual-card">
          <SectionTitle
            color="red"
            icon="◷"
            title="Proyectos atrasados"
            count={overdueProjects.length}
          />

          {overdueProjects.length === 0 ? (
            <EmptyState text="No hay proyectos atrasados." />
          ) : (
            <div className="project-card-list">
              {overdueProjects.slice(0, 4).map((project) => (
                <ProjectMiniCard
                  key={project.id}
                  project={project}
                  icon="▧"
                  color="red"
                  badge={renderDaysLabel(project)}
                  badgeColor="red"
                  onClick={() => onOpenProject(project.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="visual-card">
          <SectionTitle
            color="gold"
            icon="⌕"
            title="Listos para revisión"
            count={readyForReviewProjects.length}
          />

          {readyForReviewProjects.length === 0 ? (
            <EmptyState
              icon="▯⌕"
              text="No hay proyectos listos para revisión."
            />
          ) : (
            <div className="project-card-list">
              {readyForReviewProjects.slice(0, 4).map((project) => (
                <ProjectMiniCard
                  key={project.id}
                  project={project}
                  icon="⌕"
                  color="gold"
                  badge="Por revisar"
                  badgeColor="gold"
                  onClick={() => onOpenProject(project.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="visual-card">
          <SectionTitle
            color="green"
            icon="▣"
            title="Próximas entregas"
            count={dueSoonProjects.length}
          />

          {dueSoonProjects.length === 0 ? (
            <EmptyState text="No hay entregas próximas en los siguientes 7 días." />
          ) : (
            <div className="project-card-list">
              {dueSoonProjects.map((project) => (
                <ProjectMiniCard
                  key={project.id}
                  project={project}
                  icon="▣"
                  color="green"
                  badge={renderDaysLabel(project)}
                  badgeColor="green"
                  onClick={() => onOpenProject(project.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="visual-card">
          <SectionTitle color="blue" icon="👥" title="Carga por colaborador" />

          {projectsByAssignee.length === 0 ? (
            <EmptyState text="No hay proyectos activos asignados." />
          ) : (
            <div className="visual-table-wrap">
              <table className="visual-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Activos</th>
                    <th>Atrasados</th>
                    <th>Por revisar</th>
                    <th>Alta prioridad</th>
                  </tr>
                </thead>

                <tbody>
                  {projectsByAssignee.map((item) => (
                    <tr key={item.name}>
                      <td>
                        <div className="collaborator-cell">
                          <span className="avatar-mini">
                            {item.name === "Sin responsable"
                              ? "?"
                              : item.name
                                  .split(" ")
                                  .map((word) => word[0])
                                  .join("")
                                  .slice(0, 2)}
                          </span>

                          {item.name}
                        </div>
                      </td>

                      <td>
                        <Badge color="blue">{item.total}</Badge>
                      </td>

                      <td>
                        <Badge color="red">{item.overdue}</Badge>
                      </td>

                      <td>
                        <Badge color="gold">{item.readyForReview}</Badge>
                      </td>

                      <td>
                        <Badge color="orange">{item.highPriority}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="visual-card">
        <SectionTitle color="blue" icon="▦" title="Carga por área" />

        {projectsByArea.length === 0 ? (
          <EmptyState text="No hay proyectos activos por área." />
        ) : (
          <div className="visual-table-wrap">
            <table className="visual-table area-table">
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Activos</th>
                  <th>Atrasados</th>
                  <th>Por revisar</th>
                  <th>Correcciones</th>
                  <th>Alta prioridad</th>
                  <th>Próximos</th>
                  <th>Finalizados</th>
                  <th>Avance promedio</th>
                </tr>
              </thead>

              <tbody>
                {projectsByArea.map((item) => (
                  <tr key={item.area}>
                    <td>{item.area}</td>

                    <td>
                      <Badge color="blue">{item.total}</Badge>
                    </td>

                    <td>
                      <Badge color="red">{item.overdue}</Badge>
                    </td>

                    <td>
                      <Badge color="gold">{item.readyForReview}</Badge>
                    </td>

                    <td>
                      <Badge color="purple">{item.corrections}</Badge>
                    </td>

                    <td>
                      <Badge color="orange">{item.highPriority}</Badge>
                    </td>

                    <td>
                      <Badge color="green">{item.dueSoon}</Badge>
                    </td>

                    <td>
                      <Badge color="teal">{item.finished}</Badge>
                    </td>

                    <td>
                      <div className="area-progress">
                        <strong>{item.averageProgress}%</strong>

                        <div className="area-progress-track">
                          <div
                            className="area-progress-fill"
                            style={{ width: `${item.averageProgress}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ icon, title, value, color }) {
  return (
    <div className={`metric-card visual-metric metric-${color}`}>
      <div className="metric-icon">{icon}</div>

      <div>
        <strong>{value}</strong>
        <span>{title}</span>
      </div>
    </div>
  );
}

function AlertCard({ color, icon, value, title, detail }) {
  return (
    <div className={`alert-card alert-${color}`}>
      <div className="alert-top">
        <span>{icon}</span>
        <strong>{value}</strong>
      </div>

      <h4>{title}</h4>
      <p>{detail}</p>
    </div>
  );
}

function SectionTitle({ color, icon, title, count }) {
  return (
    <div className="section-title-row">
      <div className={`section-title-icon section-title-${color}`}>{icon}</div>

      <h3>{title}</h3>

      {typeof count === "number" && (
        <span className={`section-count section-count-${color}`}>{count}</span>
      )}
    </div>
  );
}

function ProjectMiniCard({ project, icon, color, badge, badgeColor, onClick }) {
  return (
    <button className="project-mini-card" onClick={onClick}>
      <span className={`project-mini-icon project-mini-${color}`}>{icon}</span>

      <div className="project-mini-content">
        <strong>{project.title}</strong>

        <div className="project-mini-meta">
          <span>
            <small>Responsable</small>
            {project.assignedToName || "Sin responsable"}
          </span>

          <span>
            <small>Área</small>
            {project.responsibleArea || "Sin área"}
          </span>

          <span>
            <small>Estado</small>
            <em>{project.status || "Sin estado"}</em>
          </span>

          <span>
            <small>Fecha límite</small>
            {project.deadline || "Sin fecha"}
          </span>
        </div>
      </div>

      <span className={`project-mini-badge badge-${badgeColor}`}>{badge}</span>
    </button>
  );
}

function EmptyState({ icon = "▯", text }) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}