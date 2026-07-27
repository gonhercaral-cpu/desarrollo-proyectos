import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
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
import BugReports from "./BugReports";
import MaterialCorrections from "./MaterialCorrections";
import MaterialCorrectionIcon from "../components/material-corrections/MaterialCorrectionIcon";
import SubscriptionManager from "./SubscriptionManager";
import DriveManager from "./DriveManager";
import ProtectCameras from "./ProtectCameras";
import DepartmentsAdmin from "../components/DepartmentsAdmin";
import DigitalSignageAdmin from "../components/DigitalSignageAdmin";
import FloatingQuickTools from "../components/FloatingQuickTools";
import { auth, db, storage } from "../services/firebase";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getPastedImageFiles } from "../utils/clipboardAttachments";
import MessageAudioPlayer from "../components/MessageAudioPlayer";
import MessageText from "../components/MessageText";
import DepartmentReadReceipt from "../components/DepartmentReadReceipt";
import { getMessagePreview, isAudioMessage } from "../utils/messageUtils";
import {
  canAccessEditorial,
  filterVisibleDepartmentMessages,
  normalizeDepartmentId,
  userBelongsToDepartmentId,
} from "../utils/departmentMembership";
import {
  loadVisibleDepartmentMessages,
  subscribeToVisibleDepartmentMessages,
} from "../services/departmentMessagesService";
import {
  subscribeToUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationVisual,
} from "../services/notificationsService";

