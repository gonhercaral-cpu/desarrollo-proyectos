import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";
import { calculateAutomaticProgress } from "../utils/progressUtils";

const PROJECTS_COLLECTION = "projects";


function MyProjectsMenuIcon({ className = "" }) {
  return (
    <svg className={`my-projects-menu-svg ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 13h6" />
      <path d="M8 17h4" />
    </svg>
  );
}

export default function MyProjects({ onOpenProject }) {
  const { profile, currentUser, firebaseUser, isAdmin } = useAuth();

  const [assignedProjects, setAssignedProjects] = useState([]);
  const [collaboratorProjects, setCollaboratorProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeFilter, setActiveFilter] = useState("Todos");
  const [activeProjectView, setActiveProjectView] = useState("Todos");
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
    return [
      ...assignedProjects.map((project) => ({
        ...project,
        relationType: "Asignado",
      })),
      ...collaboratorProjects.map((project) => ({
        ...project,
        relationType: "Colaboración",
      })),
    ];
  }, [assignedProjects, collaboratorProjects]);

  const visibleProjects = useMemo(() => {
    let projects = allMyProjects;

    if (activeProjectView === "Asignados") {
      projects = projects.filter((project) => project.relationType === "Asignado");
    }

    if (activeProjectView === "Colaboraciones") {
      projects = projects.filter(
        (project) => project.relationType === "Colaboración"
      );
    }

    return filterProjects(projects, activeFilter, searchText);
  }, [allMyProjects, activeProjectView, activeFilter, searchText]);

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
    : agendaProjects.slice(0, 4);

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
    : recentActivity.slice(0, 4);

  if (loading) {
    return (
      <div className="my-projects-redesign">
        <div className="dashboard-loading-card">Cargando tus proyectos...</div>
      </div>
    );
  }

  return (
    <div className="my-projects-redesign">
      <section className="module-topbar module-topbar-my-projects">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <MyProjectsMenuIcon />
          </span>

          <div className="module-topbar-copy">
            <p className="section-kicker module-topbar-kicker">Operación</p>
            <h1>Mis proyectos</h1>
            <p>
              Consulta tus proyectos asignados, colaboraciones y próximos vencimientos desde una vista limpia y fácil de revisar.
            </p>
          </div>
        </div>

        <div className="module-topbar-actions">
          <button className="module-topbar-button" onClick={loadProjects}>
            ↻ Actualizar
          </button>

          <label className="module-topbar-search">
            <span>⌕</span>
            <input
              id="my-projects-search"
              name="search"
              type="text"
              placeholder="Buscar proyecto o departamento..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
        </div>
      </section>

      {message && <div className="message-box">{message}</div>}

      <div className="my-projects-metrics-v2">
        <MetricAction
          icon={<MyProjectsMenuIcon />}
          value={metrics.assigned}
          title="Asignados"
          detail="Proyectos donde eres responsable"
          color="blue"
          onClick={() => {
            setActiveProjectView("Asignados");
            setActiveFilter("Todos");
          }}
        />

        <MetricAction
          icon="👥"
          value={metrics.collaborator}
          title="Colaboraciones"
          detail="Proyectos donde participas"
          color="teal"
          onClick={() => {
            setActiveProjectView("Colaboraciones");
            setActiveFilter("Todos");
          }}
        />

        <MetricAction
          icon="◷"
          value={metrics.inProgress}
          title="En curso"
          detail="Proyectos activos"
          color="green"
          onClick={() => {
            setActiveProjectView("Todos");
            setActiveFilter("En curso");
          }}
        />

        <MetricAction
          icon="⚑"
          value={metrics.dueSoon}
          title="Por vencer"
          detail="Vencen en 3 días o menos"
          color="orange"
          onClick={() => {
            setActiveProjectView("Todos");
            setActiveFilter("Por vencer");
          }}
        />

        <MetricAction
          icon="☑"
          value={metrics.readyForReview}
          title="Por revisión"
          detail="Listos para revisión"
          color="purple"
          onClick={() => {
            setActiveProjectView("Todos");
            setActiveFilter("Por revisar");
          }}
        />
      </div>

      <div className="my-projects-layout-v2">
        <main className="my-projects-main-v2">
          <section className="my-projects-workspace-v2">
            <div className="my-projects-workspace-header-v2">
              <div className="my-projects-section-title-v2">
                <div className="my-projects-section-icon-v2"><MyProjectsMenuIcon /></div>
                <div>
                  <h3>Mis proyectos activos</h3>
                  <p>
                    Revisa tus asignaciones y colaboraciones desde una sola
                    vista.
                  </p>
                </div>
              </div>

              <div className="workspace-count">
                <strong>{visibleProjects.length}</strong>
                <span>mostrados</span>
              </div>
            </div>

            <div className="workspace-toolbar-v2">
              <div className="project-view-tabs">
                {['Todos', 'Asignados', 'Colaboraciones'].map((view) => (
                  <button
                    type="button"
                    key={view}
                    className={activeProjectView === view ? "active" : ""}
                    onClick={() => setActiveProjectView(view)}
                  >
                    {view}
                  </button>
                ))}
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

            <ProjectList
              projects={visibleProjects}
              onOpenProject={onOpenProject}
            />
          </section>
        </main>

        <aside className="my-projects-side-v2">
          <section className="my-projects-side-card-v2">
            <SectionHeader
              icon="▣"
              title="Próximos vencimientos"
              action={showFullAgenda ? "Ver menos" : "Ver todos"}
              onAction={() => setShowFullAgenda((current) => !current)}
            />

            <div className="my-projects-deadline-list-v2">
              {visibleAgendaProjects.length === 0 ? (
                <EmptyState text="No tienes vencimientos próximos." />
              ) : (
                visibleAgendaProjects.map((project) => (
                  <button
                    type="button"
                    className="my-projects-deadline-item-v2"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className={`side-item-icon-v2 ${isOverdue(project) ? "red" : "blue"}`}>▣</span>

                    <div>
                      <strong>{project.title}</strong>
                      <small>{getProjectDepartmentName(project)}</small>
                    </div>

                    <Badge color={isOverdue(project) ? "red" : "orange"}>
                      {renderDeadlineLabel(project)}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="my-projects-side-card-v2">
            <SectionHeader
              icon="↻"
              title="Actividad reciente"
              action={showFullActivity ? "Ver menos" : "Ver más"}
              onAction={() => setShowFullActivity((current) => !current)}
            />

            <div className="my-projects-activity-list-v2">
              {visibleActivity.length === 0 ? (
                <EmptyState text="No hay actividad reciente." />
              ) : (
                visibleActivity.map((project) => (
                  <button
                    type="button"
                    className="my-projects-activity-item-v2"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className="side-item-icon-v2 teal">▧</span>

                    <div>
                      <strong>{project.title}</strong>
                      <p>
                        <Badge color={getStatusBadgeColor(project)}>
                          {project.status || "Sin estado"}
                        </Badge>
                        <small>{formatDate(project.updatedAt || project.createdAt)}</small>
                      </p>
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

function ProjectList({ projects, onOpenProject }) {
  return (
    <div className="my-project-card-list-v2">
      {projects.length === 0 ? (
        <EmptyState text="No hay proyectos para mostrar con estos filtros." />
      ) : (
        projects.map((project) => {
          const progress = calculateAutomaticProgress(project);

          return (
            <article className="my-project-card-v2" key={project.id}>
              <div className="my-project-icon-v2">
                {project.relationType === "Asignado" ? <MyProjectsMenuIcon /> : "▥"}
              </div>

              <div className="my-project-card-body-v2">
                <div className="my-project-card-top-v2">
                  <div>
                    <div className="project-title-line">
                      <h3>{project.title}</h3>

                      <Badge
                        color={project.relationType === "Asignado" ? "blue" : "teal"}
                      >
                        {project.relationType}
                      </Badge>
                    </div>

                    <p>{project.description || "Sin descripción registrada."}</p>
                  </div>

                  <Badge color={getStatusBadgeColor(project)}>
                    {isOverdue(project)
                      ? "Atrasado"
                      : project.status || "Sin estado"}
                  </Badge>
                </div>

                <div className="my-project-meta-grid-v2">
                  <MetaItem label="Departamento" value={getProjectDepartmentName(project)} icon="▥" />
                  <MetaItem label="Prioridad" value={project.priority} icon="⚑" />
                  <MetaItem
                    label="Fecha límite"
                    value={formatPlainDate(project.deadline)}
                    icon="▣"
                  />
                  <MetaItem
                    label="Responsable"
                    value={project.assignedToName || project.responsibleName || "Sin responsable"}
                    icon="👤"
                  />
                </div>

                <div className="my-project-progress-row-v2">
                  <div>
                    <span>Avance</span>
                    <strong>{progress}%</strong>
                  </div>

                  <div className="area-progress-track">
                    <div
                      className="area-progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <button
                    type="button"
                    className="visual-primary-button my-project-detail-button-v2"
                    onClick={() => onOpenProject(project.id)}
                  >
                    Ver detalle <span>›</span>
                  </button>
                </div>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

function MetricAction({ icon, value, title, detail, color, onClick }) {
  return (
    <button
      type="button"
      className={`my-project-metric-card-v2 ${color}`}
      onClick={onClick}
    >
      <span className="my-project-metric-icon-v2">{icon}</span>

      <div>
        <strong>{value}</strong>
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
    </button>
  );
}

function SectionHeader({ icon, title, action, onAction }) {
  return (
    <div className="my-projects-side-header-v2">
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
    <div className="empty-state my-projects-empty-v2">
      <div>✦</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function MetaItem({ label, value, danger, icon }) {
  return (
    <div className="meta-item my-project-meta-item-v2">
      {icon && <span className="meta-item-icon-v2">{icon}</span>}
      <div>
        <span>{label}</span>
        <strong className={danger ? "danger-text" : ""}>
          {value || "Sin información"}
        </strong>
      </div>
    </div>
  );
}

function getProjectDepartmentName(project) {
  return (
    project?.departmentName ||
    project?.responsibleDepartmentName ||
    project?.responsibleArea ||
    "Sin departamento"
  );
}

function filterProjects(projects, activeFilter, searchText) {
  const search = searchText.trim().toLowerCase();

  return projects.filter((project) => {
    const matchesSearch =
      !search ||
      project.title?.toLowerCase().includes(search) ||
      project.description?.toLowerCase().includes(search) ||
      getProjectDepartmentName(project).toLowerCase().includes(search) ||
      project.responsibleArea?.toLowerCase().includes(search) ||
      project.assignedToName?.toLowerCase().includes(search) ||
      project.status?.toLowerCase().includes(search) ||
      project.relationType?.toLowerCase().includes(search);

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
