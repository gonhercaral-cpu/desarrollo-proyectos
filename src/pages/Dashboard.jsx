import { useEffect, useState } from "react";
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
import DepartmentsAdmin from "../components/DepartmentsAdmin";

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

  const [page, setPage] = useState(
    isAdmin ? "executive-dashboard" : "my-projects"
  );
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [returnPage, setReturnPage] = useState(
    isAdmin ? "all-projects" : "my-projects"
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);

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
    setSelectedProjectId(null);
    setPage(nextPage);
    setReturnPage(nextPage);
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
  }

  function openProject(projectId) {
    setSelectedProjectId(projectId);

    if (page === "project-history") {
      setReturnPage("project-history");
    } else if (page === "my-projects") {
      setReturnPage("my-projects");
    } else if (page === "executive-dashboard") {
      setReturnPage("executive-dashboard");
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
    } else {
      setReturnPage(isAdmin ? "all-projects" : "my-projects");
    }

    setPage("project-detail");
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
  }

  function editProject(projectId) {
    setSelectedProjectId(projectId);
    setPage("edit-project");
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
  }

  function backToProjects() {
    setSelectedProjectId(null);
    setPage(returnPage || (isAdmin ? "all-projects" : "my-projects"));
    setProfileMenuOpen(false);
    setProfilePanelOpen(false);
  }

  function handleViewProfile() {
    setProfilePanelOpen(true);
    setProfileMenuOpen(false);
  }

  function handleLogout() {
    setProfileMenuOpen(false);
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

    if (page === "executive-dashboard" && isAdmin) {
      return <ExecutiveDashboard onOpenProject={openProject} />;
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

    return page === navPage;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand-panel">
          <img
            src="/active-logo.png"
            alt="Active English School"
            className="sidebar-logo"
          />

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
              <span className="nav-icon">▦</span>
              Dashboard ejecutivo
            </button>
          )}

          <button
            className={isNavActive("my-projects") ? "active" : ""}
            onClick={() => goToPage("my-projects")}
          >
            <span className="nav-icon">▱</span>
            Mis proyectos
          </button>

          <button
            className={isNavActive("team-agenda") ? "active" : ""}
            onClick={() => goToPage("team-agenda")}
          >
            <span className="nav-icon">🗓️</span>
            Agenda del equipo
          </button>

          <button
            className={isNavActive("purchase-requests") ? "active" : ""}
            onClick={() => goToPage("purchase-requests")}
          >
            <span className="nav-icon">🛒</span>
            Solicitudes de compra
          </button>

          {canUsePrintShop && (
            <button
              className={isNavActive("print-shop") ? "active" : ""}
              onClick={() => goToPage("print-shop")}
            >
              <span className="nav-icon">▣</span>
              Imprenta
            </button>
          )}

          {canUseTechnicalSupport && (
            <button
              className={isNavActive("technical-support") ? "active" : ""}
              onClick={() => goToPage("technical-support")}
            >
              <span className="nav-icon">◈</span>
              Soporte Técnico
            </button>
          )}

          {isAdmin && (
            <>
              <button
                className={isNavActive("all-projects") ? "active" : ""}
                onClick={() => goToPage("all-projects")}
              >
                <span className="nav-icon">☰</span>
                Todos los proyectos
              </button>

              <button
                className={
                  isNavActive("collaborators-admin") ? "active" : ""
                }
                onClick={() => goToPage("collaborators-admin")}
              >
                <span className="nav-icon">☷</span>
                Colaboradores
              </button>

              <button
                className={isNavActive("departments-admin") ? "active" : ""}
                onClick={() => goToPage("departments-admin")}
              >
                <span className="nav-icon">▤</span>
                Departamentos
              </button>

              <button
                className={isNavActive("project-history") ? "active" : ""}
                onClick={() => goToPage("project-history")}
              >
                <span className="nav-icon">◴</span>
                Historial
              </button>

              <button
                className={isNavActive("create-project") ? "active" : ""}
                onClick={() => goToPage("create-project")}
              >
                <span className="nav-icon">＋</span>
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