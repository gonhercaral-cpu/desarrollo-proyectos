import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";

const PROJECTS_COLLECTION = "projects";

export default function MyProjects({ onOpenProject }) {
  const { profile, firebaseUser } = useAuth();

  const [assignedProjects, setAssignedProjects] = useState([]);
  const [collaboratorProjects, setCollaboratorProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeFilter, setActiveFilter] = useState("Todos");
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");

  const [showFullAgenda, setShowFullAgenda] = useState(false);
  const [showFullActivity, setShowFullActivity] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setMessage("");

    try {
      const projectsRef = collection(db, PROJECTS_COLLECTION);
      const q = query(projectsRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      const allProjects = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const profileName = normalizeText(profile?.name || "");
      const profileEmail = normalizeText(
        profile?.email || firebaseUser?.email || ""
      );
      const userId = firebaseUser?.uid || "";

      const assigned = allProjects.filter((project) => {
        const assignedToId = project.assignedToId || "";
        const assignedToUid = project.assignedToUid || "";
        const assignedToEmail = normalizeText(project.assignedToEmail || "");
        const assignedToName = normalizeText(project.assignedToName || "");

        return (
          assignedToId === userId ||
          assignedToUid === userId ||
          assignedToEmail === profileEmail ||
          assignedToName === profileName
        );
      });

      const collaborations = allProjects.filter((project) => {
        const isAssigned = assigned.some(
          (assignedProject) => assignedProject.id === project.id
        );

        if (isAssigned) return false;

        const collaboratorIds = normalizeArray(project.collaboratorIds);
        const collaboratorUids = normalizeArray(project.collaboratorUids);
        const collaboratorEmails = normalizeArray(
          project.collaboratorEmails
        ).map(normalizeText);
        const collaboratorNames = normalizeArray(project.collaboratorNames).map(
          normalizeText
        );

        return (
          collaboratorIds.includes(userId) ||
          collaboratorUids.includes(userId) ||
          collaboratorEmails.includes(profileEmail) ||
          collaboratorNames.includes(profileName)
        );
      });

      setAssignedProjects(assigned);
      setCollaboratorProjects(collaborations);
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron cargar tus proyectos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const allMyProjects = useMemo(() => {
    return [...assignedProjects, ...collaboratorProjects];
  }, [assignedProjects, collaboratorProjects]);

  const filteredAssignedProjects = useMemo(() => {
    return filterProjects(assignedProjects, activeFilter, searchText);
  }, [assignedProjects, activeFilter, searchText]);

  const filteredCollaboratorProjects = useMemo(() => {
    return filterProjects(collaboratorProjects, activeFilter, searchText);
  }, [collaboratorProjects, activeFilter, searchText]);

  const metrics = useMemo(() => {
    const assigned = assignedProjects.length;
    const collaborator = collaboratorProjects.length;

    const inProgress = allMyProjects.filter(
      (project) =>
        project.status === "En proceso" ||
        project.status === "En planeación" ||
        project.status === "Asignado" ||
        project.status === "Por iniciar"
    ).length;

    const dueSoon = allMyProjects.filter(isDueSoon).length;

    const readyForReview = allMyProjects.filter(
      (project) => project.status === "Listo para revisión"
    ).length;

    return {
      assigned,
      collaborator,
      inProgress,
      dueSoon,
      readyForReview,
      total: allMyProjects.length,
    };
  }, [assignedProjects, collaboratorProjects, allMyProjects]);

  const agendaProjects = useMemo(() => {
    return allMyProjects
      .filter((project) => project.deadline)
      .sort((a, b) => {
        const dateA = parseDate(a.deadline);
        const dateB = parseDate(b.deadline);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return dateA.getTime() - dateB.getTime();
      });
  }, [allMyProjects]);

  const visibleAgendaProjects = showFullAgenda
    ? agendaProjects
    : agendaProjects.slice(0, 3);

  const recentActivity = useMemo(() => {
    return allMyProjects
      .slice()
      .sort((a, b) => {
        const dateA = parseDate(a.updatedAt || a.createdAt);
        const dateB = parseDate(b.updatedAt || b.createdAt);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return dateB.getTime() - dateA.getTime();
      });
  }, [allMyProjects]);

  const visibleActivity = showFullActivity
    ? recentActivity
    : recentActivity.slice(0, 3);

  const statusDistribution = useMemo(() => {
    const total = allMyProjects.length || 1;

    const items = [
      {
        label: "En planeación",
        value: allMyProjects.filter(
          (project) => project.status === "En planeación"
        ).length,
        color: "blue",
      },
      {
        label: "En proceso",
        value: allMyProjects.filter(
          (project) => project.status === "En proceso"
        ).length,
        color: "green",
      },
      {
        label: "Listo para revisión",
        value: allMyProjects.filter(
          (project) => project.status === "Listo para revisión"
        ).length,
        color: "purple",
      },
      {
        label: "Finalizados",
        value: allMyProjects.filter(
          (project) => project.status === "Finalizado"
        ).length,
        color: "gray",
      },
    ];

    return items.map((item) => ({
      ...item,
      percentage: Math.round((item.value / total) * 100),
    }));
  }, [allMyProjects]);

  if (loading) {
    return (
      <div className="visual-page">
        <div className="dashboard-loading-card">Cargando tus proyectos...</div>
      </div>
    );
  }

  return (
    <div className="visual-page">
      <PageHeader
        title="Mis proyectos"
        subtitle="Consulta tus proyectos asignados, colaboraciones, próximos vencimientos y seguimiento de avances."
      >
        <button className="visual-outline-button" onClick={loadProjects}>
          ↻ Actualizar
        </button>

        <div className="visual-search">
          <span>⌕</span>
          <input
            type="text"
            placeholder="Buscar proyecto..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
      </PageHeader>

      {message && <div className="message-box">{message}</div>}

      <div className="my-metrics-grid">
        <SimpleMetric
          icon="▣"
          value={metrics.assigned}
          title="Asignados"
          detail="Proyectos donde eres responsable"
          color="blue"
        />

        <SimpleMetric
          icon="👥"
          value={metrics.collaborator}
          title="Colaboraciones"
          detail="Proyectos donde participas"
          color="teal"
        />

        <SimpleMetric
          icon="↗"
          value={metrics.inProgress}
          title="En progreso"
          detail="Proyectos activos"
          color="green"
        />

        <SimpleMetric
          icon="▣"
          value={metrics.dueSoon}
          title="Próximos a vencer"
          detail="En los próximos 15 días"
          color="orange"
        />
      </div>

      <div className="projects-layout">
        <section className="visual-card projects-main-panel">
          <div className="section-title-row no-border">
            <h3>Mis proyectos</h3>
          </div>

          <div className="filter-pills">
            {[
              "Todos",
              "En planeación",
              "En proceso",
              "Listo para revisión",
              "Finalizado",
            ].map((filter) => (
              <button
                key={filter}
                className={activeFilter === filter ? "active" : ""}
                onClick={() => setActiveFilter(filter)}
              >
                {filter === "Finalizado" ? "Finalizados" : filter}
              </button>
            ))}
          </div>

          <ProjectGroup
            title="Mis proyectos asignados"
            subtitle="Proyectos donde tú eres el responsable principal."
            projects={filteredAssignedProjects}
            emptyText="No tienes proyectos asignados en esta vista."
            type="assigned"
            onOpenProject={onOpenProject}
          />

          <ProjectGroup
            title="Proyectos donde colaboro"
            subtitle="Proyectos donde participas como colaborador, pero no eres el responsable principal."
            projects={filteredCollaboratorProjects}
            emptyText="No estás como colaborador en proyectos de esta vista."
            type="collaborator"
            onOpenProject={onOpenProject}
          />
        </section>

        <aside className="projects-side-panel">
          <section className="visual-card">
            <SectionHeader
              title="Mi agenda"
              icon="▣"
              action={showFullAgenda ? "Ver menos" : "Ver agenda completa"}
              onAction={() => setShowFullAgenda((current) => !current)}
            />

            <div className="agenda-list">
              {visibleAgendaProjects.length === 0 ? (
                <EmptyState text="No tienes entregas próximas." />
              ) : (
                visibleAgendaProjects.map((project) => (
                  <AgendaItem
                    key={project.id}
                    project={project}
                    label={renderDeadlineLabel(project)}
                  />
                ))
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionHeader title="Distribución por estado" />

            <div className="status-distribution">
              <div className="donut-placeholder">
                <div className="donut-center">
                  <strong>{allMyProjects.length}</strong>
                  <span>
                    {allMyProjects.length === 1 ? "Proyecto" : "Proyectos"}
                  </span>
                </div>
              </div>

              <div className="status-bars">
                {statusDistribution.map((item) => (
                  <div className="status-bar-row" key={item.label}>
                    <span className={`status-dot status-${item.color}`} />
                    <p>{item.label}</p>

                    <div className="mini-track">
                      <div
                        className={`mini-fill mini-${item.color}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>

                    <strong>{item.value}</strong>
                    <small>{item.percentage}%</small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="visual-card">
            <SectionHeader
              title="Actividad reciente"
              action={showFullActivity ? "Ver menos" : "Ver todas"}
              onAction={() => setShowFullActivity((current) => !current)}
            />

            <div className="activity-list">
              {visibleActivity.length === 0 ? (
                <EmptyState text="No hay actividad reciente." />
              ) : (
                visibleActivity.map((project, index) => (
                  <div className="activity-item" key={project.id}>
                    <span className={`activity-icon activity-${(index % 3) + 1}`}>
                      {index % 3 === 0 ? "＋" : index % 3 === 1 ? "✎" : "✓"}
                    </span>

                    <div>
                      <strong>{project.title}</strong>
                      <p>
                        {project.status || "Proyecto actualizado"} ·{" "}
                        {project.responsibleArea || "Sin área"}
                      </p>
                      <small>
                        {formatDate(project.updatedAt || project.createdAt)}
                      </small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ProjectGroup({
  title,
  subtitle,
  projects,
  emptyText,
  type,
  onOpenProject,
}) {
  return (
    <div className="project-group">
      <div className="project-group-header">
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>

        <span className={`project-group-count ${type}`}>
          {projects.length}
        </span>
      </div>

      {projects.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="assigned-project-list">
          {projects.map((project) => (
            <AssignedProjectCard
              key={project.id}
              project={project}
              deadlineLabel={renderDeadlineLabel(project)}
              type={type}
              onClick={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      )}
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

function AssignedProjectCard({ project, deadlineLabel, type, onClick }) {
  const priorityColor =
    project.priority === "Alta"
      ? "red"
      : project.priority === "Media"
      ? "gold"
      : "green";

  const statusColor =
    project.status === "Listo para revisión"
      ? "purple"
      : project.status === "Finalizado"
      ? "teal"
      : "blue";

  return (
    <article className="assigned-project-card">
      <div className={`assigned-icon project-mini-${statusColor}`}>
        {type === "collaborator" ? "👥" : "▤"}
      </div>

      <div className="assigned-content">
        <div className="assigned-title-row">
          <div>
            <h4>{project.title}</h4>
            <span>
              Área responsable: {project.responsibleArea || "Sin área"}
            </span>
          </div>

          <div className="assigned-badges">
            <Badge color={type === "collaborator" ? "teal" : "blue"}>
              {type === "collaborator" ? "Colaborador" : "Responsable"}
            </Badge>

            <Badge color={priorityColor}>
              ⚑ {project.priority || "Sin prioridad"}
            </Badge>

            <Badge color={statusColor}>
              ● {project.status || "Sin estado"}
            </Badge>
          </div>
        </div>

        <p>{project.description || "Sin descripción registrada."}</p>

        <div className="assigned-bottom">
          <div className="assigned-progress">
            <span>Avance</span>

            <div className="area-progress-track">
              <div
                className="area-progress-fill"
                style={{ width: `${Number(project.progress || 0)}%` }}
              />
            </div>

            <strong>{Number(project.progress || 0)}%</strong>
          </div>

          <div className="assigned-deadline">
            <span>▣ Vence: {formatPlainDate(project.deadline)}</span>
            <span>◷ {deadlineLabel}</span>
          </div>

          <button className="visual-detail-button" onClick={onClick}>
            Ver detalle ›
          </button>
        </div>
      </div>
    </article>
  );
}

function AgendaItem({ project, label }) {
  const date = parseDate(project.deadline);

  const day = date
    ? date.toLocaleDateString("es-MX", { day: "2-digit" })
    : "--";

  const month = date
    ? date.toLocaleDateString("es-MX", { month: "short" }).replace(".", "")
    : "---";

  const isUrgent = label.includes("hoy") || label.includes("atrasado");

  return (
    <div className="agenda-item">
      <div className="agenda-date">
        <strong>{day}</strong>
        <span>{month.toUpperCase()}</span>
      </div>

      <div>
        <strong>{project.title}</strong>
        <p>Entrega o seguimiento pendiente</p>
      </div>

      <Badge color={isUrgent ? "red" : "gold"}>{label}</Badge>
    </div>
  );
}

function SectionHeader({ title, icon, action, onAction }) {
  return (
    <div className="mini-section-header">
      <div>
        {icon && <span>{icon}</span>}
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

function filterProjects(projects, activeFilter, searchText) {
  return projects.filter((project) => {
    const search = searchText.trim().toLowerCase();

    const matchesSearch =
      !search ||
      project.title?.toLowerCase().includes(search) ||
      project.description?.toLowerCase().includes(search) ||
      project.responsibleArea?.toLowerCase().includes(search) ||
      project.status?.toLowerCase().includes(search) ||
      project.priority?.toLowerCase().includes(search);

    const matchesFilter =
      activeFilter === "Todos" ||
      project.status === activeFilter ||
      (activeFilter === "Finalizados" && project.status === "Finalizado");

    return matchesSearch && matchesFilter;
  });
}

function isDueSoon(project) {
  const days = getDaysDifference(project.deadline);
  return days !== null && days >= 0 && days <= 15;
}

function renderDeadlineLabel(project) {
  const days = getDaysDifference(project.deadline);

  if (days === null) return "Sin fecha";
  if (days < 0) return `${Math.abs(days)} día(s) atrasado`;
  if (days === 0) return "Vence hoy";

  return `Faltan ${days} día(s)`;
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeArray(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === "object" && !value.toDate) {
    return Object.values(value);
  }

  return [];
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

function formatPlainDate(value) {
  const date = parseDate(value);

  if (!date) return "Sin fecha";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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