import { useMemo, useState } from "react";
import SettingsPanel from "./components/SettingsPanel";
import { readWebPreferences } from "./utils/webPreferences";
import TeamsPanel from "./components/TeamsPanel";
import ActiveClassroomNavigation from "./components/ActiveClassroomNavigation";
import FolderDialog from "./components/FolderDialog";
import UnitEditor from "./components/UnitEditor";
import LevelsPanel from "./components/LevelsPanel";
import ActiveClassroomIcon from "./components/ActiveClassroomIcon";
import useActiveClassroomLibrary from "./hooks/useActiveClassroomLibrary";
import { canClassroom } from "./utils/permissions";
import { unitCatalog, catalogMetrics, filterCatalog } from "./utils/catalog";
import useUnitCatalog from "./hooks/useUnitCatalog";
import { UnitCard, UnitInspector, PublicationTable } from "./components/UnitCatalog";
import { ClassroomHeader, ClassroomMetrics } from "./components/ConsoleLayout";
import "./styles/active-classroom.css";
import "./styles/console.css";

const sectionDetails = {
 library: ["Biblioteca", "Gestiona y organiza los recursos educativos de tu institución."],
 levels: ["Niveles", "Organiza los niveles académicos y su estructura de Units."],
 publications: ["Publicaciones", "Controla versiones, estados y despliegue del contenido educativo."],
 teams: ["Equipos", "Administra los dispositivos vinculados a Active Classroom."],
 settings: ["Ajustes", "Configura el módulo y administra permisos y preferencias."],
};
export default function ActiveClassroomModule({ profile }) {
  const library = useActiveClassroomLibrary(profile);
  const versions = useUnitCatalog(profile);
  const catalog = unitCatalog(library.folders, versions.documents, library.resources);
  const metrics = catalogMetrics(library.folders, catalog);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [importPicker, setImportPicker] = useState(false);
  const [levelCreation, setLevelCreation] = useState(0);
  const [reorder, setReorder] = useState(false);
  const [activeSection, setActiveSection] = useState("library");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState(() => readWebPreferences().sort);
  const [viewMode, setViewMode] = useState(() => readWebPreferences().view);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialogState, setDialogState] = useState({ open: false, folder: null });
  const [toast, setToast] = useState("");
  const [initialImport, setInitialImport] = useState(false);
  const [unitDirty, setUnitDirty] = useState(false);

  const visibleUnits = useMemo(() => filterCatalog(catalog, { search: searchTerm, type: typeFilter, status: statusFilter, sort: sortMode, level: library.selectedFolder?.kind === "level" ? library.selectedFolder.id : "" }), [catalog, searchTerm, typeFilter, statusFilter, sortMode, library.selectedFolder]);
  const inspected = catalog.find(unit => unit.id === selectedUnit) || visibleUnits[0];

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

  async function handleFolderSubmit(name, parentId) {
    try {
      if (dialogState.folder) {
        await library.renameUnit(dialogState.folder.id, name);
        showToast(`Unit renombrada: ${name.trim()}`);
      } else {
        await library.createUnit(name, parentId);
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

  function renderLibrary(publications = false) {
    return <>
      <ClassroomMetrics items={[{ title: "Niveles activos", value: metrics.levels, detail: `${library.folders.filter(folder => folder.kind === "level").length} niveles registrados`, icon: "library" }, { title: "Units publicadas", value: metrics.published, detail: "con versiones inmutables", icon: "publications", tone: "green" }, { title: publications ? "Borradores pendientes" : "Pendientes de actualizar", value: publications ? metrics.drafts : metrics.pending, detail: "cambios pendientes de publicar", icon: "refresh", tone: "orange" }]} />
      <div className="ac-console-layout"><section className="ac-console-panel">
        <div className="ac-console-toolbar"><label><ActiveClassroomIcon name="search" /><input value={searchTerm} placeholder="Buscar por nombre de Unit, nivel o contenido…" onChange={event => setSearchTerm(event.target.value)} /></label><select aria-label="Nivel" value={library.selectedFolder?.kind === "level" ? library.selectedFolder.id : ""} onChange={event => library.openFolder(event.target.value || "root")}><option value="">Todos los niveles</option>{library.folders.filter(folder => folder.kind === "level").map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select><select aria-label="Estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option>{["Publicado", "Borrador", "Procesando", "Actualización disponible", "Error"].map(state => <option key={state}>{state}</option>)}</select><select aria-label="Orden" value={sortMode} onChange={event => setSortMode(event.target.value)}><option value="name">Ordenar por: Nombre</option><option value="date">Última modificación</option></select><div className="ac-view-buttons"><button aria-label="Vista de lista" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}><ActiveClassroomIcon name="list" /></button><button aria-label="Vista de cuadrícula" className={viewMode === "grid" ? "is-active" : ""} onClick={() => setViewMode("grid")}><ActiveClassroomIcon name="grid" /></button></div><button className="ac-outline-button" onClick={() => setFiltersOpen(!filtersOpen)}><ActiveClassroomIcon name="filter" />Filtrar</button></div>
        {filtersOpen && <div className="ac-console-extra-filters"><select aria-label="Tipo de archivo" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">Todos los tipos</option>{["presentation", "image", "audio", "video", "pdf", "document"].map(type => <option key={type} value={type}>{({ presentation: "Presentación", image: "Imagen", audio: "Audio", video: "Video", pdf: "PDF", document: "Documento" })[type]}</option>)}</select><button onClick={clearFilters}>Limpiar filtros</button></div>}
        {publications || viewMode === "list" ? <PublicationTable units={visibleUnits} selected={inspected?.id} onSelect={setSelectedUnit} onOpen={library.openFolder} /> : <div className="ac-console-grid">{visibleUnits.map(unit => <UnitCard key={unit.id} unit={unit} selected={inspected?.id === unit.id} resources={library.resources} onSelect={setSelectedUnit} onOpen={library.openFolder} onRename={folder => setDialogState({ open: true, folder })} onDelete={handleDeleteFolder} canEdit={canClassroom(profile, "editUnits")} />)}{!visibleUnits.length && <p className="ac-console-empty">Sin Units que coincidan con los filtros.</p>}</div>}
      </section><UnitInspector unit={inspected} resources={library.resources} onOpen={id => { library.openFolder(id); setActiveSection("library"); }} publications={publications} canPublish={canClassroom(profile, "publishVersions")} /></div>
    </>;
  }

  function renderSection() {
    if (library.loading) {
      return <div className="ac-module-state"><span className="ac-spinner" /><strong>Cargando Active Classroom...</strong></div>;
    }
    if (activeSection === "library" && library.selectedFolder?.kind === "unit") return (
      <UnitEditor
        profile={profile}
        initialImport={initialImport}
        key={library.selectedFolder.id}
        unit={library.selectedFolder}
        folders={library.folders}
        resources={library.resources}
        onBack={() => library.openFolder(library.selectedFolder.parentId)}
        onImport={library.importDriveFiles}
        onUpload={library.uploadFiles}
        onDirtyChange={setUnitDirty}
      />
    );
    if (activeSection === "library") return renderLibrary();
    if (activeSection === "levels") return <LevelsPanel folders={library.folders} profile={profile} catalog={catalog} resources={library.resources} createRequested={levelCreation} reordering={reorder} onOpen={(id) => { library.openFolder(id); setActiveSection("library"); }} />;
    if (activeSection === "publications") return renderLibrary(true);
    if (activeSection === "teams") return <TeamsPanel profile={profile} />;
    if (activeSection === "settings") return <SettingsPanel profile={profile} />;
    return null;
  }

  return (
    <section className={`ac-module ac-console ac-section-${activeSection}`}>
      <ClassroomHeader title={sectionDetails[activeSection][0]} subtitle={sectionDetails[activeSection][1]}>
        {activeSection === "library" && <>{canClassroom(profile, "editUnits") && <button className="ac-primary-button" onClick={() => setDialogState({ open: true, folder: null })}>+ Nueva Unit</button>}{canClassroom(profile, "importDrive") && <button className="ac-hero-outline" onClick={() => { if (library.selectedFolder?.kind === "unit") document.querySelector("[data-editor-import]")?.click(); else setImportPicker(true); }}><ActiveClassroomIcon name="upload" />Importar desde Nube AES</button>}</>}
        {activeSection === "levels" && canClassroom(profile, "manageLevels") && <><button className="ac-primary-button" onClick={() => setLevelCreation(value => value + 1)}>+ Nuevo nivel</button><button className="ac-hero-outline" onClick={() => setReorder(!reorder)}>Reordenar</button></>}
        {activeSection === "publications" && canClassroom(profile, "publishVersions") && <button className="ac-primary-button" disabled={!inspected} onClick={() => { library.openFolder(inspected.id); setActiveSection("library"); }}>+ Publicar nueva versión</button>}
      </ClassroomHeader>
      <ActiveClassroomNavigation canManageDevices={canClassroom(profile, "manageDevices")} activeSection={activeSection} onChange={(section) => {
        if (!unitDirty || window.confirm("Salir sin guardar cambios del borrador?")) setActiveSection(section);
      }} />
      <main className="ac-module-main">
        {(library.error || versions.error) && (
          <div className="ac-error-banner" role="alert">
            <span>{library.error || versions.error}</span>
            <button type="button" onClick={() => library.setError("")} aria-label="Cerrar aviso">×</button>
          </div>
        )}
        {renderSection()}
      </main>

      {importPicker && <div className="ac-dialog-backdrop"><section className="ac-dialog" role="dialog" aria-modal="true" aria-labelledby="ac-import-unit"><h2 id="ac-import-unit">Importar desde Nube AES</h2><p>Selecciona la Unit de destino.</p><select aria-label="Unit de destino" onChange={event => { const unit = library.folders.find(folder => folder.id === event.target.value); if (unit) { library.openFolder(unit.id); setInitialImport(true); setImportPicker(false); } }} value=""><option value="">Selecciona una Unit</option>{catalog.map(unit => <option value={unit.id} key={unit.id}>{unit.level?.name} · {unit.name}</option>)}</select><button className="ac-outline-button" onClick={() => setImportPicker(false)}>Cancelar</button></section></div>}
      {dialogState.open && (
        <FolderDialog
          key={dialogState.folder?.id || "new-unit"}
          levels={library.folders.filter(folder => folder.kind === "level" && folder.active !== false)}
          initialLevel={library.selectedFolder?.kind === "level" ? library.selectedFolder.id : ""}
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
