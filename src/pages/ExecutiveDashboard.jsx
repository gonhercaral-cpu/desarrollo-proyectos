import { useEffect, useMemo, useState } from "react";
import { getExecutiveDashboardData } from "../services/projectsService";

export default function ExecutiveDashboard({ onOpenProject }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    try {
      const data = await getExecutiveDashboardData();
      setDashboardData(data);
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

  const metrics = dashboardData?.metrics || {};
  const projects = dashboardData?.projects || {};
  const workloadByResponsible = dashboardData?.workloadByResponsible || [];
  const workloadByArea = dashboardData?.workloadByArea || [];
  const recentLogs = dashboardData?.recentLogs || [];
  const alerts = dashboardData?.alerts || [];

  const averageProgress = useMemo(() => {
    const activeProjects = projects.active || [];

    if (activeProjects.length === 0) {
      return 0;
    }

    return Math.round(
      activeProjects.reduce(
        (total, project) => total + Number(project.progress || 0),
        0
      ) / activeProjects.length
    );
  }, [projects.active]);

  const dueSoonProjects = useMemo(() => {
    const activeProjects = projects.active || [];

    return activeProjects
      .filter((project) => {
        const days = getDaysDifference(project.deadline);
        return days !== null && days >= 0 && days <= 7;
      })
      .sort((a, b) => {
        const daysA = getDaysDifference(a.deadline);
        const daysB = getDaysDifference(b.deadline);

        return Number(daysA || 0) - Number(daysB || 0);
      })
      .slice(0, 8);
  }, [projects.active]);

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
            Vista general del avance, carga de trabajo, historial y actividad
            reciente del área.
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

      <div className="dashboard-metrics-grid visual-metrics-grid executive-main-metrics">
        <MetricCard
          icon="▣"
          title="Activos"
          value={metrics.active || 0}
          color="blue"
        />

        <MetricCard
          icon="◷"
          title="Atrasados"
          value={metrics.overdue || 0}
          color="red"
        />

        <MetricCard
          icon="⌕"
          title="Por revisar"
          value={metrics.review || 0}
          color="gold"
        />

        <MetricCard
          icon="✓"
          title="Finalizados este mes"
          value={metrics.finishedThisMonth || 0}
          color="green"
        />

        <MetricCard
          icon="🗑"
          title="Eliminados"
          value={metrics.deleted || 0}
          color="red"
        />

        <MetricCard
          icon="◔"
          title="Avance promedio"
          value={`${averageProgress}%`}
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
              <strong className="status-percentage">{averageProgress}%</strong>

              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${averageProgress}%` }}
                />
              </div>

              <div className="progress-scale">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>

            <p>
              El área tiene {metrics.active || 0} proyectos activos,{" "}
              {metrics.historical || 0} proyectos en historial y{" "}
              {metrics.review || 0} proyectos listos para revisión
              administrativa.
            </p>

            <div className="status-watermark">◎</div>
          </div>
        </section>

        <section className="visual-card">
          <div className="visual-card-header">
            <h3>Alertas ejecutivas</h3>
            <span>ⓘ</span>
          </div>

          <div className="alerts-grid">
            {alerts.slice(0, 3).map((alert) => (
              <AlertCard
                key={alert.type}
                color={getAlertColor(alert)}
                icon={getAlertIcon(alert)}
                value={getAlertNumber(alert.title)}
                title={alert.title}
                detail={alert.detail}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="visual-card">
          <SectionTitle
            color="red"
            icon="◷"
            title="Proyectos atrasados"
            count={projects.overdue?.length || 0}
          />

          {!projects.overdue || projects.overdue.length === 0 ? (
            <EmptyState text="No hay proyectos atrasados." />
          ) : (
            <div className="project-card-list">
              {projects.overdue.slice(0, 4).map((project) => (
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
            count={projects.review?.length || 0}
          />

          {!projects.review || projects.review.length === 0 ? (
            <EmptyState
              icon="▯⌕"
              text="No hay proyectos listos para revisión."
            />
          ) : (
            <div className="project-card-list">
              {projects.review.slice(0, 4).map((project) => (
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
          <SectionTitle
            color="teal"
            icon="✓"
            title="Cerrados recientemente"
            count={projects.recentlyClosed?.length || 0}
          />

          {!projects.recentlyClosed || projects.recentlyClosed.length === 0 ? (
            <EmptyState text="No hay proyectos cerrados recientemente." />
          ) : (
            <div className="project-card-list">
              {projects.recentlyClosed.slice(0, 5).map((project) => (
                <ProjectMiniCard
                  key={project.id}
                  project={project}
                  icon="✓"
                  color="teal"
                  badge={project.status || "Cerrado"}
                  badgeColor={getClosedBadgeColor(project)}
                  onClick={() => onOpenProject(project.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="visual-card">
          <SectionTitle color="blue" icon="👥" title="Carga por colaborador" />

          {workloadByResponsible.length === 0 ? (
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
                    <th>Avance</th>
                  </tr>
                </thead>

                <tbody>
                  {workloadByResponsible.map((item) => (
                    <tr key={item.responsible}>
                      <td>
                        <div className="collaborator-cell">
                          <span className="avatar-mini">
                            {getInitials(item.responsible)}
                          </span>

                          {item.responsible}
                        </div>
                      </td>

                      <td>
                        <Badge color="blue">{item.active}</Badge>
                      </td>

                      <td>
                        <Badge color="red">{item.overdue}</Badge>
                      </td>

                      <td>
                        <Badge color="gold">{item.review}</Badge>
                      </td>

                      <td>
                        <Badge color="orange">{item.highPriority}</Badge>
                      </td>

                      <td>
                        <div className="area-progress">
                          <strong>{item.averageProgress}%</strong>

                          <div className="area-progress-track">
                            <div
                              className="area-progress-fill"
                              style={{
                                width: `${item.averageProgress}%`,
                              }}
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

        <section className="visual-card">
          <SectionTitle color="orange" icon="▤" title="Actividad reciente" />

          {recentLogs.length === 0 ? (
            <EmptyState text="Todavía no hay actividad registrada en la bitácora." />
          ) : (
            <div className="recent-project-list formal-log-list">
              {recentLogs.slice(0, 8).map((log) => (
                <div className="recent-project-item formal-log-row" key={log.id}>
                  <span className="recent-icon">{getLogIcon(log.type)}</span>

                  <div className="formal-log-content">
                    <b>{log.title || "Movimiento registrado"}</b>
                    <p>{log.description || "Sin descripción."}</p>

                    <div className="recent-project-meta">
                      <Badge color={getLogBadgeColor(log.type)}>
                        {formatLogType(log.type)}
                      </Badge>

                      <small>
                        {log.userName || "Usuario"} ·{" "}
                        {formatDate(log.createdAt)}
                      </small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="visual-card">
        <SectionTitle color="blue" icon="▦" title="Carga por área" />

        {workloadByArea.length === 0 ? (
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
                  <th>Alta prioridad</th>
                  <th>Avance promedio</th>
                </tr>
              </thead>

              <tbody>
                {workloadByArea.map((item) => (
                  <tr key={item.area}>
                    <td>{item.area}</td>

                    <td>
                      <Badge color="blue">{item.active}</Badge>
                    </td>

                    <td>
                      <Badge color="red">{item.overdue}</Badge>
                    </td>

                    <td>
                      <Badge color="gold">{item.review}</Badge>
                    </td>

                    <td>
                      <Badge color="orange">{item.highPriority}</Badge>
                    </td>

                    <td>
                      <div className="area-progress">
                        <strong>{item.averageProgress}%</strong>

                        <div className="area-progress-track">
                          <div
                            className="area-progress-fill"
                            style={{
                              width: `${item.averageProgress}%`,
                            }}
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

function parseDate(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
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

function getInitials(name = "") {
  if (!name || name === "Sin responsable") {
    return "?";
  }

  return String(name)
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAlertNumber(title = "") {
  const match = String(title).match(/\d+/);
  return match ? match[0] : "0";
}

function getAlertColor(alert) {
  if (alert.level === "danger") return "red";
  if (alert.level === "warning") return "gold";
  if (alert.level === "info") return "blue";

  return "green";
}

function getAlertIcon(alert) {
  if (alert.level === "danger") return "⚠";
  if (alert.type === "review") return "⌕";
  if (alert.type === "highPriority") return "⚑";
  if (alert.type === "stale") return "◷";
  if (alert.type === "noEvidence") return "▯";

  return "✓";
}

function getClosedBadgeColor(project) {
  if (project.status === "Eliminado") return "red";
  if (project.status === "Cancelado") return "orange";
  if (project.status === "Archivado") return "blue";

  return "teal";
}

function getLogIcon(type) {
  if (type === "PROJECT_CREATED") return "＋";
  if (type === "PROJECT_UPDATED") return "✎";
  if (type === "STATUS_CHANGED") return "↻";
  if (type === "PROGRESS_CHANGED") return "◔";
  if (type === "EVIDENCE_UPLOADED") return "⇧";
  if (type === "COMMENT_ADDED") return "☰";
  if (type === "REVIEW_REQUESTED") return "⌕";
  if (type === "CORRECTIONS_REQUESTED") return "✎";
  if (type === "PROJECT_APPROVED") return "✓";
  if (type === "PROJECT_FINISHED") return "✓";
  if (type === "PROJECT_CANCELLED") return "⨯";
  if (type === "PROJECT_DELETED") return "🗑";
  if (type === "PROJECT_RESTORED") return "↺";
  if (type === "INTERNAL_NOTE_UPDATED") return "▤";

  return "•";
}

function getLogBadgeColor(type) {
  if (type === "PROJECT_DELETED") return "red";
  if (type === "PROJECT_CANCELLED") return "orange";
  if (type === "PROJECT_FINISHED") return "teal";
  if (type === "PROJECT_APPROVED") return "green";
  if (type === "REVIEW_REQUESTED") return "gold";
  if (type === "CORRECTIONS_REQUESTED") return "purple";
  if (type === "EVIDENCE_UPLOADED") return "blue";
  if (type === "PROJECT_RESTORED") return "green";

  return "blue";
}

function formatLogType(type = "") {
  const labels = {
    PROJECT_CREATED: "Creación",
    PROJECT_UPDATED: "Edición",
    STATUS_CHANGED: "Estado",
    PROGRESS_CHANGED: "Avance",
    EVIDENCE_UPLOADED: "Evidencia",
    COMMENT_ADDED: "Comentario",
    REVIEW_REQUESTED: "Revisión",
    CORRECTIONS_REQUESTED: "Correcciones",
    PROJECT_APPROVED: "Aprobado",
    PROJECT_FINISHED: "Finalizado",
    PROJECT_CANCELLED: "Cancelado",
    PROJECT_DELETED: "Eliminado",
    PROJECT_RESTORED: "Restaurado",
    INTERNAL_NOTE_UPDATED: "Nota interna",
  };

  return labels[type] || "Movimiento";
}