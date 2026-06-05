import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import CreateProject from "./CreateProject";
import MyProjects from "./MyProjects";
import AllProjects from "./AllProjects";
import ProjectDetail from "./ProjectDetail";
import EditProject from "./EditProject";
import ExecutiveDashboard from "./ExecutiveDashboard";

export default function Dashboard() {
  const { profile, logout, isAdmin } = useAuth();

  const [page, setPage] = useState(
    isAdmin ? "executive-dashboard" : "my-projects"
  );
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  function goToPage(nextPage) {
    setSelectedProjectId(null);
    setPage(nextPage);
  }

  function openProject(projectId) {
    setSelectedProjectId(projectId);
    setPage("project-detail");
  }

  function editProject(projectId) {
    setSelectedProjectId(projectId);
    setPage("edit-project");
  }

  function backToProjects() {
    setSelectedProjectId(null);
    setPage(isAdmin ? "all-projects" : "my-projects");
  }

  function renderPage() {
    if (page === "executive-dashboard" && isAdmin) {
      return <ExecutiveDashboard onOpenProject={openProject} />;
    }

    if (page === "create-project" && isAdmin) {
      return <CreateProject />;
    }

    if (page === "all-projects" && isAdmin) {
      return <AllProjects onOpenProject={openProject} />;
    }

    if (page === "edit-project") {
      if (!selectedProjectId) {
        return (
          <div className="card">
            <h2>No se seleccionó ningún proyecto</h2>
            <p>Regresa al listado de proyectos y selecciona uno para editarlo.</p>

            <button onClick={backToProjects}>
              Volver a proyectos
            </button>
          </div>
        );
      }

      return (
        <EditProject
          projectId={selectedProjectId}
          onBack={() => {
            setPage("project-detail");
          }}
          onSaved={() => {
            setPage("project-detail");
          }}
        />
      );
    }

    if (page === "project-detail") {
      if (!selectedProjectId) {
        return (
          <div className="card">
            <h2>No se seleccionó ningún proyecto</h2>
            <p>Regresa al listado de proyectos y selecciona uno para verlo.</p>

            <button onClick={backToProjects}>
              Volver a proyectos
            </button>
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <small>Active English School</small>
          <h1>Desarrollo de Proyectos</h1>
        </div>

        <div className="user-box">
          <strong>{profile?.name || "Usuario sin perfil"}</strong>
          <span>
            {profile?.role || "Sin rol"} · {profile?.area || "Sin área"}
          </span>
        </div>

        <nav>
          {isAdmin && (
            <button
              className={page === "executive-dashboard" ? "active" : ""}
              onClick={() => goToPage("executive-dashboard")}
            >
              Dashboard ejecutivo
            </button>
          )}

          <button
            className={page === "my-projects" ? "active" : ""}
            onClick={() => goToPage("my-projects")}
          >
            Mis proyectos
          </button>

          {isAdmin && (
            <>
              <button
                className={page === "all-projects" ? "active" : ""}
                onClick={() => goToPage("all-projects")}
              >
                Todos los proyectos
              </button>

              <button
                className={page === "create-project" ? "active" : ""}
                onClick={() => goToPage("create-project")}
              >
                Alta de proyecto
              </button>
            </>
          )}
        </nav>

        <button className="logout-button" onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="main-content">{renderPage()}</main>
    </div>
  );
}