import { useCallback, useMemo, useRef, useState } from "react";
import { useEditorialEditorState } from "../hooks/useEditorialEditorState";
import { useEditorialProject } from "../hooks/useEditorialProject";
import { useEditorialShortcuts } from "../hooks/useEditorialShortcuts";
import { formatInches, getPageSizePreset, getProjectTypeLabel } from "../models/editorialModels";
import { updateEditorialProjectConfig } from "../services/editorialProjectsService";
import { clampZoom, getPageMetrics } from "../utils/editorialMeasurements";
import EditorialIcon from "./EditorialIcon";
import EditorialProjectDialog from "./EditorialProjectDialog";
import EditorialEditorToolbar from "./editor/EditorialEditorToolbar";
import EditorialInspectorPanel from "./editor/EditorialInspectorPanel";
import EditorialWorkspace from "./editor/EditorialWorkspace";

const RAIL_ITEMS = [
  ["projects", "Proyectos"],
  ["books", "Libros"],
  ["material", "Material"],
  ["templates", "Plantillas"],
  ["resources", "Recursos"],
  ["components", "Componentes"],
  ["styles", "Estilos"],
  ["reviews", "Revisiones"],
  ["approvals", "Aprobaciones"],
];

function getInitials(profile) {
  return (profile?.name || profile?.email || "U")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getPages(documents) {
  return documents.flatMap((document) => document.pages.map((page) => ({
    ...page,
    documentId: document.id,
    documentName: document.name,
  })));
}

function StructurePanel({ activeRail, documents, selectedPageId, onSelectPage }) {
  if (activeRail !== "books") {
    const label = RAIL_ITEMS.find(([name]) => name === activeRail)?.[1] || "Panel";
    return (
      <aside className="editorial-structure-panel">
        <header><strong>{label}</strong></header>
        <div className="editorial-panel-empty"><EditorialIcon name={activeRail} size={28} /><p>Sin contenido en este proyecto.</p></div>
      </aside>
    );
  }

  return (
    <aside className="editorial-structure-panel">
      <section className="editorial-tree-section">
        <header><strong>Estructura del libro</strong><EditorialIcon name="chevron" size={15} /></header>
        <div className="editorial-tree-list">
          {documents.map((document) => (
            <div key={document.id} className="editorial-tree-document">
              <div className="editorial-tree-row document"><EditorialIcon name="books" size={15} /><span>{document.name}</span></div>
              {document.pages.map((page) => (
                <button type="button" className={`editorial-tree-row page ${selectedPageId === page.id ? "active" : ""}`} key={page.id} onClick={() => onSelectPage(page.id)}>
                  <EditorialIcon name="page" size={14} /><span>{page.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section className="editorial-pages-side-section">
        <header><strong>Páginas</strong><span>{getPages(documents).length}</span></header>
        <div className="editorial-side-thumbnails">
          {getPages(documents).map((page) => (
            <button type="button" key={page.id} className={selectedPageId === page.id ? "active" : ""} onClick={() => onSelectPage(page.id)}>
              <span className="editorial-page-mini"><small>{page.number}</small></span><span>{page.number}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function BottomPanel({ documents, selectedPageId, onSelectPage, project }) {
  const pages = getPages(documents);
  const size = getPageSizePreset(project.size);
  return (
    <footer className="editorial-bottom-panel">
      <section className="editorial-bottom-pages">
        <header>Páginas</header>
        <div>{pages.map((page) => <button type="button" key={page.id} className={selectedPageId === page.id ? "active" : ""} onClick={() => onSelectPage(page.id)}><span className="editorial-bottom-page-paper" /><small>{page.number}</small></button>)}</div>
      </section>
      <section className="editorial-print-data">
        <header>Datos de impresión</header>
        <dl>
          <div><dt>Tamaño</dt><dd>{size.label}</dd></div>
          <div><dt>Sangrado</dt><dd>{formatInches(project.bleedIn)}</dd></div>
          <div><dt>Márgenes</dt><dd>{formatInches(project.margins?.top)}</dd></div>
          <div><dt>Páginas</dt><dd>{pages.length}</dd></div>
        </dl>
      </section>
      <section className="editorial-print-guides">
        <header>Guías de impresión</header>
        <p><span className="bleed" /> Sangrado</p><p><span className="margin" /> Área segura y márgenes</p>
      </section>
      <section className="editorial-quick-view"><header>Vista rápida</header><span className="editorial-quick-paper"><i /></span></section>
    </footer>
  );
}

function QuickPreview({ project, onClose }) {
  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar vista rápida" />
      <section className="editorial-quick-preview-dialog" role="dialog" aria-modal="true" aria-label="Vista rápida">
        <header><div><span className="editorial-eyebrow">Vista rápida</span><h2>{project.name}</h2></div><button type="button" className="editorial-icon-button" onClick={onClose} aria-label="Cerrar"><EditorialIcon name="close" /></button></header>
        <div className={`editorial-preview-paper ${project.orientation}`}><span>1</span></div>
        <p>Vista estructural. Elementos permanecen editables en Firestore.</p>
      </section>
    </div>
  );
}

function EditorialEditorReady({ project, documents, profile, theme, onToggleTheme, onBack }) {
  const pages = useMemo(() => getPages(documents), [documents]);
  const [selectedPageId, setSelectedPageId] = useState(() => pages[0]?.id || "");
  const activePage = pages.find((page) => page.id === selectedPageId) || pages[0];
  const context = useMemo(() => ({
    projectId: project.id,
    documentId: activePage.documentId,
    pageId: activePage.id,
  }), [activePage.documentId, activePage.id, project.id]);
  const editor = useEditorialEditorState({ context, user: profile });
  useEditorialShortcuts(editor.actions);

  const workspaceRef = useRef(null);
  const [activeRail, setActiveRail] = useState("books");
  const [activeInspector, setActiveInspector] = useState("Propiedades");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [zoom, setZoomState] = useState(0.75);
  const [viewMode, setViewMode] = useState("single");
  const [showRulers, setShowRulers] = useState(true);
  const [guideSettings, setGuideSettings] = useState({ bleed: true, cut: true, safe: true, margins: true, gutter: true });
  const metrics = useMemo(() => getPageMetrics(project), [project]);
  const setZoom = useCallback((value) => setZoomState(clampZoom(value)), []);

  async function handleSelectPage(pageId) {
    if (pageId === activePage.id) return;
    try {
      await editor.flush();
      editor.select("");
      setSelectedPageId(pageId);
    } catch {
      setActiveInspector("Propiedades");
    }
  }

  async function handleBack() {
    try {
      await editor.flush();
      onBack();
    } catch {
      setActiveInspector("Propiedades");
    }
  }

  async function handleSaveConfig(form) {
    editor.reportStatus("saving");
    setSaveError("");
    try {
      await editor.flush();
      await updateEditorialProjectConfig(project.id, form, profile);
      editor.reportStatus("saved");
      setConfigOpen(false);
    } catch (error) {
      editor.reportStatus("error", error.message);
      setSaveError(error.message || "No fue posible guardar los cambios.");
    }
  }

  const statusLabels = { idle: "Sin cambios", saving: "Guardando…", saved: "Guardado", error: "Error al guardar" };
  const zoomProps = {
    zoom,
    viewMode,
    showRulers,
    guideSettings,
    onZoomChange: setZoom,
    onFit: (mode) => workspaceRef.current?.fit(mode),
    onViewModeChange: setViewMode,
    onShowRulersChange: setShowRulers,
    onGuideSettingsChange: setGuideSettings,
  };

  return (
    <div className={`editorial-editor-shell ${leftOpen ? "left-open" : "left-closed"} ${rightOpen ? "right-open" : "right-closed"} ${bottomOpen ? "bottom-open" : "bottom-closed"}`}>
      <header className="editorial-editor-topbar">
        <button type="button" className="editorial-editor-brand" onClick={handleBack} aria-label="Volver a proyectos editoriales"><img src="/active-logo.png" alt="AES" /><strong>AES</strong><span>Editor Editorial</span><EditorialIcon name="chevron" size={14} /></button>
        <div className="editorial-editor-breadcrumb"><span>{getProjectTypeLabel(project.type)}</span><EditorialIcon name="chevron" size={13} /><strong>{project.name}</strong></div>
        <div className="editorial-editor-top-actions">
          <span className={`editorial-save-status ${editor.saveStatus}`} title={editor.saveError || statusLabels[editor.saveStatus]}><i />{statusLabels[editor.saveStatus]}</span>
          <button type="button" className="editorial-top-action-button" onClick={() => setQuickPreviewOpen(true)}><EditorialIcon name="eye" size={17} /> Vista rápida</button>
          <button type="button" className="editorial-top-icon-button" onClick={onToggleTheme} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}><EditorialIcon name={theme === "dark" ? "sun" : "moon"} /></button>
          <span className="editorial-user-avatar">{getInitials(profile)}</span>
        </div>
      </header>

      <div className="editorial-editor-menubar" aria-label="Menú editorial"><span>Archivo</span><span>Editar</span><span>Ver</span><span>Insertar</span><span>Formato</span><span>Disposición</span><span>Texto</span><span>Tabla</span><span>Herramientas</span></div>

      <EditorialEditorToolbar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        bottomOpen={bottomOpen}
        selectedElement={editor.selectedElement}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        zoomProps={zoomProps}
        actions={editor.actions}
        onToggleLeft={() => setLeftOpen((value) => !value)}
        onToggleRight={() => setRightOpen((value) => !value)}
        onToggleBottom={() => setBottomOpen((value) => !value)}
        onOpenConfig={() => setConfigOpen(true)}
      />

      <nav className="editorial-editor-rail" aria-label="Navegación editorial">
        {RAIL_ITEMS.map(([name, label]) => <button type="button" className={activeRail === name ? "active" : ""} onClick={() => setActiveRail(name)} key={name}><EditorialIcon name={name} /><span>{label}</span></button>)}
        <button type="button" className="editorial-rail-back" onClick={handleBack}><EditorialIcon name="arrowLeft" /><span>Proyectos</span></button>
      </nav>

      {leftOpen && <StructurePanel activeRail={activeRail} documents={documents} selectedPageId={activePage.id} onSelectPage={handleSelectPage} />}
      <EditorialWorkspace ref={workspaceRef} metrics={metrics} zoom={zoom} viewMode={viewMode} showRulers={showRulers} guideSettings={guideSettings} elements={editor.elements} selectedElement={editor.selectedElement} onZoomChange={setZoom} onSelect={editor.select} onChange={editor.actions.updateElement} />
      {rightOpen && <EditorialInspectorPanel activeTab={activeInspector} onChangeTab={setActiveInspector} editor={editor} />}
      {bottomOpen && <BottomPanel documents={documents} selectedPageId={activePage.id} onSelectPage={handleSelectPage} project={project} />}

      <EditorialProjectDialog key={configOpen ? `config-${project.updatedAt?.seconds || "open"}` : "config-closed"} open={configOpen} title="Configuración editorial" submitLabel="Guardar cambios" initialProject={project} busy={editor.saveStatus === "saving"} error={saveError} onClose={() => { setConfigOpen(false); setSaveError(""); }} onSubmit={handleSaveConfig} />
      {quickPreviewOpen && <QuickPreview project={project} onClose={() => setQuickPreviewOpen(false)} />}
    </div>
  );
}

export default function EditorialEditorShell({ projectId, profile, theme, onToggleTheme, onBack }) {
  const { project, documents, loading, error } = useEditorialProject(projectId);

  if (loading) return <div className="editorial-editor-state"><span className="editorial-spinner" /><strong>Abriendo editor…</strong></div>;
  if (error || !project) return <div className="editorial-editor-state error"><EditorialIcon name="info" size={32} /><strong>No fue posible abrir el proyecto</strong><p>{error}</p><button type="button" className="editorial-button primary" onClick={onBack}>Volver a proyectos</button></div>;
  if (getPages(documents).length === 0) return <div className="editorial-editor-state error"><EditorialIcon name="page" size={32} /><strong>Proyecto sin página inicial</strong><p>Crea nuevamente el proyecto para generar estructura válida.</p><button type="button" className="editorial-button primary" onClick={onBack}>Volver a proyectos</button></div>;

  return <EditorialEditorReady project={project} documents={documents} profile={profile} theme={theme} onToggleTheme={onToggleTheme} onBack={onBack} />;
}
