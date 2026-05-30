import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import CreateProject from "./CreateProject";
import MyProjects from "./MyProjects";
import AllProjects from "./AllProjects";
import ProjectDetail from "./ProjectDetail";

export default function Dashboard() {
  const { profile, logout, isAdmin } = useAuth();

  const [page, setPage] = useState("my-projects");
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  function openProject(projectId) {
    setSelectedProjectId(projectId);
    setPage("project-detail");
  }

  function backToProjects() {
    setSelectedProjectId(null);
    setPage(isAdmin ? "all-projects" : "my-projects");
  }

  function renderPage() {
    if (page === "create-project") {
      return <CreateProject />;
    }

    if (page === "all-projects") {
      return <AllProjects onOpenProject={openProject} />;
    }

    if (page === "project-detail") {
      return (
        <ProjectDetail
          projectId={selectedProjectId}
          onBack={backToProjects}
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
          <button onClick={() => setPage("my-projects")}>
            Mis proyectos
          </button>

          {isAdmin && (
            <>
              <button onClick={() => setPage("all-projects")}>
                Todos los proyectos
              </button>

              <button onClick={() => setPage("create-project")}>
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