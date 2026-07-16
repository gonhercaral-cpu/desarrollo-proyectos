import { useState } from "react";
import { useEditorialProjects } from "../hooks/useEditorialProjects";
import { getProjectTypeLabel, getPageSizePreset } from "../models/editorialModels";
import {
  createEditorialProject,
  deleteEditorialProject,
  duplicateEditorialProject,
  renameEditorialProject,
  setEditorialProjectArchived,
} from "../services/editorialProjectsService";
import EditorialConfirmDialog from "./EditorialConfirmDialog";
import EditorialIcon from "./EditorialIcon";
import EditorialProjectDialog from "./EditorialProjectDialog";

function formatProjectDate(value) {
  const date = value?.toDate?.();
  if (!date) return "Actualización pendiente";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getInitials(profile) {
  const source = profile?.name || profile?.email || "Usuario";
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function EditorialProjectsView({ profile, isAdmin, theme, onToggleTheme, onOpenProject }) {
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameProject, setRenameProject] = useState(null);
  const [deleteProject, setDeleteProject] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const { projects, visibleProjects, loading, error } = useEditorialProjects({
    profile,
    isAdmin,
    filter,
    search,
  });

  const activeCount = projects.filter((project) => project.archived !== true).length;
  const archivedCount = projects.filter((project) => project.archived === true).length;

  async function runAction(actionName, action) {
    setBusyAction(actionName);
    setActionError("");
    try {
      await action();
      return true;
    } catch (actionFailure) {
      setActionError(actionFailure.message || "No fue posible completar la acción.");
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreate(form) {
    const succeeded = await runAction("create", async () => {
      const projectId = await createEditorialProject(form, profile);
      setCreateOpen(false);
      onOpenProject(projectId);
    });
    if (succeeded) setCreateOpen(false);
  }

  async function handleRename(form) {
    const succeeded = await runAction(`rename:${renameProject.id}`, () =>
      renameEditorialProject(renameProject.id, form.name, profile)
    );
    if (succeeded) setRenameProject(null);
  }

  async function handleDelete() {
    const succeeded = await runAction(`delete:${deleteProject.id}`, () =>
      deleteEditorialProject(deleteProject.id, profile)
    );
    if (succeeded) setDeleteProject(null);
  }

  return (
    <div className="editorial-projects-page">
      <header className="editorial-projects-topbar">
        <button type="button" className="editorial-brand" onClick={() => window.location.assign("/")} aria-label="Volver al sistema">
          <img src="/active-logo.png" alt="AES" />
          <span><strong>AES</strong><small>Editor Editorial</small></span>
        </button>
        <div className="editorial-projects-top-actions">
          <button type="button" className="editorial-top-icon-button" onClick={onToggleTheme} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>
            <EditorialIcon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <span className="editorial-user-avatar" title={profile?.name || profile?.email}>{getInitials(profile)}</span>
        </div>
      </header>

      <main className="editorial-projects-main">
        <section className="editorial-projects-hero">
          <div>
            <span className="editorial-eyebrow">Producción académica</span>
            <h1>Proyectos editoriales</h1>
            <p>Crea y organiza libros, cuadernillos, evaluaciones y material didáctico.</p>
          </div>
          <button type="button" className="editorial-button primary create" onClick={() => { setActionError(""); setCreateOpen(true); }}>
            <EditorialIcon name="plus" size={18} /> Nuevo proyecto
          </button>
        </section>

        <section className="editorial-projects-toolbar" aria-label="Filtros de proyectos">
          <div className="editorial-project-tabs">
            <button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>Activos <span>{activeCount}</span></button>
            <button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Archivados <span>{archivedCount}</span></button>
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos <span>{projects.length}</span></button>
          </div>
          <label className="editorial-search-field">
            <EditorialIcon name="search" size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar proyecto" aria-label="Buscar proyecto" />
          </label>
        </section>

        {(error || actionError) && <p className="editorial-page-error" role="alert">{error || actionError}</p>}

        {loading ? (
          <div className="editorial-projects-state"><span className="editorial-spinner" /><strong>Cargando proyectos…</strong></div>
        ) : visibleProjects.length === 0 ? (
          <div className="editorial-projects-state empty">
            <span className="editorial-empty-icon"><EditorialIcon name="books" size={34} /></span>
            <strong>{search ? "Sin resultados" : filter === "archived" ? "No hay proyectos archivados" : "Crea tu primer proyecto editorial"}</strong>
            <p>{search ? "Prueba otro nombre." : "La configuración y estructura se guardarán en Firebase."}</p>
            {!search && filter !== "archived" && <button type="button" className="editorial-button primary" onClick={() => setCreateOpen(true)}>Crear proyecto</button>}
          </div>
        ) : (
          <div className="editorial-project-grid">
            {visibleProjects.map((project) => {
              const size = getPageSizePreset(project.size);
              const actionBusy = busyAction.endsWith(`:${project.id}`);
              const canManageProject = isAdmin || project.ownerUid === (profile?.uid || profile?.id);
              return (
                <article className="editorial-project-card" key={project.id}>
                  <button type="button" className="editorial-project-preview" onClick={() => onOpenProject(project.id)} aria-label={`Abrir ${project.name}`}>
                    <span className={`editorial-document-mockup type-${project.type}`}>
                      <small>AES</small>
                      <strong>{project.name}</strong>
                      <span>{getProjectTypeLabel(project.type)}</span>
                    </span>
                  </button>
                  <div className="editorial-project-card-body">
                    <div className="editorial-project-card-heading">
                      <div>
                        <span className="editorial-project-type">{getProjectTypeLabel(project.type)}</span>
                        <h2>{project.name}</h2>
                      </div>
                      {project.archived && <span className="editorial-archived-badge">Archivado</span>}
                    </div>
                    <div className="editorial-project-meta">
                      <span>{size.label}</span>
                      <span>{project.orientation === "landscape" ? "Horizontal" : "Vertical"}</span>
                      <span>{formatProjectDate(project.updatedAt || project.createdAt)}</span>
                    </div>
                    <div className="editorial-project-actions">
                      <button type="button" className="editorial-button compact primary" onClick={() => onOpenProject(project.id)}>Abrir</button>
                      <button type="button" className="editorial-icon-button" title="Editar nombre" aria-label={`Editar nombre de ${project.name}`} onClick={() => { setActionError(""); setRenameProject(project); }} disabled={actionBusy}><EditorialIcon name="edit" size={18} /></button>
                      <button type="button" className="editorial-icon-button" title="Duplicar" aria-label={`Duplicar ${project.name}`} onClick={() => runAction(`duplicate:${project.id}`, () => duplicateEditorialProject(project, profile))} disabled={actionBusy}><EditorialIcon name="copy" size={18} /></button>
                      {canManageProject && <button type="button" className="editorial-icon-button" title={project.archived ? "Restaurar" : "Archivar"} aria-label={`${project.archived ? "Restaurar" : "Archivar"} ${project.name}`} onClick={() => runAction(`archive:${project.id}`, () => setEditorialProjectArchived(project.id, !project.archived, profile))} disabled={actionBusy}><EditorialIcon name="archive" size={18} /></button>}
                      {canManageProject && <button type="button" className="editorial-icon-button danger" title="Eliminar" aria-label={`Eliminar ${project.name}`} onClick={() => { setActionError(""); setDeleteProject(project); }} disabled={actionBusy}><EditorialIcon name="trash" size={18} /></button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <EditorialProjectDialog key={createOpen ? "create-open" : "create-closed"} open={createOpen} title="Nuevo proyecto editorial" submitLabel="Crear proyecto" busy={busyAction === "create"} error={busyAction === "create" ? "" : actionError} onClose={() => setCreateOpen(false)} onSubmit={handleCreate} />
      <EditorialProjectDialog key={renameProject?.id || "rename-closed"} open={Boolean(renameProject)} title="Editar nombre" submitLabel="Guardar nombre" initialProject={renameProject} nameOnly busy={busyAction.startsWith("rename:")} error={busyAction.startsWith("rename:") ? "" : actionError} onClose={() => setRenameProject(null)} onSubmit={handleRename} />
      <EditorialConfirmDialog open={Boolean(deleteProject)} project={deleteProject} busy={busyAction.startsWith("delete:")} error={busyAction.startsWith("delete:") ? "" : actionError} onClose={() => setDeleteProject(null)} onConfirm={handleDelete} />
    </div>
  );
}
