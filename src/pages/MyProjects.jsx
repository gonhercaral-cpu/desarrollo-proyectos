import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";

const PROJECTS_COLLECTION = "projects";

export default function MyProjects({ onOpenProject }) {
  const { profile, currentUser, firebaseUser, isAdmin } = useAuth();

  const [assignedProjects, setAssignedProjects] = useState([]);
  const [collaboratorProjects, setCollaboratorProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeFilter, setActiveFilter] = useState("Todos");
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");

  const [showFullAgenda, setShowFullAgenda] = useState(false);
  const [showFullActivity, setShowFullActivity] = useState(false);

  function getUserId() {
    return (
      currentUser?.uid ||
      firebaseUser?.uid ||
      profile?.uid ||
      profile?.id ||
      ""
    );
  }

  async function loadProjects() {
    setLoading(true);
    setMessage("");

    try {
      const userId = getUserId();

      if (!userId) {
        setAssignedProjects([]);
        setCollaboratorProjects([]);
        setMessage("No se pudo identificar tu usuario.");
        return;
      }

      const allProjects = await getMyAllowedProjects(userId, isAdmin);

      const activeProjects = allProjects.filter((project) => {
        return !isHistoricalProject(project);
      });

      const assigned = activeProjects.filter((project) => {
        return isProjectAssignedToUser(project, userId);
      });

      const collaborations = activeProjects.filter((project) => {
        const alreadyAssigned = assigned.some(
          (assignedProject) => assignedProject.id === project.id
        );

        if (alreadyAssigned) return false;

        return isUserCollaboratorInProject(project, userId);
      });

      setAssignedProjects(sortByCreatedAtDesc(assigned));
      setCollaboratorProjects(sortByCreatedAtDesc(collaborations));
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron cargar tus proyectos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, [
    currentUser?.uid,
    firebaseUser?.uid,
    profile?.uid,
    profile?.id,
    isAdmin,
  ]);

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

    const inProgress = allMyProjects.filter((project) =>
      [
        "Pendiente",
        "Por iniciar",
        "Asignado",
        "En planeación",
        "En proceso",
        "En espera de información",
        "Correcciones solicitadas",
        "Pausado",
      ].includes(project.status)
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
        label: "Por iniciar",
        value: allMyProjects.filter(
          (project) =>
            project.status === "Por iniciar" ||
            project.status === "Asignado" ||
            project.status === "Pendiente"
        ).length,
        color: "blue",
      },
      {
        label: "En planeación",
        value: allMyProjects.filter(
          (project) => project.status === "En planeación"
        ).length,
        color: "gold",
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
            id="my-projects-search"
            name="search"
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
          icon="◷"
          value={metrics.inProgress}
          title="En curso"
          detail="Proyectos activos"
          color="green"
        />

        <SimpleMetric
          icon="⚑"
          value={metrics.dueSoon}
          title="Por vencer"
          detail="Vencen en 3 días o menos"
          color="orange"
        />

        <SimpleMetric
          icon="☑"
          value={metrics.readyForReview}
          title="Por revisión"
          detail="Listos para revisión"
          color="purple"
        />
      </div>

      <div className="my-projects-layout">
        <main className="my-projects-main">
          <section className="visual-card filters-card">
            <div className="filters-card-top">
              <div className="section-title-row no-border no-margin">
                <span className="section-title-icon section-title-blue">⌕</span>
                <h3>Filtrar mis proyectos</h3>
              </div>

              <div className="filter-pills compact">
                {[
                  "Todos",
                  "En curso",
                  "Por revisar",
                  "Por vencer",
                  "Atrasados",
                ].map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    className={activeFilter === filter ? "active" : ""}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter}
                    {filter === "Atrasados" && <span className="red-dot" />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <ProjectSection
            title={`Proyectos asignados (${filteredAssignedProjects.length})`}
            subtitle="Proyectos donde eres responsable principal."
            projects={filteredAssignedProjects}
            onOpenProject={onOpenProject}
          />

          <ProjectSection
            title={`Colaboraciones (${filteredCollaboratorProjects.length})`}
            subtitle="Proyectos donde participas como colaborador."
            projects={filteredCollaboratorProjects}
            onOpenProject={onOpenProject}
          />
        </main>

        <aside className="my-projects-side">
          <section className="visual-card">
            <SectionHeader
              title="Próximos vencimientos"
              action={showFullAgenda ? "Ver menos" : "Ver todos"}
              onAction={() => setShowFullAgenda((current) => !current)}
            />

            <div className="agenda-list">
              {visibleAgendaProjects.length === 0 ? (
                <EmptyState text="No tienes vencimientos próximos." />
              ) : (
                visibleAgendaProjects.map((project) => (
                  <button
                    type="button"
                    className="agenda-item agenda-button"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <div>
                      <strong>{project.title}</strong>
                      <span>{project.responsibleArea || "Sin área"}</span>
                    </div>

                    <Badge color={isOverdue(project) ? "red" : "orange"}>
                      {renderDeadlineLabel(project)}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionHeader
              title="Actividad reciente"
              action={showFullActivity ? "Ver menos" : "Ver más"}
              onAction={() => setShowFullActivity((current) => !current)}
            />

            <div className="recent-project-list">
              {visibleActivity.length === 0 ? (
                <EmptyState text="No hay actividad reciente." />
              ) : (
                visibleActivity.map((project) => (
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
            <SectionHeader title="Distribución de estados" />

            <div className="status-distribution-list">
              {statusDistribution.map((item) => (
                <div className="status-distribution-item" key={item.label}>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>

                  <div className="area-progress-track">
                    <div
                      className="area-progress-fill"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>

                  <small>{item.percentage}%</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

async function getMyAllowedProjects(userId, isAdmin) {
  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const projectQueries = [
    {
      name: "assignedToUid",
      queryRef: query(projectsRef, where("assignedToUid", "==", userId)),
    },
    {
      name: "assignedToId",
      queryRef: query(projectsRef, where("assignedToId", "==", userId)),
    },
    {
      name: "collaboratorIds",
      queryRef: query(
        projectsRef,
        where("collaboratorIds", "array-contains", userId)
      ),
    },
  ];

  if (isAdmin) {
    projectQueries.push({
      name: "createdByUid",
      queryRef: query(projectsRef, where("createdByUid", "==", userId)),
    });
  }

  const results = [];

  console.log("UID usado en Mis proyectos:", userId);

  for (const item of projectQueries) {
    try {
      const snapshot = await getDocs(item.queryRef);

      console.log(
        `Consulta ${item.name}: ${snapshot.docs.length} proyecto(s) encontrados`
      );

      snapshot.docs.forEach((document) => {
        results.push({
          id: document.id,
          ...document.data(),
        });
      });
    } catch (error) {
      console.warn(
        `No se pudo ejecutar la consulta de Mis proyectos: ${item.name}`,
        error
      );
    }
  }

  return removeDuplicatedProjects(results);
}

function ProjectSection({ title, subtitle, projects, onOpenProject }) {
  return (
    <section className="visual-card">
      <div className="list-header">
        <div className="section-title-row no-border no-margin">
          <span className="section-title-icon section-title-blue">▦</span>

          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="my-project-card-list">
        {projects.length === 0 ? (
          <EmptyState text="No hay proyectos para mostrar con estos filtros." />
        ) : (
          projects.map((project) => (
            <article className="my-project-card" key={project.id}>
              <div className="my-project-card-top">
                <div>
                  <h3>{project.title}</h3>
                  <p>{project.description || "Sin descripción registrada."}</p>
                </div>

                <Badge color={getStatusBadgeColor(project)}>
                  {isOverdue(project)
                    ? "Atrasado"
                    : project.status || "Sin estado"}
                </Badge>
              </div>

              <div className="my-project-meta-grid">
                <MetaItem label="Área" value={project.responsibleArea} />
                <MetaItem label="Prioridad" value={project.priority} />
                <MetaItem
                  label="Fecha límite"
                  value={formatPlainDate(project.deadline)}
                />
                <MetaItem
                  label="Tiempo"
                  value={renderDeadlineLabel(project)}
                  danger={isOverdue(project)}
                />
              </div>

              <div className="my-project-progress-row">
                <div>
                  <span>Avance</span>
                  <strong>{Number(project.progress || 0)}%</strong>
                </div>

                <div className="area-progress-track">
                  <div
                    className="area-progress-fill"
                    style={{ width: `${Number(project.progress || 0)}%` }}
                  />
                </div>
              </div>

              <div className="my-project-card-actions">
                <button
                  type="button"
                  className="visual-primary-button"
                  onClick={() => onOpenProject(project.id)}
                >
                  Ver detalle
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
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

function MetaItem({ label, value, danger }) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : ""}>
        {value || "Sin información"}
      </strong>
    </div>
  );
}

function filterProjects(projects, activeFilter, searchText) {
  const search = searchText.trim().toLowerCase();

  return projects.filter((project) => {
    const matchesSearch =
      !search ||
      project.title?.toLowerCase().includes(search) ||
      project.description?.toLowerCase().includes(search) ||
      project.responsibleArea?.toLowerCase().includes(search) ||
      project.assignedToName?.toLowerCase().includes(search) ||
      project.status?.toLowerCase().includes(search);

    const matchesFilter =
      activeFilter === "Todos" ||
      (activeFilter === "En curso" && isInCourse(project)) ||
      (activeFilter === "Por revisar" &&
        project.status === "Listo para revisión") ||
      (activeFilter === "Por vencer" && isDueSoon(project)) ||
      (activeFilter === "Atrasados" && isOverdue(project));

    return matchesSearch && matchesFilter;
  });
}

function isProjectAssignedToUser(project, userId) {
  return (
    project?.assignedToUid === userId ||
    project?.assignedToId === userId ||
    project?.assignedTo === userId ||
    project?.responsibleUid === userId ||
    project?.responsibleId === userId
  );
}

function isUserCollaboratorInProject(project, userId) {
  const collaboratorIds = normalizeArray(project?.collaboratorIds);

  return collaboratorIds.includes(userId);
}

function isHistoricalProject(project) {
  return (
    project?.deleted === true ||
    project?.archived === true ||
    project?.status === "Eliminado" ||
    project?.status === "Finalizado" ||
    project?.status === "Terminado" ||
    project?.status === "Cancelado" ||
    project?.status === "Archivado" ||
    Boolean(project?.finishedAt) ||
    Boolean(project?.cancelledAt) ||
    Boolean(project?.deletedAt) ||
    Boolean(project?.archivedAt)
  );
}

function isInCourse(project) {
  return [
    "Pendiente",
    "Por iniciar",
    "Asignado",
    "En planeación",
    "En proceso",
    "En espera de información",
    "Correcciones solicitadas",
    "Pausado",
  ].includes(project.status);
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

function isOverdue(project) {
  const days = getDaysDifference(project.deadline);

  return days !== null && days < 0 && !isHistoricalProject(project);
}

function isDueSoon(project) {
  const days = getDaysDifference(project.deadline);

  return (
    days !== null &&
    days >= 0 &&
    days <= 3 &&
    !isHistoricalProject(project)
  );
}

function renderDeadlineLabel(project) {
  const days = getDaysDifference(project.deadline);

  if (days === null) return "Sin fecha";
  if (days < 0) return `${Math.abs(days)} día(s) vencido`;
  if (days === 0) return "Vence hoy";
  if (days <= 3) return `${days} día(s) restantes`;

  return `${days} días restantes`;
}

function getStatusBadgeColor(project) {
  if (isOverdue(project)) return "red";

  if (project.status === "Listo para revisión") return "purple";
  if (project.status === "Correcciones solicitadas") return "orange";
  if (project.status === "En proceso") return "green";
  if (project.status === "En planeación") return "blue";
  if (project.status === "Pausado") return "gold";

  return "blue";
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];

  return value.filter(Boolean);
}

function removeDuplicatedProjects(projects) {
  const map = new Map();

  projects.forEach((project) => {
    map.set(project.id, project);
  });

  return Array.from(map.values());
}

function sortByCreatedAtDesc(projects) {
  return [...projects].sort((a, b) => {
    const dateA = parseDate(a.createdAt);
    const dateB = parseDate(b.createdAt);

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;

    return dateB.getTime() - dateA.getTime();
  });
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