import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import CreateProject from "./CreateProject";
import MyProjects from "./MyProjects";
import AllProjects from "./AllProjects";
import ProjectHistory from "./ProjectHistory";
import ProjectDetail from "./ProjectDetail";
import EditProject from "./EditProject";
import ExecutiveDashboard from "./ExecutiveDashboard";
import CollaboratorsAdmin from "./CollaboratorsAdmin";
import TechnicalSupport from "./TechnicalSupport";
import PrintShop from "./printshop";
import PurchaseRequests from "./PurchaseRequests";
import TeamAgenda from "./TeamAgenda";
import IdeasIncubator from "./IdeasIncubator";
import DepartmentsAdmin from "../components/DepartmentsAdmin";
import { auth, db, storage } from "../services/firebase";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

const DASHBOARD_STORAGE_KEYS = {
  page: "dp.dashboard.activePage",
  returnPage: "dp.dashboard.returnPage",
  selectedProjectId: "dp.dashboard.selectedProjectId",
};

function getStoredDashboardValue(key, fallback = "") {
  if (typeof window === "undefined") return fallback;

  const value = window.localStorage.getItem(key);
  return value || fallback;
}

function setStoredDashboardValue(key, value) {
  if (typeof window === "undefined") return;

  if (value === null || value === undefined || value === "") {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, value);
}


function DashboardNavIcon({ name }) {
  return (
    <svg className="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      {renderDashboardNavIconPath(name)}
    </svg>
  );
}

function renderDashboardNavIconPath(name) {
  switch (name) {
    case "dashboard":
      return (
        <>
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <rect x="14" y="14" width="7" height="7" rx="2" />
        </>
      );
    case "myProjects":
      return (
        <>
          <path d="M5 5h14v14H5z" />
          <path d="M8 9h8" />
          <path d="M8 13h6" />
          <path d="M8 17h4" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M3 10h18" />
        </>
      );
    case "purchase":
      return (
        <>
          <path d="M4 5h2l2.1 9.2a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 1.9-1.4L21 8H7" />
          <circle cx="10" cy="20" r="1.4" />
          <circle cx="17" cy="20" r="1.4" />
        </>
      );
    case "ideas":
      return (
        <>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M8 14.5a6 6 0 1 1 8 0c-.9.8-1.3 1.6-1.3 2.5H9.3c0-.9-.4-1.7-1.3-2.5z" />
        </>
      );
    case "print":
      return (
        <>
          <path d="M7 8V4h10v4" />
          <rect x="6" y="14" width="12" height="7" rx="1.5" />
          <rect x="4" y="8" width="16" height="9" rx="2" />
          <circle cx="17" cy="11.5" r="1" />
        </>
      );
    case "technical":
      return (
        <>
          <path d="M14.5 5.5l4 4" />
          <path d="M4 20l6.5-6.5" />
          <path d="M12.5 3.5l8 8-2.5 2.5-8-8z" />
        </>
      );
    case "allProjects":
      return (
        <>
          <path d="M4 6.5h16" />
          <path d="M4 12h16" />
          <path d="M4 17.5h12" />
        </>
      );
    case "collaborators":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.5 15.5a4.5 4.5 0 0 1 5 4.5" />
        </>
      );
    case "departments":
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      );
    case "history":
      return (
        <>
          <path d="M7 7h7a6 6 0 1 1-5.2 9" />
          <path d="M7 7V3" />
          <path d="M7 7H3" />
        </>
      );
    case "create":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </>
      );
    case "messages":
      return (
        <>
          <path d="M4 5.5h16v10.5H8l-4 3.5V5.5z" />
          <path d="M8 9h8" />
          <path d="M8 12.5h5.5" />
        </>
      );
    case "more":
      return (
        <>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </>
      );
    default:
      return <circle cx="12" cy="12" r="8" />;
  }
}


function getDashboardNavigationItems({ isAdmin, canUsePrintShop, canUseTechnicalSupport }) {
  const items = [];

  if (isAdmin) {
    items.push({ page: "executive-dashboard", label: "Dashboard ejecutivo", mobileLabel: "Ejecutivo", icon: "dashboard" });
  }

  items.push({ page: "workspace-dashboard", label: "Tablero", mobileLabel: "Inicio", icon: "dashboard" });
  items.push({ page: "internal-messages", label: "Mensajes", mobileLabel: "Mensajes", icon: "messages" });
  items.push({ page: "my-projects", label: "Mis proyectos", mobileLabel: "Proyectos", icon: "myProjects" });
  items.push({ page: "team-agenda", label: "Agenda del equipo", mobileLabel: "Agenda", icon: "calendar" });
  items.push({ page: "purchase-requests", label: "Solicitudes de compra", mobileLabel: "Compras", icon: "purchase" });
  items.push({ page: "ideas-incubator", label: "Incubadora de ideas", mobileLabel: "Ideas", icon: "ideas" });

  if (canUsePrintShop) {
    items.push({ page: "print-shop", label: "Imprenta", mobileLabel: "Imprenta", icon: "print" });
  }

  if (canUseTechnicalSupport) {
    items.push({ page: "technical-support", label: "Soporte Técnico", mobileLabel: "Soporte", icon: "technical" });
  }

  if (isAdmin) {
    items.push({ page: "all-projects", label: "Todos los proyectos", mobileLabel: "Todos", icon: "allProjects" });
    items.push({ page: "collaborators-admin", label: "Colaboradores", mobileLabel: "Equipo", icon: "collaborators" });
    items.push({ page: "departments-admin", label: "Departamentos", mobileLabel: "Áreas", icon: "departments" });
    items.push({ page: "project-history", label: "Historial", mobileLabel: "Historial", icon: "history" });
    items.push({ page: "create-project", label: "Alta de proyecto", mobileLabel: "Alta", icon: "create" });
  }

  return items;
}

function getMobilePrimaryNavigationItems(items, { isAdmin, canUsePrintShop, canUseTechnicalSupport }) {
  const preferredPages = isAdmin
    ? ["executive-dashboard", "workspace-dashboard", "internal-messages", "my-projects"]
    : ["workspace-dashboard", "internal-messages", "my-projects", "team-agenda"];

  const preferred = preferredPages
    .map((pageName) => items.find((item) => item.page === pageName))
    .filter(Boolean);

  if (preferred.length >= 4) {
    return preferred.slice(0, 4);
  }

  const fallback = items.filter(
    (item) => !preferred.some((preferredItem) => preferredItem.page === item.page)
  );

  return [...preferred, ...fallback].slice(0, 4);
}

function getSafeDashboardPage(page, { isAdmin, canUsePrintShop, canUseTechnicalSupport }) {
  const defaultPage = isAdmin ? "executive-dashboard" : "workspace-dashboard";
  const adminOnlyPages = new Set([
    "executive-dashboard",
    "all-projects",
    "project-history",
    "create-project",
    "collaborators-admin",
    "departments-admin",
  ]);

  if (!page) return defaultPage;
  if (adminOnlyPages.has(page) && !isAdmin) return defaultPage;
  if (page === "print-shop" && !canUsePrintShop) return defaultPage;
  if (page === "technical-support" && !canUseTechnicalSupport) return defaultPage;

  return page;
}

