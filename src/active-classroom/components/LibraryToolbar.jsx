import { useRef } from "react";
import { ACTIVE_CLASSROOM_ACCEPTED_FILES } from "../constants";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

export default function LibraryToolbar({
  selectedFolder,
  searchTerm,
  typeFilter,
  statusFilter,
  sortMode,
  viewMode,
  filtersOpen,
  saving,
  onSearchChange,
  onTypeFilterChange,
  onStatusFilterChange,
  onSortModeChange,
  onViewModeChange,
  onFiltersOpenChange,
  onClearFilters,
  onCreateFolder,
  onUploadFiles,
}) {
  const fileInputRef = useRef(null);
  const canCreateUnit = selectedFolder?.kind === "level";
  const canUpload = selectedFolder?.kind === "unit";

  async function handleFileChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) await onUploadFiles(files);
  }

  return (
    <>
      <div className="ac-library-toolbar">
        <button
          type="button"
          className="ac-primary-button"
          disabled={!canCreateUnit || saving}
          onClick={onCreateFolder}
          title={canCreateUnit ? "Crear Unit dentro de este Nivel" : "Abre un Nivel para crear una Unit"}
        >
          <span className="ac-button-plus" aria-hidden="true">+</span>
          Nueva Unit
        </button>

        <button
          type="button"
          className="ac-outline-button"
          disabled={!canUpload || saving}
          onClick={() => fileInputRef.current?.click()}
          title={canUpload ? "Subir recursos a esta Unit" : "Abre una Unit para subir archivos"}
        >
          <ActiveClassroomIcon name="upload" />
          Subir archivos
        </button>
        <input
          ref={fileInputRef}
          className="ac-hidden-input"
          type="file"
          multiple
          accept={ACTIVE_CLASSROOM_ACCEPTED_FILES}
          onChange={handleFileChange}
        />

        <span className="ac-toolbar-spacer" />

        <div className="ac-view-switch" aria-label="Vista">
          <button
            type="button"
            aria-label="Vista de lista"
            aria-pressed={viewMode === "list"}
            className={viewMode === "list" ? "is-active" : ""}
            onClick={() => onViewModeChange("list")}
          >
            <ActiveClassroomIcon name="list" />
          </button>
          <button
            type="button"
            aria-label="Vista de cuadrícula"
            aria-pressed={viewMode === "grid"}
            className={viewMode === "grid" ? "is-active" : ""}
            onClick={() => onViewModeChange("grid")}
          >
            <ActiveClassroomIcon name="grid" />
          </button>
        </div>

        <button
          type="button"
          className="ac-outline-button"
          aria-expanded={filtersOpen}
          onClick={() => onFiltersOpenChange(!filtersOpen)}
        >
          <ActiveClassroomIcon name="filter" />
          Filtrar
        </button>
      </div>

      {filtersOpen && (
        <div className="ac-filter-panel">
          <label className="ac-search-field">
            <ActiveClassroomIcon name="search" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar por nombre"
            />
          </label>
          <label>
            <span className="ac-sr-only">Tipo de archivo</span>
            <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
              <option value="all">Tipo de archivo</option>
              <option value="image">Imagen</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
              <option value="pdf">PDF</option>
              <option value="document">Documento</option>
              <option value="presentation">Presentación</option>
            </select>
          </label>
          <label>
            <span className="ac-sr-only">Estado</span>
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
              <option value="all">Estado</option>
              <option value="published">Publicado</option>
              <option value="draft">Borrador</option>
            </select>
          </label>
          <label>
            <span className="ac-sr-only">Orden</span>
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value)}>
              <option value="name">Ordenar por: Nombre</option>
              <option value="date">Ordenar por: Modificado</option>
            </select>
          </label>
          <button type="button" className="ac-clear-filters" onClick={onClearFilters}>
            <ActiveClassroomIcon name="refresh" />
            Limpiar filtros
          </button>
        </div>
      )}
    </>
  );
}