// Módulo en desarrollo: reactivar cambiando este valor a true.
const ENABLE_UNIFI_CAMERAS_MODULE = false;

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
  if (name === "materialCorrections") {
    return <MaterialCorrectionIcon />;
  }
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
    case "subscriptions":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
          <path d="M16 16h.01" />
          <path d="M7 3v4" />
          <path d="M17 3v4" />
        </>
      );
    case "drive":
      return (
        <>
          <path d="M6 18.5a4 4 0 0 1 .9-7.9 5.8 5.8 0 0 1 11.1 1.6A3.2 3.2 0 0 1 17.8 18.5H6z" />
          <path d="M9 15h6" />
          <path d="M12 12v6" />
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
    case "bugReports":
      return (
        <>
          <path d="M8.2 8.2a5.4 5.4 0 0 1 7.6 0" />
          <path d="M9 4.5 7.6 3" />
          <path d="M15 4.5 16.4 3" />
          <rect x="7" y="7" width="10" height="13" rx="5" />
          <path d="M4 11h3" />
          <path d="M17 11h3" />
          <path d="M4.5 17H7" />
          <path d="M17 17h2.5" />
          <path d="M12 10v7" />
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
          <path d="M4 20h16" />
          <path d="M6 20V8l6-4 6 4v12" />
          <path d="M9 20v-6h6v6" />
          <path d="M9 10h.01M12 10h.01M15 10h.01" />
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
    case "protect":
      return (
        <>
          <path d="M4 8h11l2-3h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12.5" cy="13.5" r="3.6" />
        </>
      );
    case "signage":
      return (
        <>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 9h5" />
          <path d="M7 13h10" />
        </>
      );
    case "editorial":
      return (
        <>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21z" />
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


function getDashboardNavigationItems({ isAdmin, canUsePrintShop, canUseTechnicalSupport, canUseDriveManager, canUseEditorial }) {
  const items = [];

  if (isAdmin) {
    items.push({ page: "executive-dashboard", label: "Dashboard ejecutivo", mobileLabel: "Ejecutivo", icon: "dashboard", section: "featured" });
  } else {
    items.push({ page: "workspace-dashboard", label: "Mi panel", mobileLabel: "Mi panel", icon: "dashboard", section: "featured" });
  }

  items.push({ page: "workspace-dashboard", label: "Tablero", mobileLabel: "Inicio", icon: "dashboard", section: "General" });
  items.push({ page: "internal-messages", label: "Mensajes", mobileLabel: "Mensajes", icon: "messages", section: "General" });
  items.push({ page: "team-agenda", label: "Agenda del equipo", mobileLabel: "Agenda", icon: "calendar", section: "General" });
  items.push({ page: "ideas-incubator", label: "Incubadora de ideas", mobileLabel: "Ideas", icon: "ideas", section: "General" });

  items.push({ page: "my-projects", label: "Mis proyectos", mobileLabel: "Proyectos", icon: "myProjects", section: "Operación" });

  if (canUseEditorial) {
    items.push({ page: "editorial", label: "Editor Editorial", mobileLabel: "Editorial", icon: "editorial", section: "Operación" });
    items.push({ page: "material-corrections", label: "Correcciones de material", mobileLabel: "Correcciones", icon: "materialCorrections", section: "Operación" });
  }

  items.push({ page: "purchase-requests", label: "Solicitudes de compra", mobileLabel: "Compras", icon: "purchase", section: "Operación" });

  if (canUsePrintShop) {
    items.push({ page: "print-shop", label: "Imprenta", mobileLabel: "Imprenta", icon: "print", section: "Operación" });
  }

  if (canUseTechnicalSupport) {
    items.push({ page: "technical-support", label: "Soporte técnico", mobileLabel: "Soporte", icon: "technical", section: "Operación" });
  }

  if (canUseDriveManager && !isAdmin) {
    items.push({ page: "drive-manager", label: "Nube AES", mobileLabel: "Nube", icon: "drive", section: "Operación" });
  }

  if (!isAdmin) {
    items.push({ page: "bug-reports", label: "Reporte de errores", mobileLabel: "Errores", icon: "bugReports", section: "Operación" });
  }

  if (isAdmin) {
    items.push({ page: "create-project", label: "Alta de proyecto", mobileLabel: "Alta", icon: "create", section: "Operación" });
    items.push({ page: "all-projects", label: "Todos los proyectos", mobileLabel: "Todos", icon: "allProjects", section: "Administración" });
    items.push({ page: "project-history", label: "Historial de proyectos", mobileLabel: "Historial", icon: "history", section: "Administración" });
    items.push({ page: "collaborators-admin", label: "Colaboradores", mobileLabel: "Equipo", icon: "collaborators", section: "Administración" });
    items.push({ page: "departments-admin", label: "Departamentos", mobileLabel: "Áreas", icon: "departments", section: "Administración" });
    items.push({ page: "drive-manager", label: "Nube AES", mobileLabel: "Nube", icon: "drive", section: "Administración" });
    items.push({ page: "subscription-manager", label: "Gestor de suscripciones", mobileLabel: "Suscripciones", icon: "subscriptions", section: "Administración" });
    items.push({ page: "digital-signage", label: "Digital Signage", mobileLabel: "Signage", icon: "signage", section: "Administración" });
    if (ENABLE_UNIFI_CAMERAS_MODULE) {
      items.push({ page: "protect-cameras", label: "UniFi Protect", mobileLabel: "Cámaras", icon: "protect", section: "Administración" });
    }
    items.push({ page: "bug-reports", label: "Reporte de errores", mobileLabel: "Errores", icon: "bugReports", section: "Administración" });
  }

  return items;
}

function getDashboardNavigationGroups(items = []) {
  const sectionLabels = ["General", "Operación", "Administración"];

  return sectionLabels
    .map((section) => ({
      section,
      items: items.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);
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

function getSafeDashboardPage(page, { isAdmin, canUsePrintShop, canUseTechnicalSupport, canUseDriveManager, canUseEditorial }) {
  const defaultPage = isAdmin ? "executive-dashboard" : "workspace-dashboard";
  const adminOnlyPages = new Set([
    "executive-dashboard",
    "all-projects",
    "project-history",
    "create-project",
    "collaborators-admin",
    "departments-admin",
    "digital-signage",
    "subscription-manager",
    "protect-cameras",
  ]);

  if (!page) return defaultPage;
  if (page === "protect-cameras" && !ENABLE_UNIFI_CAMERAS_MODULE) return defaultPage;
  if (adminOnlyPages.has(page) && !isAdmin) return defaultPage;
  if (page === "drive-manager" && !canUseDriveManager) return defaultPage;
  if (page === "print-shop" && !canUsePrintShop) return defaultPage;
  if (page === "technical-support" && !canUseTechnicalSupport) return defaultPage;
  if (page === "material-corrections" && !canUseEditorial) return defaultPage;
  if (page === "notifications-center") return "notifications-center";

  return page;
}

export default function Dashboard({ theme = "light", onToggleTheme }) {
  const { profile, logout, isAdmin, uid, refreshProfile } = useAuth();
  const userDepartmentNames = getProfileDepartmentNames(profile);
  const canUsePrintShopByDepartment =
    isAdmin ||
    userDepartmentNames.some(
      (departmentName) =>
        departmentName === "imprenta" || departmentName === "soporte tecnico"
    );

  const [hasPrintshopAssignment, setHasPrintshopAssignment] = useState(false);

  useEffect(() => {
    if (canUsePrintShopByDepartment || !uid) {
      return;
    }

    let responsibleHasDocs = false;
    let collaboratorHasDocs = false;

    const unsubscribeResponsible = onSnapshot(
      query(collection(db, "printRequests"), where("responsibleUid", "==", uid)),
      (snapshot) => {
        responsibleHasDocs = !snapshot.empty;
        setHasPrintshopAssignment(responsibleHasDocs || collaboratorHasDocs);
      },
      () => {}
    );
    const unsubscribeCollaborator = onSnapshot(
      query(collection(db, "printRequests"), where("collaboratorUid", "==", uid)),
      (snapshot) => {
        collaboratorHasDocs = !snapshot.empty;
        setHasPrintshopAssignment(responsibleHasDocs || collaboratorHasDocs);
      },
      () => {}
    );

    return () => {
      unsubscribeResponsible();
      unsubscribeCollaborator();
    };
  }, [canUsePrintShopByDepartment, uid]);

  const canUsePrintShop = canUsePrintShopByDepartment || hasPrintshopAssignment;

  const canUseTechnicalSupport = canAccessTechnicalSupport(profile, isAdmin);
  const canUseDriveManager = isAdmin || profile?.role === "collaborator";
  const canUseEditorial = canAccessEditorial(profile, isAdmin);

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
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const unreadDirectMessagesCount = useUnreadInternalMessagesCount(profile);
  const unreadDepartmentMessagesCount = useUnreadDepartmentMessagesCount(profile, isAdmin);
  const unreadMessagesCount = unreadDirectMessagesCount + unreadDepartmentMessagesCount;
  const unreadAnnouncementsCount = useUnreadAnnouncementsCount(profile);

  const [pendingChatKeyToOpen, setPendingChatKeyToOpen] = useState("");
  const activeChatKeyRef = useRef("");
  const isMessagesPageActiveRef = useRef(false);

  useEffect(() => {
    isMessagesPageActiveRef.current = page === "internal-messages";
  }, [page]);

  const messageNotifications = useGlobalMessageNotifications(profile, isAdmin, {
    activeChatKeyRef,
    isMessagesPageActiveRef,
    onNotificationClick: (chatKey) => {
      setPendingChatKeyToOpen(chatKey);
      setPage("internal-messages");
    },
  });

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
      canUseDriveManager,
      canUseEditorial,
    });

    if (safePage !== page) {
      setSelectedProjectId(null);
      setReturnPage(safePage);
      setPage(safePage);
    }
  }, [page, isAdmin, canUsePrintShop, canUseTechnicalSupport, canUseDriveManager, canUseEditorial]);

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
      return;
    }

    if (canUseEditorial && pageFromUrl === "material-corrections") {
      setSelectedProjectId(null);
      setReturnPage("material-corrections");
      setPage("material-corrections");
      setProfileMenuOpen(false);
      setProfilePanelOpen(false);
    }
  }, [canUseTechnicalSupport, canUsePrintShop, canUseEditorial]);

  function goToPage(nextPage) {
    if (nextPage === "editorial") {
      window.location.assign("/editorial");
      return;
    }

    const safePage = getSafeDashboardPage(nextPage, {
      isAdmin,
      canUsePrintShop,
      canUseTechnicalSupport,
      canUseDriveManager,
      canUseEditorial,
    });

    setSelectedProjectId(null);
    setPage(safePage);
    setReturnPage(safePage);
    setProfileMenuOpen(false);
    setNotificationPanelOpen(false);
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
    } else if (page === "subscription-manager") {
      setReturnPage("subscription-manager");
    } else if (page === "team-agenda") {
      setReturnPage("team-agenda");
    } else if (page === "ideas-incubator") {
      setReturnPage("ideas-incubator");
    } else if (page === "bug-reports") {
      setReturnPage("bug-reports");
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
    setNotificationPanelOpen(false);
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
          onProfileUpdated={refreshProfile}
          onClose={() => setProfilePanelOpen(false)}
        />
      );
    }

    if (page === "workspace-dashboard") {
      return (
        <WorkspaceDashboard
          profile={profile}
          isAdmin={isAdmin}
          unreadDirectMessagesCount={unreadDirectMessagesCount}
          unreadDepartmentMessagesCount={unreadDepartmentMessagesCount}
          unreadMessagesCount={unreadMessagesCount}
          unreadAnnouncementsCount={unreadAnnouncementsCount}
          onOpenModule={goToPage}
        />
      );
    }

    if (page === "internal-messages") {
      return (
        <InternalMessages
          profile={profile}
          isAdmin={isAdmin}
          onActiveChatKeyChange={(chatKey) => {
            activeChatKeyRef.current = chatKey;
          }}
          pendingChatKeyToOpen={pendingChatKeyToOpen}
          onPendingChatKeyConsumed={() => setPendingChatKeyToOpen("")}
          notificationPermission={messageNotifications.permission}
          onRequestNotificationPermission={messageNotifications.requestPermission}
        />
      );
    }

    if (page === "notifications-center") {
      return (
        <NotificationsCenter
          profile={profile}
          isAdmin={isAdmin}
          unreadMessagesCount={unreadMessagesCount}
          unreadAnnouncementsCount={unreadAnnouncementsCount}
          onOpenModule={goToPage}
          onOpenProject={openProject}
        />
      );
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

    if (page === "drive-manager" && canUseDriveManager) {
      return <DriveManager />;
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

    if (page === "subscription-manager" && isAdmin) {
      return <SubscriptionManager />;
    }

    if (page === "digital-signage" && isAdmin) {
      return <DigitalSignageAdmin />;
    }

    if (page === "protect-cameras" && isAdmin && ENABLE_UNIFI_CAMERAS_MODULE) {
      return <ProtectCameras />;
    }

    if (page === "team-agenda") {
      return <TeamAgenda onMessageUser={(userId) => {
        setPendingChatKeyToOpen(`direct:${userId}`);
        setPage("internal-messages");
      }} />;
    }

    if (page === "ideas-incubator") {
      return <IdeasIncubator />;
    }

    if (page === "bug-reports") {
      return <BugReports />;
    }

    if (page === "material-corrections" && canUseEditorial) {
      return <MaterialCorrections />;
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

    if (navPage === "drive-manager") {
      return page === "drive-manager";
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

    if (navPage === "subscription-manager") {
      return page === "subscription-manager";
    }

    if (navPage === "digital-signage") {
      return page === "digital-signage";
    }

    if (navPage === "protect-cameras") {
      return page === "protect-cameras";
    }

    if (navPage === "team-agenda") {
      return page === "team-agenda";
    }

    if (navPage === "ideas-incubator") {
      return page === "ideas-incubator";
    }

    if (navPage === "bug-reports") {
      return page === "bug-reports";
    }

    if (navPage === "material-corrections") {
      return page === "material-corrections";
    }

    if (navPage === "notifications-center") {
      return page === "notifications-center";
    }

    return page === navPage;
  }

  const navigationItems = getDashboardNavigationItems({
    isAdmin,
    canUsePrintShop,
    canUseTechnicalSupport,
    canUseDriveManager,
    canUseEditorial,
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
  const featuredNavigationItem = navigationItems.find((item) => item.section === "featured");
  const groupedNavigationItems = getDashboardNavigationGroups(navigationItems);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
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

        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
          aria-label={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>

        <nav className="sidebar-nav redesigned-sidebar-nav">
          {featuredNavigationItem && (
            <button
              type="button"
              className={`sidebar-featured-item ${isNavActive(featuredNavigationItem.page) ? "active" : ""}`}
              onClick={() => goToPage(featuredNavigationItem.page)}
            >
              <span className="nav-icon"><DashboardNavIcon name={featuredNavigationItem.icon} /></span>
              <span className="sidebar-nav-label">{featuredNavigationItem.label}</span>
              {featuredNavigationItem.badgeCount > 0 && (
                <span className="nav-unread-badge">
                  {formatUnreadBadgeCount(featuredNavigationItem.badgeCount)}
                </span>
              )}
            </button>
          )}

          {groupedNavigationItems.map((group) => (
            <div className="sidebar-nav-group" key={group.section}>
              <span className="sidebar-section-title">{group.section.toUpperCase()}</span>

              {group.items.map((item) => (
                <button
                  key={item.page}
                  type="button"
                  className={isNavActive(item.page) ? "active" : ""}
                  onClick={() => goToPage(item.page)}
                >
                  <span className="nav-icon"><DashboardNavIcon name={item.icon} /></span>
                  <span className="sidebar-nav-label">{item.label}</span>
                  {item.badgeCount > 0 && (
                    <span
                      className={`nav-unread-badge ${item.page === "workspace-dashboard" ? "nav-announcement-badge" : ""}`}
                      aria-label={`${item.badgeCount} pendientes`}
                    >
                      {formatUnreadBadgeCount(item.badgeCount)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-brand-footer" aria-label="Active English School - Desarrollo de Proyectos">
          <span className="sidebar-brand-footer-icon"><DashboardNavIcon name="dashboard" /></span>
          <span>
            <strong>Active English School</strong>
            <small>Desarrollo de Proyectos</small>
          </span>
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
          activeTitle={isAdmin ? "Desarrollo de Proyectos" : "Mi panel"}
          theme={theme}
          onToggleTheme={onToggleTheme}
          unreadMessagesCount={unreadMessagesCount}
          unreadAnnouncementsCount={unreadAnnouncementsCount}
          profileMenuOpen={profileMenuOpen}
          setProfileMenuOpen={setProfileMenuOpen}
          notificationPanelOpen={notificationPanelOpen}
          setNotificationPanelOpen={setNotificationPanelOpen}
          onViewProfile={handleViewProfile}
          onLogout={handleLogout}
          onOpenModule={goToPage}
          onOpenProject={openProject}
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

      <FloatingQuickTools
        profile={profile}
        isAdmin={isAdmin}
        unreadMessagesCount={unreadMessagesCount}
        onOpenMessages={() => goToPage("internal-messages")}
        onOpenNotes={() => {
          goToPage("workspace-dashboard");
          window.setTimeout(() => scrollToWorkspaceSection("workspace-notes-section"), 120);
        }}
      />
    </div>
  );
}



function WorkspaceDashboard({
  profile,
  isAdmin,
  unreadDirectMessagesCount = 0,
  unreadDepartmentMessagesCount = 0,
  unreadMessagesCount = 0,
  unreadAnnouncementsCount = 0,
  onOpenModule = () => {},
}) {
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
  const [announcementSearchTerm, setAnnouncementSearchTerm] = useState("");
  const [announcementFilter, setAnnouncementFilter] = useState("all");
  const [adminAnnouncementSearchTerm, setAdminAnnouncementSearchTerm] = useState("");
  const [adminAnnouncementFilter, setAdminAnnouncementFilter] = useState("all");
  const [selectedAdminAnnouncementId, setSelectedAdminAnnouncementId] = useState("");
  const [activeCollaborators, setActiveCollaborators] = useState([]);
  const [noteSearchTerm, setNoteSearchTerm] = useState("");
  const [noteFilter, setNoteFilter] = useState("all");
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const communicationActivity = useWorkspaceCommunicationActivity(profile, isAdmin);

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
          .filter((announcement) => isAdmin || isAnnouncementActive(announcement))
          .sort(sortByCreatedAtDesc)
          .slice(0, isAdmin ? 80 : 12);

        setAnnouncements(nextAnnouncements);
        setAnnouncementError("");
      },
      (error) => {
        console.error("No se pudieron cargar los anuncios:", error);
        setAnnouncementError("No se pudieron cargar los anuncios.");
      }
    );
  }, [currentUserId, isAdmin]);

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
    if (!isAdmin || !currentUserId) {
      setActiveCollaborators([]);
      return undefined;
    }

    return onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const nextCollaborators = snapshot.docs
          .map((userDoc) => normalizeUserProfileForAnnouncements(userDoc.id, userDoc.data()))
          .filter(isActiveUserForAnnouncementTracking)
          .sort(sortUserProfilesByName);

        setActiveCollaborators(nextCollaborators);
      },
      (error) => {
        console.error("No se pudieron cargar colaboradores para anuncios:", error);
        setActiveCollaborators([]);
      }
    );
  }, [isAdmin, currentUserId]);

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
    setShowAnnouncementComposer(false);
  }

  function resetNoteEditor() {
    revokeDraftAttachmentPreviews(noteAttachments);
    setNoteForm({ title: "", content: "", pinned: false, color: "yellow" });
    setNoteAttachments([]);
    setOriginalNoteAttachments([]);
    setEditingNoteId("");
    setShowNoteComposer(false);
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
    setShowAnnouncementComposer(true);
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

  async function handleRestoreAnnouncement(announcementId) {
    if (!isAdmin) return;

    try {
      await updateDoc(doc(db, "announcements", announcementId), {
        active: true,
        archivedAt: null,
        restoredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserId,
        updatedByName: profile?.name || "Usuario",
        updatedByEmail: profile?.email || "",
      });
      setAnnouncementStatus("Anuncio restaurado.");
    } catch (error) {
      console.error("No se pudo restaurar el anuncio:", error);
      setAnnouncementError("No se pudo restaurar el anuncio.");
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
    setShowNoteComposer(true);
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

  const activeAnnouncements = announcements.filter(isAnnouncementActive);
  const archivedAnnouncements = announcements.filter((announcement) => !isAnnouncementActive(announcement));
  const unreadAnnouncements = activeAnnouncements.filter(
    (announcement) => !announcementReceipts[announcement.id]?.length
  ).length;
  const pendingNotes = notes.filter((note) => !note.completed).length;
  const importantAnnouncements = activeAnnouncements.filter(
    (announcement) => announcement.priority === "important"
  ).length;
  const adminAnnouncementStats = announcements.map((announcement) => ({
    announcement,
    stats: getAnnouncementConfirmationStats(
      announcement,
      announcementReceipts[announcement.id] || [],
      activeCollaborators
    ),
  }));
  const adminTotalPendingConfirmations = adminAnnouncementStats
    .filter(({ announcement }) => isAnnouncementActive(announcement))
    .reduce((total, item) => total + item.stats.pendingCount, 0);
  const notesWithAttachments = notes.filter((note) => Array.isArray(note.attachments) && note.attachments.length > 0).length;
  const filteredAnnouncements = activeAnnouncements.filter((announcement) =>
    matchesAnnouncementBoardFilters(announcement, {
      searchTerm: announcementSearchTerm,
      filter: announcementFilter,
      receipts: announcementReceipts[announcement.id] || [],
      currentUserId,
    })
  );
  const filteredNotes = notes.filter((note) =>
    matchesPersonalNoteFilters(note, {
      searchTerm: noteSearchTerm,
      filter: noteFilter,
    })
  );
  const unreadDirectActivityMessages = communicationActivity.directMessages
    .filter((message) => message.fromUserId !== currentUserId && message.read !== true)
    .slice(0, 6);
  const unreadDepartmentActivityMessages = communicationActivity.departmentMessages
    .filter((message) => isUnreadDepartmentMessage(message, currentUserId))
    .slice(0, 6);
  const unreadAnnouncementItems = activeAnnouncements
    .filter((announcement) => !announcementReceipts[announcement.id]?.length)
    .slice(0, 6);
  const pendingNoteItems = notes
    .filter((note) => !note.completed)
    .slice(0, 6);
  const activityItems = buildWorkspaceActivityItems({
    directMessages: unreadDirectActivityMessages,
    departmentMessages: unreadDepartmentActivityMessages,
    announcements: unreadAnnouncementItems,
    notes: pendingNoteItems,
  });
  const totalWorkspacePendingItems =
    Number(unreadMessagesCount || 0) + Number(unreadAnnouncements || 0) + Number(pendingNotes || 0);

  return (
    <div className="workspace-dashboard-page workspace-dashboard-redesign">
      <section className="module-topbar module-topbar-dashboard workspace-module-topbar">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <DashboardNavIcon name="dashboard" />
          </span>

          <div className="module-topbar-copy">
            <p className="section-kicker module-topbar-kicker">General</p>
            <h1>Tablero general</h1>
            <p>
              Publica avisos importantes, consulta tus notas personales y mantente al día con lo esencial.
            </p>
            {unreadAnnouncements > 0 && (
              <div className="announcement-pending-strip compact-pending-strip module-topbar-alert">
                <span>📣</span>
                <strong>{unreadAnnouncements} anuncio(s) pendiente(s) de confirmar</strong>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="workspace-clean-metrics">
        <button
          type="button"
          className="workspace-clean-metric metric-blue"
          onClick={() => scrollToWorkspaceSection("workspace-announcements-section")}
        >
          <span className="workspace-clean-icon">📣</span>
          <span>
            <strong>{activeAnnouncements.length}</strong>
            <small>Avisos activos</small>
            <em>Anuncios publicados</em>
          </span>
        </button>

        <button
          type="button"
          className="workspace-clean-metric metric-gold"
          onClick={() => scrollToWorkspaceSection("workspace-notes-section")}
        >
          <span className="workspace-clean-icon">🔔</span>
          <span>
            <strong>{pendingNotes}</strong>
            <small>Notas pendientes</small>
            <em>Notas por revisar</em>
          </span>
        </button>

        <button
          type="button"
          className="workspace-clean-metric metric-green"
          onClick={() => scrollToWorkspaceSection("workspace-notes-section")}
        >
          <span className="workspace-clean-icon">🗂️</span>
          <span>
            <strong>{notesWithAttachments}</strong>
            <small>Notas con archivos</small>
            <em>Notas con adjuntos</em>
          </span>
        </button>

        <button
          type="button"
          className="workspace-clean-metric metric-purple"
          onClick={() => onOpenModule("internal-messages")}
        >
          <span className="workspace-clean-icon">💬</span>
          <span>
            <strong>{unreadMessagesCount}</strong>
            <small>Mensajes no leídos</small>
            <em>Nuevos mensajes</em>
          </span>
        </button>
      </section>

      <div className="workspace-primary-grid-redesign">
        <section id="workspace-announcements-section" className="workspace-clean-card announcement-clean-card">
          <div className="workspace-clean-card-header">
            <div>
              <h3>Tablero de anuncios</h3>
              <p>Publica avisos importantes para todo el equipo.</p>
            </div>

            <div className="workspace-clean-card-actions">
              <span>{activeAnnouncements.length} activos</span>
              {isAdmin && (
                <button
                  type="button"
                  className="workspace-primary-button clean-action-button"
                  onClick={() => setShowAnnouncementComposer((current) => !current)}
                >
                  + Publicar anuncio
                </button>
              )}
            </div>
          </div>

          {isAdmin && (showAnnouncementComposer || editingAnnouncementId) && (
            <form className="announcement-form board-form-visual clean-composer" onSubmit={handleAnnouncementSubmit}>
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
                  spellCheck={true}
                  lang="es-MX"
                  autoCorrect="on"
                  autoCapitalize="sentences"
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
                <button
                  type="button"
                  className="workspace-soft-button"
                  onClick={resetAnnouncementEditor}
                >
                  Cancelar
                </button>

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

          {activeAnnouncements.length > 0 && (
            <div className="board-search-toolbar clean-toolbar">
              <label className="board-search-input">
                <span>Buscar anuncios</span>
                <input
                  value={announcementSearchTerm}
                  onChange={(event) => setAnnouncementSearchTerm(event.target.value)}
                  placeholder="Buscar por título, mensaje, autor o archivo..."
                />
              </label>

              <div className="board-filter-pills" aria-label="Filtros de anuncios">
                {ANNOUNCEMENT_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={announcementFilter === option.value ? "active" : ""}
                    onClick={() => setAnnouncementFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="announcement-list visual-announcement-list clean-announcement-list">
            {activeAnnouncements.length === 0 ? (
              <div className="workspace-clean-empty announcement-empty-illustration">
                <div className="clean-empty-illustration-icon">📣</div>
                <strong>Aún no hay anuncios publicados</strong>
                <p>Comparte información importante con tu equipo.</p>
                {isAdmin && (
                  <button
                    type="button"
                    className="workspace-soft-button clean-empty-button"
                    onClick={() => setShowAnnouncementComposer(true)}
                  >
                    Publicar mi primer anuncio +
                  </button>
                )}
              </div>
            ) : filteredAnnouncements.length === 0 ? (
              <div className="workspace-clean-empty">
                <strong>No hay anuncios que coincidan</strong>
                <p>Ajusta la búsqueda o cambia el filtro seleccionado.</p>
              </div>
            ) : (
              filteredAnnouncements.map((announcement) => {
                const receipts = announcementReceipts[announcement.id] || [];
                const currentUserHasRead = receipts.some(
                  (receipt) => receipt.userId === currentUserId || receipt.id === currentUserId
                );

                return (
                  <article
                    key={announcement.id}
                    className={`announcement-item visual-announcement-item clean-announcement-item ${
                      announcement.priority === "important" ? "important" : ""
                    } ${currentUserHasRead ? "" : "pending-read"}`}
                  >
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
                      <div className="announcement-admin-actions clean-admin-actions">
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
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section id="workspace-notes-section" className="workspace-clean-card notes-clean-card">
          <div className="workspace-clean-card-header">
            <div>
              <h3>Mis notas personales</h3>
              <p>Crea notas rápidas y organiza tu información personal.</p>
            </div>

            <div className="workspace-clean-card-actions">
              <span>{notes.length} notas</span>
              <button
                type="button"
                className="workspace-primary-button clean-action-button note-action-button"
                onClick={() => setShowNoteComposer((current) => !current)}
              >
                + Nueva nota
              </button>
            </div>
          </div>

          {(showNoteComposer || editingNoteId) && (
            <form className="personal-note-form board-form-visual clean-composer clean-note-composer" onSubmit={handleNoteSubmit}>
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
                <button
                  type="button"
                  className="workspace-soft-button"
                  onClick={resetNoteEditor}
                >
                  Cancelar
                </button>

                <button type="submit" className="workspace-primary-button" disabled={noteSaving}>
                  {noteSaving ? "Guardando..." : editingNoteId ? "Guardar nota" : "Agregar nota"}
                </button>
              </div>
            </form>
          )}

          {noteError && <div className="workspace-error-box">{noteError}</div>}
          {noteStatus && <div className="workspace-success-box">{noteStatus}</div>}

          {notes.length > 0 && (
            <div className="board-search-toolbar notes-search-toolbar clean-toolbar">
              <label className="board-search-input">
                <span>Buscar notas</span>
                <input
                  value={noteSearchTerm}
                  onChange={(event) => setNoteSearchTerm(event.target.value)}
                  placeholder="Buscar por título, contenido o archivo..."
                />
              </label>

              <div className="board-filter-pills" aria-label="Filtros de notas personales">
                {NOTE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={noteFilter === option.value ? "active" : ""}
                    onClick={() => setNoteFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`personal-notes-list visual-notes-grid clean-notes-list ${notes.length === 0 ? "notes-list-empty-state" : ""}`}>
            {notes.length === 0 ? (
              <div className="workspace-clean-empty note-empty-illustration">
                <div className="clean-empty-illustration-icon">📝</div>
                <strong>Aún no tienes notas personales</strong>
                <p>Crea tu primera nota para guardar información importante.</p>
                <button
                  type="button"
                  className="workspace-soft-button clean-empty-button note-empty-button"
                  onClick={() => setShowNoteComposer(true)}
                >
                  Crear mi primera nota +
                </button>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="workspace-clean-empty">
                <strong>No hay notas que coincidan</strong>
                <p>Ajusta la búsqueda o cambia el filtro seleccionado.</p>
              </div>
            ) : (
              filteredNotes.map((note) => (
                <article
                  key={note.id}
                  className={`personal-note-item visual-note-item clean-note-item note-color-${normalizeNoteColor(note.color)} ${note.completed ? "completed" : ""}`}
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

                  <div className="personal-note-actions clean-note-actions">
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

        {isAdmin && announcements.length > 0 && (
          <details className="workspace-admin-details workspace-admin-details-wide">
            <summary>Panel administrativo de anuncios</summary>
            <AnnouncementAdminDashboard
              announcements={announcements}
              activeAnnouncements={activeAnnouncements}
              archivedAnnouncements={archivedAnnouncements}
              activeCollaborators={activeCollaborators}
              announcementReceipts={announcementReceipts}
              filter={adminAnnouncementFilter}
              onFilterChange={setAdminAnnouncementFilter}
              searchTerm={adminAnnouncementSearchTerm}
              onSearchTermChange={setAdminAnnouncementSearchTerm}
              selectedAnnouncementId={selectedAdminAnnouncementId}
              onSelectAnnouncement={setSelectedAdminAnnouncementId}
              onEdit={handleEditAnnouncement}
              onArchive={handleArchiveAnnouncement}
              onRestore={handleRestoreAnnouncement}
              onDelete={handleDeleteAnnouncement}
            />
          </details>
        )}
      </div>

      <section className="workspace-clean-card workspace-activity-clean-card">
        <div className="workspace-clean-card-header compact-activity-header">
          <div>
            <h3>Actividad reciente</h3>
            <p>Lo más importante para revisar.</p>
          </div>

          <button type="button" className="workspace-soft-button" onClick={() => onOpenModule("my-projects")}>
            Ver mis proyectos
          </button>
        </div>

        <div className="workspace-clean-activity-list">
          {activityItems.length === 0 ? (
            <div className="workspace-clean-empty compact-clean-empty">
              <div className="clean-empty-illustration-icon muted">📋</div>
              <strong>No hay actividad reciente</strong>
              <p>Cuando haya anuncios, notas o mensajes, aparecerán aquí.</p>
            </div>
          ) : (
            activityItems.slice(0, 4).map((item) => (
              <button
                type="button"
                key={item.id}
                className={`workspace-clean-activity-item activity-${item.tone}`}
                onClick={() => {
                  if (item.action === "messages") onOpenModule("internal-messages");
                  if (item.action === "announcements") scrollToWorkspaceSection("workspace-announcements-section");
                  if (item.action === "notes") scrollToWorkspaceSection("workspace-notes-section");
                }}
              >
                <span>{item.icon}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <em>{item.timeLabel}</em>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}


function WorkspaceNoticeCenter({
  unreadDirectMessagesCount,
  unreadDepartmentMessagesCount,
  unreadAnnouncementsCount,
  pendingNotesCount,
  totalPendingCount,
  activityItems,
  onOpenMessages,
  onOpenAnnouncements,
  onOpenNotes,
  onOpenProjects,
}) {
  const hasActivity = activityItems.length > 0;

  return (
    <section className="workspace-notice-center">
      <div className="notice-center-hero">
        <div>
          <span className="notice-center-kicker">Centro de avisos</span>
          <h2>{totalPendingCount > 0 ? "Tienes actividad pendiente" : "Todo al día por ahora"}</h2>
          <p>
            Revisa desde aquí tus mensajes nuevos, anuncios por confirmar, chats por departamento y notas personales pendientes.
          </p>
        </div>
        <div className={`notice-center-total ${totalPendingCount > 0 ? "has-pending" : "clear"}`}>
          <strong>{formatUnreadBadgeCount(totalPendingCount)}</strong>
          <span>{totalPendingCount === 1 ? "pendiente" : "pendientes"}</span>
        </div>
      </div>

      <div className="notice-center-grid">
        <button type="button" className="notice-center-card message-card" onClick={onOpenMessages}>
          <span className="notice-card-icon">💬</span>
          <div>
            <strong>{formatUnreadBadgeCount(unreadDirectMessagesCount)}</strong>
            <h3>Mensajes nuevos</h3>
            <p>Conversaciones individuales sin leer.</p>
          </div>
          <b>Ver mensajes</b>
        </button>

        <button type="button" className="notice-center-card department-card" onClick={onOpenMessages}>
          <span className="notice-card-icon">👥</span>
          <div>
            <strong>{formatUnreadBadgeCount(unreadDepartmentMessagesCount)}</strong>
            <h3>Chats de departamento</h3>
            <p>Mensajes grupales pendientes.</p>
          </div>
          <b>Ver chats</b>
        </button>

        <button type="button" className="notice-center-card announcement-card" onClick={onOpenAnnouncements}>
          <span className="notice-card-icon">📣</span>
          <div>
            <strong>{formatUnreadBadgeCount(unreadAnnouncementsCount)}</strong>
            <h3>Anuncios pendientes</h3>
            <p>Avisos que faltan por confirmar.</p>
          </div>
          <b>Ver tablero</b>
        </button>

        <button type="button" className="notice-center-card notes-card-mini" onClick={onOpenNotes}>
          <span className="notice-card-icon">📝</span>
          <div>
            <strong>{formatUnreadBadgeCount(pendingNotesCount)}</strong>
            <h3>Notas pendientes</h3>
            <p>Recordatorios personales activos.</p>
          </div>
          <b>Ver notas</b>
        </button>
      </div>

      <div className="notice-center-activity-card">
        <div className="notice-center-activity-header">
          <div>
            <span>Actividad reciente</span>
            <h3>Lo más importante para revisar</h3>
          </div>
          <button type="button" onClick={onOpenProjects}>Ver mis proyectos</button>
        </div>

        {hasActivity ? (
          <div className="notice-activity-list">
            {activityItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notice-activity-item ${item.tone}`}
                onClick={item.action === "messages" ? onOpenMessages : item.action === "announcements" ? onOpenAnnouncements : onOpenNotes}
              >
                <span>{item.icon}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <small>{item.timeLabel}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="notice-center-empty">
            <strong>No hay avisos pendientes</strong>
            <p>Cuando lleguen mensajes, anuncios o recordatorios pendientes, aparecerán en esta sección.</p>
          </div>
        )}
      </div>
    </section>
  );
}



function AnnouncementAdminDashboard({
  announcements,
  activeAnnouncements,
  archivedAnnouncements,
  activeCollaborators,
  announcementReceipts,
  filter,
  onFilterChange,
  searchTerm,
  onSearchTermChange,
  selectedAnnouncementId,
  onSelectAnnouncement,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}) {
  const announcementStats = announcements.map((announcement) => ({
    announcement,
    stats: getAnnouncementConfirmationStats(
      announcement,
      announcementReceipts[announcement.id] || [],
      activeCollaborators
    ),
  }));
  const filteredStats = announcementStats.filter(({ announcement, stats }) =>
    matchesAdminAnnouncementFilters(announcement, stats, { filter, searchTerm })
  );
  const selectedItem =
    announcementStats.find(({ announcement }) => announcement.id === selectedAnnouncementId) ||
    filteredStats[0] ||
    null;
  const importantCount = announcements.filter((announcement) => announcement.priority === "important").length;
  const withAttachmentsCount = announcements.filter(hasBoardAttachments).length;
  const pendingConfirmations = announcementStats
    .filter(({ announcement }) => isAnnouncementActive(announcement))
    .reduce((total, item) => total + item.stats.pendingCount, 0);

  return (
    <section className="announcement-admin-dashboard">
      <div className="announcement-admin-dashboard-header">
        <div>
          <span>Panel administrativo</span>
          <h4>Seguimiento de anuncios</h4>
          <p>
            Revisa anuncios activos y archivados, confirma quién ya los leyó y detecta quién falta por confirmar.
          </p>
        </div>
        <div className="announcement-admin-total-badge">
          {activeCollaborators.length} colaborador(es) activos
        </div>
      </div>

      <div className="announcement-admin-metrics">
        <div>
          <span>Activos</span>
          <strong>{activeAnnouncements.length}</strong>
        </div>
        <div>
          <span>Archivados</span>
          <strong>{archivedAnnouncements.length}</strong>
        </div>
        <div>
          <span>Importantes</span>
          <strong>{importantCount}</strong>
        </div>
        <div>
          <span>Con archivos</span>
          <strong>{withAttachmentsCount}</strong>
        </div>
        <div className="pending">
          <span>Pendientes totales</span>
          <strong>{pendingConfirmations}</strong>
        </div>
      </div>

      <div className="announcement-admin-toolbar">
        <label className="board-search-input announcement-admin-search">
          <span>Buscar en panel admin</span>
          <input
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Buscar por título, mensaje, autor o archivo..."
          />
        </label>

        <div className="board-filter-pills announcement-admin-filters" aria-label="Filtros administrativos de anuncios">
          {ADMIN_ANNOUNCEMENT_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? "active" : ""}
              onClick={() => onFilterChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="announcement-admin-layout">
        <div className="announcement-admin-table-wrap">
          <table className="announcement-admin-table">
            <thead>
              <tr>
                <th>Anuncio</th>
                <th>Estado</th>
                <th>Prioridad</th>
                <th>Lectura</th>
                <th>Faltan</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="announcement-admin-empty">No hay anuncios con este filtro.</div>
                  </td>
                </tr>
              ) : (
                filteredStats.map(({ announcement, stats }) => {
                  const active = isAnnouncementActive(announcement);
                  const isSelected = selectedItem?.announcement?.id === announcement.id;

                  return (
                    <tr key={announcement.id} className={isSelected ? "selected" : ""}>
                      <td>
                        <button
                          type="button"
                          className="announcement-admin-title-button"
                          onClick={() => onSelectAnnouncement(announcement.id)}
                        >
                          <strong>{announcement.title || "Anuncio sin título"}</strong>
                          <span>{formatDateTime(announcement.createdAt)} · {announcement.createdByName || "Administración"}</span>
                        </button>
                      </td>
                      <td>
                        <span className={`admin-status-pill ${active ? "active" : "archived"}`}>
                          {active ? "Activo" : "Archivado"}
                        </span>
                      </td>
                      <td>{announcement.priority === "important" ? "Importante" : "Normal"}</td>
                      <td>
                        <div className="admin-read-progress">
                          <strong>{stats.readCount} / {stats.totalCount}</strong>
                          <span>{stats.readPercentage}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={stats.pendingCount > 0 ? "admin-pending-number" : "admin-complete-number"}>
                          {stats.pendingCount}
                        </span>
                      </td>
                      <td>
                        <div className="announcement-admin-row-actions">
                          <button type="button" onClick={() => onSelectAnnouncement(announcement.id)}>
                            Ver
                          </button>
                          <button type="button" onClick={() => onEdit(announcement)}>
                            Editar
                          </button>
                          {active ? (
                            <button type="button" onClick={() => onArchive(announcement.id)}>
                              Archivar
                            </button>
                          ) : (
                            <button type="button" onClick={() => onRestore(announcement.id)}>
                              Restaurar
                            </button>
                          )}
                          <button type="button" className="danger" onClick={() => onDelete(announcement)}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <aside className="announcement-admin-detail">
          {selectedItem ? (
            <>
              <div className="announcement-admin-detail-top">
                <span className={`admin-status-pill ${isAnnouncementActive(selectedItem.announcement) ? "active" : "archived"}`}>
                  {isAnnouncementActive(selectedItem.announcement) ? "Activo" : "Archivado"}
                </span>
                <h5>{selectedItem.announcement.title || "Anuncio sin título"}</h5>
                <p>{selectedItem.announcement.message || "Sin mensaje."}</p>
              </div>

              <div className="announcement-admin-detail-stats">
                <div>
                  <span>Leídos</span>
                  <strong>{selectedItem.stats.readCount}</strong>
                </div>
                <div>
                  <span>Faltan</span>
                  <strong>{selectedItem.stats.pendingCount}</strong>
                </div>
                <div>
                  <span>Avance</span>
                  <strong>{selectedItem.stats.readPercentage}%</strong>
                </div>
              </div>

              <div className="announcement-admin-people-grid">
                <div>
                  <strong>Ya confirmaron</strong>
                  {selectedItem.stats.readers.length === 0 ? (
                    <p>Aún nadie ha confirmado este anuncio.</p>
                  ) : (
                    selectedItem.stats.readers.map((person) => (
                      <span key={person.id} className="reader-person-chip">
                        ✓ {person.name || person.email || "Usuario"}
                      </span>
                    ))
                  )}
                </div>

                <div>
                  <strong>Faltan por confirmar</strong>
                  {selectedItem.stats.missing.length === 0 ? (
                    <p>Todos los colaboradores activos ya confirmaron.</p>
                  ) : (
                    selectedItem.stats.missing.map((person) => (
                      <span key={person.id} className="missing-person-chip">
                        • {person.name || person.email || "Usuario"}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="announcement-admin-empty">Selecciona un anuncio para ver el detalle.</div>
          )}
        </aside>
      </div>
    </section>
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
        if (type === "audio") {
          return (
            <article
              key={attachment.path || attachment.url || attachment.name}
              className="attachment-card type-audio audio-message-card"
            >
              <MessageAudioPlayer attachment={attachment} />
            </article>
          );
        }

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

function isAudioOnlyMessage(message) {
  return isAudioMessage(message, getAttachmentType);
}

function isRecordedVoiceAttachment(attachment) {
  const name = String(attachment?.name || "").toLowerCase();

  return attachment?.source === "recordedVoice" ||
    /^audio-\d{4}-\d{2}-\d{2}t.+\.webm$/i.test(name);
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

const ANNOUNCEMENT_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "read", label: "Leídos" },
  { value: "important", label: "Importantes" },
  { value: "attachments", label: "Con archivos" },
];

const ADMIN_ANNOUNCEMENT_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "archived", label: "Archivados" },
  { value: "important", label: "Importantes" },
  { value: "attachments", label: "Con archivos" },
  { value: "pending", label: "Con pendientes" },
  { value: "completed", label: "Leídos por todos" },
];

const NOTE_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "pinned", label: "Fijadas" },
  { value: "pending", label: "Pendientes" },
  { value: "completed", label: "Completadas" },
  { value: "attachments", label: "Con archivos" },
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
      source: attachment.source || "",
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

function createDraftAttachment(file, metadata = {}) {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name,
    size: file.size || 0,
    contentType: file.type || guessContentTypeFromName(file.name),
    type: getAttachmentType(file.type, file.name),
    source: metadata.source || "",
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
      source: item.source || "",
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
        source: item.source || "",
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
  const looksLikeRecordedAudio = /^audio-\d{4}-\d{2}-\d{2}t.+\.webm$/i.test(lowerName)
    || /^audio-.*\.(webm|weba)$/i.test(lowerName);

  if (looksLikeRecordedAudio) return "audio";
  if (lowerType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)) return "image";
  if (lowerType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|weba)$/i.test(lowerName)) return "audio";
  if (lowerType.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm)$/i.test(lowerName)) return "video";
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

function getSearchableAttachmentText(attachments = []) {
  if (!Array.isArray(attachments)) return "";
  return attachments
    .map((attachment) => [attachment.name, attachment.type, attachment.contentType].filter(Boolean).join(" "))
    .join(" ");
}

function textIncludesSearchTerm(value, searchTerm) {
  const normalizedSearch = normalizeText(searchTerm);
  if (!normalizedSearch) return true;
  return normalizeText(value).includes(normalizedSearch);
}

function hasBoardAttachments(item) {
  return Array.isArray(item?.attachments) && item.attachments.length > 0;
}


function isAnnouncementActive(announcement) {
  return announcement?.active !== false;
}

function normalizeUserProfileForAnnouncements(id, data = {}) {
  return {
    id,
    uid: data.uid || data.userId || id,
    name: data.name || data.displayName || data.fullName || data.email || "Usuario",
    email: data.email || "",
    role: data.role || "collaborator",
    active: data.active,
    status: data.status || "active",
  };
}

function isActiveUserForAnnouncementTracking(user) {
  return Boolean(user?.id)
    && user.active !== false
    && user.status !== "inactive"
    && user.status !== "deleted";
}

function sortUserProfilesByName(a, b) {
  return String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "es");
}

function getAnnouncementConfirmationStats(announcement, receipts = [], activeCollaborators = []) {
  const receiptUserIds = new Set(
    receipts
      .map((receipt) => receipt.userId || receipt.id || "")
      .filter(Boolean)
  );
  const receiptEmails = new Set(
    receipts
      .map((receipt) => String(receipt.userEmail || "").toLowerCase())
      .filter(Boolean)
  );
  const readers = activeCollaborators.filter((user) =>
    receiptUserIds.has(user.id) ||
    receiptUserIds.has(user.uid) ||
    (user.email && receiptEmails.has(String(user.email).toLowerCase()))
  );
  const missing = activeCollaborators.filter((user) =>
    !receiptUserIds.has(user.id) &&
    !receiptUserIds.has(user.uid) &&
    !(user.email && receiptEmails.has(String(user.email).toLowerCase()))
  );
  const totalCount = activeCollaborators.length;
  const readCount = readers.length;
  const pendingCount = Math.max(totalCount - readCount, 0);
  const readPercentage = totalCount ? Math.round((readCount / totalCount) * 100) : 0;

  return {
    totalCount,
    readCount,
    pendingCount,
    readPercentage,
    readers,
    missing,
  };
}

function matchesAdminAnnouncementFilters(announcement, stats, { filter, searchTerm }) {
  if (filter === "active" && !isAnnouncementActive(announcement)) return false;
  if (filter === "archived" && isAnnouncementActive(announcement)) return false;
  if (filter === "important" && announcement.priority !== "important") return false;
  if (filter === "attachments" && !hasBoardAttachments(announcement)) return false;
  if (filter === "pending" && stats.pendingCount <= 0) return false;
  if (filter === "completed" && (stats.totalCount === 0 || stats.pendingCount > 0)) return false;

  const searchableText = [
    announcement.title,
    announcement.message,
    announcement.createdByName,
    announcement.createdByEmail,
    announcement.priority,
    isAnnouncementActive(announcement) ? "activo" : "archivado",
    getSearchableAttachmentText(announcement.attachments),
  ].join(" ");

  return textIncludesSearchTerm(searchableText, searchTerm);
}

function matchesAnnouncementBoardFilters(announcement, { searchTerm, filter, receipts, currentUserId }) {
  const hasRead = (receipts || []).some(
    (receipt) => receipt.userId === currentUserId || receipt.id === currentUserId
  );

  if (filter === "pending" && hasRead) return false;
  if (filter === "read" && !hasRead) return false;
  if (filter === "important" && announcement.priority !== "important") return false;
  if (filter === "attachments" && !hasBoardAttachments(announcement)) return false;

  const searchableText = [
    announcement.title,
    announcement.message,
    announcement.createdByName,
    announcement.createdByEmail,
    getSearchableAttachmentText(announcement.attachments),
  ].join(" ");

  return textIncludesSearchTerm(searchableText, searchTerm);
}

function matchesPersonalNoteFilters(note, { searchTerm, filter }) {
  if (filter === "pinned" && !note.pinned) return false;
  if (filter === "pending" && note.completed) return false;
  if (filter === "completed" && !note.completed) return false;
  if (filter === "attachments" && !hasBoardAttachments(note)) return false;

  const searchableText = [
    note.title,
    note.content,
    note.color,
    getSearchableAttachmentText(note.attachments),
  ].join(" ");

  return textIncludesSearchTerm(searchableText, searchTerm);
}

function matchesConversationSearch(conversation, searchTerm) {
  const searchableText = [
    conversation.participantName,
    conversation.participantEmail,
    conversation.lastMessage?.message,
    conversation.messages
      .map((message) => [
        message.subject,
        message.message,
        message.fromUserName,
        message.toUserName,
        getSearchableAttachmentText(message.attachments),
      ].join(" "))
      .join(" "),
  ].join(" ");

  return textIncludesSearchTerm(searchableText, searchTerm);
}

function matchesMessageSearch(message, searchTerm) {
  const searchableText = [
    message.subject,
    message.message,
    message.fromUserName,
    message.toUserName,
    message.fromUserEmail,
    message.toUserEmail,
    getSearchableAttachmentText(message.attachments),
  ].join(" ");

  return textIncludesSearchTerm(searchableText, searchTerm);
}

function buildMessageTypingStateId(chatKey, userId) {
  return `${chatKey || "chat"}__${userId || "user"}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}

let messageNotificationAudioContext = null;

function getMessageNotificationAudioContext() {
  if (typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  if (!messageNotificationAudioContext) {
    messageNotificationAudioContext = new AudioContextClass();
  }

  return messageNotificationAudioContext;
}

async function primeMessageNotificationSound() {
  try {
    const audioContext = getMessageNotificationAudioContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.connect(audioContext.destination);
    gain.disconnect();
  } catch (error) {
    console.warn("No se pudo preparar sonido de mensaje:", error);
  }
}

async function playMessageNotificationSound(preferences = { soundsEnabled: true, tone: "classic", volume: 70, mutedUntil: 0 }) {
  if (typeof window === "undefined") return;
  if (!preferences.soundsEnabled || Number(preferences.mutedUntil) > Date.now()) return;

  try {
    const audioContext = getMessageNotificationAudioContext();
    if (!audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const selectedTone = NOTIFICATION_TONES.find((tone) => tone.id === preferences.tone) || NOTIFICATION_TONES[0];
    selectedTone.notes.forEach((tone) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime + tone.start;
      const stopAt = startAt + tone.duration;

      oscillator.type = selectedTone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, stopAt);
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, Number(preferences.volume) / 100 * 0.34), startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, stopAt);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
    });
  } catch (error) {
    console.warn("No se pudo reproducir sonido de mensaje:", error);
  }
}

const AUDIO_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function getAudioFileExtension(mimeType = "") {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("mp4")) return "m4a";
  if (type.includes("aac")) return "aac";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function getVoiceRecordingErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Permiso de micrófono denegado. Revisa los permisos del navegador.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No se detectó ningún micrófono.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "El micrófono está ocupado o bloqueado por otra aplicación.";
  }

  return "No se pudo acceder al micrófono.";
}

function formatVoiceRecordingDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function canUseBrowserNotifications() {
  return typeof window !== "undefined"
    && "Notification" in window
    && (window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function showBrowserMessageNotification(messageInfo, onNotificationClick) {
  if (!canUseBrowserNotifications() || window.Notification.permission !== "granted") return;

  const notification = new window.Notification(messageInfo.title || "Nuevo mensaje", {
    body: messageInfo.body || "Tienes un mensaje nuevo.",
    tag: messageInfo.tag || "dashboard-message",
    renotify: true,
    silent: false,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
    onNotificationClick?.(messageInfo.chatKey);
  };
}

function useGlobalMessageNotifications(profile, isAdmin, { activeChatKeyRef, isMessagesPageActiveRef, onNotificationClick }) {
  const currentUserId = getCurrentUserId(profile);
  const [permission, setPermission] = useState(() =>
    canUseBrowserNotifications() ? window.Notification.permission : "unsupported"
  );
  const directReadyRef = useRef(false);
  const departmentReadyRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const prepareNotifications = () => primeMessageNotificationSound();

    window.addEventListener("pointerdown", prepareNotifications, { once: true });
    window.addEventListener("keydown", prepareNotifications, { once: true });

    return () => {
      window.removeEventListener("pointerdown", prepareNotifications);
      window.removeEventListener("keydown", prepareNotifications);
    };
  }, []);

  async function requestPermission() {
    if (!canUseBrowserNotifications()) return;

    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
    } catch (error) {
      console.warn("No se pudo pedir permiso de notificaciones:", error);
    }
  }

  function isViewingChatNow(chatKey) {
    return (
      isMessagesPageActiveRef?.current === true &&
      activeChatKeyRef?.current === chatKey &&
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    );
  }

  function alertNewMessages(items) {
    const itemsNeedingAlert = items.filter((item) => !isViewingChatNow(item.chatKey));
    if (itemsNeedingAlert.length === 0) return;

    playMessageNotificationSound({ soundsEnabled: true, tone: "classic", volume: 70, mutedUntil: 0, ...profile?.notificationPreferences });

    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      itemsNeedingAlert.forEach((item) => showBrowserMessageNotification(item, onNotificationClick));
    }
  }

  useEffect(() => {
    directReadyRef.current = false;
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const inboxQuery = query(
      collection(db, "internalMessages"),
      where("toUserId", "==", currentUserId)
    );

    return onSnapshot(
      inboxQuery,
      (snapshot) => {
        const wasReady = directReadyRef.current;
        directReadyRef.current = true;
        if (!wasReady) return;

        const newItems = snapshot
          .docChanges()
          .filter((change) => change.type === "added")
          .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
          .filter((message) => message.read !== true && message.fromUserId !== currentUserId)
          .map((message) => ({
            key: `direct:${message.id}`,
            chatKey: `direct:${message.fromUserId || ""}`,
            title: `Nuevo mensaje de ${message.fromUserName || "un colaborador"}`,
            body: truncateNotificationText(getMessagePreview(message, getAttachmentType), 120),
            tag: `message-direct-${message.id}`,
          }));

        alertNewMessages(newItems);
      },
      (error) => {
        console.error("No se pudo iniciar el listener global de mensajes directos:", error);
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    departmentReadyRef.current = false;
  }, [currentUserId, isAdmin, profile]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onChanges: (messages, isInitialSnapshot) => {
        departmentReadyRef.current = true;
        if (isInitialSnapshot) return;

        const newItems = messages
          .filter((message) => isUnreadDepartmentMessage(message, currentUserId))
          .map((message) => ({
            key: `department:${message.id}`,
            chatKey: `department:${message.departmentId || ""}`,
            title: `Nuevo mensaje en ${message.departmentName || "departamento"}`,
            body: `${message.fromUserName || "Un colaborador"}: ${truncateNotificationText(getMessagePreview(message, getAttachmentType), 100)}`,
            tag: `message-department-${message.id}`,
          }));

        alertNewMessages(newItems);
      },
      onError: (error) => {
        console.error("No se pudo iniciar el listener global de mensajes por departamento:", error);
      },
    });
  }, [currentUserId, isAdmin, profile]);

  return { permission, requestPermission };
}


function MessagesEmptyConversationState() {
  return (
    <div className="workspace-empty-state messages-empty-state chat-empty-thread chat-empty-watermark">
      <div className="chat-empty-watermark-pattern" aria-hidden="true" />
      <strong>Selecciona una conversación</strong>
      <p>El historial del chat aparecerá aquí.</p>
    </div>
  );
}

function InternalMessages({
  profile,
  isAdmin = false,
  onActiveChatKeyChange,
  pendingChatKeyToOpen = "",
  onPendingChatKeyConsumed,
  notificationPermission = "unsupported",
  onRequestNotificationPermission,
}) {
  const currentUserId = getCurrentUserId(profile);
  const [collaborators, setCollaborators] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [presenceByUserId, setPresenceByUserId] = useState({});
  const [presenceNow, setPresenceNow] = useState(Date.now());
  const [inboxMessages, setInboxMessages] = useState([]);
  const [sentMessages, setSentMessages] = useState([]);
  const [departmentMessages, setDepartmentMessages] = useState([]);
  const [conversationType, setConversationType] = useState("direct");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [messageForm, setMessageForm] = useState({
    toUserId: "",
    message: "",
  });
  const [departmentForm, setDepartmentForm] = useState({ message: "" });
  const [messageAttachments, setMessageAttachments] = useState([]);
  const [departmentAttachments, setDepartmentAttachments] = useState([]);
  const [messageStatus, setMessageStatus] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [conversationSearchTerm, setConversationSearchTerm] = useState("");
  const [threadSearchTerm, setThreadSearchTerm] = useState("");
  const [showChatFilesPanel, setShowChatFilesPanel] = useState(false);
  const [mutedChats, setMutedChats] = useState({});
  const [replyTarget, setReplyTarget] = useState(null);
  const [typingStates, setTypingStates] = useState([]);
  const [voiceRecordingType, setVoiceRecordingType] = useState("");
  const [voiceRecordingElapsedMs, setVoiceRecordingElapsedMs] = useState(0);
  const [voiceRecordingPaused, setVoiceRecordingPaused] = useState(false);
  const [voiceRecordingProcessing, setVoiceRecordingProcessing] = useState(false);
  const [voicePauseSupported, setVoicePauseSupported] = useState(false);
  const [voiceWaveLevels, setVoiceWaveLevels] = useState(() =>
    Array.from({ length: 56 }, (_, index) => 0.2 + ((index % 7) * 0.035))
  );
  const threadMessagesRef = useRef(null);
  const threadEndRef = useRef(null);
  const directComposerRef = useRef(null);
  const departmentComposerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStreamRef = useRef(null);
  const voiceStopActionRef = useRef("draft");
  const voiceRecordingStartedAtRef = useRef(0);
  const voiceRecordingAccumulatedMsRef = useRef(0);
  const voiceTimerRef = useRef(null);
  const voiceAudioContextRef = useRef(null);
  const voiceAnalyserRef = useRef(null);
  const voiceAnalyserDataRef = useRef(null);
  const voiceWaveFrameRef = useRef(null);
  const voiceWaveLastUpdateRef = useRef(0);
  const pageTitleRef = useRef(typeof document === "undefined" ? "Mensajes" : document.title);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      query(collection(db, "users"), where("active", "==", true)),
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
      collection(db, "departments"),
      (snapshot) => {
        const nextDepartments = snapshot.docs
          .map((departmentDoc) => ({ id: departmentDoc.id, ...departmentDoc.data() }))
          .filter((department) => department.active !== false && department.deleted !== true)
          .filter((department) => department.name || department.title)
          .sort((a, b) => {
            const orderA = Number(a.order ?? a.position ?? 9999);
            const orderB = Number(b.order ?? b.position ?? 9999);
            if (orderA !== orderB) return orderA - orderB;
            return String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "es");
          });

        setDepartments(nextDepartments);
      },
      (error) => {
        console.error("No se pudieron cargar los departamentos:", error);
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
    if (!currentUserId) return undefined;

    const typingQuery = query(
      collection(db, "messageTypingStates"),
      where("memberIds", "array-contains", currentUserId)
    );

    return onSnapshot(
      typingQuery,
      (snapshot) => {
        const nextStates = snapshot.docs.map((typingDoc) => ({
          id: typingDoc.id,
          ...typingDoc.data(),
        }));

        setTypingStates(nextStates);
      },
      (error) => {
        console.error("No se pudo cargar el estado de escritura:", error);
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
    if (!currentUserId) return undefined;

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onMessages: (messages) => {
        const nextMessages = messages
          .map((message) => ({
            ...message,
            attachments: normalizeStoredAttachments(message.attachments),
            readBy: message.readBy || {},
          }))
          .sort(sortByCreatedAtDesc);

        setDepartmentMessages(nextMessages);
        setMessageError((current) =>
          current === "No se pudieron cargar los chats por departamento." ? "" : current
        );
      },
      onError: (error) => {
        console.error("No se pudieron cargar los mensajes por departamento:", error);
        setDepartmentMessages([]);
        if (error?.code === "permission-denied") return;
        setMessageError("No se pudieron cargar los chats por departamento.");
      },
    });
  }, [currentUserId, isAdmin, profile]);

  useEffect(() => {
    return () => revokeDraftAttachmentPreviews(messageAttachments);
  }, []);

  useEffect(() => {
    return () => revokeDraftAttachmentPreviews(departmentAttachments);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state === "recording") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
    voiceChunksRef.current = [];
    setVoiceRecordingType("");
  }, [selectedConversationId]);

  const departmentOptions = buildDepartmentChatOptions({
    departments,
    collaborators,
    profile,
    currentUserId,
    isAdmin,
  });
  const allMessages = [...inboxMessages, ...sentMessages].sort(sortByCreatedAtDesc);
  const conversations = buildInternalConversations(allMessages, collaborators, currentUserId);
  const visibleDepartmentMessages = filterVisibleDepartmentMessages(departmentMessages, profile, isAdmin);
  const departmentConversations = buildDepartmentConversations(
    visibleDepartmentMessages,
    departmentOptions,
    currentUserId
  );
  const filteredConversations = conversations.filter((conversation) =>
    matchesConversationSearch(conversation, conversationSearchTerm)
  );
  const filteredDepartmentConversations = departmentConversations.filter((conversation) =>
    matchesDepartmentConversationSearch(conversation, conversationSearchTerm)
  );
  const selectedConversation =
    filteredConversations.find((conversation) => conversation.participantId === selectedConversationId) || null;
  const normalizedSelectedDepartmentId = normalizeDepartmentId(selectedDepartmentId) || "";
  const selectedDepartmentOption =
    departmentOptions.find((department) => normalizeDepartmentId(department) === normalizedSelectedDepartmentId) || null;
  const selectedDepartmentIsVisible = Boolean(selectedDepartmentOption);
  const selectedDepartmentConversation =
    departmentConversations.find((conversation) => normalizeDepartmentId(conversation.departmentId) === normalizedSelectedDepartmentId) ||
    (selectedDepartmentOption
      ? {
          departmentId: normalizedSelectedDepartmentId,
          departmentName: selectedDepartmentOption.name,
          normalizedName: selectedDepartmentOption.normalizedName,
          memberCount: selectedDepartmentOption.memberCount || 0,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
        }
      : null);
  const selectedDepartmentName =
    selectedDepartmentOption?.name ||
    selectedDepartmentConversation?.departmentName ||
    selectedDepartmentConversation?.name ||
    "Departamento";
  const selectedDepartmentNormalizedName =
    selectedDepartmentOption?.normalizedName ||
    selectedDepartmentConversation?.normalizedName ||
    normalizeText(selectedDepartmentName);
  const selectedDepartmentTarget = normalizedSelectedDepartmentId && (selectedDepartmentOption || selectedDepartmentConversation)
    ? {
        id: normalizedSelectedDepartmentId,
        departmentId: normalizedSelectedDepartmentId,
        name: selectedDepartmentName,
        departmentName: selectedDepartmentName,
        normalizedName: selectedDepartmentNormalizedName,
      }
    : null;
  const userCanAccessSelectedDepartment = Boolean(
    !normalizedSelectedDepartmentId ||
      isAdmin ||
      userBelongsToDepartmentId(profile, normalizedSelectedDepartmentId) ||
      userBelongsToDepartment(profile, selectedDepartmentNormalizedName)
  );
  const selectedMessages = selectedConversation
    ? selectedConversation.messages
        .slice()
        .sort(sortByCreatedAtAsc)
        .filter((message) => matchesMessageSearch(message, threadSearchTerm))
    : [];
  const selectedDepartmentMessages = selectedDepartmentConversation
    ? selectedDepartmentConversation.messages
        .slice()
        .sort(sortByCreatedAtAsc)
        .filter((message) => matchesDepartmentMessageSearch(message, threadSearchTerm))
    : [];
  const selectedConversationTotalMessages = selectedConversation?.messages.length || 0;
  const selectedDepartmentTotalMessages = selectedDepartmentConversation?.messages.length || 0;
  const unreadCount = inboxMessages.filter((message) => !message.read).length;
  const unreadDepartmentCount = visibleDepartmentMessages.filter((message) => isUnreadDepartmentMessage(message, currentUserId)).length;
  const totalUnreadCount = unreadCount + unreadDepartmentCount;
  const totalMessages = allMessages.length + visibleDepartmentMessages.length;
  const messageProfiles = [{ ...profile, id: currentUserId }, ...collaborators];
  const selectedRecipient = selectedConversation
    ? {
        id: selectedConversation.participantId,
        name: selectedConversation.participantName,
        email: selectedConversation.participantEmail,
      }
    : collaborators.find((user) => user.id === (messageForm.toUserId || selectedConversationId)) || null;
  const selectedPresenceStatus = getPresenceStatus(
    selectedRecipient ? presenceByUserId[selectedRecipient.id] : null,
    presenceNow
  );

  const activeThreadMessages = conversationType === "department"
    ? (selectedDepartmentConversation?.messages || [])
    : (selectedConversation?.messages || []);
  const activeFilteredMessages = conversationType === "department"
    ? selectedDepartmentMessages
    : selectedMessages;
  const activeLastMessage = activeFilteredMessages[activeFilteredMessages.length - 1] || null;
  const activeLastMessageKey = activeLastMessage
    ? `${activeLastMessage.id || ""}:${getMillisFromFirestoreDate(activeLastMessage.createdAt)}:${getMillisFromFirestoreDate(activeLastMessage.updatedAt)}`
    : "";
  const activeChatTitle = conversationType === "department"
    ? selectedDepartmentName
    : selectedRecipient?.name || selectedRecipient?.email || "Conversación";
  const activeChatSubtitle = conversationType === "department"
    ? `${selectedDepartmentConversation?.memberCount || 0} integrante(s) incluidos`
    : selectedRecipient?.email || "Sin correo registrado";
  const activeAllSharedAttachments = activeThreadMessages.flatMap((message) =>
    normalizeStoredAttachments(message.attachments).map((attachment) => ({
      ...attachment,
      messageId: message.id,
      createdAt: message.createdAt,
      fromUserName: message.fromUserName || "Usuario",
    }))
  ).filter((attachment) => !isRecordedVoiceAttachment(attachment));
  const activeSharedAttachments = activeAllSharedAttachments.slice(0, 6);
  const activeChatTypeLabel = conversationType === "department" ? "Chat por departamento" : "Chat individual";
  const activeChatKey =
    conversationType === "department"
      ? `department:${normalizedSelectedDepartmentId}`
      : `direct:${selectedConversation?.participantId || selectedRecipient?.id || ""}`;
  const activeChatMuted = Boolean(mutedChats[activeChatKey]);
  const activeTypingUsers = typingStates.filter((typingState) => {
    if (!typingState?.isTyping || typingState.userId === currentUserId) return false;
    if (typingState.chatKey !== activeChatKey) return false;

    const updatedAt = getMillisFromFirestoreDate(typingState.updatedAt);
    return updatedAt > 0 && Date.now() - updatedAt <= 8000;
  });
  const activeTypingLabel =
    activeTypingUsers.length === 0
      ? ""
      : activeTypingUsers.length === 1
        ? `${activeTypingUsers[0].userName || "Alguien"} está escribiendo...`
        : "Varias personas están escribiendo...";

  const directMessageHasText = Boolean(messageForm.message.trim());
  const directMessageCanSend = directMessageHasText || messageAttachments.length > 0;
  const directComposerRecording = voiceRecordingType === "direct";
  const directComposerUsesVoiceButton = directComposerRecording || !directMessageCanSend;
  const departmentMessageHasText = Boolean(departmentForm.message.trim());
  const departmentMessageCanSend = departmentMessageHasText || departmentAttachments.length > 0;
  const departmentComposerRecording = voiceRecordingType === "department";
  const departmentComposerUsesVoiceButton = departmentComposerRecording || !departmentMessageCanSend;
  const voiceRecordingLabel = formatVoiceRecordingDuration(voiceRecordingElapsedMs);

  useEffect(() => {
    if (!normalizedSelectedDepartmentId || selectedDepartmentIsVisible || isAdmin) return;

    const timeoutId = window.setTimeout(() => {
      setSelectedDepartmentId("");
      setThreadSearchTerm("");
      setShowChatFilesPanel(false);
      setReplyTarget(null);
      setDepartmentForm({ message: "" });
      setDepartmentAttachments([]);
      setMessageError("");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [normalizedSelectedDepartmentId, selectedDepartmentIsVisible, isAdmin]);

  function scrollActiveThreadToBottom(behavior = "smooth") {
    if (typeof window === "undefined") return;

    const scrollNow = () => {
      const thread = threadMessagesRef.current;
      if (thread) {
        thread.scrollTo({
          top: thread.scrollHeight,
          behavior,
        });
      }
      threadEndRef.current?.scrollIntoView({ behavior, block: "end" });
    };

    window.requestAnimationFrame(() => {
      scrollNow();
      window.setTimeout(scrollNow, 90);
      window.setTimeout(scrollNow, 240);
    });
  }

  useEffect(() => {
    if (conversationType !== "direct" || !selectedConversation) return;
    setMessageForm((current) => ({
      ...current,
      toUserId: selectedConversation.participantId,
    }));
    markConversationMessagesAsRead(selectedConversation.messages);
  }, [conversationType, selectedConversation?.participantId, selectedConversation?.unreadCount]);

  useEffect(() => {
    if (conversationType !== "department" || !selectedDepartmentConversation) return;
    markDepartmentConversationMessagesAsRead(selectedDepartmentConversation.messages);
  }, [conversationType, selectedDepartmentConversation?.departmentId, selectedDepartmentConversation?.unreadCount]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      clearVoiceTimer();
      if (voiceWaveFrameRef.current) {
        window.cancelAnimationFrame(voiceWaveFrameRef.current);
        voiceWaveFrameRef.current = null;
      }
      if (voiceAudioContextRef.current) {
        voiceAudioContextRef.current.close().catch(() => {});
        voiceAudioContextRef.current = null;
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      writeTypingState(false);
    };
  }, [activeChatKey]);

  useLayoutEffect(() => {
    scrollActiveThreadToBottom("auto");
  }, [activeChatKey, activeLastMessageKey, activeFilteredMessages.length]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const baseTitle = pageTitleRef.current.replace(/^\(\d+\)\s+Mensajes -\s+/, "");

    if (totalUnreadCount > 0) {
      document.title = `(${totalUnreadCount}) Mensajes - ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }

    return () => {
      document.title = baseTitle;
    };
  }, [totalUnreadCount]);

  useEffect(() => {
    onActiveChatKeyChange?.(activeChatKey);
  }, [activeChatKey, onActiveChatKeyChange]);

  useEffect(() => {
    return () => onActiveChatKeyChange?.("");
  }, [onActiveChatKeyChange]);

  useEffect(() => {
    if (!pendingChatKeyToOpen) return;

    if (pendingChatKeyToOpen.startsWith("direct:")) {
      setConversationType("direct");
      setSelectedConversationId(pendingChatKeyToOpen.slice("direct:".length));
    } else if (pendingChatKeyToOpen.startsWith("department:")) {
      setConversationType("department");
      setSelectedDepartmentId(normalizeDepartmentId(pendingChatKeyToOpen.slice("department:".length)) || "");
    }

    onPendingChatKeyConsumed?.();
  }, [pendingChatKeyToOpen, onPendingChatKeyConsumed]);

  function resetMessageComposer() {
    revokeDraftAttachmentPreviews(messageAttachments);
    setMessageForm((current) => ({
      ...current,
      message: "",
    }));
    setMessageAttachments([]);
    setReplyTarget(null);
  }

  function resetDepartmentComposer() {
    revokeDraftAttachmentPreviews(departmentAttachments);
    setDepartmentForm({ message: "" });
    setDepartmentAttachments([]);
    setReplyTarget(null);
  }

  async function writeTypingState(isTyping) {
    if (!currentUserId || !activeChatKey) return;

    const isDepartmentChat = conversationType === "department";
    const targetId = isDepartmentChat
      ? normalizedSelectedDepartmentId
      : selectedRecipient?.id;

    if (!targetId) return;

    const memberIds = isDepartmentChat
      ? getDepartmentMemberIds(selectedDepartmentTarget, collaborators, profile, currentUserId)
      : [currentUserId, targetId].filter(Boolean);

    try {
      await setDoc(
        doc(db, "messageTypingStates", buildMessageTypingStateId(activeChatKey, currentUserId)),
        {
          chatKey: activeChatKey,
          chatType: conversationType,
          targetId,
          userId: currentUserId,
          userName: profile?.name || profile?.email || "Usuario",
          memberIds,
          isTyping,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.warn("No se pudo actualizar estado escribiendo:", error);
    }
  }

  function scheduleTypingState(isTyping) {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    writeTypingState(isTyping);

    if (isTyping) {
      typingTimeoutRef.current = window.setTimeout(() => {
        writeTypingState(false);
      }, 1800);
    }
  }

  function handleReplyToMessage(message, type = conversationType) {
    setReplyTarget({
      type,
      messageId: message.id,
      fromUserId: message.fromUserId || "",
      fromUserName: message.fromUserId === currentUserId ? "Tú" : message.fromUserName || "Usuario",
      message: message.message || "Archivo adjunto",
      createdAt: message.createdAt || null,
    });
  }

  function handleComposerKeyDown(event, formRef) {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    formRef.current?.requestSubmit();
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

  function handleComposerPaste(event, type) {
    const files = getPastedImageFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    const validation = validateBoardFiles(
      files,
      type === "department" ? departmentAttachments.length : messageAttachments.length
    );
    if (!validation.valid) {
      setMessageError(validation.message);
      return;
    }
    const drafts = files.map(createDraftAttachment);
    if (type === "department") setDepartmentAttachments((current) => [...current, ...drafts].slice(0, 6));
    else setMessageAttachments((current) => [...current, ...drafts].slice(0, 6));
    setMessageError("");
  }

  function handleDepartmentFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateBoardFiles(files, departmentAttachments.length);
    if (!validation.valid) {
      setMessageError(validation.message);
      return;
    }

    setDepartmentAttachments((current) => [
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

  function handleRemoveDepartmentAttachment(attachmentId) {
    setDepartmentAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function stopVoiceWave() {
    if (voiceWaveFrameRef.current) {
      window.cancelAnimationFrame(voiceWaveFrameRef.current);
      voiceWaveFrameRef.current = null;
    }

    if (voiceAudioContextRef.current) {
      voiceAudioContextRef.current.close().catch(() => {});
      voiceAudioContextRef.current = null;
    }

    voiceAnalyserRef.current = null;
    voiceAnalyserDataRef.current = null;
    voiceWaveLastUpdateRef.current = 0;
    setVoiceWaveLevels(Array.from({ length: 100 }, (_, index) => 0.16 + ((index % 6) * 0.025)));
  }

  function startVoiceWave(stream) {
    stopVoiceWave();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !stream) return;

    try {
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      voiceAudioContextRef.current = audioContext;
      voiceAnalyserRef.current = analyser;
      voiceAnalyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const draw = (timestamp) => {
        if (!voiceAnalyserRef.current || !voiceAnalyserDataRef.current) return;
        voiceAnalyserRef.current.getByteFrequencyData(voiceAnalyserDataRef.current);

        if (timestamp - voiceWaveLastUpdateRef.current > 100) {
          const data = voiceAnalyserDataRef.current;
          const step = Math.max(1, Math.floor(data.length / 100));
          const levels = Array.from({ length: 100 }, (_, index) => {
            const slice = data.slice(index * step, (index + 1) * step);
            const average = slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
            return Math.min(1, Math.max(0.16, average / 150));
          });

          setVoiceWaveLevels(levels);
          voiceWaveLastUpdateRef.current = timestamp;
        }

        voiceWaveFrameRef.current = window.requestAnimationFrame(draw);
      };

      voiceWaveFrameRef.current = window.requestAnimationFrame(draw);
    } catch (error) {
      console.warn("No se pudo iniciar el analizador de audio:", error);
    }
  }

  function startVoiceTimer() {
    clearVoiceTimer();
    voiceRecordingStartedAtRef.current = Date.now();
    voiceTimerRef.current = window.setInterval(() => {
      setVoiceRecordingElapsedMs(
        voiceRecordingAccumulatedMsRef.current + Date.now() - voiceRecordingStartedAtRef.current
      );
    }, 250);
  }

  function resetVoiceRecorderState() {
    clearVoiceTimer();
    stopVoiceWave();
    voiceRecordingStartedAtRef.current = 0;
    voiceRecordingAccumulatedMsRef.current = 0;
    voiceStopActionRef.current = "draft";
    voiceChunksRef.current = [];
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
    setVoiceRecordingType("");
    setVoiceRecordingElapsedMs(0);
    setVoiceRecordingPaused(false);
    setVoiceRecordingProcessing(false);
    setVoicePauseSupported(false);
  }

  function createVoiceDraftFile(mimeType = "") {
    const extension = getAudioFileExtension(mimeType);
    const blob = new Blob(voiceChunksRef.current, { type: mimeType || "audio/webm" });
    if (!blob.size) return null;

    const file = new File([blob], `audio-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, {
      type: mimeType || "audio/webm",
    });

    return createDraftAttachment(file, { source: "recordedVoice" });
  }

  function handleToggleVoicePause() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || voiceRecordingProcessing) return;

    if (recorder.state === "recording") {
      if (typeof recorder.pause !== "function") {
        setMessageError("Este navegador no permite pausar la grabaciÃ³n.");
        return;
      }

      recorder.pause();
      voiceRecordingAccumulatedMsRef.current += Date.now() - voiceRecordingStartedAtRef.current;
      setVoiceRecordingElapsedMs(voiceRecordingAccumulatedMsRef.current);
      clearVoiceTimer();
      stopVoiceWave();
      setVoiceRecordingPaused(true);
      return;
    }

    if (recorder.state === "paused" && typeof recorder.resume === "function") {
      recorder.resume();
      setVoiceRecordingPaused(false);
      startVoiceTimer();
      startVoiceWave(voiceStreamRef.current);
    }
  }

  function finishVoiceRecording(action = "draft") {
    if (voiceRecordingProcessing) return;

    const recorder = mediaRecorderRef.current;
    voiceStopActionRef.current = action;
    if (action === "send") {
      setVoiceRecordingProcessing(true);
    }

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    resetVoiceRecorderState();
  }

  async function sendVoiceRecording(type, draftAttachment) {
    if (!draftAttachment) {
      setMessageError("No se pudo preparar el audio.");
      return;
    }

    setMessageSaving(true);
    setMessageError("");
    setMessageStatus("");

    try {
      if (type === "department") {
        const department = selectedDepartmentTarget;
        if (!normalizedSelectedDepartmentId) {
          setMessageError("Selecciona un departamento.");
          return;
        }
        if (!department) {
          setMessageError("Cargando conversación.");
          return;
        }
        if (!userCanAccessSelectedDepartment) {
          setMessageError("No tienes acceso a este departamento.");
          return;
        }

        const memberIds = getDepartmentMemberIds(department, collaborators, profile, currentUserId);
        if (!memberIds.includes(currentUserId)) {
          memberIds.push(currentUserId);
        }

        const messageId = doc(collection(db, "departmentMessages")).id;
        const attachments = await uploadBoardAttachments([draftAttachment], {
          folder: `dashboard/departmentMessages/${normalizedSelectedDepartmentId}/${currentUserId}/${messageId}`,
          ownerUid: currentUserId,
        });

        await setDoc(doc(db, "departmentMessages", messageId), {
          departmentId: normalizedSelectedDepartmentId,
          departmentName: department.name || department.departmentName || "Departamento",
          fromUserId: currentUserId,
          fromUserName: profile?.name || "Usuario",
          fromUserEmail: profile?.email || "",
          message: "Mensaje de audio",
          attachments,
          replyToMessageId: replyTarget?.type === "department" ? replyTarget.messageId : "",
          replyToFromUserId: replyTarget?.type === "department" ? replyTarget.fromUserId : "",
          replyToFromUserName: replyTarget?.type === "department" ? replyTarget.fromUserName : "",
          replyToMessage: replyTarget?.type === "department" ? replyTarget.message.slice(0, 240) : "",
          memberIds,
          readBy: {
            [currentUserId]: serverTimestamp(),
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setSelectedDepartmentId(normalizedSelectedDepartmentId);
        writeTypingState(false);
        resetDepartmentComposer();
      } else {
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

        if (!recipient?.id) {
          setMessageError("Selecciona una conversaciÃ³n o un colaborador.");
          return;
        }

        const messageId = doc(collection(db, "internalMessages")).id;
        const attachments = await uploadBoardAttachments([draftAttachment], {
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
          subject: `ConversaciÃ³n con ${recipientName}`.slice(0, 120),
          message: "Mensaje de audio",
          attachments,
          replyToMessageId: replyTarget?.type === "direct" ? replyTarget.messageId : "",
          replyToFromUserId: replyTarget?.type === "direct" ? replyTarget.fromUserId : "",
          replyToFromUserName: replyTarget?.type === "direct" ? replyTarget.fromUserName : "",
          replyToMessage: replyTarget?.type === "direct" ? replyTarget.message.slice(0, 240) : "",
          read: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setSelectedConversationId(recipient.id);
        writeTypingState(false);
        resetMessageComposer();
      }

      scrollActiveThreadToBottom("smooth");
    } catch (error) {
      console.error("No se pudo enviar el audio:", error);
      setMessageError("No se pudo enviar el audio.");
    } finally {
      setMessageSaving(false);
    }
  }

  async function handleStartVoiceRecording(type) {
    if (voiceRecordingType) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessageError("Este navegador no permite grabar audio desde aquí.");
      return;
    }

    if (!window.isSecureContext) {
      setMessageError("Grabar audio requiere una conexión segura (HTTPS).");
      return;
    }

    const currentCount = type === "department" ? departmentAttachments.length : messageAttachments.length;
    if (currentCount >= 6) {
      setMessageError("Solo puedes adjuntar hasta 6 archivos por mensaje.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = pickSupportedAudioMimeType();
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      voiceChunksRef.current = [];
      voiceStopActionRef.current = "draft";
      voiceStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setVoiceRecordingElapsedMs(0);
      setVoiceRecordingPaused(false);
      setVoiceRecordingProcessing(false);
      setVoicePauseSupported(typeof recorder.pause === "function" && typeof recorder.resume === "function");

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        clearVoiceTimer();
        const action = voiceStopActionRef.current;

        if (action === "cancel") {
          resetVoiceRecorderState();
          return;
        }

        const draft = createVoiceDraftFile(recorder.mimeType || preferredMimeType || "audio/webm");

        if (action === "send") {
          await sendVoiceRecording(type, draft);
          resetVoiceRecorderState();
          return;
        }

        if (draft) {
          if (type === "department") {
            setDepartmentAttachments((current) => [...current, draft].slice(0, 6));
          } else {
            setMessageAttachments((current) => [...current, draft].slice(0, 6));
          }
        }

        resetVoiceRecorderState();
      };

      recorder.start();
      setVoiceRecordingType(type);
      startVoiceTimer();
      startVoiceWave(stream);
      setMessageError("");
    } catch (error) {
      console.error("No se pudo iniciar la grabación de audio:", error);
      setMessageError(getVoiceRecordingErrorMessage(error));
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      setVoiceRecordingType("");
    }
  }

  function handleStopVoiceRecording() {
    finishVoiceRecording("draft");
  }

  function handleStartConversation(userId) {
    if (!userId) return;
    setConversationType("direct");
    setSelectedConversationId(userId);
    setMessageForm({ toUserId: userId, message: "" });
    setConversationSearchTerm("");
    setThreadSearchTerm("");
    setShowChatFilesPanel(false);
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
        replyToMessageId: replyTarget?.type === "direct" ? replyTarget.messageId : "",
        replyToFromUserId: replyTarget?.type === "direct" ? replyTarget.fromUserId : "",
        replyToFromUserName: replyTarget?.type === "direct" ? replyTarget.fromUserName : "",
        replyToMessage: replyTarget?.type === "direct" ? replyTarget.message.slice(0, 240) : "",
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedConversationId(recipient.id);
      writeTypingState(false);
      resetMessageComposer();
      scrollActiveThreadToBottom("smooth");
    } catch (error) {
      console.error("No se pudo enviar el mensaje:", error);
      setMessageError("No se pudo enviar el mensaje.");
    } finally {
      setMessageSaving(false);
    }
  }

  async function handleDepartmentMessageSubmit(event) {
    event.preventDefault();
    setMessageStatus("");
    setMessageError("");

    const department = selectedDepartmentTarget;
    const departmentId = normalizedSelectedDepartmentId;
    const cleanMessage = departmentForm.message.trim();

    if (!departmentId) {
      setMessageError("Selecciona un departamento.");
      return;
    }
    if (!department) {
      setMessageError("Cargando conversación.");
      return;
    }
    if (!userCanAccessSelectedDepartment) {
      setMessageError("No tienes acceso a este departamento.");
      return;
    }

    if (!cleanMessage && departmentAttachments.length === 0) {
      setMessageError("Escribe un mensaje o adjunta un archivo.");
      return;
    }

    const memberIds = getDepartmentMemberIds(department, collaborators, profile, currentUserId);
    if (!memberIds.includes(currentUserId)) {
      memberIds.push(currentUserId);
    }

    setMessageSaving(true);

    try {
      const messageId = doc(collection(db, "departmentMessages")).id;
      const attachments = await uploadBoardAttachments(departmentAttachments, {
        folder: `dashboard/departmentMessages/${departmentId}/${currentUserId}/${messageId}`,
        ownerUid: currentUserId,
      });

      await setDoc(doc(db, "departmentMessages", messageId), {
        departmentId,
        departmentName: department.departmentName || department.name || "Departamento",
        fromUserId: currentUserId,
        fromUserName: profile?.name || "Usuario",
        fromUserEmail: profile?.email || "",
        message: cleanMessage || "Archivo adjunto",
        attachments,
        replyToMessageId: replyTarget?.type === "department" ? replyTarget.messageId : "",
        replyToFromUserId: replyTarget?.type === "department" ? replyTarget.fromUserId : "",
        replyToFromUserName: replyTarget?.type === "department" ? replyTarget.fromUserName : "",
        replyToMessage: replyTarget?.type === "department" ? replyTarget.message.slice(0, 240) : "",
        memberIds,
        readBy: {
          [currentUserId]: serverTimestamp(),
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedDepartmentId(departmentId);
      writeTypingState(false);
      resetDepartmentComposer();
      scrollActiveThreadToBottom("smooth");
    } catch (error) {
      console.error("No se pudo enviar el mensaje por departamento:", error);
      setMessageError("No se pudo enviar el mensaje al departamento.");
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

  async function markDepartmentMessageAsRead(message) {
    if (!message?.id || !isUnreadDepartmentMessage(message, currentUserId)) return;

    try {
      await updateDoc(doc(db, "departmentMessages", message.id), {
        [`readBy.${currentUserId}`]: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("No se pudo marcar el mensaje de departamento como leído:", error);
      setMessageError("No se pudo marcar el mensaje del departamento como leído.");
    }
  }

  async function handleDeleteMessage(message, type) {
    if (!isAdmin || !message?.id) return;

    const confirmed = window.confirm(
      "¿Eliminar este mensaje para todos? Esta acción no se puede deshacer."
    );
    if (!confirmed) return;

    setMessageStatus("");
    setMessageError("");

    try {
      const collectionName = type === "department" ? "departmentMessages" : "internalMessages";
      await deleteDoc(doc(db, collectionName, message.id));
      if (replyTarget?.messageId === message.id) {
        setReplyTarget(null);
      }
      setMessageStatus("Mensaje eliminado para todos.");
    } catch (error) {
      console.error("No se pudo eliminar el mensaje:", error);
      setMessageError("No se pudo eliminar el mensaje.");
    }
  }

  function markConversationMessagesAsRead(messages) {
    (messages || [])
      .filter((message) => message.toUserId === currentUserId && !message.read)
      .forEach((message) => markMessageAsRead(message));
  }

  function markDepartmentConversationMessagesAsRead(messages) {
    (messages || [])
      .filter((message) => isUnreadDepartmentMessage(message, currentUserId))
      .forEach((message) => markDepartmentMessageAsRead(message));
  }

  function handleSelectConversation(conversation) {
    setConversationType("direct");
    setSelectedConversationId(conversation.participantId);
    setMessageForm({ toUserId: conversation.participantId, message: "" });
    setThreadSearchTerm("");
    setShowChatFilesPanel(false);
    setMessageStatus("");
    setMessageError("");
    setReplyTarget(null);
    writeTypingState(false);
    markConversationMessagesAsRead(conversation.messages);
  }

  function handleSelectDepartmentConversation(conversation) {
    const departmentId = normalizeDepartmentId(conversation?.departmentId || conversation) || "";
    setConversationType("department");
    setSelectedDepartmentId(departmentId);
    setThreadSearchTerm("");
    setShowChatFilesPanel(false);
    setMessageStatus("");
    setMessageError("");
    setReplyTarget(null);
    writeTypingState(false);
    markDepartmentConversationMessagesAsRead(conversation.messages);
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || !selectedConversationId && !selectedDepartmentId) return;
      if (showChatFilesPanel || replyTarget || voiceRecordingType) return;
      setSelectedConversationId("");
      setSelectedDepartmentId("");
      setMessageForm((current) => ({ ...current, toUserId: "" }));
      setShowChatFilesPanel(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedConversationId, selectedDepartmentId, showChatFilesPanel, replyTarget, voiceRecordingType]);

  return (
    <div className="internal-messages-page chat-messages-page department-chat-page">
      <section className="module-topbar module-topbar-messages messages-module-topbar">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <DashboardNavIcon name="messages" />
          </span>

          <div className="module-topbar-copy">
            <p className="section-kicker module-topbar-kicker">Comunicación interna</p>
            <div className="messages-title-row module-topbar-title-row">
              <h1>Mensajes</h1>
              {totalUnreadCount > 0 && (
                <span className="messages-title-unread-badge">
                  {totalUnreadCount} sin leer
                </span>
              )}
            </div>
            <p>
              Conversa con colaboradores y departamentos en un espacio claro, ordenado y con historial.
            </p>
          </div>
        </div>

        <div className="messages-summary-grid chat-summary-grid department-chat-summary-grid module-header-summary-grid module-topbar-summary-grid">
          <div className="messages-summary-card unread">
            <span>✉️</span>
            <strong>{totalUnreadCount}</strong>
            <small>No leídos</small>
          </div>
          <div className="messages-summary-card inbox">
            <span>💬</span>
            <strong>{conversations.length}</strong>
            <small>Individuales</small>
          </div>
          <div className="messages-summary-card group">
            <span>👥</span>
            <strong>{departmentConversations.length}</strong>
            <small>Departamentos</small>
          </div>
          <div className="messages-summary-card sent">
            <span>📨</span>
            <strong>{totalMessages}</strong>
            <small>Mensajes</small>
          </div>
        </div>
      </section>

      {notificationPermission === "default" && (
        <div className="workspace-success-box messages-notification-permission-box">
          <span>Activa las notificaciones del navegador para no perderte mensajes nuevos cuando la pestaña esté en segundo plano.</span>
          <button type="button" onClick={onRequestNotificationPermission}>
            Activar notificaciones
          </button>
        </div>
      )}
      {notificationPermission === "denied" && (
        <div className="workspace-error-box messages-notification-permission-box">
          Las notificaciones están bloqueadas por el navegador. Actívalas desde la configuración del sitio para recibir avisos de mensajes nuevos.
        </div>
      )}

      {messageError && <div className="workspace-error-box">{messageError}</div>}
      {messageStatus && <div className="workspace-success-box">{messageStatus}</div>}

      <div className="chat-layout workspace-card department-chat-layout">
        <aside className="chat-sidebar-panel">
          <div className="chat-sidebar-header">
            <div>
              <span>Historial</span>
              <h3>{conversationType === "department" ? "Departamentos" : "Conversaciones"}</h3>
            </div>
            {conversationType === "direct" && (
              <button type="button" onClick={() => setNewConversationOpen((current) => !current)}>
                {newConversationOpen ? "Cerrar" : "+ Nuevo chat"}
              </button>
            )}
          </div>

          <div className="chat-mode-tabs" role="tablist" aria-label="Tipo de conversación">
            <button
              type="button"
              className={conversationType === "direct" ? "active" : ""}
              onClick={() => {
                setConversationType("direct");
                setThreadSearchTerm("");
                setShowChatFilesPanel(false);
                setMessageError("");
                setMessageStatus("");
              }}
            >
              Individuales
              {unreadCount > 0 && <span>{unreadCount}</span>}
            </button>
            <button
              type="button"
              className={conversationType === "department" ? "active" : ""}
              onClick={() => {
                setConversationType("department");
                setNewConversationOpen(false);
                setThreadSearchTerm("");
                setShowChatFilesPanel(false);
                setMessageError("");
                setMessageStatus("");
              }}
            >
              Departamentos
              {unreadDepartmentCount > 0 && <span>{unreadDepartmentCount}</span>}
            </button>
          </div>

          {conversationType === "direct" && newConversationOpen && (
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
                className="chat-start-button"
                onClick={() => handleStartConversation(messageForm.toUserId)}
                disabled={!messageForm.toUserId}
              >
                Iniciar chat
              </button>
            </div>
          )}

          <div className="chat-search-box">
            <label>
              <span>{conversationType === "department" ? "Buscar departamentos" : "Buscar conversaciones"}</span>
              <input
                value={conversationSearchTerm}
                onChange={(event) => setConversationSearchTerm(event.target.value)}
                placeholder={conversationType === "department" ? "Departamento, mensaje o adjunto..." : "Nombre, correo, mensaje o adjunto..."}
              />
            </label>
            <small>
              {conversationType === "department"
                ? `${filteredDepartmentConversations.length} de ${departmentConversations.length} departamento(s)`
                : `${filteredConversations.length} de ${conversations.length} conversación(es)`}
            </small>
          </div>

          {conversationType === "direct" ? (
            <div className="chat-conversation-list">
              {conversations.length === 0 ? (
                <div className="workspace-empty-state messages-empty-state compact">
                  <strong>No hay conversaciones</strong>
                  <p>Inicia una conversación con algún colaborador.</p>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="workspace-empty-state messages-empty-state compact">
                  <strong>No hay coincidencias</strong>
                  <p>Prueba con otro nombre, mensaje o archivo.</p>
                </div>
              ) : (
                filteredConversations.map((conversation) => {
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
                      <div className={`chat-conversation-avatar presence-avatar ${presenceStatus.state || (presenceStatus.online ? "online" : "unavailable")}`}>
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
                          {getMessagePreview(conversation.lastMessage, getAttachmentType)}
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
          ) : (
            <div className="chat-conversation-list department-conversation-list">
              {departmentConversations.length === 0 ? (
                <div className="workspace-empty-state messages-empty-state compact">
                  <strong>No hay chats por departamento</strong>
                  <p>Cuando tengas un departamento asignado, aparecerá aquí.</p>
                </div>
              ) : filteredDepartmentConversations.length === 0 ? (
                <div className="workspace-empty-state messages-empty-state compact">
                  <strong>No hay coincidencias</strong>
                  <p>Prueba con otro departamento, mensaje o archivo.</p>
                </div>
              ) : (
                filteredDepartmentConversations.map((conversation) => (
                  <button
                    key={conversation.departmentId}
                    type="button"
                    className={`chat-conversation-item department-chat-item ${normalizedSelectedDepartmentId === normalizeDepartmentId(conversation.departmentId) ? "active" : ""} ${conversation.unreadCount > 0 ? "unread" : ""}`}
                    onClick={() => handleSelectDepartmentConversation(conversation)}
                  >
                    <div className="chat-conversation-avatar department-chat-avatar">
                      {getInitials(conversation.departmentName)}
                    </div>
                    <div className="chat-conversation-main">
                      <div className="chat-conversation-topline">
                        <strong>{conversation.departmentName}</strong>
                        <small>{formatDateTime(conversation.lastMessage?.createdAt)}</small>
                      </div>
                      <span className="department-chat-label">Chat grupal</span>
                      <p>
                        {conversation.lastMessage
                          ? `${conversation.lastMessage.fromUserId === currentUserId ? "Tú" : conversation.lastMessage.fromUserName || "Usuario"}: ${getMessagePreview(conversation.lastMessage, getAttachmentType)}`
                          : "Todavía no hay mensajes en este departamento."}
                      </p>
                      <div className="chat-conversation-meta">
                        <span>{conversation.messages.length} mensaje(s)</span>
                        {conversation.memberCount > 0 && <span>{conversation.memberCount} integrante(s)</span>}
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
                ))
              )}
            </div>
          )}
        </aside>

        <section className="chat-thread-panel">
          {conversationType === "direct" ? (
            !selectedRecipient ? (
              <MessagesEmptyConversationState />
            ) : (
              <>
                <div className="chat-thread-header">
                  <div className={`chat-thread-avatar presence-avatar ${selectedPresenceStatus.state || (selectedPresenceStatus.online ? "online" : "unavailable")}`}>{getInitials(selectedRecipient.name)}</div>
                  <div>
                    <span>Conversación con</span>
                    <h3>{selectedRecipient.name || selectedRecipient.email || "Usuario"}</h3>
                    <small>{selectedRecipient.email || "Sin correo registrado"}</small>
                    <PresenceBadge status={selectedPresenceStatus} />
                  </div>
                </div>

                <div className="chat-thread-search-box">
                  <label>
                    <span>Buscar en esta conversación</span>
                    <input
                      value={threadSearchTerm}
                      onChange={(event) => setThreadSearchTerm(event.target.value)}
                      placeholder="Buscar mensaje, remitente o archivo..."
                    />
                  </label>
                  <small>
                    Mostrando {selectedMessages.length} de {selectedConversationTotalMessages} mensaje(s)
                  </small>
                </div>

                <div className="chat-thread-messages" ref={threadMessagesRef}>
                  {selectedConversationTotalMessages === 0 ? (
                    <div className="chat-date-separator">Todavía no hay mensajes en esta conversación.</div>
                  ) : selectedMessages.length === 0 ? (
                    <div className="chat-date-separator">No hay mensajes que coincidan con tu búsqueda.</div>
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
                            {message.replyToMessageId && (
                              <div className="chat-reply-reference">
                                <span>{message.replyToFromUserName || "Mensaje citado"}</span>
                                <p><MessageText text={message.replyToMessage || "Mensaje citado"} /></p>
                              </div>
                            )}
                            {message.message && !isAudioOnlyMessage(message) && (
                              <p><MessageText text={message.message} /></p>
                            )}
                            <AttachmentGallery attachments={message.attachments} compact />
                            <div className="chat-bubble-status">
                              {outgoing ? (message.read ? "Leído" : "Enviado") : "Recibido"}
                              <button
                                type="button"
                                className="chat-reply-button"
                                onClick={() => handleReplyToMessage(message, "direct")}
                              >
                                Responder
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="chat-reply-button"
                                  onClick={() => handleDeleteMessage(message, "direct")}
                                >
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                  <div ref={threadEndRef} aria-hidden="true" />
                </div>

                {activeTypingLabel && <div className="chat-typing-indicator">{activeTypingLabel}</div>}

                <form className="chat-composer" onSubmit={handleMessageSubmit} ref={directComposerRef}>
                  {replyTarget?.type === "direct" && (
                    <div className="chat-reply-preview">
                      <div>
                        <span>Respondiendo a {replyTarget.fromUserName}</span>
                        <p>{replyTarget.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTarget(null)}
                        aria-label="Cancelar respuesta"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {directComposerRecording ? (
                    <div className="chat-voice-recorder-bar" role="status" aria-live="polite">
                      <button
                        type="button"
                        className="voice-recorder-action danger"
                        onClick={() => finishVoiceRecording("cancel")}
                        disabled={voiceRecordingProcessing}
                        aria-label="Cancelar audio"
                        title="Cancelar audio"
                      >
                        🗑
                      </button>
                      <div className="voice-recorder-status">
                        <span className={`voice-recorder-dot ${voiceRecordingPaused ? "paused" : ""}`} />
                        <strong>{voiceRecordingPaused ? "Pausado" : "Grabando"}</strong>
                        <small>{voiceRecordingLabel}</small>
                        <div className={`voice-recorder-wave ${voiceRecordingPaused ? "paused" : ""}`} aria-hidden="true">
                          {voiceWaveLevels.map((level, index) => (
                            <span key={index} style={{ "--wave-level": level, "--wave-index": index }} />
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="voice-recorder-action"
                        onClick={handleToggleVoicePause}
                        disabled={voiceRecordingProcessing || !voicePauseSupported}
                        aria-label={voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion"}
                        title={voicePauseSupported ? (voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion") : "Pausa no disponible"}
                      >
                        {voiceRecordingPaused ? "🎙" : "⏸"}
                      </button>
                      <button
                        type="button"
                        className="voice-recorder-action send"
                        onClick={() => finishVoiceRecording("send")}
                        disabled={voiceRecordingProcessing}
                        aria-label="Enviar audio"
                        title="Enviar audio"
                      >
                        {voiceRecordingProcessing ? "…" : "➤"}
                      </button>
                    </div>
                  ) : (
                    <>
                  <textarea
                    spellCheck={true}
                    lang="es-MX"
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    onPaste={(event) => handleComposerPaste(event, "direct")}
                    value={messageForm.message}
                    onChange={(event) => {
                      const nextMessage = event.target.value;
                      setMessageForm((current) => ({
                        ...current,
                        toUserId: selectedRecipient.id,
                        message: nextMessage,
                      }));
                      scheduleTypingState(Boolean(nextMessage.trim()));
                    }}
                    onKeyDown={(event) => handleComposerKeyDown(event, directComposerRef)}
                    placeholder={`Escribe un mensaje para ${selectedRecipient.name || "este colaborador"}...`}
                    maxLength={1200}
                  />

                  <div className="chat-composer-tools">
                    <AttachmentPicker
                      title="Adjuntos"
                      helper="Imagen, documento, audio o video. Máximo 6 archivos."
                      onChange={handleMessageFileSelection}
                    />

                    <button
                      type={directComposerUsesVoiceButton ? "button" : "submit"}
                      className={`workspace-primary-button chat-send-icon-button ${directComposerUsesVoiceButton ? "voice-mode" : ""} ${directComposerRecording ? "recording" : ""}`}
                      onClick={
                        directComposerUsesVoiceButton
                          ? () => (directComposerRecording ? handleStopVoiceRecording() : handleStartVoiceRecording("direct"))
                          : undefined
                      }
                      disabled={messageSaving || Boolean(voiceRecordingType && voiceRecordingType !== "direct")}
                      aria-label={
                        messageSaving
                          ? "Enviando mensaje"
                          : directComposerUsesVoiceButton
                            ? directComposerRecording
                              ? "Detener audio"
                              : "Grabar audio"
                            : "Enviar mensaje"
                      }
                      title={
                        messageSaving
                          ? "Enviando..."
                          : directComposerUsesVoiceButton
                            ? directComposerRecording
                              ? "Detener audio"
                              : "Grabar audio"
                            : "Enviar"
                      }
                    >
                      {messageSaving ? "…" : directComposerUsesVoiceButton ? (directComposerRecording ? "■" : "🎙") : "➤"}
                    </button>
                  </div>

                  <AttachmentDraftList
                    items={messageAttachments}
                    onRemove={handleRemoveMessageAttachment}
                  />
                    </>
                  )}
                </form>
              </>
            )
          ) : normalizedSelectedDepartmentId && !selectedDepartmentConversation ? (
            <div className="workspace-empty-state messages-empty-state chat-empty-thread chat-empty-watermark">
              <div className="chat-empty-watermark-pattern" aria-hidden="true" />
              <strong>Cargando conversación</strong>
              <p>Estamos preparando el chat del departamento.</p>
            </div>
          ) : !selectedDepartmentConversation ? (
            <MessagesEmptyConversationState />
          ) : (
            <>
              <div className="chat-thread-header department-thread-header">
                <div className="chat-thread-avatar department-chat-avatar">{getInitials(selectedDepartmentName)}</div>
                <div>
                  <span>Chat por departamento</span>
                  <h3>{selectedDepartmentName}</h3>
                  <small>{selectedDepartmentConversation.memberCount || 0} integrante(s) incluidos en esta conversación.</small>
                  <span className="department-chat-label">Visible para miembros del departamento y administradores</span>
                </div>
              </div>

              <div className="chat-thread-search-box">
                <label>
                  <span>Buscar en este departamento</span>
                  <input
                    value={threadSearchTerm}
                    onChange={(event) => setThreadSearchTerm(event.target.value)}
                    placeholder="Buscar mensaje, remitente o archivo..."
                  />
                </label>
                <small>
                  Mostrando {selectedDepartmentMessages.length} de {selectedDepartmentTotalMessages} mensaje(s)
                </small>
              </div>

              <div className="chat-thread-messages" ref={threadMessagesRef}>
                {selectedDepartmentTotalMessages === 0 ? (
                  <div className="chat-date-separator">Todavía no hay mensajes en este departamento.</div>
                ) : selectedDepartmentMessages.length === 0 ? (
                  <div className="chat-date-separator">No hay mensajes que coincidan con tu búsqueda.</div>
                ) : (
                  selectedDepartmentMessages.map((message) => {
                    const outgoing = message.fromUserId === currentUserId;
                    return (
                      <article key={message.id} className={`chat-bubble-row ${outgoing ? "outgoing" : "incoming"}`}>
                        {!outgoing && (
                          <div className="chat-message-avatar">{getInitials(message.fromUserName)}</div>
                        )}
                        <div className="chat-bubble department-chat-bubble">
                          <div className="chat-bubble-topline">
                            <strong>{outgoing ? "Tú" : message.fromUserName || "Usuario"}</strong>
                            <small>{formatDateTime(message.createdAt)}</small>
                          </div>
                          {message.replyToMessageId && (
                            <div className="chat-reply-reference">
                              <span>{message.replyToFromUserName || "Mensaje citado"}</span>
                              <p><MessageText text={message.replyToMessage || "Mensaje citado"} /></p>
                            </div>
                          )}
                          {message.message && !isAudioOnlyMessage(message) && (
                            <p><MessageText text={message.message} /></p>
                          )}
                          <AttachmentGallery attachments={message.attachments} compact />
                          <div className="chat-bubble-status">
                            {outgoing ? (
                              <>
                                Enviado · <DepartmentReadReceipt message={message} profiles={messageProfiles} />
                              </>
                            ) : "Recibido"}
                            <button
                              type="button"
                              className="chat-reply-button"
                              onClick={() => handleReplyToMessage(message, "department")}
                            >
                              Responder
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                className="chat-reply-button"
                                onClick={() => handleDeleteMessage(message, "department")}
                              >
                                Eliminar
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
                <div ref={threadEndRef} aria-hidden="true" />
              </div>

              {activeTypingLabel && <div className="chat-typing-indicator">{activeTypingLabel}</div>}

              <form className="chat-composer" onSubmit={handleDepartmentMessageSubmit} ref={departmentComposerRef}>
                {replyTarget?.type === "department" && (
                  <div className="chat-reply-preview">
                    <div>
                      <span>Respondiendo a {replyTarget.fromUserName}</span>
                      <p>{replyTarget.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Cancelar respuesta"
                    >
                      ×
                    </button>
                  </div>
                )}
                {departmentComposerRecording ? (
                  <div className="chat-voice-recorder-bar" role="status" aria-live="polite">
                    <button
                      type="button"
                      className="voice-recorder-action danger"
                      onClick={() => finishVoiceRecording("cancel")}
                      disabled={voiceRecordingProcessing}
                      aria-label="Cancelar audio"
                      title="Cancelar audio"
                    >
                      🗑
                    </button>
                    <div className="voice-recorder-status">
                      <span className={`voice-recorder-dot ${voiceRecordingPaused ? "paused" : ""}`} />
                      <strong>{voiceRecordingPaused ? "Pausado" : "Grabando"}</strong>
                      <small>{voiceRecordingLabel}</small>
                      <div className={`voice-recorder-wave ${voiceRecordingPaused ? "paused" : ""}`} aria-hidden="true">
                        {voiceWaveLevels.map((level, index) => (
                          <span key={index} style={{ "--wave-level": level, "--wave-index": index }} />
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="voice-recorder-action"
                      onClick={handleToggleVoicePause}
                      disabled={voiceRecordingProcessing || !voicePauseSupported}
                      aria-label={voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion"}
                      title={voicePauseSupported ? (voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion") : "Pausa no disponible"}
                    >
                      {voiceRecordingPaused ? "🎙" : "⏸"}
                    </button>
                    <button
                      type="button"
                      className="voice-recorder-action send"
                      onClick={() => finishVoiceRecording("send")}
                      disabled={voiceRecordingProcessing}
                      aria-label="Enviar audio"
                      title="Enviar audio"
                    >
                      {voiceRecordingProcessing ? "…" : "➤"}
                    </button>
                  </div>
                ) : (
                  <>
                <textarea
                  spellCheck={true}
                  lang="es-MX"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  onPaste={(event) => handleComposerPaste(event, "department")}
                  value={departmentForm.message}
                  onChange={(event) => {
                    const nextMessage = event.target.value;
                    setDepartmentForm({ message: nextMessage });
                    scheduleTypingState(Boolean(nextMessage.trim()));
                  }}
                  onKeyDown={(event) => handleComposerKeyDown(event, departmentComposerRef)}
                  placeholder={`Escribe un mensaje para ${selectedDepartmentName}...`}
                  maxLength={1200}
                />

                <div className="chat-composer-tools">
                  <AttachmentPicker
                    title="Adjuntos"
                    helper="Imagen, documento, audio o video. Máximo 6 archivos."
                    onChange={handleDepartmentFileSelection}
                  />

                  <button
                    type={departmentComposerUsesVoiceButton ? "button" : "submit"}
                    className={`workspace-primary-button chat-send-icon-button ${departmentComposerUsesVoiceButton ? "voice-mode" : ""} ${departmentComposerRecording ? "recording" : ""}`}
                    onClick={
                      departmentComposerUsesVoiceButton
                        ? () => (departmentComposerRecording ? handleStopVoiceRecording() : handleStartVoiceRecording("department"))
                        : undefined
                    }
                    disabled={messageSaving || Boolean(voiceRecordingType && voiceRecordingType !== "department")}
                    aria-label={
                      messageSaving
                        ? "Enviando mensaje"
                        : departmentComposerUsesVoiceButton
                          ? departmentComposerRecording
                            ? "Detener audio"
                            : "Grabar audio"
                          : "Enviar mensaje al departamento"
                    }
                    title={
                      messageSaving
                        ? "Enviando..."
                        : departmentComposerUsesVoiceButton
                          ? departmentComposerRecording
                            ? "Detener audio"
                            : "Grabar audio"
                          : "Enviar"
                    }
                  >
                    {messageSaving ? "…" : departmentComposerUsesVoiceButton ? (departmentComposerRecording ? "■" : "🎙") : "➤"}
                  </button>
                </div>

                <AttachmentDraftList
                  items={departmentAttachments}
                  onRemove={handleRemoveDepartmentAttachment}
                />
                  </>
                )}
              </form>
            </>
          )}
        </section>

        <aside className="chat-info-panel">
          <div className="chat-info-card">
            <div className="chat-info-title">
              <span>ⓘ</span>
              <h3>Información</h3>
            </div>

            <div className="chat-info-section">
              <small>Tipo de chat</small>
              <strong>{activeChatTypeLabel}</strong>
            </div>

            <div className="chat-info-section">
              <small>{conversationType === "department" ? "Departamento" : "Participante"}</small>
              <div className="chat-info-person">
                <div className={`chat-conversation-avatar ${conversationType === "department" ? "department-chat-avatar" : "presence-avatar"} ${conversationType === "direct" ? selectedPresenceStatus.state || (selectedPresenceStatus.online ? "online" : "unavailable") : ""}`}>
                  {getInitials(activeChatTitle)}
                </div>
                <div>
                  <strong>{activeChatTitle}</strong>
                  <span>{activeChatSubtitle}</span>
                  {conversationType === "direct" && <PresenceBadge status={selectedPresenceStatus} compact />}
                </div>
              </div>
            </div>

            <div className="chat-info-section">
              <div className="chat-info-section-head">
                <small>Archivos compartidos</small>
                <b>{activeAllSharedAttachments.length}</b>
              </div>
              {activeSharedAttachments.length === 0 ? (
                <p className="chat-info-muted">Aún no hay archivos compartidos en este chat.</p>
              ) : (
                <div className="chat-shared-files-list">
                  {activeSharedAttachments.map((attachment) => {
                    const type = getAttachmentType(attachment.contentType, attachment.name);
                    return (
                      <a
                        key={`${attachment.messageId}-${attachment.path || attachment.url || attachment.name}`}
                        className="chat-shared-file"
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className={`chat-shared-file-icon type-${type}`}>
                          {type === "image" ? "IMG" : type === "video" ? "VID" : type === "audio" ? "AUD" : "DOC"}
                        </span>
                        <div>
                          <strong>{attachment.name || "Archivo"}</strong>
                          <small>{getAttachmentTypeLabel(type)} · {formatFileSize(attachment.size)}</small>
                        </div>
                        <em>↗</em>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="chat-info-section chat-info-stats">
              <div>
                <strong>{activeThreadMessages.length}</strong>
                <span>Mensajes</span>
              </div>
              <div>
                <strong>{activeFilteredMessages.length}</strong>
                <span>Visibles</span>
              </div>
            </div>

            <div className="chat-info-section chat-info-quick-actions">
              <small>Acciones rápidas</small>
              <button
                type="button"
                onClick={() => document.querySelector('.chat-thread-search-box input')?.focus()}
              >
                <span>⌕</span>
                Buscar en chat
                <b>›</b>
              </button>
              <button
                type="button"
                onClick={() => setShowChatFilesPanel((current) => !current)}
              >
                <span>▣</span>
                {showChatFilesPanel ? "Ocultar archivos" : "Ver archivos"}
                <b>›</b>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMutedChats((current) => ({
                    ...current,
                    [activeChatKey]: !current[activeChatKey],
                  }));
                  setMessageStatus(activeChatMuted ? "Notificaciones activadas para este chat." : "Notificaciones silenciadas para este chat.");
                }}
              >
                <span>{activeChatMuted ? "🔔" : "🔕"}</span>
                {activeChatMuted ? "Activar notificaciones" : "Silenciar notificaciones"}
                <b>›</b>
              </button>
            </div>

            {showChatFilesPanel && (
              <div className="chat-info-section chat-info-expanded-files">
                <div className="chat-info-section-head">
                  <small>Todos los archivos del chat</small>
                  <b>{activeAllSharedAttachments.length}</b>
                </div>
                {activeAllSharedAttachments.length === 0 ? (
                  <p className="chat-info-muted">Todavía no hay archivos para mostrar.</p>
                ) : (
                  <div className="chat-expanded-files-list">
                    {activeAllSharedAttachments.map((attachment) => {
                      const type = getAttachmentType(attachment.contentType, attachment.name);
                      return (
                        <a
                          key={`full-${attachment.messageId}-${attachment.path || attachment.url || attachment.name}`}
                          className="chat-shared-file"
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className={`chat-shared-file-icon type-${type}`}>
                            {type === "image" ? "IMG" : type === "video" ? "VID" : type === "audio" ? "AUD" : "DOC"}
                          </span>
                          <div>
                            <strong>{attachment.name || "Archivo"}</strong>
                            <small>
                              {getAttachmentTypeLabel(type)} · {formatFileSize(attachment.size)}
                              {attachment.fromUserName ? ` · ${attachment.fromUserName}` : ""}
                            </small>
                          </div>
                          <em>↗</em>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeChatMuted && (
              <div className="chat-info-section chat-muted-notice">
                <span>🔕</span>
                <p>Las notificaciones de este chat están silenciadas en esta sesión.</p>
              </div>
            )}
          </div>
        </aside>
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
function buildDepartmentChatOptions({ departments, collaborators, profile, currentUserId, isAdmin }) {
  const optionsByKey = new Map();
  const currentUserLabels = getUserDepartmentLabels(profile);
  const currentUserDepartmentKeys = currentUserLabels.map(normalizeText).filter(Boolean);

  function addOption({ id, name, source = "profile", raw = {} }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const normalizedName = normalizeText(cleanName);
    if (!normalizedName) return;
    const optionId =
      normalizeDepartmentId({ ...raw, id: id || raw.id }) ||
      normalizeDepartmentId(cleanName, { labelFallback: true }) ||
      getDepartmentOptionId(cleanName);
    if (!optionsByKey.has(normalizedName)) {
      optionsByKey.set(normalizedName, {
        id: optionId,
        name: cleanName,
        normalizedName,
        source,
        departmentDocId: raw.id || "",
        memberCount: 0,
      });
    }
  }

  (departments || []).forEach((department) => {
    const departmentName = department.name || department.title || "";
    const normalizedName = normalizeText(departmentName);
    const departmentId = normalizeDepartmentId(department) || normalizeDepartmentId(departmentName, { labelFallback: true }) || getDepartmentOptionId(departmentName);
    if (!departmentName || (!isAdmin && !userBelongsToDepartmentId(profile, departmentId) && !currentUserDepartmentKeys.includes(normalizedName))) return;
    addOption({ id: departmentId, name: departmentName, source: "departments", raw: department });
  });

  if (isAdmin) {
    [{ ...profile, id: currentUserId }, ...(collaborators || [])].forEach((user) => {
      getUserDepartmentLabels(user).forEach((departmentName) => addOption({ name: departmentName, source: "users" }));
    });
  } else {
    currentUserLabels.forEach((departmentName) => addOption({ name: departmentName, source: "profile" }));
  }

  const users = [{ ...profile, id: currentUserId }, ...(collaborators || [])];
  return Array.from(optionsByKey.values())
    .map((option) => ({
      ...option,
      memberCount: getDepartmentMemberIds(option, collaborators, profile, currentUserId).length,
    }))
    .filter((option) => isAdmin || users.some((user) => userBelongsToDepartmentId(user, option.id) || userBelongsToDepartment(user, option.normalizedName)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function buildDepartmentConversations(messages, departmentOptions, currentUserId) {
  const grouped = new Map();
  const departmentIdByName = new Map();

  (departmentOptions || []).forEach((department) => {
    const departmentId = normalizeDepartmentId(department) || normalizeDepartmentId(department.name, { labelFallback: true });
    if (!departmentId) return;
    if (department.normalizedName) {
      departmentIdByName.set(department.normalizedName, departmentId);
    }
    grouped.set(departmentId, {
      departmentId,
      departmentName: department.name,
      normalizedName: department.normalizedName,
      memberCount: department.memberCount || 0,
      messages: [],
      unreadCount: 0,
      lastMessage: null,
    });
  });

  (messages || []).forEach((message) => {
    const messageDepartmentName = message.departmentName || message.department || message.area || "Departamento";
    const normalizedName = normalizeText(messageDepartmentName);
    const departmentId =
      departmentIdByName.get(normalizedName) ||
      normalizeDepartmentId(message.departmentId || message.areaId || message.primaryDepartmentId) ||
      normalizeDepartmentId(messageDepartmentName, { labelFallback: true }) ||
      getDepartmentOptionId(messageDepartmentName);
    if (!grouped.has(departmentId)) return;

    const conversation = grouped.get(departmentId);
    conversation.messages.push(message);
    if (isUnreadDepartmentMessage(message, currentUserId)) {
      conversation.unreadCount += 1;
    }
    if (!conversation.memberCount && Array.isArray(message.memberIds)) {
      conversation.memberCount = message.memberIds.length;
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
      const dateDiff = getMillisFromFirestoreDate(b.lastMessage?.createdAt) - getMillisFromFirestoreDate(a.lastMessage?.createdAt);
      if (dateDiff !== 0) return dateDiff;
      return a.departmentName.localeCompare(b.departmentName, "es");
    });
}

function getDepartmentMemberIds(department, collaborators, profile, currentUserId) {
  const departmentId = normalizeDepartmentId(department);
  const normalizedName = department?.normalizedName || normalizeText(department?.name || department?.departmentName || "");
  const userMap = new Map();

  [{ ...profile, id: currentUserId }, ...(collaborators || [])].forEach((user) => {
    const userId = user?.id || user?.uid || "";
    if (!userId) return;
    if (userBelongsToDepartmentId(user, departmentId) || userBelongsToDepartment(user, normalizedName)) {
      userMap.set(userId, user);
    }
  });

  if (currentUserId) {
    userMap.set(currentUserId, { ...profile, id: currentUserId });
  }

  return Array.from(userMap.keys()).filter(Boolean);
}

function getDepartmentOptionId(departmentName = "") {
  const slug = normalizeText(departmentName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || `department-${Date.now()}`;
}

function getUserDepartmentLabels(user = {}) {
  return [
    user?.area,
    user?.department,
    user?.departmentName,
    user?.team,
    ...(Array.isArray(user?.departmentNames) ? user.departmentNames : []),
    ...(Array.isArray(user?.departments) ? user.departments : []),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex((item) => normalizeText(item) === normalizeText(value)) === index);
}

function userBelongsToDepartment(user = {}, normalizedDepartmentName = "") {
  if (!normalizedDepartmentName) return false;
  return getUserDepartmentLabels(user).some((departmentName) => normalizeText(departmentName) === normalizedDepartmentName);
}

function isUnreadDepartmentMessage(message, currentUserId) {
  if (!message?.id || !currentUserId) return false;
  if (message.fromUserId === currentUserId) return false;
  const readBy = message.readBy || {};
  return !readBy[currentUserId];
}

function matchesDepartmentConversationSearch(conversation, searchTerm) {
  const normalizedSearch = normalizeText(searchTerm);
  if (!normalizedSearch) return true;

  const values = [
    conversation.departmentName,
    conversation.lastMessage?.message,
    conversation.lastMessage?.fromUserName,
    getSearchableAttachmentText(conversation.lastMessage?.attachments),
    ...(conversation.messages || []).flatMap((message) => [
      message.message,
      message.fromUserName,
      message.fromUserEmail,
      getSearchableAttachmentText(message.attachments),
    ]),
  ];

  return values.some((value) => normalizeText(value).includes(normalizedSearch));
}

function matchesDepartmentMessageSearch(message, searchTerm) {
  const normalizedSearch = normalizeText(searchTerm);
  if (!normalizedSearch) return true;

  return [
    message.departmentName,
    message.message,
    message.fromUserName,
    message.fromUserEmail,
    getSearchableAttachmentText(message.attachments),
  ].some((value) => normalizeText(value).includes(normalizedSearch));
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


function useWorkspaceCommunicationActivity(profile, isAdmin = false) {
  const currentUserId = getCurrentUserId(profile);
  const [directMessages, setDirectMessages] = useState([]);
  const [departmentMessages, setDepartmentMessages] = useState([]);

  useEffect(() => {
    if (!currentUserId) {
      setDirectMessages([]);
      return undefined;
    }

    const directMessagesQuery = query(
      collection(db, "internalMessages"),
      where("toUserId", "==", currentUserId)
    );

    return onSnapshot(
      directMessagesQuery,
      (snapshot) => {
        const nextMessages = snapshot.docs
          .map((messageDoc) => ({
            id: messageDoc.id,
            ...messageDoc.data(),
            attachments: normalizeStoredAttachments(messageDoc.data()?.attachments),
          }))
          .sort(sortByCreatedAtDesc)
          .slice(0, 20);

        setDirectMessages(nextMessages);
      },
      (error) => {
        console.error("No se pudo cargar la actividad reciente de mensajes:", error);
        setDirectMessages([]);
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setDepartmentMessages([]);
      return undefined;
    }

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onMessages: (messages) => {
        const nextMessages = messages
          .map((message) => ({
            ...message,
            attachments: normalizeStoredAttachments(message.attachments),
            readBy: message.readBy || {},
          }))
          .sort(sortByCreatedAtDesc)
          .slice(0, 30);

        setDepartmentMessages(nextMessages);
      },
      onError: (error) => {
        console.error("No se pudo cargar la actividad reciente de departamentos:", error);
        setDepartmentMessages([]);
      },
    });
  }, [currentUserId, isAdmin, profile]);

  return { directMessages, departmentMessages };
}

function buildWorkspaceActivityItems({ directMessages, departmentMessages, announcements, notes }) {
  const directItems = (directMessages || []).map((message) => ({
    id: `direct-${message.id}`,
    icon: "💬",
    tone: "message",
    action: "messages",
    dateValue: message.createdAt,
    title: `${message.fromUserName || "Un colaborador"} te envió un mensaje`,
    description: message.message || "Mensaje con archivo adjunto.",
    timeLabel: formatDateTime(message.createdAt),
  }));

  const departmentItems = (departmentMessages || []).map((message) => ({
    id: `department-${message.id}`,
    icon: "👥",
    tone: "department",
    action: "messages",
    dateValue: message.createdAt,
    title: `Nuevo mensaje en ${message.departmentName || "Departamento"}`,
    description: `${message.fromUserName || "Un colaborador"}: ${message.message || "Archivo adjunto"}`,
    timeLabel: formatDateTime(message.createdAt),
  }));

  const announcementItems = (announcements || []).map((announcement) => ({
    id: `announcement-${announcement.id}`,
    icon: announcement.priority === "important" ? "📢" : "📣",
    tone: "announcement",
    action: "announcements",
    dateValue: announcement.createdAt,
    title: `Anuncio pendiente: ${announcement.title || "Sin título"}`,
    description: announcement.message || "Confirma que ya viste este anuncio.",
    timeLabel: formatDateTime(announcement.createdAt),
  }));

  const noteItems = (notes || []).map((note) => ({
    id: `note-${note.id}`,
    icon: note.pinned ? "📌" : "📝",
    tone: "note",
    action: "notes",
    dateValue: note.updatedAt || note.createdAt,
    title: `Nota pendiente: ${note.title || "Nota personal"}`,
    description: note.content || "Recordatorio personal pendiente.",
    timeLabel: formatDateTime(note.updatedAt || note.createdAt),
  }));

  return [...directItems, ...departmentItems, ...announcementItems, ...noteItems]
    .sort((a, b) => getMillisFromFirestoreDate(b.dateValue) - getMillisFromFirestoreDate(a.dateValue))
    .slice(0, 8);
}

function scrollToWorkspaceSection(sectionId) {
  if (typeof window === "undefined" || !sectionId) return;

  window.requestAnimationFrame(() => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
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


function useUnreadDepartmentMessagesCount(profile, isAdmin = false) {
  const currentUserId = getCurrentUserId(profile);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!currentUserId) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onMessages: (messages) => {
        const nextUnreadCount = messages.filter((message) => {
          return message.fromUserId !== currentUserId && !(message.readBy || {})[currentUserId];
        }).length;

        setUnreadCount(nextUnreadCount);
      },
      onError: (error) => {
        console.error("No se pudo cargar el contador de mensajes por departamento:", error);
        setUnreadCount(0);
      },
    });
  }, [currentUserId, isAdmin, profile]);

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
    <span className={`presence-badge ${status.state || (status.online ? "online" : "unavailable")} ${compact ? "compact" : ""}`}>
      <span className="presence-dot" />
      {status.label}
    </span>
  );
}

function getPresenceStatus(presence, now = Date.now()) {
  const lastSeenMillis = getMillisFromFirestoreDate(presence?.lastSeen || presence?.updatedAt);
  const onlineWindow = 2 * 60 * 1000;
  const awayWindow = 8 * 60 * 60 * 1000;
  const hasPresenceRecord = Boolean(presence && (presence.userId || presence.id || lastSeenMillis > 0));
  const hasRecentHeartbeat = lastSeenMillis > 0 && now - lastSeenMillis <= onlineWindow;
  const hasRecentActivity = lastSeenMillis > 0 && now - lastSeenMillis <= awayWindow;
  const explicitlyOnline = presence?.isOnline === true;

  if (explicitlyOnline && hasRecentHeartbeat) {
    return {
      online: true,
      state: "online",
      label: "En línea",
    };
  }

  if (hasPresenceRecord && hasRecentActivity) {
    return {
      online: false,
      state: "away",
      label: `Última vez ${formatRelativePresenceTime(lastSeenMillis, now)}`,
    };
  }

  return {
    online: false,
    state: "unavailable",
    label: "No disponible",
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
          <UserAvatar profile={profile} />
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
          <div className="mobile-drawer-avatar"><UserAvatar profile={profile} /></div>
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


function NotificationsSummaryIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "2",
    "aria-hidden": "true",
  };

  if (name === "messages") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h16v11H8l-4 4z" />
      </svg>
    );
  }

  if (name === "announcements") {
    return (
      <svg {...commonProps}>
        <path d="M3 10v4h3l4 4V6L6 10z" />
        <path d="M14 8a4 4 0 0 1 0 8" />
        <path d="M17 5a8 8 0 0 1 0 14" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M12 3a5 5 0 0 0-5 5v2.6c0 .8-.24 1.58-.69 2.24L5 15.3c-.6.9.04 2.1 1.11 2.1h11.78c1.07 0 1.71-1.2 1.11-2.1l-1.31-1.96A4 4 0 0 1 17 11.1V8a5 5 0 0 0-5-5Z" />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function NotificationsCenter({
  profile,
  isAdmin,
  unreadMessagesCount = 0,
  unreadAnnouncementsCount = 0,
  onOpenModule,
  onOpenProject,
}) {
  const [marking, setMarking] = useState(false);
  const [status, setStatus] = useState("");
  const { notifications } = useDashboardNotifications(profile, isAdmin);
  const totalUnread = notifications.length;
  const realUnreadMessagesCount = notifications.filter((notification) => notification.group === "message").length;
  const realUnreadAnnouncementsCount = notifications.filter((notification) => notification.group === "announcement").length;

  async function handleMarkAllRead() {
    setMarking(true);
    setStatus("");

    try {
      await markAllDashboardNotificationsRead({ profile, isAdmin });
      setStatus("Todas las notificaciones pendientes se marcaron como leídas.");
    } catch (error) {
      console.error("No se pudieron marcar las notificaciones:", error);
      setStatus("No se pudieron marcar todas las notificaciones como leídas.");
    } finally {
      setMarking(false);
    }
  }

  async function handleOpenNotification(notification) {
    try {
      await markDashboardNotificationRead(notification, { profile });
    } catch (error) {
      console.error("No se pudo marcar la notificación como leída:", error);
    }

    if (notification.type === "editorial") {
      window.location.assign(notification.editorialLink || `/editorial/${notification.editorialProjectId || ""}`);
      return;
    }

    if (notification.type === "material-correction") {
      window.location.assign(notification.materialLink || `/?page=material-corrections&reportId=${notification.materialReportId || ""}`);
      return;
    }

    if (notification.type === "project" && notification.projectId) {
      onOpenProject?.(notification.projectId);
      return;
    }

    onOpenModule?.(notification.route || "workspace-dashboard");
  }

  return (
    <section className="notifications-center-page printshop-page">
      <section className="printshop-topbar">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon">
            <svg
              className="printshop-svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 3a5 5 0 0 0-5 5v2.6c0 .8-.24 1.58-.69 2.24L5 15.3c-.6.9.04 2.1 1.11 2.1h11.78c1.07 0 1.71-1.2 1.11-2.1l-1.31-1.96A4 4 0 0 1 17 11.1V8a5 5 0 0 0-5-5Z" />
              <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
            </svg>
          </span>

          <div className="printshop-topbar-copy">
            <p className="section-kicker printshop-kicker">Centro de avisos</p>
            <h1>Notificaciones</h1>
            <p>
              Consulta mensajes pendientes, comunicados y actualizaciones de tus proyectos en un solo lugar.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="visual-primary-button"
          onClick={handleMarkAllRead}
          disabled={marking || totalUnread === 0}
        >
          {marking ? "Marcando..." : "Marcar todas como leídas"}
        </button>
      </section>

      {status && <div className="message-box">{status}</div>}

      <div className="notifications-center-grid">
        <article className="notifications-center-summary-card unread">
          <span className="notifications-center-summary-icon">
            <NotificationsSummaryIcon name="unread" />
          </span>
          <span className="notifications-center-summary-label">Sin leer</span>
          <strong>{formatUnreadBadgeCount(totalUnread)}</strong>
        </article>

        <article className="notifications-center-summary-card">
          <span className="notifications-center-summary-icon">
            <NotificationsSummaryIcon name="messages" />
          </span>
          <span className="notifications-center-summary-label">Mensajes</span>
          <strong>{formatUnreadBadgeCount(realUnreadMessagesCount || unreadMessagesCount)}</strong>
        </article>

        <article className="notifications-center-summary-card">
          <span className="notifications-center-summary-icon">
            <NotificationsSummaryIcon name="announcements" />
          </span>
          <span className="notifications-center-summary-label">Anuncios</span>
          <strong>{formatUnreadBadgeCount(realUnreadAnnouncementsCount || unreadAnnouncementsCount)}</strong>
        </article>
      </div>

      <div className="notifications-center-list-card">
        <div className="admin-panel-header">
          <h3>Notificaciones pendientes</h3>
          <button type="button" onClick={() => onOpenModule?.("internal-messages")}>Abrir mensajes</button>
        </div>

        <div className="notifications-center-list">
          {notifications.length === 0 ? (
            <div className="notifications-empty-state">
              <strong>No hay notificaciones pendientes</strong>
              <p>Cuando recibas mensajes o haya anuncios por confirmar, aparecerán aquí.</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <button
                type="button"
                key={notification.key}
                className="notifications-center-item"
                onClick={() => handleOpenNotification(notification)}
              >
                <span className={`notification-icon notification-${notification.tone}`}>
                  {notification.icon}
                </span>
                <span>
                  <strong>{notification.title}</strong>
                  <small>{notification.detail}</small>
                </span>
                <em>{notification.time}</em>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function TopProfileBar({
  profile,
  isAdmin,
  activeTitle = "Desarrollo de Proyectos",
  theme = "light",
  onToggleTheme,
  unreadMessagesCount = 0,
  unreadAnnouncementsCount = 0,
  profileMenuOpen,
  setProfileMenuOpen,
  notificationPanelOpen,
  setNotificationPanelOpen,
  onViewProfile,
  onLogout,
  onOpenModule,
  onOpenProject,
}) {
  const { notifications } = useDashboardNotifications(profile, isAdmin);
  const safeNotificationCount = notifications.length;
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [markingNotifications, setMarkingNotifications] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");

  useEffect(() => {
    const cleanSearchTerm = searchTerm.trim();

    if (cleanSearchTerm.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);

    searchDashboardItems({
      term: cleanSearchTerm,
      isAdmin,
      profile,
    })
      .then((results) => {
        if (!cancelled) {
          setSearchResults(results);
        }
      })
      .catch((error) => {
        console.error("No se pudo ejecutar la búsqueda del tablero:", error);
        if (!cancelled) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [searchTerm, isAdmin, profile]);

  function toggleNotifications() {
    setNotificationPanelOpen((current) => !current);
    setProfileMenuOpen(false);
    setNotificationStatus("");
  }

  function toggleProfile() {
    setProfileMenuOpen((current) => !current);
    setNotificationPanelOpen(false);
  }

  async function handleMarkAllNotificationsRead() {
    setMarkingNotifications(true);
    setNotificationStatus("");

    try {
      await markAllDashboardNotificationsRead({ profile, isAdmin });
      setNotificationStatus("Notificaciones marcadas como leídas.");
    } catch (error) {
      console.error("No se pudieron marcar las notificaciones como leídas:", error);
      setNotificationStatus("No se pudieron marcar todas como leídas.");
    } finally {
      setMarkingNotifications(false);
    }
  }

  function handleSelectSearchResult(result) {
    if (result.type === "project" && result.id) {
      onOpenProject?.(result.id);
    } else if (result.route) {
      onOpenModule?.(result.route);
    }

    setSearchTerm("");
    setSearchResults([]);
    setProfileMenuOpen(false);
    setNotificationPanelOpen(false);
  }

  async function handleOpenNotification(notification) {
    try {
      await markDashboardNotificationRead(notification, { profile });
    } catch (error) {
      console.error("No se pudo marcar la notificación como leída:", error);
    }

    if (notification.type === "editorial") {
      window.location.assign(notification.editorialLink || `/editorial/${notification.editorialProjectId || ""}`);
    } else if (notification.type === "material-correction") {
      window.location.assign(notification.materialLink || `/?page=material-corrections&reportId=${notification.materialReportId || ""}`);
    } else if (notification.type === "project" && notification.projectId) {
      onOpenProject?.(notification.projectId);
    } else if (notification.route) {
      onOpenModule?.(notification.route);
    }

    setNotificationPanelOpen(false);
  }

  return (
    <div className="top-profile-bar redesigned-topbar">
      <div className="topbar-title-area">
        <strong>{activeTitle}</strong>
      </div>

      <div className="topbar-search-wrapper">
        <label className="topbar-search" aria-label="Buscar">
          <span>⌕</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={isAdmin ? "Buscar proyectos, tareas, personas..." : "Buscar proyectos, tareas, mensajes..."}
          />
        </label>

        {searchTerm.trim().length >= 2 && (
          <div className="topbar-search-results">
            <div className="topbar-search-results-header">
              <strong>Resultados</strong>
              {searchLoading && <span>Buscando...</span>}
            </div>

            {!searchLoading && searchResults.length === 0 && (
              <p className="topbar-search-empty">No se encontraron coincidencias.</p>
            )}

            {searchResults.map((result) => (
              <button
                type="button"
                key={`${result.type}-${result.id || result.route || result.title}`}
                className="topbar-search-result"
                onClick={() => handleSelectSearchResult(result)}
              >
                <span className={`topbar-search-result-icon topbar-search-${result.tone || "blue"}`}>
                  {result.icon || "⌕"}
                </span>
                <span>
                  <strong>{result.title}</strong>
                  <small>{result.description}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        {onToggleTheme && (
          <button
            type="button"
            className="theme-toggle-button topbar-theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            <span className="theme-toggle-icon" aria-hidden="true">
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                  <circle cx="12" cy="12" r="4.25" />
                  <path d="M12 2.75v2.1M12 19.15v2.1M4.85 4.85l1.48 1.48M17.67 17.67l1.48 1.48M2.75 12h2.1M19.15 12h2.1M4.85 19.15l1.48-1.48M17.67 6.33l1.48-1.48" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                  <path d="M20.25 14.05A7.7 7.7 0 0 1 9.95 3.75a8.4 8.4 0 1 0 10.3 10.3Z" />
                </svg>
              )}
            </span>
            <span className="theme-toggle-copy">
              <strong>{theme === "dark" ? "Claro" : "Oscuro"}</strong>
            </span>
          </button>
        )}

        <div className="notification-menu-wrapper">
          <button
            type="button"
            className="notification-bell-button"
            onClick={toggleNotifications}
            aria-label="Ver notificaciones"
          >
            <span>♢</span>
            <span className="notification-bell-icon">🔔</span>
            {safeNotificationCount > 0 && (
              <b>{formatUnreadBadgeCount(safeNotificationCount)}</b>
            )}
          </button>

          {notificationPanelOpen && (
            <div className="notifications-dropdown">
              <div className="notifications-header">
                <strong>Notificaciones</strong>
                <button
                  type="button"
                  onClick={handleMarkAllNotificationsRead}
                  disabled={markingNotifications || safeNotificationCount === 0}
                >
                  {markingNotifications ? "Marcando..." : "Marcar todas como leídas"}
                </button>
              </div>

              {notificationStatus && (
                <div className="notifications-status-message">{notificationStatus}</div>
              )}

              <div className="notifications-list">
                {notifications.length === 0 ? (
                  <div className="notifications-empty-state notifications-dropdown-empty">
                    <strong>No hay notificaciones pendientes</strong>
                    <p>Los mensajes nuevos y anuncios por confirmar aparecerán aquí.</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <button
                      type="button"
                      key={notification.key}
                      className="notification-item"
                      onClick={() => handleOpenNotification(notification)}
                    >
                      <span className={`notification-icon notification-${notification.tone}`}>
                        {notification.icon}
                      </span>
                      <span className="notification-copy">
                        <strong>{notification.title}</strong>
                        <small>{notification.detail}</small>
                      </span>
                      <span className="notification-time">{notification.time}</span>
                      <i className={`notification-dot notification-dot-${notification.tone}`} />
                    </button>
                  ))
                )}
              </div>

              <button
                type="button"
                className="notifications-footer-link"
                onClick={() => {
                  onOpenModule?.("notifications-center");
                  setNotificationPanelOpen(false);
                }}
              >
                Ver todas las notificaciones
              </button>
            </div>
          )}
        </div>

        <div className="profile-menu-wrapper topbar-profile-wrapper">
          <button
            type="button"
            className="profile-chip-button"
            onClick={toggleProfile}
          >
            <span className="profile-chip-avatar"><UserAvatar profile={profile} /></span>
            <strong>{profile?.name || "Usuario"}</strong>
            <em>⌄</em>
          </button>

          {profileMenuOpen && (
            <div className="profile-dropdown">
              <div className="profile-dropdown-header">
                <div className="profile-dropdown-avatar"><UserAvatar profile={profile} /></div>

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
    </div>
  );
}


async function searchDashboardItems({ term, isAdmin, profile }) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return [];

  const currentUserId = getCurrentUserId(profile);
  const results = [];

  const moduleResults = getDashboardSearchableModules(isAdmin).filter((item) =>
    [item.title, item.description].some((value) => normalizeText(value).includes(normalizedTerm))
  );

  results.push(...moduleResults);

  const projects = await getSafeCollectionItems("projects");
  projects
    .filter((project) => {
      if (project.deleted === true) return false;

      if (!isAdmin) {
        const allowedUserIds = [
          project.ownerId,
          project.createdByUid,
          project.responsibleUid,
          project.responsibleId,
          ...(Array.isArray(project.collaboratorIds) ? project.collaboratorIds : []),
          ...(Array.isArray(project.responsibleIds) ? project.responsibleIds : []),
        ].filter(Boolean);

        if (currentUserId && allowedUserIds.length > 0 && !allowedUserIds.includes(currentUserId)) {
          return false;
        }
      }

      return [
        project.name,
        project.title,
        project.projectName,
        project.code,
        project.area,
        project.departmentName,
        project.description,
        project.status,
      ].some((value) => normalizeText(value).includes(normalizedTerm));
    })
    .slice(0, 8)
    .forEach((project) => {
      results.push({
        type: "project",
        id: project.id,
        title: project.name || project.title || project.projectName || "Proyecto sin título",
        description: `${project.code ? `${project.code} · ` : ""}${project.area || project.departmentName || "Proyecto"}`,
        icon: "▣",
        tone: "blue",
      });
    });

  if (isAdmin) {
    const users = await getSafeCollectionItems("users");
    users
      .filter((user) => user.deleted !== true)
      .filter((user) =>
        [user.name, user.email, user.area, ...(Array.isArray(user.departmentNames) ? user.departmentNames : [])].some((value) =>
          normalizeText(value).includes(normalizedTerm)
        )
      )
      .slice(0, 5)
      .forEach((user) => {
        results.push({
          type: "user",
          id: user.id,
          route: "collaborators-admin",
          title: user.name || user.email || "Colaborador",
          description: user.email || user.area || "Perfil de colaborador",
          icon: "👥",
          tone: "green",
        });
      });
  }

  const messages = await getSafeCollectionItems("internalMessages");
  messages
    .filter((message) => {
      if (!isAdmin && currentUserId) {
        return message.fromUserId === currentUserId || message.toUserId === currentUserId;
      }
      return true;
    })
    .filter((message) =>
      [message.message, message.fromUserName, message.toUserName, message.fromUserEmail, message.toUserEmail].some((value) =>
        normalizeText(value).includes(normalizedTerm)
      )
    )
    .slice(0, 4)
    .forEach((message) => {
      results.push({
        type: "message",
        id: message.id,
        route: "internal-messages",
        title: "Mensaje interno",
        description: message.message || "Abrir módulo de mensajes",
        icon: "💬",
        tone: "gold",
      });
    });

  return results.slice(0, 10);
}

function getDashboardSearchableModules(isAdmin) {
  const baseModules = [
    { type: "module", route: "workspace-dashboard", title: "Tablero", description: "Anuncios, notas y actividad general", icon: "▦", tone: "blue" },
    { type: "module", route: "internal-messages", title: "Mensajes", description: "Conversaciones internas y mensajes por departamento", icon: "💬", tone: "gold" },
    { type: "module", route: "team-agenda", title: "Agenda del equipo", description: "Horarios, solicitudes y próximas acciones", icon: "📅", tone: "green" },
    { type: "module", route: "ideas-incubator", title: "Incubadora de ideas", description: "Registro y seguimiento de ideas nuevas", icon: "💡", tone: "gold" },
    { type: "module", route: "my-projects", title: "Mis proyectos", description: "Proyectos asignados o en colaboración", icon: "▣", tone: "blue" },
    { type: "module", route: "print-shop", title: "Imprenta", description: "Solicitudes, producción e inventario de imprenta", icon: "🖨", tone: "blue" },
    { type: "module", route: "technical-support", title: "Soporte técnico", description: "Inventario técnico, mantenimientos y reportes", icon: "🛠", tone: "green" },
    { type: "module", route: "bug-reports", title: "Reporte de errores", description: "Registro y seguimiento de incidencias del sistema", icon: "🐞", tone: "red" },
  ];

  baseModules.push({
    type: "module",
    route: "purchase-requests",
    title: "Solicitudes de compra",
    description: "Solicita compras y consulta su seguimiento",
    icon: "🛒",
    tone: "gold",
  });

  if (!isAdmin) return baseModules;

  return [
    { type: "module", route: "executive-dashboard", title: "Dashboard ejecutivo", description: "Resumen general de proyectos y operación", icon: "▦", tone: "blue" },
    ...baseModules,
    { type: "module", route: "create-project", title: "Alta de proyecto", description: "Registrar un nuevo proyecto", icon: "+", tone: "green" },
    { type: "module", route: "all-projects", title: "Todos los proyectos", description: "Listado completo y control administrativo", icon: "☰", tone: "blue" },
    { type: "module", route: "project-history", title: "Historial de proyectos", description: "Proyectos terminados o eliminados", icon: "↶", tone: "gold" },
    { type: "module", route: "collaborators-admin", title: "Colaboradores", description: "Gestión de usuarios y permisos", icon: "👥", tone: "green" },
    { type: "module", route: "departments-admin", title: "Departamentos", description: "Gestión de departamentos y áreas", icon: "▦", tone: "blue" },
    { type: "module", route: "drive-manager", title: "Nube AES", description: "Explorar carpetas y archivos de Google Drive", icon: "N", tone: "blue" },
    { type: "module", route: "digital-signage", title: "Digital Signage", description: "Contenido visual, playlists y pantallas", icon: "TV", tone: "blue" },
  ];
}

async function getSafeCollectionItems(collectionName) {
  try {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
  } catch (error) {
    if (error?.code !== "permission-denied") {
      console.warn(`No se pudo buscar en ${collectionName}:`, error);
    }
    return [];
  }
}

async function markAllDashboardNotificationsRead({ profile, isAdmin }) {
  const currentUserId = getCurrentUserId(profile);
  if (!currentUserId) return;

  await markAllNotificationsRead(currentUserId);

  const announcements = await getSafeCollectionItems("announcements");
  const activeAnnouncements = announcements.filter((announcement) => announcement.active !== false);

  await Promise.all(
    activeAnnouncements.map((announcement) =>
      setDoc(
        doc(db, "announcements", announcement.id, "reads", currentUserId),
        {
          announcementId: announcement.id,
          userId: currentUserId,
          userName: profile?.name || "Usuario",
          userEmail: profile?.email || "",
          readAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  const directMessagesSnapshot = await getDocs(
    query(collection(db, "internalMessages"), where("toUserId", "==", currentUserId))
  );

  await Promise.all(
    directMessagesSnapshot.docs
      .filter((messageDoc) => messageDoc.data()?.read !== true)
      .map((messageDoc) =>
        updateDoc(doc(db, "internalMessages", messageDoc.id), {
          read: true,
          readAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
  );

  const departmentMessages = await loadVisibleDepartmentMessages(profile, isAdmin);

  await Promise.all(
    departmentMessages
      .filter((message) => isUnreadDepartmentMessage(message, currentUserId))
      .map((message) =>
        updateDoc(doc(db, "departmentMessages", message.id), {
          [`readBy.${currentUserId}`]: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
  );
}

function useDashboardNotifications(profile, isAdmin = false) {
  const currentUserId = getCurrentUserId(profile);
  const [directMessages, setDirectMessages] = useState([]);
  const [departmentMessages, setDepartmentMessages] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementReadState, setAnnouncementReadState] = useState({});
  const [projectNotifications, setProjectNotifications] = useState([]);

  useEffect(() => {
    if (!currentUserId) {
      setProjectNotifications([]);
      return undefined;
    }

    return subscribeToUserNotifications(currentUserId, setProjectNotifications);
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setDirectMessages([]);
      return undefined;
    }

    const directMessagesQuery = query(
      collection(db, "internalMessages"),
      where("toUserId", "==", currentUserId)
    );

    return onSnapshot(
      directMessagesQuery,
      (snapshot) => {
        const nextMessages = snapshot.docs
          .map((messageDoc) => ({
            id: messageDoc.id,
            ...messageDoc.data(),
            attachments: normalizeStoredAttachments(messageDoc.data()?.attachments),
          }))
          .filter((message) => message.fromUserId !== currentUserId && message.read !== true)
          .sort(sortByCreatedAtDesc);

        setDirectMessages(nextMessages);
      },
      (error) => {
        console.error("No se pudieron cargar notificaciones de mensajes directos:", error);
        setDirectMessages([]);
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setDepartmentMessages([]);
      return undefined;
    }

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onMessages: (messages) => {
        const nextMessages = messages
          .map((message) => ({
            ...message,
            attachments: normalizeStoredAttachments(message.attachments),
            readBy: message.readBy || {},
          }))
          .filter((message) => isUnreadDepartmentMessage(message, currentUserId))
          .sort(sortByCreatedAtDesc);

        setDepartmentMessages(nextMessages);
      },
      onError: (error) => {
        console.error("No se pudieron cargar notificaciones de departamentos:", error);
        setDepartmentMessages([]);
      },
    });
  }, [currentUserId, isAdmin, profile]);

  useEffect(() => {
    if (!currentUserId) {
      setAnnouncements([]);
      setAnnouncementReadState({});
      return undefined;
    }

    return onSnapshot(
      collection(db, "announcements"),
      (snapshot) => {
        const nextAnnouncements = snapshot.docs
          .map((announcementDoc) => ({
            id: announcementDoc.id,
            ...announcementDoc.data(),
            attachments: normalizeStoredAttachments(announcementDoc.data()?.attachments),
          }))
          .filter(isAnnouncementActive)
          .sort(sortByCreatedAtDesc);

        setAnnouncements(nextAnnouncements);
        setAnnouncementReadState((current) => {
          const nextState = {};
          nextAnnouncements.forEach((announcement) => {
            if (Object.prototype.hasOwnProperty.call(current, announcement.id)) {
              nextState[announcement.id] = current[announcement.id];
            }
          });
          return nextState;
        });
      },
      (error) => {
        console.error("No se pudieron cargar notificaciones de anuncios:", error);
        setAnnouncements([]);
        setAnnouncementReadState({});
      }
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || announcements.length === 0) {
      setAnnouncementReadState({});
      return undefined;
    }

    const unsubscribers = announcements.map((announcement) =>
      onSnapshot(
        doc(db, "announcements", announcement.id, "reads", currentUserId),
        (snapshot) => {
          setAnnouncementReadState((current) => ({
            ...current,
            [announcement.id]: snapshot.exists(),
          }));
        },
        (error) => {
          console.error("No se pudo cargar estado de lectura de anuncio:", error);
          setAnnouncementReadState((current) => ({
            ...current,
            [announcement.id]: false,
          }));
        }
      )
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [announcements, currentUserId]);

  return buildRealDashboardNotifications({
    directMessages,
    departmentMessages,
    announcements: announcements.filter((announcement) => announcementReadState[announcement.id] !== true),
    projectNotifications: projectNotifications.filter((notification) => notification.read !== true),
  });
}

function buildRealDashboardNotifications({
  directMessages = [],
  departmentMessages = [],
  announcements = [],
  projectNotifications = [],
}) {
  const directNotifications = directMessages.map((message) => ({
    key: `direct-${message.id}`,
    type: "direct-message",
    group: "message",
    id: message.id,
    tone: "blue",
    icon: "💬",
    title: `${message.fromUserName || "Un colaborador"} te envió un mensaje`,
    detail: getNotificationMessageDetail(message),
    time: formatNotificationTime(message.createdAt),
    dateValue: message.createdAt,
    route: "internal-messages",
  }));

  const departmentNotifications = departmentMessages.map((message) => ({
    key: `department-${message.id}`,
    type: "department-message",
    group: "message",
    id: message.id,
    tone: "green",
    icon: "👥",
    title: `Nuevo mensaje en ${message.departmentName || "Departamento"}`,
    detail: `${message.fromUserName || "Un colaborador"}: ${getNotificationMessageDetail(message)}`,
    time: formatNotificationTime(message.createdAt),
    dateValue: message.createdAt,
    route: "internal-messages",
  }));

  const announcementNotifications = announcements.map((announcement) => ({
    key: `announcement-${announcement.id}`,
    type: "announcement",
    group: "announcement",
    id: announcement.id,
    tone: announcement.priority === "important" ? "red" : "gold",
    icon: announcement.priority === "important" ? "!" : "📣",
    title: announcement.priority === "important" ? "Anuncio importante pendiente" : "Anuncio pendiente",
    detail: `${announcement.title || "Comunicado"}${announcement.message ? ` · ${truncateNotificationText(announcement.message, 90)}` : ""}`,
    time: formatNotificationTime(announcement.createdAt || announcement.updatedAt),
    dateValue: announcement.createdAt || announcement.updatedAt,
    route: "workspace-dashboard",
  }));

  const projectEventNotifications = projectNotifications.map((notification) => {
    const visual = getNotificationVisual(notification.tipo);
    // Fase 7 — Las notificaciones editoriales viven en la misma colección; se
    // enrutan al Editor Editorial (no al detalle de proyecto operativo).
    const isEditorial = Boolean(notification.editorialProjectId);
    const isMaterialCorrection = Boolean(notification.materialCorrectionReportId);
    const notificationType = isEditorial
      ? "editorial"
      : isMaterialCorrection
        ? "material-correction"
        : "project";

    return {
      key: `${notificationType}-${notification.id}`,
      type: notificationType,
      group: "project",
      id: notification.id,
      projectId: notification.projectId,
      editorialProjectId: notification.editorialProjectId || "",
      editorialLink: notification.link || "",
      materialReportId: notification.materialCorrectionReportId || "",
      materialLink: isMaterialCorrection ? notification.link || "" : "",
      route: isMaterialCorrection ? "material-corrections" : "",
      tone: visual.tone,
      icon: visual.icon,
      title: notification.titulo || (isEditorial
        ? "Actualización editorial"
        : isMaterialCorrection
          ? "Corrección de material"
          : "Actualización de proyecto"),
      detail: `${notification.actorName || "Un colaborador"}: ${truncateNotificationText(notification.mensaje || "", 90)}`,
      time: formatNotificationTime(notification.createdAt),
      dateValue: notification.createdAt,
    };
  });

  return {
    notifications: [
      ...directNotifications,
      ...departmentNotifications,
      ...announcementNotifications,
      ...projectEventNotifications,
    ]
      .sort((a, b) => getMillisFromFirestoreDate(b.dateValue) - getMillisFromFirestoreDate(a.dateValue))
      .slice(0, 30),
  };
}

function getNotificationMessageDetail(message) {
  if (isAudioOnlyMessage(message)) return "Mensaje de audio";
  const cleanMessage = String(message?.message || "").trim();
  if (cleanMessage) return truncateNotificationText(cleanMessage, 90);

  const attachments = normalizeStoredAttachments(message?.attachments);
  if (attachments.length === 1) return `Archivo adjunto: ${attachments[0].name || "Archivo"}`;
  if (attachments.length > 1) return `${attachments.length} archivos adjuntos`;
  return "Mensaje pendiente por revisar.";
}

function truncateNotificationText(value = "", maxLength = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function formatNotificationTime(value) {
  const millis = getMillisFromFirestoreDate(value);
  if (!millis) return "Ahora";

  const diff = Math.max(Date.now() - millis, 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "Ahora";
  if (diff < hour) {
    const minutes = Math.max(Math.floor(diff / minute), 1);
    return `Hace ${minutes} min`;
  }
  if (diff < day) {
    const hours = Math.max(Math.floor(diff / hour), 1);
    return `Hace ${hours} h`;
  }

  const days = Math.max(Math.floor(diff / day), 1);
  if (days < 7) return `Hace ${days} d`;

  return formatDateTime(value);
}

async function markDashboardNotificationRead(notification, { profile }) {
  const currentUserId = getCurrentUserId(profile);
  if (!currentUserId || !notification?.id) return;

  if (notification.type === "project") {
    await markNotificationRead(notification.id);
    return;
  }

  if (notification.type === "direct-message") {
    await updateDoc(doc(db, "internalMessages", notification.id), {
      read: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  if (notification.type === "department-message") {
    await updateDoc(doc(db, "departmentMessages", notification.id), {
      [`readBy.${currentUserId}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  if (notification.type === "announcement") {
    await setDoc(
      doc(db, "announcements", notification.id, "reads", currentUserId),
      {
        announcementId: notification.id,
        userId: currentUserId,
        userName: profile?.name || "Usuario",
        userEmail: profile?.email || "",
        readAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}

function buildQuickNotifications() {
  return [];
}

function ProfilePage({ profile, isAdmin, onProfileUpdated, onClose }) {
  const [phone, setPhone] = useState(profile?.phone || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preferences, setPreferences] = useState(() => ({ soundsEnabled: true, tone: "classic", volume: 70, mutedUntil: 0, ...profile?.notificationPreferences }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    if (phone.trim() && !/^[+\d][\d\s().-]{6,19}$/.test(phone.trim())) return setMessage("Ingresa un teléfono válido.");
    setSaving(true); setMessage("");
    try {
      const userId = profile.uid || profile.id;
      const photoRef = ref(storage, `profile-photos/${userId}/avatar`);
      let photoURL = profile.photoURL || "";
      if (removePhoto || photoFile) { await deleteObject(photoRef).catch(() => {}); photoURL = ""; }
      if (photoFile) {
        if (!photoFile.type.startsWith("image/") || photoFile.size > 5 * 1024 * 1024) throw new Error("La foto debe ser una imagen de máximo 5 MB.");
        await uploadBytes(photoRef, photoFile, { contentType: photoFile.type });
        photoURL = await getDownloadURL(photoRef);
      }
      const savedPreferences = { ...preferences, mutedUntil: Number(preferences.muteDuration || 0) ? Date.now() + Number(preferences.muteDuration) : 0 };
      delete savedPreferences.muteDuration;
      await updateDoc(doc(db, "users", userId), { phone: phone.trim(), bio: bio.trim(), photoURL, notificationPreferences: savedPreferences, profileUpdatedAt: serverTimestamp() });
      await onProfileUpdated(); setMessage("Cambios guardados correctamente."); setPhotoFile(null); setRemovePhoto(false);
    } catch (error) { setMessage(error?.message || "No se pudieron guardar los cambios."); }
    finally { setSaving(false); }
  }
  return (
    <form className="profile-page printshop-page" onSubmit={saveProfile}>
      <section className="profile-module-topbar printshop-topbar"><div className="printshop-topbar-main"><span className="printshop-topbar-module-icon"><DashboardNavIcon name="collaborators" /></span><div className="printshop-topbar-copy"><p className="section-kicker">CUENTA PERSONAL</p><h1>Mi perfil</h1><p>Administra tus datos y notificaciones internas.</p></div></div><button type="button" className="visual-outline-button profile-back-button" onClick={onClose}>← Volver</button></section>

      <div className="profile-content-grid">
        <section className="profile-section-card profile-photo-card">
          <ProfileSectionTitle title="Foto de perfil" text="Visible en encabezado y avatares del sistema." />
          <div className="profile-photo-editor">
            <div className="profile-page-avatar"><UserAvatar profile={{ ...profile, photoURL: removePhoto ? "" : profile.photoURL }} preview={photoPreview} /></div>
            <strong>{profile?.name || "Usuario"}</strong>
            <div className="profile-photo-actions"><label className="visual-outline-button">Cambiar foto<input hidden type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0] || null; setPhotoFile(file); setPhotoPreview(file ? URL.createObjectURL(file) : ""); setRemovePhoto(false); }} /></label>{(profile.photoURL || photoFile) && <button type="button" className="profile-remove-photo" onClick={() => { setPhotoFile(null); setPhotoPreview(""); setRemovePhoto(true); }}>Eliminar</button>}</div>
            <small>JPG, PNG o WebP. Máximo 5 MB.</small>
          </div>
          <label className="profile-bio-field"><span>Sobre mí</span><textarea rows="5" maxLength="400" value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Escribe una breve presentación personal." /><small>{bio.length}/400</small></label>
        </section>

        <section className="profile-section-card profile-personal-card">
          <ProfileSectionTitle title="Información personal" text="Datos básicos de contacto." />
          <div className="profile-fields-grid"><ProfileInfoItem label="Nombre" value={profile?.name} /><label className="profile-edit-field"><span>Teléfono</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+52 664 123 4567" /></label></div>
        </section>

        <section className="profile-section-card profile-account-card">
          <ProfileSectionTitle title="Cuenta y privilegios" text="Información administrada por el sistema." />
          <div className="profile-fields-grid"><ProfileInfoItem label="Correo" value={profile?.email} /><ProfileInfoItem label="Área" value={profile?.area} /><ProfileInfoItem label="Privilegio" value={isAdmin ? "Administrador" : getRoleLabel(profile?.role)} /><ProfileInfoItem label="Estado" value={profile?.active === false ? "Inactivo" : "Activo"} /></div>
        </section>

        <section className="profile-section-card profile-notifications-card">
          <ProfileSectionTitle title="Configuración de notificaciones" text="Controla únicamente sonidos internos de esta aplicación." />
          <div className="profile-notification-settings"><label className="profile-toggle-field"><input type="checkbox" checked={preferences.soundsEnabled} onChange={(e) => setPreferences({ ...preferences, soundsEnabled: e.target.checked })} /> Activar sonidos</label><label>Tono<select value={preferences.tone} onChange={(e) => setPreferences({ ...preferences, tone: e.target.value })}>{NOTIFICATION_TONES.map((tone) => <option key={tone.id} value={tone.id}>{tone.label}</option>)}</select></label><label>Volumen: {preferences.volume}%<input type="range" min="0" max="100" value={preferences.volume} onChange={(e) => setPreferences({ ...preferences, volume: Number(e.target.value) })} /></label><label>Silenciar temporalmente<select value={preferences.muteDuration || 0} onChange={(e) => setPreferences({ ...preferences, muteDuration: Number(e.target.value) })}><option value="0">No silenciar</option><option value="3600000">1 hora</option><option value="28800000">8 horas</option><option value="86400000">24 horas</option></select></label><button type="button" className="visual-outline-button profile-preview-button" onClick={() => playMessageNotificationSound({ ...preferences, soundsEnabled: true, mutedUntil: 0 })}>Escuchar vista previa</button></div>
        </section>
      </div>
      <div className="profile-page-footer">{message && <p className="profile-save-message" role="status">{message}</p>}<div className="profile-save-actions"><button className="visual-primary-button" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</button></div></div>
    </form>
  );
}

const NOTIFICATION_TONES = [
  { id: "classic", label: "Clásico", wave: "triangle", notes: [{ start: 0, frequency: 880, endFrequency: 660, duration: 0.18 }, { start: 0.24, frequency: 1040, endFrequency: 780, duration: 0.2 }] },
  { id: "soft", label: "Suave", wave: "sine", notes: [{ start: 0, frequency: 620, endFrequency: 520, duration: 0.28 }] },
  { id: "bright", label: "Brillante", wave: "triangle", notes: [{ start: 0, frequency: 1040, endFrequency: 1320, duration: 0.14 }, { start: 0.17, frequency: 1320, endFrequency: 1560, duration: 0.16 }] },
  { id: "bell", label: "Campana", wave: "sine", notes: [{ start: 0, frequency: 784, endFrequency: 740, duration: 0.42 }] },
  { id: "double", label: "Doble aviso", wave: "square", notes: [{ start: 0, frequency: 720, endFrequency: 720, duration: 0.1 }, { start: 0.16, frequency: 720, endFrequency: 720, duration: 0.1 }] },
  { id: "ascending", label: "Ascendente", wave: "triangle", notes: [{ start: 0, frequency: 520, endFrequency: 720, duration: 0.16 }, { start: 0.18, frequency: 720, endFrequency: 980, duration: 0.18 }] },
  { id: "digital", label: "Digital", wave: "square", notes: [{ start: 0, frequency: 980, endFrequency: 860, duration: 0.08 }, { start: 0.11, frequency: 1180, endFrequency: 1020, duration: 0.09 }] },
  { id: "calm", label: "Calmado", wave: "sine", notes: [{ start: 0, frequency: 440, endFrequency: 392, duration: 0.38 }, { start: 0.3, frequency: 523, endFrequency: 466, duration: 0.32 }] },
  { id: "pulse", label: "Pulso", wave: "sawtooth", notes: [{ start: 0, frequency: 660, endFrequency: 620, duration: 0.09 }, { start: 0.13, frequency: 660, endFrequency: 620, duration: 0.09 }, { start: 0.26, frequency: 820, endFrequency: 760, duration: 0.12 }] },
  { id: "chime", label: "Armonía", wave: "sine", notes: [{ start: 0, frequency: 659, endFrequency: 622, duration: 0.32 }, { start: 0.14, frequency: 784, endFrequency: 740, duration: 0.34 }, { start: 0.28, frequency: 988, endFrequency: 932, duration: 0.36 }] },
];

function UserAvatar({ profile, preview = "" }) {
  return preview || profile?.photoURL ? <img className="user-avatar-image" src={preview || profile.photoURL} alt="Foto de perfil" /> : getInitials(profile?.name);
}

function ProfileSectionTitle({ title, text }) {
  return <div className="profile-section-title"><h2>{title}</h2><p>{text}</p></div>;
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