export default function Dashboard() {
  const { profile, logout, isAdmin } = useAuth();
  const userDepartmentNames = getProfileDepartmentNames(profile);
  const canUsePrintShop =
    isAdmin ||
    userDepartmentNames.some(
      (departmentName) =>
        departmentName === "imprenta" || departmentName === "soporte tecnico"
    );

  const canUseTechnicalSupport = canAccessTechnicalSupport(profile, isAdmin);

  const defaultDashboardPage = isAdmin ? "executive-dashboard" : "workspace-dashboard";
  const defaultReturnPage = isAdmin ? "all-projects" : "workspace-dashboard";

  const [page, setPageState] = useState(() =>
    getStoredDashboardValue(DASHBOARD_STORAGE_KEYS.page, defaultDashboardPage)
  );
  const [selectedProjectId, setSelectedProjectIdState] = useState(() =>
    getStoredDashboardValue(DASHBOARD_STORAGE_KEYS.selectedProjectId, "")
  );
  const [returnPage, setReturnPageState] = useState(() =>
    getStoredDashboardValue(DASHBOARD_STORAGE_KEYS.returnPage, defaultReturnPage)
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unreadMessagesCount = useUnreadInternalMessagesCount(profile);
  const unreadAnnouncementsCount = useUnreadAnnouncementsCount(profile);

  useDashboardPresence(profile, page);

  function setPage(nextPage) {
    setPageState(nextPage);
    setStoredDashboardValue(DASHBOARD_STORAGE_KEYS.page, nextPage);
  }

  function setSelectedProjectId(projectId) {
    const nextProjectId = projectId || "";
    setSelectedProjectIdState(nextProjectId);
    setStoredDashboardValue(DASHBOARD_STORAGE_KEYS.selectedProjectId, nextProjectId);
  }

  function setReturnPage(nextReturnPage) {
    const fallbackReturnPage = isAdmin ? "all-projects" : "my-projects";
    const safeReturnPage = nextReturnPage || fallbackReturnPage;
    setReturnPageState(safeReturnPage);
    setStoredDashboardValue(DASHBOARD_STORAGE_KEYS.returnPage, safeReturnPage);
  }

  useEffect(() => {
    const safePage = getSafeDashboardPage(page, {
      isAdmin,
      canUsePrintShop,
      canUseTechnicalSupport,
    });

    if (safePage !== page) {
      setSelectedProjectId(null);
      setReturnPage(safePage);
      setPage(safePage);
    }
  }, [page, isAdmin, canUsePrintShop, canUseTechnicalSupport]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pageFromUrl = params.get("page");
    const assetIdFromUrl = params.get("assetId");

    if (
      canUseTechnicalSupport &&
      (pageFromUrl === "technical-support" || assetIdFromUrl)
    ) {
      setSelectedProjectId(null);
      setReturnPage("technical-support");
      setPage("technical-support");
      setProfileMenuOpen(false);
      setProfilePanelOpen(false);
      return;
    }

    if (canUsePrintShop && pageFromUrl === "print-shop") {
      setSelectedProjectId(null);
      setReturnPage("print-shop");
      setPage("print-shop");
      setProfileMenuOpen(false);
      setProfilePanelOpen(false);
    }
  }, [canUseTechnicalSupport, canUsePrintShop]);

  function goToPage(nextPage) {
    const safePage = getSafeDashboardPage(nextPage, {
      isAdmin,
      canUsePrintShop,
      canUseTechnicalSupport,
    });

    setSelectedProjectId(null);
    setPage(safePage);
    setReturnPage(safePage);
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
    setMobileMenuOpen(false);
  }

  function goToHomeDashboard() {
    goToPage(isAdmin ? "executive-dashboard" : "workspace-dashboard");
  }

  function openProject(projectId) {
    setSelectedProjectId(projectId);

    if (page === "project-history") {
      setReturnPage("project-history");
    } else if (page === "my-projects") {
      setReturnPage("my-projects");
    } else if (page === "executive-dashboard") {
      setReturnPage("executive-dashboard");
    } else if (page === "workspace-dashboard") {
      setReturnPage("workspace-dashboard");
    } else if (page === "collaborators-admin") {
      setReturnPage("collaborators-admin");
    } else if (page === "departments-admin") {
      setReturnPage("departments-admin");
    } else if (page === "technical-support") {
      setReturnPage("technical-support");
    } else if (page === "print-shop") {
      setReturnPage("print-shop");
    } else if (page === "purchase-requests") {
      setReturnPage("purchase-requests");
    } else if (page === "team-agenda") {
      setReturnPage("team-agenda");
    } else if (page === "ideas-incubator") {
      setReturnPage("ideas-incubator");
    } else {
      setReturnPage(isAdmin ? "all-projects" : "my-projects");
    }

    setPage("project-detail");
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
    setMobileMenuOpen(false);
  }

  function editProject(projectId) {
    setSelectedProjectId(projectId);
    setPage("edit-project");
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
    setMobileMenuOpen(false);
  }

  function backToProjects() {
    setSelectedProjectId(null);
    setPage(returnPage || (isAdmin ? "all-projects" : "my-projects"));
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
    setMobileMenuOpen(false);
  }

  function handleViewProfile() {
    setProfilePanelOpen(true);
    setProfileMenuOpen(false);
  }

  function handleLogout() {
    setProfileMenuOpen(false);
    Object.values(DASHBOARD_STORAGE_KEYS).forEach((storageKey) =>
      setStoredDashboardValue(storageKey, "")
    );
    logout();
  }

  function renderPage() {
    if (profilePanelOpen) {
      return (
        <ProfilePage
          profile={profile}
          isAdmin={isAdmin}
          onClose={() => setProfilePanelOpen(false)}
        />
      );
    }

    if (page === "workspace-dashboard") {
      return <WorkspaceDashboard profile={profile} isAdmin={isAdmin} />;
    }

    if (page === "internal-messages") {
      return <InternalMessages profile={profile} />;
    }

    if (page === "executive-dashboard" && isAdmin) {
      return <ExecutiveDashboard onOpenProject={openProject} onOpenModule={goToPage} />;
    }

    if (page === "collaborators-admin" && isAdmin) {
      return <CollaboratorsAdmin />;
    }

    if (page === "departments-admin" && isAdmin) {
      return <DepartmentsAdmin />;
    }

    if (page === "technical-support" && canUseTechnicalSupport) {
      return <TechnicalSupport />;
    }

    if (page === "print-shop" && canUsePrintShop) {
      return <PrintShop />;
    }

    if (page === "purchase-requests") {
      return <PurchaseRequests />;
    }

    if (page === "team-agenda") {
      return <TeamAgenda />;
    }

    if (page === "ideas-incubator") {
      return <IdeasIncubator />;
    }

    if (page === "create-project" && isAdmin) {
      return <CreateProject />;
    }

    if (page === "all-projects" && isAdmin) {
      return (
        <AllProjects
          onOpenProject={openProject}
          onEditProject={editProject}
        />
      );
    }

    if (page === "project-history" && isAdmin) {
      return <ProjectHistory onOpenProject={openProject} />;
    }

    if (page === "edit-project") {
      if (!selectedProjectId) {
        return (
          <div className="card">
            <h2>No se seleccionó ningún proyecto</h2>
            <p>
              Regresa al listado de proyectos y selecciona uno para editarlo.
            </p>

            <button onClick={backToProjects}>Volver a proyectos</button>
          </div>
        );
      }

      return (
        <EditProject
          projectId={selectedProjectId}
          onBack={() => setPage("project-detail")}
          onSaved={() => setPage("project-detail")}
        />
      );
    }

    if (page === "project-detail") {
      if (!selectedProjectId) {
        return (
          <div className="card">
            <h2>No se seleccionó ningún proyecto</h2>
            <p>Regresa al listado de proyectos y selecciona uno para verlo.</p>

            <button onClick={backToProjects}>Volver a proyectos</button>
          </div>
        );
      }

      return (
        <ProjectDetail
          projectId={selectedProjectId}
          onBack={backToProjects}
          onEditProject={editProject}
        />
      );
    }

    return <MyProjects onOpenProject={openProject} />;
  }

  function isNavActive(navPage) {
    if (navPage === "workspace-dashboard") {
      return page === "workspace-dashboard";
    }

    if (navPage === "all-projects") {
      return (
        page === "all-projects" ||
        (returnPage === "all-projects" &&
          (page === "project-detail" || page === "edit-project"))
      );
    }

    if (navPage === "project-history") {
      return (
        page === "project-history" ||
        (returnPage === "project-history" &&
          (page === "project-detail" || page === "edit-project"))
      );
    }

    if (navPage === "my-projects") {
      return (
        page === "my-projects" ||
        (returnPage === "my-projects" &&
          (page === "project-detail" || page === "edit-project"))
      );
    }

    if (navPage === "executive-dashboard") {
      return (
        page === "executive-dashboard" ||
        (returnPage === "executive-dashboard" &&
          (page === "project-detail" || page === "edit-project"))
      );
    }

    if (navPage === "collaborators-admin") {
      return page === "collaborators-admin";
    }

    if (navPage === "departments-admin") {
      return page === "departments-admin";
    }

    if (navPage === "technical-support") {
      return page === "technical-support";
    }

    if (navPage === "print-shop") {
      return page === "print-shop";
    }

    if (navPage === "purchase-requests") {
      return page === "purchase-requests";
    }

    if (navPage === "team-agenda") {
      return page === "team-agenda";
    }

    if (navPage === "ideas-incubator") {
      return page === "ideas-incubator";
    }

    return page === navPage;
  }

  const navigationItems = getDashboardNavigationItems({
    isAdmin,
    canUsePrintShop,
    canUseTechnicalSupport,
  }).map((item) => {
    if (item.page === "workspace-dashboard") {
      return { ...item, badgeCount: unreadAnnouncementsCount };
    }

    if (item.page === "internal-messages") {
      return { ...item, badgeCount: unreadMessagesCount };
    }

    return item;
  });
  const mobilePrimaryItems = getMobilePrimaryNavigationItems(navigationItems, {
    isAdmin,
    canUsePrintShop,
    canUseTechnicalSupport,
  });
  const activeNavigationItem =
    navigationItems.find((item) => isNavActive(item.page)) ||
    navigationItems[0];

  return (
    <div className="app-shell">
      <MobileAppHeader
        profile={profile}
        title={activeNavigationItem?.label || "Desarrollo de Proyectos"}
        subtitle={isAdmin ? "Panel administrador" : "Mi espacio de trabajo"}
        onHome={goToHomeDashboard}
        onOpenMenu={() => {
          setMobileMenuOpen(true);
          setProfileMenuOpen(false);
        }}
        onOpenProfile={handleViewProfile}
      />

      <aside className="sidebar">
        <div className="sidebar-brand-panel">
          <button
            type="button"
            className="sidebar-logo-button"
            onClick={goToHomeDashboard}
            title={isAdmin ? "Volver al Dashboard ejecutivo" : "Volver a Mis proyectos"}
          >
            <img
              src="/active-logo.png"
              alt="Active English School"
              className="sidebar-logo"
            />
          </button>

          <h1>Active English School</h1>

          <div className="sidebar-divider" />

          <h2>
            Desarrollo de
            <br />
            Proyectos
          </h2>
        </div>

        <nav className="sidebar-nav">
          {isAdmin && (
            <button
              className={isNavActive("executive-dashboard") ? "active" : ""}
              onClick={() => goToPage("executive-dashboard")}
            >
              <span className="nav-icon"><DashboardNavIcon name="dashboard" /></span>
              Dashboard ejecutivo
            </button>
          )}

          <button
            className={isNavActive("workspace-dashboard") ? "active" : ""}
            onClick={() => goToPage("workspace-dashboard")}
          >
            <span className="nav-icon"><DashboardNavIcon name="dashboard" /></span>
            <span className="sidebar-nav-label">Tablero</span>
            {unreadAnnouncementsCount > 0 && (
              <span
                className="nav-unread-badge nav-announcement-badge"
                aria-label={`${unreadAnnouncementsCount} anuncios pendientes de confirmar`}
              >
                {formatUnreadBadgeCount(unreadAnnouncementsCount)}
              </span>
            )}
          </button>

          <button
            className={isNavActive("internal-messages") ? "active" : ""}
            onClick={() => goToPage("internal-messages")}
          >
            <span className="nav-icon"><DashboardNavIcon name="messages" /></span>
            <span className="sidebar-nav-label">Mensajes</span>
            {unreadMessagesCount > 0 && (
              <span className="nav-unread-badge" aria-label={`${unreadMessagesCount} mensajes no leídos`}>
                {formatUnreadBadgeCount(unreadMessagesCount)}
              </span>
            )}
          </button>

          <button
            className={isNavActive("my-projects") ? "active" : ""}
            onClick={() => goToPage("my-projects")}
          >
            <span className="nav-icon"><DashboardNavIcon name="myProjects" /></span>
            Mis proyectos
          </button>

          <button
            className={isNavActive("team-agenda") ? "active" : ""}
            onClick={() => goToPage("team-agenda")}
          >
            <span className="nav-icon"><DashboardNavIcon name="calendar" /></span>
            Agenda del equipo
          </button>

          <button
            className={isNavActive("purchase-requests") ? "active" : ""}
            onClick={() => goToPage("purchase-requests")}
          >
            <span className="nav-icon"><DashboardNavIcon name="purchase" /></span>
            Solicitudes de compra
          </button>

          <button
            className={isNavActive("ideas-incubator") ? "active" : ""}
            onClick={() => goToPage("ideas-incubator")}
          >
            <span className="nav-icon"><DashboardNavIcon name="ideas" /></span>
            Incubadora de ideas
          </button>

          {canUsePrintShop && (
            <button
              className={isNavActive("print-shop") ? "active" : ""}
              onClick={() => goToPage("print-shop")}
            >
              <span className="nav-icon"><DashboardNavIcon name="print" /></span>
              Imprenta
            </button>
          )}

          {canUseTechnicalSupport && (
            <button
              className={isNavActive("technical-support") ? "active" : ""}
              onClick={() => goToPage("technical-support")}
            >
              <span className="nav-icon"><DashboardNavIcon name="technical" /></span>
              Soporte Técnico
            </button>
          )}

          {isAdmin && (
            <>
              <button
                className={isNavActive("all-projects") ? "active" : ""}
                onClick={() => goToPage("all-projects")}
              >
                <span className="nav-icon"><DashboardNavIcon name="allProjects" /></span>
                Todos los proyectos
              </button>

              <button
                className={
                  isNavActive("collaborators-admin") ? "active" : ""
                }
                onClick={() => goToPage("collaborators-admin")}
              >
                <span className="nav-icon"><DashboardNavIcon name="collaborators" /></span>
                Colaboradores
              </button>

              <button
                className={isNavActive("departments-admin") ? "active" : ""}
                onClick={() => goToPage("departments-admin")}
              >
                <span className="nav-icon"><DashboardNavIcon name="departments" /></span>
                Departamentos
              </button>

              <button
                className={isNavActive("project-history") ? "active" : ""}
                onClick={() => goToPage("project-history")}
              >
                <span className="nav-icon"><DashboardNavIcon name="history" /></span>
                Historial
              </button>

              <button
                className={isNavActive("create-project") ? "active" : ""}
                onClick={() => goToPage("create-project")}
              >
                <span className="nav-icon"><DashboardNavIcon name="create" /></span>
                Alta de proyecto
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-icon">▥</div>

          <div>
            <strong>Desarrollo de Proyectos</strong>
            <span>Área administrativa</span>
          </div>
        </div>
      </aside>

      <MobileModuleDrawer
        open={mobileMenuOpen}
        items={navigationItems}
        isAdmin={isAdmin}
        profile={profile}
        isNavActive={isNavActive}
        onNavigate={goToPage}
        onClose={() => setMobileMenuOpen(false)}
        onViewProfile={handleViewProfile}
        onLogout={handleLogout}
      />

      <main className="main-content">
        <TopProfileBar
          profile={profile}
          isAdmin={isAdmin}
          profileMenuOpen={profileMenuOpen}
          setProfileMenuOpen={setProfileMenuOpen}
          onViewProfile={handleViewProfile}
          onLogout={handleLogout}
        />

        {renderPage()}
      </main>

      <MobileBottomNavigation
        primaryItems={mobilePrimaryItems}
        allItems={navigationItems}
        isNavActive={isNavActive}
        onNavigate={goToPage}
        onOpenMore={() => {
          setMobileMenuOpen(true);
          setProfileMenuOpen(false);
        }}
      />
    </div>
  );
}



function WorkspaceDashboard({ profile, isAdmin }) {
  const currentUserId = getCurrentUserId(profile);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementReceipts, setAnnouncementReceipts] = useState({});
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    message: "",
    priority: "normal",
  });
  const [announcementAttachments, setAnnouncementAttachments] = useState([]);
  const [originalAnnouncementAttachments, setOriginalAnnouncementAttachments] = useState([]);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [announcementStatus, setAnnouncementStatus] = useState("");
  const [announcementError, setAnnouncementError] = useState("");
  const [announcementSaving, setAnnouncementSaving] = useState(false);

  const [notes, setNotes] = useState([]);
  const [noteForm, setNoteForm] = useState({ title: "", content: "", pinned: false, color: "yellow" });
  const [noteAttachments, setNoteAttachments] = useState([]);
  const [originalNoteAttachments, setOriginalNoteAttachments] = useState([]);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [noteError, setNoteError] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const announcementsQuery = query(collection(db, "announcements"));

    return onSnapshot(
      announcementsQuery,
      (snapshot) => {
        const nextAnnouncements = snapshot.docs
          .map((announcementDoc) => ({
            id: announcementDoc.id,
            ...announcementDoc.data(),
            attachments: normalizeStoredAttachments(announcementDoc.data()?.attachments),
          }))
          .filter((announcement) => announcement.active !== false)
          .sort(sortByCreatedAtDesc)
          .slice(0, 12);

        setAnnouncements(nextAnnouncements);
        setAnnouncementError("");
      },
      (error) => {
        console.error("No se pudieron cargar los anuncios:", error);
        setAnnouncementError("No se pudieron cargar los anuncios.");
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || announcements.length === 0) {
      setAnnouncementReceipts({});
      return undefined;
    }

    const unsubscribers = announcements.map((announcement) => {
      const readsPath = ["announcements", announcement.id, "reads"];

      if (isAdmin) {
        return onSnapshot(
          collection(db, ...readsPath),
          (snapshot) => {
            const receipts = snapshot.docs
              .map((receiptDoc) => ({ id: receiptDoc.id, ...receiptDoc.data() }))
              .sort(sortByReadAtDesc);

            setAnnouncementReceipts((current) => ({
              ...current,
              [announcement.id]: receipts,
            }));
          },
          (error) => {
            console.error("No se pudieron cargar confirmaciones:", error);
          }
        );
      }

      return onSnapshot(
        doc(db, ...readsPath, currentUserId),
        (snapshot) => {
          setAnnouncementReceipts((current) => ({
            ...current,
            [announcement.id]: snapshot.exists()
              ? [{ id: snapshot.id, ...snapshot.data() }]
              : [],
          }));
        },
        (error) => {
          console.error("No se pudo cargar tu confirmación de lectura:", error);
        }
      );
    });

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [announcements, currentUserId, isAdmin]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const notesQuery = query(
      collection(db, "personalNotes"),
      where("userId", "==", currentUserId)
    );

    return onSnapshot(
      notesQuery,
      (snapshot) => {
        const nextNotes = snapshot.docs
          .map((noteDoc) => ({
            id: noteDoc.id,
            ...noteDoc.data(),
            attachments: normalizeStoredAttachments(noteDoc.data()?.attachments),
          }))
          .sort(sortPersonalNotes);

        setNotes(nextNotes);
        setNoteError("");
      },
      (error) => {
        console.error("No se pudieron cargar tus notas personales:", error);
        setNoteError("No se pudieron cargar tus notas personales.");
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    return () => {
      revokeDraftAttachmentPreviews(announcementAttachments);
      revokeDraftAttachmentPreviews(noteAttachments);
    };
  }, []);

  function resetAnnouncementEditor() {
    revokeDraftAttachmentPreviews(announcementAttachments);
    setAnnouncementForm({ title: "", message: "", priority: "normal" });
    setAnnouncementAttachments([]);
    setOriginalAnnouncementAttachments([]);
    setEditingAnnouncementId("");
  }

  function resetNoteEditor() {
    revokeDraftAttachmentPreviews(noteAttachments);
    setNoteForm({ title: "", content: "", pinned: false, color: "yellow" });
    setNoteAttachments([]);
    setOriginalNoteAttachments([]);
    setEditingNoteId("");
  }

  function handleAnnouncementFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateBoardFiles(files, announcementAttachments.length);
    if (!validation.valid) {
      setAnnouncementError(validation.message);
      return;
    }

    setAnnouncementAttachments((current) => [
      ...current,
      ...files.map(createDraftAttachment),
    ]);
    setAnnouncementError("");
  }

  function handleNoteFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateBoardFiles(files, noteAttachments.length);
    if (!validation.valid) {
      setNoteError(validation.message);
      return;
    }

    setNoteAttachments((current) => [
      ...current,
      ...files.map(createDraftAttachment),
    ]);
    setNoteError("");
  }

  function handleRemoveAnnouncementAttachment(attachmentId) {
    setAnnouncementAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  function handleRemoveNoteAttachment(attachmentId) {
    setNoteAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  async function handleAnnouncementSubmit(event) {
    event.preventDefault();
    setAnnouncementStatus("");
    setAnnouncementError("");

    if (!isAdmin) return;

    const cleanTitle = announcementForm.title.trim();
    const cleanMessage = announcementForm.message.trim();

    if (!cleanTitle || !cleanMessage) {
      setAnnouncementError("Escribe el título y el mensaje del anuncio.");
      return;
    }

    setAnnouncementSaving(true);

    try {
      const announcementId = editingAnnouncementId || doc(collection(db, "announcements")).id;
      const attachments = await uploadBoardAttachments(announcementAttachments, {
        folder: `dashboard/announcements/${announcementId}`,
        ownerUid: currentUserId,
      });
      const removedAttachments = getRemovedAttachments(
        originalAnnouncementAttachments,
        announcementAttachments
      );

      const payload = {
        title: cleanTitle,
        message: cleanMessage,
        priority: announcementForm.priority === "important" ? "important" : "normal",
        attachments,
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserId,
        updatedByName: profile?.name || "Usuario",
        updatedByEmail: profile?.email || "",
      };

      if (editingAnnouncementId) {
        await updateDoc(doc(db, "announcements", editingAnnouncementId), payload);
        setAnnouncementStatus("Anuncio actualizado.");
      } else {
        await setDoc(doc(db, "announcements", announcementId), {
          ...payload,
          active: true,
          createdAt: serverTimestamp(),
          createdByUid: currentUserId,
          createdByName: profile?.name || "Usuario",
          createdByEmail: profile?.email || "",
        });
        setAnnouncementStatus("Anuncio publicado.");
      }

      await deleteStoredAttachments(removedAttachments);
      resetAnnouncementEditor();
    } catch (error) {
      console.error("No se pudo guardar el anuncio:", error);
      setAnnouncementError("No se pudo guardar el anuncio.");
    } finally {
      setAnnouncementSaving(false);
    }
  }

  function handleEditAnnouncement(announcement) {
    resetAnnouncementEditor();
    const existingAttachments = normalizeStoredAttachments(announcement.attachments).map(markStoredAttachment);
    setEditingAnnouncementId(announcement.id);
    setOriginalAnnouncementAttachments(existingAttachments);
    setAnnouncementAttachments(existingAttachments);
    setAnnouncementForm({
      title: announcement.title || "",
      message: announcement.message || "",
      priority: announcement.priority === "important" ? "important" : "normal",
    });
    setAnnouncementStatus("");
    setAnnouncementError("");
  }

  async function handleArchiveAnnouncement(announcementId) {
    if (!isAdmin) return;

    try {
      await updateDoc(doc(db, "announcements", announcementId), {
        active: false,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserId,
        updatedByName: profile?.name || "Usuario",
        updatedByEmail: profile?.email || "",
      });
      setAnnouncementStatus("Anuncio archivado.");
    } catch (error) {
      console.error("No se pudo archivar el anuncio:", error);
      setAnnouncementError("No se pudo archivar el anuncio.");
    }
  }

  async function handleDeleteAnnouncement(announcement) {
    if (!isAdmin) return;

    try {
      await deleteDoc(doc(db, "announcements", announcement.id));
      await deleteStoredAttachments(announcement.attachments || []);
      setAnnouncementStatus("Anuncio eliminado.");
    } catch (error) {
      console.error("No se pudo eliminar el anuncio:", error);
      setAnnouncementError("No se pudo eliminar el anuncio.");
    }
  }

  async function handleMarkAnnouncementRead(announcementId) {
    if (!currentUserId) return;

    try {
      await setDoc(
        doc(db, "announcements", announcementId, "reads", currentUserId),
        {
          announcementId,
          userId: currentUserId,
          userName: profile?.name || "Usuario",
          userEmail: profile?.email || "",
          readAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("No se pudo marcar el anuncio como leído:", error);
      setAnnouncementError("No se pudo marcar el anuncio como leído.");
    }
  }

  async function handleNoteSubmit(event) {
    event.preventDefault();
    setNoteStatus("");
    setNoteError("");

    const cleanTitle = noteForm.title.trim();
    const cleanContent = noteForm.content.trim();

    if (!cleanTitle && !cleanContent && noteAttachments.length === 0) {
      setNoteError("Escribe una nota o agrega un archivo.");
      return;
    }

    setNoteSaving(true);

    try {
      const noteId = editingNoteId || doc(collection(db, "personalNotes")).id;
      const attachments = await uploadBoardAttachments(noteAttachments, {
        folder: `dashboard/personalNotes/${currentUserId}/${noteId}`,
        ownerUid: currentUserId,
      });
      const removedAttachments = getRemovedAttachments(originalNoteAttachments, noteAttachments);

      const payload = {
        userId: currentUserId,
        title: cleanTitle || "Nota personal",
        content: cleanContent,
        color: normalizeNoteColor(noteForm.color),
        attachments,
        pinned: Boolean(noteForm.pinned),
        updatedAt: serverTimestamp(),
      };

      if (editingNoteId) {
        await updateDoc(doc(db, "personalNotes", editingNoteId), payload);
        setNoteStatus("Nota actualizada.");
      } else {
        await setDoc(doc(db, "personalNotes", noteId), {
          ...payload,
          completed: false,
          createdAt: serverTimestamp(),
        });
        setNoteStatus("Nota guardada.");
      }

      await deleteStoredAttachments(removedAttachments);
      resetNoteEditor();
    } catch (error) {
      console.error("No se pudo guardar tu nota:", error);
      setNoteError("No se pudo guardar tu nota.");
    } finally {
      setNoteSaving(false);
    }
  }

  function handleEditNote(note) {
    resetNoteEditor();
    const existingAttachments = normalizeStoredAttachments(note.attachments).map(markStoredAttachment);
    setEditingNoteId(note.id);
    setOriginalNoteAttachments(existingAttachments);
    setNoteAttachments(existingAttachments);
    setNoteForm({
      title: note.title || "",
      content: note.content || "",
      pinned: Boolean(note.pinned),
      color: normalizeNoteColor(note.color),
    });
    setNoteStatus("");
    setNoteError("");
  }

  async function handleToggleNote(note, field) {
    try {
      await updateDoc(doc(db, "personalNotes", note.id), {
        [field]: !Boolean(note[field]),
        updatedAt: serverTimestamp(),
        userId: currentUserId,
      });
    } catch (error) {
      console.error("No se pudo actualizar tu nota:", error);
      setNoteError("No se pudo actualizar la nota.");
    }
  }

  async function handleDeleteNote(note) {
    try {
      await deleteDoc(doc(db, "personalNotes", note.id));
      await deleteStoredAttachments(note.attachments || []);
      setNoteStatus("Nota eliminada.");
    } catch (error) {
      console.error("No se pudo eliminar tu nota:", error);
      setNoteError("No se pudo eliminar la nota.");
    }
  }

  const unreadAnnouncements = announcements.filter(
    (announcement) => !announcementReceipts[announcement.id]?.length
  ).length;
  const pendingNotes = notes.filter((note) => !note.completed).length;
  const importantAnnouncements = announcements.filter(
    (announcement) => announcement.priority === "important"
  ).length;
  const notesWithAttachments = notes.filter((note) => Array.isArray(note.attachments) && note.attachments.length > 0).length;

  return (
    <div className="workspace-dashboard-page">
      <div className="visual-page-header workspace-dashboard-header workspace-board-header">
        <div>
          <span className="visual-page-kicker">Centro de trabajo</span>
          <h1>Tablero general</h1>
          <p>
            Consulta anuncios importantes, confirma su lectura y administra tus notas personales privadas.
          </p>
          {unreadAnnouncements > 0 && (
            <div className="announcement-pending-strip">
              <span>📣</span>
              <strong>{unreadAnnouncements} anuncio(s) pendiente(s) de confirmar</strong>
            </div>
          )}
        </div>

        <div className="workspace-dashboard-summary workspace-summary-grid">
          <div className="workspace-summary-card highlight-blue">
            <span className="summary-icon">📣</span>
            <strong>{announcements.length}</strong>
            <small>Anuncios activos</small>
          </div>
          <div className="workspace-summary-card highlight-orange">
            <span className="summary-icon">⚠️</span>
            <strong>{importantAnnouncements}</strong>
            <small>Importantes</small>
          </div>
          <div className="workspace-summary-card highlight-green">
            <span className="summary-icon">✅</span>
            <strong>{unreadAnnouncements}</strong>
            <small>Por confirmar</small>
          </div>
          <div className="workspace-summary-card highlight-yellow">
            <span className="summary-icon">📝</span>
            <strong>{pendingNotes}</strong>
            <small>Notas pendientes</small>
          </div>
        </div>
      </div>

      <div className="workspace-dashboard-grid">
        <section className="workspace-card announcements-card board-visual-card">
          <div className="workspace-card-header workspace-card-header-visual">
            <div>
              <span className="workspace-card-kicker">Comunicación interna</span>
              <h3>Tablero de anuncios</h3>
              <p>
                Aquí se publican avisos importantes para el equipo. Puedes adjuntar imágenes, audios, documentos y videos.
              </p>
            </div>
            <div className="workspace-card-side-badge announcement-side-badge">{announcements.length} activos</div>
          </div>

          {isAdmin && (
            <form className="announcement-form board-form-visual" onSubmit={handleAnnouncementSubmit}>
              <div className="announcement-form-grid">
                <label>
                  <span>Título del anuncio</span>
                  <input
                    value={announcementForm.title}
                    onChange={(event) =>
                      setAnnouncementForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Ej. Aviso general"
                    maxLength={90}
                  />
                </label>

                <label>
                  <span>Prioridad</span>
                  <select
                    value={announcementForm.priority}
                    onChange={(event) =>
                      setAnnouncementForm((current) => ({
                        ...current,
                        priority: event.target.value,
                      }))
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Importante</option>
                  </select>
                </label>
              </div>

              <label>
                <span>Mensaje</span>
                <textarea
                  value={announcementForm.message}
                  onChange={(event) =>
                    setAnnouncementForm((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Escribe el aviso que verán los colaboradores..."
                  maxLength={900}
                />
              </label>

              <AttachmentPicker
                title="Archivos adjuntos"
                helper="Puedes subir imágenes, documentos, audio o video. Máximo 6 archivos por anuncio."
                onChange={handleAnnouncementFileSelection}
              />

              <AttachmentDraftList
                items={announcementAttachments}
                onRemove={handleRemoveAnnouncementAttachment}
              />

              <div className="workspace-form-actions">
                {editingAnnouncementId && (
                  <button
                    type="button"
                    className="workspace-soft-button"
                    onClick={resetAnnouncementEditor}
                  >
                    Cancelar edición
                  </button>
                )}

                <button type="submit" className="workspace-primary-button" disabled={announcementSaving}>
                  {announcementSaving
                    ? "Guardando..."
                    : editingAnnouncementId
                    ? "Guardar cambios"
                    : "Publicar anuncio"}
                </button>
              </div>
            </form>
          )}

          {announcementError && <div className="workspace-error-box">{announcementError}</div>}
          {announcementStatus && <div className="workspace-success-box">{announcementStatus}</div>}

          <div className="announcement-list visual-announcement-list">
            {announcements.length === 0 ? (
              <div className="workspace-empty-state board-empty-state">
                <strong>No hay anuncios activos</strong>
                <p>Cuando se publique un anuncio, aparecerá aquí.</p>
              </div>
            ) : (
              announcements.map((announcement) => {
                const receipts = announcementReceipts[announcement.id] || [];
                const currentUserHasRead = receipts.some(
                  (receipt) => receipt.userId === currentUserId || receipt.id === currentUserId
                );

                return (
                  <article
                    key={announcement.id}
                    className={`announcement-item visual-announcement-item ${
                      announcement.priority === "important" ? "important" : ""
                    } ${currentUserHasRead ? "" : "pending-read"}`}
                  >
                    <div className="announcement-ribbon">
                      <span>{announcement.priority === "important" ? "📢" : "📌"}</span>
                    </div>

                    <div className="announcement-item-top">
                      <div>
                        <span className="announcement-badge">
                          {announcement.priority === "important" ? "Importante" : "Normal"}
                        </span>
                        {!currentUserHasRead && (
                          <span className="announcement-unread-tag">Pendiente de confirmar</span>
                        )}
                        <h4>{announcement.title || "Anuncio sin título"}</h4>
                      </div>

                      <small>{formatDateTime(announcement.createdAt)}</small>
                    </div>

                    <p>{announcement.message}</p>

                    <AttachmentGallery attachments={announcement.attachments} />

                    <div className="announcement-meta-row">
                      <span>Publicado por {announcement.createdByName || "Administración"}</span>

                      {currentUserHasRead ? (
                        <span className="read-confirmation-badge">✓ Leído</span>
                      ) : (
                        <button
                          type="button"
                          className="mark-read-button"
                          onClick={() => handleMarkAnnouncementRead(announcement.id)}
                        >
                          Marcar leído / visto
                        </button>
                      )}
                    </div>

                    {isAdmin && (
                      <div className="announcement-admin-panel">
                        <details>
                          <summary>
                            Confirmaciones de lectura: {receipts.length}
                          </summary>

                          {receipts.length === 0 ? (
                            <p>Aún no hay confirmaciones para este anuncio.</p>
                          ) : (
                            <div className="announcement-readers-list">
                              {receipts.map((receipt) => (
                                <div key={receipt.id}>
                                  <strong>{receipt.userName || "Usuario"}</strong>
                                  <span>
                                    {receipt.userEmail || "Sin correo"} · {formatDateTime(receipt.readAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </details>

                        <div className="announcement-admin-actions">
                          <button type="button" onClick={() => handleEditAnnouncement(announcement)}>
                            Editar
                          </button>
                          <button type="button" onClick={() => handleArchiveAnnouncement(announcement.id)}>
                            Archivar
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteAnnouncement(announcement)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="workspace-card notes-card board-visual-card">
          <div className="workspace-card-header workspace-card-header-visual">
            <div>
              <span className="workspace-card-kicker">Espacio privado</span>
              <h3>Mis notas personales</h3>
              <p>
                Tus notas funcionan como post-it digitales: privadas, visuales y con archivos adjuntos.
              </p>
            </div>
            <div className="workspace-card-side-badge note-side-badge">{notesWithAttachments} con archivos</div>
          </div>

          <form className="personal-note-form board-form-visual" onSubmit={handleNoteSubmit}>
            <label>
              <span>Título</span>
              <input
                value={noteForm.title}
                onChange={(event) =>
                  setNoteForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Ej. Recordatorio"
                maxLength={80}
              />
            </label>

            <label>
              <span>Nota</span>
              <textarea
                value={noteForm.content}
                onChange={(event) =>
                  setNoteForm((current) => ({ ...current, content: event.target.value }))
                }
                placeholder="Escribe una nota rápida tipo post-it..."
                maxLength={700}
              />
            </label>

            <div className="note-form-toolbar">
              <label className="note-pin-row">
                <input
                  type="checkbox"
                  checked={noteForm.pinned}
                  onChange={(event) =>
                    setNoteForm((current) => ({ ...current, pinned: event.target.checked }))
                  }
                />
                <span>Fijar arriba</span>
              </label>

              <NoteColorPicker
                value={noteForm.color}
                onChange={(value) => setNoteForm((current) => ({ ...current, color: value }))}
              />
            </div>

            <AttachmentPicker
              title="Archivos adjuntos"
              helper="Adjunta imágenes, audio, video o documentos. Máximo 6 archivos por nota."
              onChange={handleNoteFileSelection}
            />

            <AttachmentDraftList
              items={noteAttachments}
              onRemove={handleRemoveNoteAttachment}
            />

            <div className="workspace-form-actions">
              {editingNoteId && (
                <button
                  type="button"
                  className="workspace-soft-button"
                  onClick={resetNoteEditor}
                >
                  Cancelar edición
                </button>
              )}

              <button type="submit" className="workspace-primary-button" disabled={noteSaving}>
                {noteSaving ? "Guardando..." : editingNoteId ? "Guardar nota" : "Agregar nota"}
              </button>
            </div>
          </form>

          {noteError && <div className="workspace-error-box">{noteError}</div>}
          {noteStatus && <div className="workspace-success-box">{noteStatus}</div>}

          <div className="personal-notes-list visual-notes-grid">
            {notes.length === 0 ? (
              <div className="workspace-empty-state postit-empty board-empty-state">
                <strong>No tienes notas personales</strong>
                <p>Agrega recordatorios rápidos para tenerlos a la mano.</p>
              </div>
            ) : (
              notes.map((note) => (
                <article
                  key={note.id}
                  className={`personal-note-item visual-note-item note-color-${normalizeNoteColor(note.color)} ${note.completed ? "completed" : ""}`}
                >
                  <div className="note-postit-pin" />

                  <div className="personal-note-top">
                    <div>
                      <div className="note-top-badges">
                        {note.pinned && <span className="pin-badge">Fijada</span>}
                        {note.completed && <span className="pin-badge completed-badge">Completada</span>}
                      </div>
                      <h4>{note.title || "Nota personal"}</h4>
                    </div>
                    <small>{formatDateTime(note.updatedAt || note.createdAt)}</small>
                  </div>

                  <p>{note.content || "Sin contenido adicional."}</p>

                  <AttachmentGallery attachments={note.attachments} compact />

                  <div className="personal-note-actions">
                    <button type="button" onClick={() => handleToggleNote(note, "completed")}>
                      {note.completed ? "Marcar pendiente" : "Completar"}
                    </button>
                    <button type="button" onClick={() => handleToggleNote(note, "pinned")}>
                      {note.pinned ? "Quitar fijado" : "Fijar"}
                    </button>
                    <button type="button" onClick={() => handleEditNote(note)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleDeleteNote(note)}
                    >
                      Eliminar
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NoteColorPicker({ value, onChange }) {
  return (
    <div className="note-color-picker">
      <span>Color</span>
      <div className="note-color-options">
        {NOTE_COLOR_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`note-color-swatch ${value === option.value ? "active" : ""} ${option.className}`}
            onClick={() => onChange(option.value)}
            title={option.label}
            aria-label={`Seleccionar color ${option.label}`}
          />
        ))}
      </div>
    </div>
  );
}

function AttachmentPicker({ title, helper, onChange }) {
  return (
    <div className="attachment-picker">
      <div className="attachment-picker-top">
        <strong>{title}</strong>
        <span>{helper}</span>
      </div>
      <label className="attachment-picker-dropzone">
        <input
          type="file"
          multiple
          accept={BOARD_ATTACHMENT_ACCEPT}
          onChange={onChange}
        />
        <div>
          <span className="dropzone-icon">📎</span>
          <strong>Seleccionar archivos</strong>
          <p>Formatos permitidos: imagen, audio, video y documentos comunes.</p>
        </div>
      </label>
    </div>
  );
}

function AttachmentDraftList({ items, onRemove }) {
  if (!items.length) return null;

  return (
    <div className="attachment-draft-list">
      {items.map((attachment) => {
        const type = getAttachmentType(attachment.contentType, attachment.name);
        return (
          <div key={attachment.id} className={`attachment-draft-chip type-${type}`}>
            <div>
              <strong>{attachment.name || "Archivo"}</strong>
              <span>{getAttachmentTypeLabel(type)} · {formatFileSize(attachment.size)}</span>
            </div>
            <button type="button" onClick={() => onRemove(attachment.id)}>
              Quitar
            </button>
          </div>
        );
      })}
    </div>
  );
}

function AttachmentGallery({ attachments, compact = false }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  return (
    <div className={`attachment-gallery ${compact ? "compact" : ""}`}>
      {attachments.map((attachment) => {
        const type = getAttachmentType(attachment.contentType, attachment.name);
        return (
          <article key={attachment.path || attachment.url || attachment.name} className={`attachment-card type-${type}`}>
            {type === "image" ? (
              <a href={attachment.url} target="_blank" rel="noreferrer" className="attachment-image-link">
                <img src={attachment.url} alt={attachment.name || "Adjunto"} />
              </a>
            ) : type === "video" ? (
              <video src={attachment.url} controls preload="metadata" />
            ) : type === "audio" ? (
              <div className="attachment-audio-box">
                <span className="attachment-kind-icon">🎧</span>
                <audio src={attachment.url} controls preload="metadata" />
              </div>
            ) : (
              <div className="attachment-document-box">
                <span className="attachment-kind-icon">📄</span>
                <div>
                  <strong>{attachment.name || "Documento"}</strong>
                  <span>{formatFileSize(attachment.size)}</span>
                </div>
              </div>
            )}

            <div className="attachment-card-footer">
              <span>{attachment.name || "Archivo"}</span>
              <a href={attachment.url} target="_blank" rel="noreferrer">
                Abrir
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

const BOARD_ATTACHMENT_ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
].join(",");

const NOTE_COLOR_OPTIONS = [
  { value: "yellow", label: "amarillo", className: "swatch-yellow" },
  { value: "blue", label: "azul", className: "swatch-blue" },
  { value: "green", label: "verde", className: "swatch-green" },
  { value: "pink", label: "rosa", className: "swatch-pink" },
  { value: "purple", label: "morado", className: "swatch-purple" },
];

function normalizeStoredAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment, index) => ({
      id: attachment.id || attachment.path || attachment.url || `stored-${index}`,
      name: attachment.name || "Archivo",
      url: attachment.url || "",
      path: attachment.path || "",
      contentType: attachment.contentType || "",
      size: Number(attachment.size) || 0,
      type: attachment.type || getAttachmentType(attachment.contentType, attachment.name),
      status: "stored",
    }))
    .filter((attachment) => attachment.url || attachment.path);
}

function markStoredAttachment(attachment) {
  return {
    ...attachment,
    status: "stored",
  };
}

function createDraftAttachment(file) {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name,
    size: file.size || 0,
    contentType: file.type || guessContentTypeFromName(file.name),
    type: getAttachmentType(file.type, file.name),
    file,
    previewUrl: file.type?.startsWith("image/") ? URL.createObjectURL(file) : "",
    status: "draft",
  };
}

function revokeDraftAttachmentPreviews(items) {
  if (!Array.isArray(items)) return;
  items.forEach((item) => {
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  });
}

function validateBoardFiles(files, currentCount = 0) {
  if (!files.length) {
    return { valid: true, message: "" };
  }

  const total = currentCount + files.length;
  if (total > 6) {
    return { valid: false, message: "Solo puedes adjuntar hasta 6 archivos por elemento." };
  }

  for (const file of files) {
    const type = getAttachmentType(file.type, file.name);
    const maxSize = type === "video" ? 80 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return {
        valid: false,
        message:
          type === "video"
            ? `El video "${file.name}" supera el límite de 80 MB.`
            : `El archivo "${file.name}" supera el límite de 25 MB.`,
      };
    }
  }

  return { valid: true, message: "" };
}

async function uploadBoardAttachments(items, { folder, ownerUid }) {
  const retained = items
    .filter((item) => item.status !== "draft")
    .map((item) => ({
      name: item.name || "Archivo",
      url: item.url || "",
      path: item.path || "",
      contentType: item.contentType || "",
      size: Number(item.size) || 0,
      type: item.type || getAttachmentType(item.contentType, item.name),
    }));

  const drafts = items.filter((item) => item.status === "draft" && item.file);

  const uploaded = await Promise.all(
    drafts.map(async (item, index) => {
      const safeName = sanitizeStorageFileName(item.name || `archivo-${index + 1}`);
      const storagePath = `${folder}/${Date.now()}-${index + 1}-${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, item.file, {
        contentType: item.contentType || undefined,
        customMetadata: {
          uploadedBy: ownerUid || "",
          originalName: item.name || safeName,
        },
      });
      const url = await getDownloadURL(storageRef);
      return {
        name: item.name || safeName,
        url,
        path: storagePath,
        contentType: item.contentType || "",
        size: Number(item.size) || 0,
        type: item.type || getAttachmentType(item.contentType, item.name),
      };
    })
  );

  return [...retained, ...uploaded];
}

function getRemovedAttachments(originalItems, currentItems) {
  const currentKeys = new Set(
    currentItems
      .filter((item) => item.status !== "draft")
      .map((item) => item.path || item.url || item.id)
  );

  return (originalItems || []).filter((item) => {
    const key = item.path || item.url || item.id;
    return key && !currentKeys.has(key);
  });
}

async function deleteStoredAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment?.path) return;
      try {
        await deleteObject(ref(storage, attachment.path));
      } catch (error) {
        console.warn("No se pudo eliminar un archivo adjunto:", attachment.path, error);
      }
    })
  );
}

function getAttachmentType(contentType, fileName = "") {
  const lowerType = String(contentType || "").toLowerCase();
  const lowerName = String(fileName || "").toLowerCase();

  if (lowerType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)) return "image";
  if (lowerType.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm)$/i.test(lowerName)) return "video";
  if (lowerType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(lowerName)) return "audio";
  return "document";
}

function getAttachmentTypeLabel(type) {
  if (type === "image") return "Imagen";
  if (type === "video") return "Video";
  if (type === "audio") return "Audio";
  return "Documento";
}

function guessContentTypeFromName(fileName = "") {
  const type = getAttachmentType("", fileName);
  if (type === "image") return "image/*";
  if (type === "video") return "video/*";
  if (type === "audio") return "audio/*";
  return "application/octet-stream";
}

function sanitizeStorageFileName(fileName = "archivo") {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function formatFileSize(bytes) {
  const numeric = Number(bytes) || 0;
  if (numeric < 1024) return `${numeric} B`;
  if (numeric < 1024 * 1024) return `${(numeric / 1024).toFixed(1)} KB`;
  return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeNoteColor(color) {
  const normalized = String(color || "yellow").toLowerCase();
  return NOTE_COLOR_OPTIONS.some((option) => option.value === normalized) ? normalized : "yellow";
}


function InternalMessages({ profile }) {
  const currentUserId = getCurrentUserId(profile);
  const [collaborators, setCollaborators] = useState([]);
  const [presenceByUserId, setPresenceByUserId] = useState({});
  const [presenceNow, setPresenceNow] = useState(Date.now());
  const [inboxMessages, setInboxMessages] = useState([]);
  const [sentMessages, setSentMessages] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [messageForm, setMessageForm] = useState({
    toUserId: "",
    message: "",
  });
  const [messageAttachments, setMessageAttachments] = useState([]);
  const [messageStatus, setMessageStatus] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const nextCollaborators = snapshot.docs
          .map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }))
          .filter((user) => user.id !== currentUserId)
          .filter((user) => user.active !== false && user.deleted !== true)
          .filter((user) => user.email || user.name)
          .sort((a, b) =>
            String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "es")
          );

        setCollaborators(nextCollaborators);
      },
      (error) => {
        console.error("No se pudieron cargar los colaboradores:", error);
        setMessageError("No se pudo cargar la lista de colaboradores.");
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      collection(db, "userPresence"),
      (snapshot) => {
        const nextPresence = {};
        snapshot.docs.forEach((presenceDoc) => {
          nextPresence[presenceDoc.id] = {
            id: presenceDoc.id,
            ...presenceDoc.data(),
          };
        });
        setPresenceByUserId(nextPresence);
      },
      (error) => {
        console.error("No se pudo cargar la presencia de colaboradores:", error);
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setPresenceNow(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const inboxQuery = query(
      collection(db, "internalMessages"),
      where("toUserId", "==", currentUserId)
    );

    return onSnapshot(
      inboxQuery,
      (snapshot) => {
        const nextMessages = snapshot.docs
          .map((messageDoc) => ({
            id: messageDoc.id,
            ...messageDoc.data(),
            attachments: normalizeStoredAttachments(messageDoc.data()?.attachments),
          }))
          .sort(sortByCreatedAtDesc);

        setInboxMessages(nextMessages);
      },
      (error) => {
        console.error("No se pudo cargar la bandeja de entrada:", error);
        setMessageError("No se pudo cargar tus mensajes recibidos.");
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const sentQuery = query(
      collection(db, "internalMessages"),
      where("fromUserId", "==", currentUserId)
    );

    return onSnapshot(
      sentQuery,
      (snapshot) => {
        const nextMessages = snapshot.docs
          .map((messageDoc) => ({
            id: messageDoc.id,
            ...messageDoc.data(),
            attachments: normalizeStoredAttachments(messageDoc.data()?.attachments),
          }))
          .sort(sortByCreatedAtDesc);

        setSentMessages(nextMessages);
      },
      (error) => {
        console.error("No se pudieron cargar los mensajes enviados:", error);
        setMessageError("No se pudieron cargar tus mensajes enviados.");
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    return () => revokeDraftAttachmentPreviews(messageAttachments);
  }, []);

  const allMessages = [...inboxMessages, ...sentMessages].sort(sortByCreatedAtDesc);
  const conversations = buildInternalConversations(allMessages, collaborators, currentUserId);
  const selectedConversation =
    conversations.find((conversation) => conversation.participantId === selectedConversationId) ||
    conversations[0] ||
    null;
  const selectedMessages = selectedConversation
    ? selectedConversation.messages.slice().sort(sortByCreatedAtAsc)
    : [];
  const unreadCount = inboxMessages.filter((message) => !message.read).length;
  const totalMessages = allMessages.length;
  const selectedRecipient = selectedConversation
    ? {
        id: selectedConversation.participantId,
        name: selectedConversation.participantName,
        email: selectedConversation.participantEmail,
      }
    : collaborators.find((user) => user.id === messageForm.toUserId) || null;
  const selectedPresenceStatus = getPresenceStatus(
    selectedRecipient ? presenceByUserId[selectedRecipient.id] : null,
    presenceNow
  );

  useEffect(() => {
    if (!selectedConversation && conversations[0]?.participantId) {
      setSelectedConversationId(conversations[0].participantId);
    }
  }, [conversations.length, selectedConversation?.participantId]);

  useEffect(() => {
    if (!selectedConversation) return;
    setMessageForm((current) => ({
      ...current,
      toUserId: selectedConversation.participantId,
    }));
    markConversationMessagesAsRead(selectedConversation.messages);
  }, [selectedConversation?.participantId, selectedConversation?.unreadCount]);

  function resetMessageComposer() {
    revokeDraftAttachmentPreviews(messageAttachments);
    setMessageForm((current) => ({
      ...current,
      message: "",
    }));
    setMessageAttachments([]);
  }

  function handleMessageFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateBoardFiles(files, messageAttachments.length);
    if (!validation.valid) {
      setMessageError(validation.message);
      return;
    }

    setMessageAttachments((current) => [
      ...current,
      ...files.map(createDraftAttachment),
    ]);
    setMessageError("");
  }

  function handleRemoveMessageAttachment(attachmentId) {
    setMessageAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  function handleStartConversation(userId) {
    if (!userId) return;
    setSelectedConversationId(userId);
    setMessageForm({ toUserId: userId, message: "" });
    setNewConversationOpen(false);
    setMessageStatus("");
    setMessageError("");
  }

  async function handleMessageSubmit(event) {
    event.preventDefault();
    setMessageStatus("");
    setMessageError("");

    const recipientId = messageForm.toUserId || selectedConversation?.participantId || "";
    const recipient =
      collaborators.find((user) => user.id === recipientId) ||
      (selectedConversation?.participantId === recipientId
        ? {
            id: selectedConversation.participantId,
            name: selectedConversation.participantName,
            email: selectedConversation.participantEmail,
          }
        : null);
    const cleanMessage = messageForm.message.trim();

    if (!recipient?.id) {
      setMessageError("Selecciona una conversación o un colaborador.");
      return;
    }

    if (!cleanMessage && messageAttachments.length === 0) {
      setMessageError("Escribe un mensaje o adjunta un archivo.");
      return;
    }

    setMessageSaving(true);

    try {
      const messageId = doc(collection(db, "internalMessages")).id;
      const attachments = await uploadBoardAttachments(messageAttachments, {
        folder: `dashboard/internalMessages/${currentUserId}/${recipient.id}/${messageId}`,
        ownerUid: currentUserId,
      });
      const recipientName = recipient.name || recipient.email || "Usuario";

      await setDoc(doc(db, "internalMessages", messageId), {
        fromUserId: currentUserId,
        fromUserName: profile?.name || "Usuario",
        fromUserEmail: profile?.email || "",
        toUserId: recipient.id,
        toUserName: recipientName,
        toUserEmail: recipient.email || "",
        subject: `Conversación con ${recipientName}`.slice(0, 120),
        message: cleanMessage || "Archivo adjunto",
        attachments,
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedConversationId(recipient.id);
      setMessageStatus("Mensaje enviado.");
      resetMessageComposer();
    } catch (error) {
      console.error("No se pudo enviar el mensaje:", error);
      setMessageError("No se pudo enviar el mensaje.");
    } finally {
      setMessageSaving(false);
    }
  }

  async function markMessageAsRead(message) {
    if (!message?.id || message.toUserId !== currentUserId || message.read) return;

    try {
      await updateDoc(doc(db, "internalMessages", message.id), {
        read: true,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("No se pudo marcar el mensaje como leído:", error);
      setMessageError("No se pudo marcar el mensaje como leído.");
    }
  }

  function markConversationMessagesAsRead(messages) {
    (messages || [])
      .filter((message) => message.toUserId === currentUserId && !message.read)
      .forEach((message) => markMessageAsRead(message));
  }

  function handleSelectConversation(conversation) {
    setSelectedConversationId(conversation.participantId);
    setMessageForm({ toUserId: conversation.participantId, message: "" });
    setMessageStatus("");
    setMessageError("");
    markConversationMessagesAsRead(conversation.messages);
  }

  return (
    <div className="internal-messages-page chat-messages-page">
      <div className="visual-page-header messages-hero chat-hero">
        <div>
          <span className="visual-page-kicker">Comunicación interna</span>
          <div className="messages-title-row">
            <h1>Mensajes</h1>
            {unreadCount > 0 && (
              <span className="messages-title-unread-badge">
                {unreadCount} sin leer
              </span>
            )}
          </div>
          <p>
            Conversa con colaboradores en hilos tipo chat, revisa el historial y deja mensajes aunque no estén conectados.
          </p>
        </div>

        <div className="messages-summary-grid chat-summary-grid">
          <div className="messages-summary-card unread">
            <span>✉️</span>
            <strong>{unreadCount}</strong>
            <small>No leídos</small>
          </div>
          <div className="messages-summary-card inbox">
            <span>💬</span>
            <strong>{conversations.length}</strong>
            <small>Conversaciones</small>
          </div>
          <div className="messages-summary-card sent">
            <span>📨</span>
            <strong>{totalMessages}</strong>
            <small>Mensajes</small>
          </div>
        </div>
      </div>

      {messageError && <div className="workspace-error-box">{messageError}</div>}
      {messageStatus && <div className="workspace-success-box">{messageStatus}</div>}

      <div className="chat-layout workspace-card">
        <aside className="chat-sidebar-panel">
          <div className="chat-sidebar-header">
            <div>
              <span>Historial</span>
              <h3>Conversaciones</h3>
            </div>
            <button type="button" onClick={() => setNewConversationOpen((current) => !current)}>
              {newConversationOpen ? "Cerrar" : "+ Nueva"}
            </button>
          </div>

          {newConversationOpen && (
            <div className="chat-new-conversation-box">
              <label>
                <span>Iniciar conversación con</span>
                <select
                  value={messageForm.toUserId}
                  onChange={(event) => setMessageForm({ toUserId: event.target.value, message: "" })}
                >
                  <option value="">Selecciona un colaborador</option>
                  {collaborators.map((collaborator) => (
                    <option key={collaborator.id} value={collaborator.id}>
                      {collaborator.name || collaborator.email || "Usuario"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="workspace-primary-button"
                onClick={() => handleStartConversation(messageForm.toUserId)}
                disabled={!messageForm.toUserId}
              >
                Abrir chat
              </button>
            </div>
          )}

          <div className="chat-conversation-list">
            {conversations.length === 0 ? (
              <div className="workspace-empty-state messages-empty-state compact">
                <strong>No hay conversaciones</strong>
                <p>Inicia una conversación con algún colaborador.</p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const presenceStatus = getPresenceStatus(
                  presenceByUserId[conversation.participantId],
                  presenceNow
                );

                return (
                  <button
                    key={conversation.participantId}
                    type="button"
                    className={`chat-conversation-item ${selectedConversation?.participantId === conversation.participantId ? "active" : ""} ${conversation.unreadCount > 0 ? "unread" : ""}`}
                    onClick={() => handleSelectConversation(conversation)}
                  >
                    <div className={`chat-conversation-avatar presence-avatar ${presenceStatus.online ? "online" : "offline"}`}>
                      {getInitials(conversation.participantName)}
                    </div>
                    <div className="chat-conversation-main">
                      <div className="chat-conversation-topline">
                        <strong>{conversation.participantName}</strong>
                        <small>{formatDateTime(conversation.lastMessage?.createdAt)}</small>
                      </div>
                      <PresenceBadge status={presenceStatus} compact />
                      <p>
                        {conversation.lastMessage?.fromUserId === currentUserId ? "Tú: " : ""}
                        {conversation.lastMessage?.message || "Archivo adjunto"}
                      </p>
                      <div className="chat-conversation-meta">
                        <span>{conversation.messages.length} mensaje(s)</span>
                        {conversation.unreadCount > 0 && (
                          <span className="chat-new-message-tag">
                            {conversation.unreadCount} nuevo(s)
                          </span>
                        )}
                        {conversation.lastMessage?.attachments?.length > 0 && <span>Adjuntos</span>}
                      </div>
                    </div>
                    {conversation.unreadCount > 0 && (
                      <span className="chat-unread-pill">{conversation.unreadCount}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="chat-thread-panel">
          {!selectedRecipient ? (
            <div className="workspace-empty-state messages-empty-state chat-empty-thread">
              <strong>Selecciona una conversación</strong>
              <p>El historial del chat aparecerá aquí.</p>
            </div>
          ) : (
            <>
              <div className="chat-thread-header">
                <div className={`chat-thread-avatar presence-avatar ${selectedPresenceStatus.online ? "online" : "offline"}`}>{getInitials(selectedRecipient.name)}</div>
                <div>
                  <span>Conversación con</span>
                  <h3>{selectedRecipient.name || selectedRecipient.email || "Usuario"}</h3>
                  <small>{selectedRecipient.email || "Sin correo registrado"}</small>
                  <PresenceBadge status={selectedPresenceStatus} />
                </div>
              </div>

              <div className="chat-thread-messages">
                {selectedMessages.length === 0 ? (
                  <div className="chat-date-separator">Todavía no hay mensajes en esta conversación.</div>
                ) : (
                  selectedMessages.map((message) => {
                    const outgoing = message.fromUserId === currentUserId;
                    return (
                      <article key={message.id} className={`chat-bubble-row ${outgoing ? "outgoing" : "incoming"}`}>
                        {!outgoing && (
                          <div className="chat-message-avatar">{getInitials(message.fromUserName)}</div>
                        )}
                        <div className="chat-bubble">
                          <div className="chat-bubble-topline">
                            <strong>{outgoing ? "Tú" : message.fromUserName || "Usuario"}</strong>
                            <small>{formatDateTime(message.createdAt)}</small>
                          </div>
                          {message.message && <p>{message.message}</p>}
                          <AttachmentGallery attachments={message.attachments} compact />
                          <div className="chat-bubble-status">
                            {outgoing ? (message.read ? "Leído" : "Enviado") : "Recibido"}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <form className="chat-composer" onSubmit={handleMessageSubmit}>
                <textarea
                  value={messageForm.message}
                  onChange={(event) =>
                    setMessageForm((current) => ({
                      ...current,
                      toUserId: selectedRecipient.id,
                      message: event.target.value,
                    }))
                  }
                  placeholder={`Escribe un mensaje para ${selectedRecipient.name || "este colaborador"}...`}
                  maxLength={1200}
                />

                <div className="chat-composer-tools">
                  <AttachmentPicker
                    title="Adjuntos"
                    helper="Imagen, documento, audio o video. Máximo 6 archivos."
                    onChange={handleMessageFileSelection}
                  />

                  <button type="submit" className="workspace-primary-button" disabled={messageSaving}>
                    {messageSaving ? "Enviando..." : "Enviar"}
                  </button>
                </div>

                <AttachmentDraftList
                  items={messageAttachments}
                  onRemove={handleRemoveMessageAttachment}
                />
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function buildInternalConversations(messages, collaborators, currentUserId) {
  const collaboratorMap = new Map(
    collaborators.map((collaborator) => [collaborator.id, collaborator])
  );
  const grouped = new Map();

  messages.forEach((message) => {
    const otherUser = getInternalMessageParticipant(message, currentUserId);
    if (!otherUser.id) return;

    if (!grouped.has(otherUser.id)) {
      const collaborator = collaboratorMap.get(otherUser.id) || {};
      grouped.set(otherUser.id, {
        participantId: otherUser.id,
        participantName: collaborator.name || otherUser.name || collaborator.email || "Usuario",
        participantEmail: collaborator.email || otherUser.email || "",
        messages: [],
        unreadCount: 0,
        lastMessage: null,
      });
    }

    const conversation = grouped.get(otherUser.id);
    conversation.messages.push(message);
    if (message.toUserId === currentUserId && !message.read) {
      conversation.unreadCount += 1;
    }
  });

  return Array.from(grouped.values())
    .map((conversation) => {
      const sortedMessages = conversation.messages.slice().sort(sortByCreatedAtDesc);
      return {
        ...conversation,
        messages: sortedMessages,
        lastMessage: sortedMessages[0] || null,
      };
    })
    .sort((a, b) => {
      const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
      if (unreadDiff !== 0) return unreadDiff;
      return getMillisFromFirestoreDate(b.lastMessage?.createdAt) - getMillisFromFirestoreDate(a.lastMessage?.createdAt);
    });
}

function getInternalMessageParticipant(message, currentUserId) {
  if (message.fromUserId === currentUserId) {
    return {
      id: message.toUserId || "",
      name: message.toUserName || "Usuario",
      email: message.toUserEmail || "",
    };
  }

  return {
    id: message.fromUserId || "",
    name: message.fromUserName || "Usuario",
    email: message.fromUserEmail || "",
  };
}




function useUnreadAnnouncementsCount(profile) {
  const currentUserId = getCurrentUserId(profile);
  const [announcementIds, setAnnouncementIds] = useState([]);
  const [readStateByAnnouncement, setReadStateByAnnouncement] = useState({});

  useEffect(() => {
    if (!currentUserId) {
      setAnnouncementIds([]);
      setReadStateByAnnouncement({});
      return undefined;
    }

    const announcementsQuery = query(collection(db, "announcements"));

    return onSnapshot(
      announcementsQuery,
      (snapshot) => {
        const nextIds = snapshot.docs
          .map((announcementDoc) => ({ id: announcementDoc.id, ...announcementDoc.data() }))
          .filter((announcement) => announcement.active !== false)
          .sort(sortByCreatedAtDesc)
          .map((announcement) => announcement.id);

        setAnnouncementIds(nextIds);
        setReadStateByAnnouncement((current) => {
          const nextState = {};
          nextIds.forEach((announcementId) => {
            if (Object.prototype.hasOwnProperty.call(current, announcementId)) {
              nextState[announcementId] = current[announcementId];
            }
          });
          return nextState;
        });
      },
      (error) => {
        console.error("No se pudo cargar el contador de anuncios pendientes:", error);
        setAnnouncementIds([]);
        setReadStateByAnnouncement({});
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || announcementIds.length === 0) {
      return undefined;
    }

    const unsubscribers = announcementIds.map((announcementId) =>
      onSnapshot(
        doc(db, "announcements", announcementId, "reads", currentUserId),
        (snapshot) => {
          setReadStateByAnnouncement((current) => ({
            ...current,
            [announcementId]: snapshot.exists(),
          }));
        },
        (error) => {
          console.error("No se pudo cargar una confirmación de anuncio:", error);
          setReadStateByAnnouncement((current) => ({
            ...current,
            [announcementId]: false,
          }));
        }
      )
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [announcementIds, currentUserId]);

  if (!currentUserId || announcementIds.length === 0) return 0;

  return announcementIds.filter((announcementId) => readStateByAnnouncement[announcementId] !== true).length;
}

function useUnreadInternalMessagesCount(profile) {
  const currentUserId = getCurrentUserId(profile);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!currentUserId) {
      setUnreadCount(0);
      return undefined;
    }

    const unreadQuery = query(
      collection(db, "internalMessages"),
      where("toUserId", "==", currentUserId)
    );

    return onSnapshot(
      unreadQuery,
      (snapshot) => {
        const nextUnreadCount = snapshot.docs.filter((messageDoc) => {
          const data = messageDoc.data();
          return data.read !== true;
        }).length;

        setUnreadCount(nextUnreadCount);
      },
      (error) => {
        console.error("No se pudo cargar el contador de mensajes no leídos:", error);
        setUnreadCount(0);
      }
    );
  }, [currentUserId]);

  return unreadCount;
}

function formatUnreadBadgeCount(count) {
  const numericCount = Number(count) || 0;
  return numericCount > 99 ? "99+" : String(numericCount);
}

function useDashboardPresence(profile, currentPage) {
  const currentUserId = getCurrentUserId(profile);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const presenceRef = doc(db, "userPresence", currentUserId);
    const userName = profile?.name || auth.currentUser?.displayName || "Usuario";
    const userEmail = profile?.email || auth.currentUser?.email || "";

    const writePresence = (isOnline = true) => {
      return setDoc(
        presenceRef,
        {
          userId: currentUserId,
          userName,
          userEmail,
          isOnline,
          currentPage: currentPage || "dashboard",
          lastSeen: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((error) => {
        console.warn("No se pudo actualizar la presencia del usuario:", error);
      });
    };

    writePresence(true);

    const heartbeatId = window.setInterval(() => {
      writePresence(document.visibilityState !== "hidden");
    }, 45000);

    const handleVisibilityChange = () => {
      writePresence(document.visibilityState !== "hidden");
    };
    const handleFocus = () => writePresence(true);
    const handleOnline = () => writePresence(true);
    const handleBeforeUnload = () => {
      writePresence(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      writePresence(false);
    };
  }, [currentUserId, profile?.name, profile?.email, currentPage]);
}

function PresenceBadge({ status, compact = false }) {
  return (
    <span className={`presence-badge ${status.online ? "online" : "offline"} ${compact ? "compact" : ""}`}>
      <span className="presence-dot" />
      {status.label}
    </span>
  );
}

function getPresenceStatus(presence, now = Date.now()) {
  const lastSeenMillis = getMillisFromFirestoreDate(presence?.lastSeen || presence?.updatedAt);
  const onlineWindow = 2 * 60 * 1000;
  const online = Boolean(presence?.isOnline) && lastSeenMillis > 0 && now - lastSeenMillis <= onlineWindow;

  if (online) {
    return {
      online: true,
      label: "En línea",
    };
  }

  if (lastSeenMillis) {
    return {
      online: false,
      label: `Última vez ${formatRelativePresenceTime(lastSeenMillis, now)}`,
    };
  }

  return {
    online: false,
    label: "Sin actividad reciente",
  };
}

function formatRelativePresenceTime(millis, now = Date.now()) {
  const diff = Math.max(0, now - millis);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "ahora";
  if (diff < hour) {
    const minutes = Math.max(1, Math.floor(diff / minute));
    return `hace ${minutes} min`;
  }
  if (diff < day) {
    const hours = Math.max(1, Math.floor(diff / hour));
    return `hace ${hours} h`;
  }
  if (diff < day * 2) return "ayer";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(millis));
}

function getCurrentUserId(profile) {
  return (
    auth.currentUser?.uid ||
    profile?.uid ||
    profile?.id ||
    profile?.userId ||
    profile?.authUid ||
    ""
  );
}

function getMillisFromFirestoreDate(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime() || 0;
  return 0;
}

function sortByCreatedAtDesc(a, b) {
  return getMillisFromFirestoreDate(b.createdAt) - getMillisFromFirestoreDate(a.createdAt);
}

function sortByCreatedAtAsc(a, b) {
  return getMillisFromFirestoreDate(a.createdAt) - getMillisFromFirestoreDate(b.createdAt);
}

function sortByReadAtDesc(a, b) {
  return getMillisFromFirestoreDate(b.readAt) - getMillisFromFirestoreDate(a.readAt);
}

function sortPersonalNotes(a, b) {
  if (Boolean(a.completed) !== Boolean(b.completed)) {
    return a.completed ? 1 : -1;
  }

  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
    return a.pinned ? -1 : 1;
  }

  const bDate = getMillisFromFirestoreDate(b.updatedAt || b.createdAt);
  const aDate = getMillisFromFirestoreDate(a.updatedAt || a.createdAt);

  return bDate - aDate;
}

function formatDateTime(value) {
  const millis = getMillisFromFirestoreDate(value);

  if (!millis) return "Fecha pendiente";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(millis));
}

function MobileAppHeader({ profile, title, subtitle, onHome, onOpenMenu, onOpenProfile }) {
  return (
    <header className="mobile-app-header">
      <button
        type="button"
        className="mobile-header-logo-button"
        onClick={onHome}
        aria-label="Volver al inicio"
      >
        <img src="/active-logo.png" alt="Active English School" />
      </button>

      <div className="mobile-header-title">
        <span>{subtitle}</span>
        <strong>{title}</strong>
      </div>

      <div className="mobile-header-actions">
        <button
          type="button"
          className="mobile-header-menu-button"
          onClick={onOpenMenu}
          aria-label="Abrir menú"
        >
          ☰
        </button>

        <button
          type="button"
          className="mobile-header-avatar-button"
          onClick={onOpenProfile}
          aria-label="Ver mi perfil"
        >
          {getInitials(profile?.name)}
        </button>
      </div>
    </header>
  );
}

function MobileBottomNavigation({ primaryItems, allItems, isNavActive, onNavigate, onOpenMore }) {
  const primaryPageSet = new Set(primaryItems.map((item) => item.page));
  const moreIsActive = allItems.some((item) => !primaryPageSet.has(item.page) && isNavActive(item.page));

  return (
    <nav className="mobile-bottom-nav" aria-label="Navegación principal móvil">
      {primaryItems.map((item) => (
        <button
          key={item.page}
          type="button"
          className={`${isNavActive(item.page) ? "active" : ""} ${item.badgeCount > 0 ? "has-unread" : ""}`}
          onClick={() => onNavigate(item.page)}
        >
          <span className="mobile-nav-icon-wrap">
            <DashboardNavIcon name={item.icon} />
            {item.badgeCount > 0 && (
              <span className="mobile-nav-unread-badge">
                {formatUnreadBadgeCount(item.badgeCount)}
              </span>
            )}
          </span>
          <span>{item.mobileLabel || item.label}</span>
        </button>
      ))}

      <button
        type="button"
        className={moreIsActive ? "active" : ""}
        onClick={onOpenMore}
      >
        <DashboardNavIcon name="more" />
        <span>Más</span>
      </button>
    </nav>
  );
}

function MobileModuleDrawer({
  open,
  items,
  isAdmin,
  profile,
  isNavActive,
  onNavigate,
  onClose,
  onViewProfile,
  onLogout,
}) {
  if (!open) return null;

  return (
    <div className="mobile-module-drawer-layer">
      <button
        type="button"
        className="mobile-module-backdrop"
        onClick={onClose}
        aria-label="Cerrar menú"
      />

      <section className="mobile-module-drawer" aria-label="Menú de módulos">
        <div className="mobile-drawer-handle" />

        <div className="mobile-drawer-profile">
          <div className="mobile-drawer-avatar">{getInitials(profile?.name)}</div>
          <div>
            <strong>{profile?.name || "Usuario"}</strong>
            <span>{isAdmin ? "Administrador" : getRoleLabel(profile?.role)}</span>
          </div>
        </div>

        <div className="mobile-drawer-list">
          {items.map((item) => (
            <button
              key={item.page}
              type="button"
              className={isNavActive(item.page) ? "active" : ""}
              onClick={() => onNavigate(item.page)}
            >
              <span className="mobile-drawer-icon">
                <DashboardNavIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
              {item.badgeCount > 0 && (
                <span className="mobile-drawer-badge">
                  {formatUnreadBadgeCount(item.badgeCount)}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mobile-drawer-actions">
          <button type="button" onClick={onViewProfile}>
            Ver mi perfil
          </button>
          <button type="button" className="danger" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </section>
    </div>
  );
}

function TopProfileBar({
  profile,
  isAdmin,
  profileMenuOpen,
  setProfileMenuOpen,
  onViewProfile,
  onLogout,
}) {
  return (
    <div className="top-profile-bar">
      <div className="top-profile-spacer" />

      <div className="profile-menu-wrapper">
        <button
          type="button"
          className="profile-circle-button"
          onClick={() => setProfileMenuOpen((current) => !current)}
        >
          <span>{getInitials(profile?.name)}</span>
        </button>

        {profileMenuOpen && (
          <div className="profile-dropdown">
            <div className="profile-dropdown-header">
              <div className="profile-dropdown-avatar">
                {getInitials(profile?.name)}
              </div>

              <div>
                <strong>{profile?.name || "Usuario sin perfil"}</strong>
                <span>{profile?.email || "Sin correo registrado"}</span>
              </div>
            </div>

            <div className="profile-dropdown-info">
              <span>{isAdmin ? "Administrador" : getRoleLabel(profile?.role)}</span>
              <span>{profile?.area || "Sin área"}</span>
            </div>

            <button type="button" onClick={onViewProfile}>
              Ver mi perfil
            </button>

            <button type="button" className="profile-logout" onClick={onLogout}>
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfilePage({ profile, isAdmin, onClose }) {
  return (
    <div className="visual-page">
      <div className="visual-page-header">
        <div>
          <h2>Mi perfil</h2>
          <p>Consulta la información de tu usuario dentro del sistema.</p>
        </div>

        <div className="visual-page-actions">
          <button className="visual-outline-button" onClick={onClose}>
            ← Volver
          </button>
        </div>
      </div>

      <section className="profile-page-card">
        <div className="profile-page-hero">
          <div className="profile-page-avatar">
            {getInitials(profile?.name)}
          </div>

          <div>
            <h3>{profile?.name || "Usuario sin perfil"}</h3>
            <p>{profile?.email || "Sin correo registrado"}</p>

            <div className="profile-page-badges">
              <span>{isAdmin ? "Administrador" : getRoleLabel(profile?.role)}</span>
              <span>{profile?.area || "Sin área"}</span>
              <span>{profile?.active === false ? "Inactivo" : "Activo"}</span>
            </div>
          </div>
        </div>

        <div className="profile-info-grid">
          <ProfileInfoItem label="Nombre" value={profile?.name} />
          <ProfileInfoItem label="Correo" value={profile?.email} />
          <ProfileInfoItem
            label="Privilegio"
            value={isAdmin ? "Administrador" : getRoleLabel(profile?.role)}
          />
          <ProfileInfoItem label="Área" value={profile?.area} />
          <ProfileInfoItem
            label="Estado"
            value={profile?.active === false ? "Inactivo" : "Activo"}
          />
        </div>
      </section>
    </div>
  );
}

function ProfileInfoItem({ label, value }) {
  return (
    <div className="profile-info-item">
      <span>{label}</span>
      <strong>{value || "Sin información"}</strong>
    </div>
  );
}

function getInitials(name = "") {
  const initials = String(name)
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}



function getProfileDepartmentNames(profile) {
  return [
    profile?.area,
    profile?.department,
    profile?.departmentName,
    profile?.position,
    profile?.team,
    ...(Array.isArray(profile?.departmentNames) ? profile.departmentNames : []),
    ...(Array.isArray(profile?.departments) ? profile.departments : []),
  ]
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function canAccessTechnicalSupport(profile, isAdmin) {
  if (isAdmin) {
    return true;
  }

  const role = normalizeText(profile?.role);
  const departmentNames = getProfileDepartmentNames(profile);

  return (
    role === "admin" ||
    departmentNames.some((departmentName) => departmentName === "soporte tecnico")
  );
}

function getRoleLabel(role = "") {
  const labels = {
    admin: "Administrador",
    collaborator: "Colaborador",
    requester: "Solicitante",
  };

  return labels[role] || role || "Usuario";
}