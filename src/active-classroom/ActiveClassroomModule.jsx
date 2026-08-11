import { useMemo, useState } from "react";
import { FuturePanel, SettingsPanel, TeamsPanel } from "./components/AccessPanel";
import ActiveClassroomNavigation from "./components/ActiveClassroomNavigation";
import FolderDialog from "./components/FolderDialog";
import LibraryTable from "./components/LibraryTable";
import LibraryToolbar from "./components/LibraryToolbar";
import PublicationsPanel from "./components/PublicationsPanel";
import ResourceInspector from "./components/ResourceInspector";
import ActiveClassroomIcon from "./components/ActiveClassroomIcon";
import useActiveClassroomLibrary from "./hooks/useActiveClassroomLibrary";
import {
  ACTIVE_CLASSROOM_FUTURE_SECTIONS,
  ACTIVE_CLASSROOM_SECTIONS,
} from "./constants";
import "./styles/active-classroom.css";

const FUTURE_TITLES = {
  announcements: "Panel de anuncios",
  observations: "Observaciones",
  suggestions: "Sugerencias",
};

export default function ActiveClassroomModule({ profile }) {
  const library = useActiveClassroomLibrary(profile);
  const [activeSection, setActiveSection] = useState("library");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("name");
  const [viewMode, setViewMode] = useState("grid");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [dialogState, setDialogState] = useState({ open: false, folder: null });
  const [toast, setToast] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const activeNavigationItem = [...ACTIVE_CLASSROOM_SECTIONS, ...ACTIVE_CLASSROOM_FUTURE_SECTIONS]
    .find((section) => section.id === activeSection);

  const visibleItems = useMemo(() => library.getVisibleItems({
    searchTerm,
    typeFilter,
    statusFilter,
    sortMode,
  }), [library, searchTerm, sortMode, statusFilter, typeFilter]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function clearFilters() {
    setSearchTerm("");
    setTypeFilter("all");
    setStatusFilter("all");
    setSortMode("name");
  }

  async function handleFolderSubmit(name) {
    try {
      if (dialogState.folder) {
        await library.renameUnit(dialogState.folder.id, name);
        showToast(`Unit renombrada: ${name.trim()}`);
      } else {
        await library.createUnit(name);
        showToast(`Unit creada: ${name.trim()}`);
      }
      setDialogState({ open: false, folder: null });
    } catch (error) {
      showToast(error?.message || "No se pudo guardar Unit.");
    }
  }

  async function handleDeleteFolder(folder) {
    const confirmed = window.confirm(
      `Eliminar ${folder.name}? Solo puede borrarse si no contiene archivos.`
    );
    if (!confirmed) return;

    try {
      await library.removeUnit(folder.id);
      showToast(`${folder.name} eliminada.`);
    } catch (error) {
      showToast(error?.message || "No se pudo eliminar Unit.");
    }
  }

  async function handleUpload(files) {
    try {
      const uploaded = await library.uploadFiles(files);
      showToast(`${uploaded.length} archivo${uploaded.length === 1 ? "" : "s"} subido${uploaded.length === 1 ? "" : "s"}.`);
    } catch (error) {
      showToast(error?.message || "No se pudieron subir archivos.");
    }
  }

  async function handleTogglePublished(resource) {
    try {
      await library.togglePublished(resource);
      showToast(resource.published ? "Recurso movido a borrador." : "Recurso publicado.");
    } catch (error) {
      showToast(error?.message || "No se pudo cambiar publicación.");
    }
  }

  async function handleDeleteResource(resource) {
    const confirmed = window.confirm(
      `Eliminar definitivamente "${resource.name}" de Active Classroom?`
    );
    if (!confirmed) return;

    try {
      await library.removeResource(resource);
      showToast("Recurso eliminado de Firestore y Storage.");
    } catch (error) {
      showToast(error?.message || "No se pudo eliminar recurso.");
    }
  }

  function handlePublicationSelection(resourceId) {
    const resource = library.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    library.openFolder(resource.folderId);
    library.setSelectedResourceId(resourceId);
    setActiveSection("library");
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    if (library.selectedFolder?.kind !== "unit") {
      showToast("Abre una Unit antes de soltar archivos.");
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) void handleUpload(files);
  }

  function renderLibrary() {
    return (
      <section className="ac-drive-page">
        <header className="ac-drive-heading">
          <div className="ac-drive-title">
            <div className="ac-product-label">
              <span className="ac-product-mark">ac</span>
              <strong>Active Classroom</strong>
            </div>
            <div className="ac-title-line">
              <h1>Biblioteca</h1>
              <span className="ac-cloud-chip">Catálogo compartido</span>
            </div>
            <p>Gestiona y organiza los recursos educativos de tu institución.</p>
          </div>
        </header>

        {library.breadcrumbs.length > 0 && (
          <nav className="ac-breadcrumb" aria-label="Ruta de biblioteca">
            <button type="button" onClick={() => library.openFolder("root")}>Biblioteca</button>
            {library.breadcrumbs.map((folder) => (
              <span key={folder.id}>
                <i>/</i>
                <button
                  type="button"
                  aria-current={folder.id === library.selectedFolderId ? "page" : undefined}
                  onClick={() => library.openFolder(folder.id)}
                >
                  {folder.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        <div className="ac-drive-layout">
          <section
            className={`ac-drive-library ${dragActive ? "is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <LibraryToolbar
              selectedFolder={library.selectedFolder}
              searchTerm={searchTerm}
              typeFilter={typeFilter}
              statusFilter={statusFilter}
              sortMode={sortMode}
              viewMode={viewMode}
              filtersOpen={filtersOpen}
              saving={library.saving}
              onSearchChange={setSearchTerm}
              onTypeFilterChange={setTypeFilter}
              onStatusFilterChange={setStatusFilter}
              onSortModeChange={setSortMode}
              onViewModeChange={setViewMode}
              onFiltersOpenChange={setFiltersOpen}
              onClearFilters={clearFilters}
              onCreateFolder={() => setDialogState({ open: true, folder: null })}
              onUploadFiles={handleUpload}
            />

            {dragActive && (
              <div className="ac-drop-overlay">
                <strong>Suelta archivos en esta Unit</strong>
                <small>Se guardarán en Firebase Storage.</small>
              </div>
            )}

            <LibraryTable
              folders={visibleItems.folders}
              resources={visibleItems.resources}
              selectedResourceId={library.selectedResourceId}
              viewMode={viewMode}
              onOpenFolder={library.openFolder}
              onSelectResource={library.setSelectedResourceId}
              onRenameFolder={(folder) => setDialogState({ open: true, folder })}
              onDeleteFolder={handleDeleteFolder}
            />
          </section>

          <ResourceInspector
            resource={library.selectedResource}
            saving={library.saving}
            onTogglePublished={handleTogglePublished}
            onDelete={handleDeleteResource}
          />
        </div>
      </section>
    );
  }

  function renderSection() {
    if (library.loading) {
      return <div className="ac-module-state"><span className="ac-spinner" /><strong>Cargando Active Classroom...</strong></div>;
    }
    if (activeSection === "library") return renderLibrary();
    if (activeSection === "publications") {
      return (
        <PublicationsPanel
          resources={library.resources}
          folders={library.folders}
          saving={library.saving}
          onTogglePublished={handleTogglePublished}
          onSelectResource={handlePublicationSelection}
        />
      );
    }
    if (activeSection === "teams") return <TeamsPanel profile={profile} />;
    if (activeSection === "settings") return <SettingsPanel />;
    return <FuturePanel title={FUTURE_TITLES[activeSection] || "Módulo futuro"} />;
  }

  return (
    <section className="ac-module">
      <nav className="ac-module-breadcrumb" aria-label="Ubicación actual">
        <ActiveClassroomIcon name="home" size={16} />
        <span>Active Classroom</span>
        <ActiveClassroomIcon name="chevron" size={14} />
        <strong>{activeNavigationItem?.label || "Biblioteca"}</strong>
      </nav>
      <ActiveClassroomNavigation activeSection={activeSection} onChange={setActiveSection} />
      <main className="ac-module-main">
        {library.error && (
          <div className="ac-error-banner" role="alert">
            <span>{library.error}</span>
            <button type="button" onClick={() => library.setError("")} aria-label="Cerrar aviso">×</button>
          </div>
        )}
        {renderSection()}
      </main>

      {dialogState.open && (
        <FolderDialog
          key={dialogState.folder?.id || "new-unit"}
          folder={dialogState.folder}
          saving={library.saving}
          onClose={() => setDialogState({ open: false, folder: null })}
          onSubmit={handleFolderSubmit}
        />
      )}

      <div className={`ac-toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </section>
  );
}
