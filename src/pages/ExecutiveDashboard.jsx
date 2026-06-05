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

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    try {
      const data = await getDashboardProjects();
      setProjects(data);
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

  function isActive(project) {
    return ACTIVE_STATUSES.includes(project.status);
  }

  function isClosed(project) {
    return CLOSED_STATUSES.includes(project.status);
  }

  function isOverdue(project) {
    const days = getDaysDifference(project.deadline);

    return days !== null && days < 0 && !isClosed(project);
  }

  function isDueSoon(project) {
    const days = getDaysDifference(project.deadline);

    return days !== null && days >= 0 && days <= 7 && !isClosed(project);
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

        if (isOverdue(project)) {
          item.overdue += 1;
        }

        if (project.status === "Listo para revisión") {
          item.readyForReview += 1;
        }

        if (project.priority === "Alta") {
          item.highPriority += 1;
        }
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
          });
        }

        const item = map.get(area);

        item.total += 1;

        if (isOverdue(project)) {
          item.overdue += 1;
        }

        if (project.status === "Listo para revisión") {
          item.readyForReview += 1;
        }
      });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
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

  if (loading) {
    return <p>Cargando dashboard ejecutivo...</p>;
  }

  return (
    <div className="executive-dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Dashboard ejecutivo</h2>
          <p className="page-description">
            Resumen general para revisar carga de trabajo, retrasos, proyectos
            listos para revisión y prioridades del área.
          </p>
        </div>

        <button className="secondary-button" onClick={loadDashboard}>
          Actualizar dashboard
        </button>
      </div>

      {message && <div className="message-box">{message}</div>}

      <div className="dashboard-metrics-grid">
        <MetricCard
          title="Activos"
          value={metrics.active}
          detail="Proyectos abiertos"
        />

        <MetricCard
          title="Atrasados"
          value={metrics.overdue}
          detail="Requieren atención"
          danger
        />

        <MetricCard
          title="Por revisar"
          value={metrics.readyForReview}
          detail="Listos para revisión"
          warning
        />

        <MetricCard
          title="Correcciones"
          value={metrics.corrections}
          detail="Devueltos al equipo"
          warning
        />

        <MetricCard
          title="Alta prioridad"
          value={metrics.highPriority}
          detail="Activos importantes"
        />

        <MetricCard
          title="Próximos"
          value={metrics.dueSoon}
          detail="Vencen en 7 días"
        />

        <MetricCard
          title="Finalizados"
          value={metrics.finished}
          detail="Cerrados correctamente"
          success
        />

        <MetricCard
          title="Avance promedio"
          value={`${metrics.averageProgress}%`}
          detail="Solo activos"
        />
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Proyectos atrasados</h3>

          {overdueProjects.length === 0 ? (
            <p>No hay proyectos atrasados.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th>Retraso</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {overdueProjects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.title}</strong>
                        <span>{project.responsibleArea}</span>
                      </td>

                      <td>{project.assignedToName || "Sin responsable"}</td>
                      <td>{project.status}</td>
                      <td>{project.deadline || "Sin fecha"}</td>
                      <td>{renderDaysLabel(project)}</td>

                      <td>
                        <button onClick={() => onOpenProject(project.id)}>
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Listos para revisión</h3>

          {readyForReviewProjects.length === 0 ? (
            <p>No hay proyectos listos para revisión.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Responsable</th>
                    <th>Prioridad</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {readyForReviewProjects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.title}</strong>
                        <span>{project.responsibleArea}</span>
                      </td>

                      <td>{project.assignedToName || "Sin responsable"}</td>
                      <td>{project.priority || "Sin prioridad"}</td>

                      <td>
                        <button onClick={() => onOpenProject(project.id)}>
                          Revisar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Próximas entregas</h3>

          {dueSoonProjects.length === 0 ? (
            <p>No hay entregas próximas en los siguientes 7 días.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Responsable</th>
                    <th>Fecha</th>
                    <th>Tiempo</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {dueSoonProjects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.title}</strong>
                        <span>{project.status}</span>
                      </td>

                      <td>{project.assignedToName || "Sin responsable"}</td>
                      <td>{project.deadline || "Sin fecha"}</td>
                      <td>{renderDaysLabel(project)}</td>

                      <td>
                        <button onClick={() => onOpenProject(project.id)}>
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Carga por colaborador</h3>

          {projectsByAssignee.length === 0 ? (
            <p>No hay proyectos activos asignados.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
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
                      <td>{item.name}</td>
                      <td>{item.total}</td>
                      <td>{item.overdue}</td>
                      <td>{item.readyForReview}</td>
                      <td>{item.highPriority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Carga por área</h3>

        {projectsByArea.length === 0 ? (
          <p>No hay proyectos activos por área.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Proyectos activos</th>
                  <th>Atrasados</th>
                  <th>Listos para revisión</th>
                </tr>
              </thead>

              <tbody>
                {projectsByArea.map((item) => (
                  <tr key={item.area}>
                    <td>{item.area}</td>
                    <td>{item.total}</td>
                    <td>{item.overdue}</td>
                    <td>{item.readyForReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, detail, danger, warning, success }) {
  let className = "metric-card";

  if (danger) className += " metric-danger";
  if (warning) className += " metric-warning";
  if (success) className += " metric-success";

  return (
    <div className={className}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}