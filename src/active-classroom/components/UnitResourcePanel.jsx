import { useState, useMemo, useEffect, useRef } from "react";
import { normalizeString, getFileTypeCategory, getProcessingStatus, getFormatLabel, getResourceStatus } from "../utils/unitResourceView.js";
import { formatFileSize, getResourceIcon } from "../utils/resourceTypes.js";
import ActiveClassroomIcon from "./ActiveClassroomIcon.jsx";
import "../styles/unit-resources.css";

const TYPE_ICONS = { document: "file", pdf: "file", presentation: "presentation", audio: "music", image: "image", video: "video", other: "more" };

const CATEGORIES = [
  { key: "all", label: "Todos" },
  { key: "document", label: "Documentos" },
  { key: "presentation", label: "Presentaciones" },
  { key: "audio", label: "Audio" },
  { key: "image", label: "Imagen" },
  { key: "video", label: "Video" },
  { key: "other", label: "Otros" },
];

function getStatusIconName(key) {
  if (key === "ready") return "check";
  if (key === "pending") return "clock";
  if (key === "processing") return "refresh";
  if (key === "error" || key === "unavailable") return "alert-circle";
  return "info";
}

export default function UnitResourcePanel({
  resources = [],
  selectedResourceId = "",
  onSelectResource = () => {},
  generalResourceIds = [],
  slideResourceIds = [],
  slides = [],
  slideLabel = "",
  driveChecks = {},
  toolbar = null,
  notices = null,
  renderActions = null,
  renderInspector = null,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [associationFilter, setAssociationFilter] = useState("all");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const headerCheckboxRef = useRef(null);

  const [viewMode, setViewMode] = useState(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const saved = window.localStorage.getItem("ac_unit_resources_view");
        if (saved === "grid" || saved === "list") return saved;
      }
    } catch { /* Navegadores con almacenamiento restringido usan vista de lista. */ }
    return "list";
  });

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("ac_unit_resources_view", mode);
      }
    } catch { /* La preferencia sigue disponible durante esta sesión. */ }
  };

  const effectiveAssociation = !slideLabel && ["slide", "not_slide"].includes(associationFilter) ? "all" : associationFilter;

  const generalSet = useMemo(() => new Set(generalResourceIds), [generalResourceIds]);
  const currentSlideSet = useMemo(() => new Set(slideResourceIds), [slideResourceIds]);

  const resourceSlideMap = useMemo(() => {
    const map = new Map();
    slides.forEach((slide, idx) => {
      const sNum = Number.isInteger(slide.index) ? slide.index + 1 : idx + 1;
      const sLabel = `Diapositiva ${sNum}`;
      const rIds = Array.isArray(slide.resourceIds)
        ? slide.resourceIds
        : Array.isArray(slide.resources)
          ? slide.resources.map((x) => (typeof x === "string" ? x : x?.id))
          : [];
      rIds.forEach((id) => {
        if (!id) return;
        if (!map.has(id)) map.set(id, []);
        const arr = map.get(id);
        if (!arr.some((s) => s.num === sNum)) {
          arr.push({ num: sNum, label: sLabel });
        }
      });
    });
    if (slideLabel && Array.isArray(slideResourceIds)) {
      slideResourceIds.forEach((id) => {
        if (!id) return;
        if (!map.has(id)) map.set(id, []);
        const arr = map.get(id);
        if (!arr.some((s) => s.label === slideLabel)) {
          arr.push({ num: null, label: slideLabel });
        }
      });
    }
    return map;
  }, [slides, slideResourceIds, slideLabel]);

  const stats = useMemo(() => {
    const existingSet = new Set(resources.map((r) => r.id));
    const uniqueGeneral = new Set(generalResourceIds.filter((id) => existingSet.has(id)));
    const uniqueSlide = new Set();
    slides.forEach((slide) => {
      const rIds = Array.isArray(slide.resourceIds)
        ? slide.resourceIds
        : Array.isArray(slide.resources)
          ? slide.resources.map((x) => (typeof x === "string" ? x : x?.id))
          : [];
      rIds.forEach((id) => {
        if (id && existingSet.has(id)) uniqueSlide.add(id);
      });
    });
    slideResourceIds.forEach((id) => {
      if (id && existingSet.has(id)) uniqueSlide.add(id);
    });

    let pending = 0;
    let ready = 0;
    resources.forEach((r) => {
      const st = getProcessingStatus(r);
      if (st === "pending") pending += 1;
      if (st === "ready") ready += 1;
    });

    return {
      total: resources.length,
      general: uniqueGeneral.size,
      slide: uniqueSlide.size,
      pending,
      ready,
    };
  }, [resources, generalResourceIds, slides, slideResourceIds]);

  const categoryCounts = useMemo(() => {
    const counts = { all: resources.length, document: 0, presentation: 0, audio: 0, image: 0, video: 0, other: 0 };
    resources.forEach((r) => {
      const cat = getFileTypeCategory(r);
      if (cat === "document" || cat === "pdf") counts.document += 1;
      else if (cat === "presentation") counts.presentation += 1;
      else if (cat === "audio") counts.audio += 1;
      else if (cat === "image") counts.image += 1;
      else if (cat === "video") counts.video += 1;
      else counts.other += 1;
    });
    return counts;
  }, [resources]);

  const activeSelectedIds = useMemo(() => {
    const existingSet = new Set(resources.map((r) => r.id));
    return new Set([...selectedIds].filter((id) => existingSet.has(id)));
  }, [selectedIds, resources]);

  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      if (searchTerm.trim()) {
        const q = normalizeString(searchTerm.trim());
        if (!normalizeString(resource?.name || "").includes(q)) return false;
      }
      if (typeFilter !== "all") {
        const cat = getFileTypeCategory(resource);
        if (typeFilter === "document") {
          if (cat !== "document" && cat !== "pdf") return false;
        } else if (cat !== typeFilter) {
          return false;
        }
      }
      if (statusFilter !== "all" && getProcessingStatus(resource) !== statusFilter) {
        return false;
      }
      if (effectiveAssociation !== "all") {
        const isGen = generalSet.has(resource.id);
        const inCurrent = currentSlideSet.has(resource.id);
        const inAny = (resourceSlideMap.get(resource.id)?.length || 0) > 0 || inCurrent;
        if (effectiveAssociation === "general" && !isGen) return false;
        if (effectiveAssociation === "any_slide" && !inAny) return false;
        if (effectiveAssociation === "slide" && !inCurrent) return false;
        if (effectiveAssociation === "not_slide" && inCurrent) return false;
      }
      if (showSelectedOnly && !activeSelectedIds.has(resource.id)) {
        return false;
      }
      return true;
    });
  }, [resources, searchTerm, typeFilter, statusFilter, effectiveAssociation, showSelectedOnly, activeSelectedIds, generalSet, currentSlideSet, resourceSlideMap]);

  const sortedResources = useMemo(() => {
    if (!sortField) return filteredResources;
    return [...filteredResources].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = normalizeString(a?.name || "").localeCompare(normalizeString(b?.name || ""), "es", { numeric: true });
      } else if (sortField === "status") {
        const stA = getResourceStatus(a, driveChecks?.[a.id])?.label || "";
        const stB = getResourceStatus(b, driveChecks?.[b.id])?.label || "";
        cmp = stA.localeCompare(stB);
      } else if (sortField === "association") {
        const genA = generalSet.has(a.id) ? 0 : 1;
        const genB = generalSet.has(b.id) ? 0 : 1;
        cmp = genA - genB;
        if (cmp === 0) {
          const sA = resourceSlideMap.get(a.id)?.length || 0;
          const sB = resourceSlideMap.get(b.id)?.length || 0;
          cmp = sB - sA;
        }
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filteredResources, sortField, sortOrder, driveChecks, generalSet, resourceSlideMap]);

  const totalItems = sortedResources.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / 8));

  if (page > totalPages) setPage(totalPages);
  const currentPage = Math.min(page, totalPages);

  const pageResources = useMemo(() => {
    const start = (currentPage - 1) * 8;
    return sortedResources.slice(start, start + 8);
  }, [sortedResources, currentPage]);

  const isAllPageSelected = pageResources.length > 0 && pageResources.every((r) => activeSelectedIds.has(r.id));
  const isSomePageSelected = pageResources.some((r) => activeSelectedIds.has(r.id)) && !isAllPageSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomePageSelected;
    }
  }, [isSomePageSelected]);

  const handleToggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        pageResources.forEach((r) => next.delete(r.id));
      } else {
        pageResources.forEach((r) => next.add(r.id));
      }
      return next;
    });
    if (!isAllPageSelected && !selectedResourceId && pageResources.length > 0) onSelectResource(pageResources[0].id);
  };

  const handleToggleSelectResource = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (!activeSelectedIds.has(id)) onSelectResource(id);
  };

  const handleNameClick = (resource) => {
    setSelectedIds((prev) => new Set(prev).add(resource.id));
    onSelectResource(resource.id);
  };

  const handleSort = (field) => {
    setPage(1);
    if (sortField !== field) {
      setSortField(field);
      setSortOrder("asc");
    } else if (sortOrder === "asc") {
      setSortOrder("desc");
    } else {
      setSortField(null);
      setSortOrder("asc");
    }
  };

  const getAriaSort = (field) => {
    if (sortField !== field) return "none";
    return sortOrder === "asc" ? "ascending" : "descending";
  };

  const selectedResource = useMemo(
    () => resources.find((r) => r.id === selectedResourceId) || null,
    [resources, selectedResourceId]
  );
  const hasInspector = Boolean(selectedResource && renderInspector);

  const startIdx = totalItems === 0 ? 0 : (currentPage - 1) * 8 + 1;
  const endIdx = Math.min(currentPage * 8, totalItems);
  const hasFilters = Boolean(searchTerm.trim() || typeFilter !== "all" || statusFilter !== "all" || effectiveAssociation !== "all" || showSelectedOnly);
  const clearFilters = () => { setSearchTerm(""); setTypeFilter("all"); setStatusFilter("all"); setAssociationFilter("all"); setShowSelectedOnly(false); setPage(1); };

  return (
    <section className="ac-unit-resource-panel ac-unit-card ac-rm-panel">
      <header className="ac-rm-header">
        <div className="ac-rm-heading">
          <h2>Recursos de la Unit ({resources.length})</h2>
          <p>Los recursos generales están disponibles en toda la unidad, mientras que los asociados a una diapositiva se vinculan a la vista activa.</p>
        </div>
        {toolbar && <div className="ac-rm-toolbar">{toolbar}</div>}
      </header>

      {notices && <div className="ac-rm-notices">{notices}</div>}

      <div className="ac-rm-stats" aria-label="Métricas de recursos">
        <article>
          <span className="ac-rm-stat-icon is-blue" aria-hidden="true"><ActiveClassroomIcon name="file" /></span>
          <div><strong>{stats.total}</strong><small>Total de recursos</small></div>
        </article>
        <article>
          <span className="ac-rm-stat-icon is-orange" aria-hidden="true"><ActiveClassroomIcon name="folder" /></span>
          <div><strong>{stats.general}</strong><small>Generales</small></div>
        </article>
        <article>
          <span className="ac-rm-stat-icon is-purple" aria-hidden="true"><ActiveClassroomIcon name="presentation" /></span>
          <div><strong>{stats.slide}</strong><small>Asociados a diapositiva</small></div>
        </article>
        <article>
          <span className="ac-rm-stat-icon is-amber" aria-hidden="true"><ActiveClassroomIcon name="clock" /></span>
          <div><strong>{stats.pending}</strong><small>Pendientes</small></div>
        </article>
        <article>
          <span className="ac-rm-stat-icon is-green" aria-hidden="true"><ActiveClassroomIcon name="check" /></span>
          <div title="Archivos con procesamiento completado"><strong>{stats.ready}</strong><small>Procesados</small></div>
        </article>
      </div>

      <div className="ac-rm-filters">
        <label className="ac-rm-search">
          <ActiveClassroomIcon name="search" aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder="Buscar por nombre..."
            aria-label="Buscar recurso"
          />
        </label>

        <label className="ac-rm-filter-combo">
          <span className="ac-rm-filter-label">Tipo de archivo</span>
          <select aria-label="Tipo de archivo" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="all">Todos los tipos</option>
            <option value="document">Documentos</option>
            <option value="pdf">PDF</option>
            <option value="presentation">Presentaciones</option>
            <option value="audio">Audio</option>
            <option value="image">Imagen</option>
            <option value="video">Video</option>
            <option value="other">Otros</option>
          </select>
        </label>

        <label className="ac-rm-filter-combo">
          <span className="ac-rm-filter-label">Estado de procesamiento</span>
          <select aria-label="Estado de procesamiento" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Todos los estados</option>
            <option value="ready">Procesados</option>
            <option value="pending">Pendientes</option>
            <option value="processing">En proceso</option>
            <option value="error">Error</option>
            <option value="none">Sin procesamiento</option>
          </select>
        </label>

        <label className="ac-rm-filter-combo">
          <span className="ac-rm-filter-label">Asociación</span>
          <select aria-label="Asociación" value={effectiveAssociation} onChange={(e) => { setAssociationFilter(e.target.value); setPage(1); }}>
            <option value="all">Todas las asociaciones</option>
            <option value="general">Generales</option>
            <option value="any_slide">Cualquier diapositiva</option>
            {slideLabel && <option value="slide">{slideLabel}</option>}
            {slideLabel && <option value="not_slide">Sin {slideLabel}</option>}
          </select>
        </label>

        <div className="ac-rm-view" role="group" aria-label="Modo de vista">
          <button
            type="button"
            className={`ac-rm-view-btn ${viewMode === "list" ? "is-active" : ""}`}
            aria-pressed={viewMode === "list"}
            aria-label="Vista de lista"
            onClick={() => handleViewModeChange("list")}
          >
            <ActiveClassroomIcon name="list" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`ac-rm-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
            aria-pressed={viewMode === "grid"}
            aria-label="Vista de cuadrícula"
            onClick={() => handleViewModeChange("grid")}
          >
            <ActiveClassroomIcon name="grid" aria-hidden="true" />
          </button>
        </div>
        {hasFilters && <button type="button" className="ac-rm-clear" aria-label="Limpiar filtros de búsqueda" onClick={clearFilters}>Limpiar filtros</button>}
      </div>

      <div className={`ac-rm-layout ${hasInspector ? "has-inspector" : ""}`}>
        <div className="ac-rm-browser">
          <nav className="ac-rm-categories" aria-label="Categorías de recursos">
            {CATEGORIES.map(({ key, label }) => {
              const isActive = key === "all"
                ? typeFilter === "all"
                : key === "document"
                  ? typeFilter === "document" || typeFilter === "pdf"
                  : typeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`ac-rm-category-btn ${isActive ? "is-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => { setTypeFilter(key); setPage(1); }}
                >
                  {key !== "all" && <span className={`ac-rm-category-icon is-${key}`}><ActiveClassroomIcon name={TYPE_ICONS[key]} size={16} /></span>}
                  <span>{label}</span>
                  <span className="ac-rm-category-count">({categoryCounts[key]})</span>
                </button>
              );
            })}
          </nav>

          {(activeSelectedIds.size > 1 || showSelectedOnly) && (
            <div className="ac-rm-selection-bar" role="status" aria-live="polite">
              <span>{activeSelectedIds.size} {activeSelectedIds.size === 1 ? "seleccionado" : "seleccionados"}</span>
              <div className="ac-rm-selection-actions">
                <button type="button" onClick={() => { setShowSelectedOnly((p) => !p); setPage(1); }}>
                  {showSelectedOnly ? "Mostrar todos" : "Ver seleccionados"}
                </button>
                <button type="button" onClick={() => { setSelectedIds(new Set()); setShowSelectedOnly(false); }}>
                  Limpiar selección
                </button>
              </div>
            </div>
          )}

          <div
            className={`ac-rm-table ${viewMode === "grid" ? "is-grid" : "is-list"}`}
            role="table"
            aria-label="Lista de recursos de la unidad"
          >
            <div className="ac-rm-table-head" role="rowgroup">
              <div className="ac-rm-row ac-rm-header-row" role="row">
                <div className="ac-rm-selection" role="columnheader">
                  <input
                    type="checkbox"
                    ref={headerCheckboxRef}
                    checked={isAllPageSelected}
                    onChange={handleToggleSelectAllPage}
                    aria-label="Seleccionar todos los recursos de la página"
                  />
                </div>
                <div className="ac-rm-name" role="columnheader" aria-sort={getAriaSort("name")}>
                  <button type="button" className="ac-rm-sort-btn" onClick={() => handleSort("name")}>
                    <span>Nombre</span>
                    <span className="ac-rm-sr-only">ordenar por nombre</span>
                  </button>
                </div>
                <div className="ac-rm-format" role="columnheader"><span>Tipo / Tamaño</span></div>
                <div className="ac-rm-state" role="columnheader" aria-sort={getAriaSort("status")}>
                  <button type="button" className="ac-rm-sort-btn" onClick={() => handleSort("status")}>
                    <span>Estado</span>
                    <span className="ac-rm-sr-only">ordenar por estado</span>
                  </button>
                </div>
                <div className="ac-rm-association" role="columnheader" aria-sort={getAriaSort("association")}>
                  <button type="button" className="ac-rm-sort-btn" onClick={() => handleSort("association")}>
                    <span>Asociación</span>
                    <span className="ac-rm-sr-only">ordenar por asociación</span>
                  </button>
                </div>
                <div className="ac-rm-actions" role="columnheader"><span>Acciones</span></div>
              </div>
            </div>

            <div className="ac-rm-table-body" role="rowgroup">
              {pageResources.length === 0 ? (
                <div className="ac-rm-empty-row" role="row"><div className="ac-rm-empty" role="cell" aria-colspan={6}>
                  <ActiveClassroomIcon name="search" aria-hidden="true" />
                  <p>No se encontraron recursos con los filtros actuales.</p>
                  {hasFilters && <button type="button" className="ac-rm-clear" onClick={clearFilters}>Limpiar filtros</button>}
                </div></div>
              ) : (
                pageResources.map((resource) => {
                  const cat = getFileTypeCategory(resource);
                  const isChecked = activeSelectedIds.has(resource.id);
                  const isInspected = selectedResourceId === resource.id;
                  const formatLabel = getFormatLabel(resource);
                  const size = resource.sizeBytes;
                  const sizeLabel = Number.isFinite(size) && size >= 0 ? formatFileSize(size) : "Sin tamaño";
                  const statusInfo = getResourceStatus(resource, driveChecks?.[resource.id]);
                  const isGen = generalSet.has(resource.id);
                  const slideAssocs = resourceSlideMap.get(resource.id) || [];
                  const iconName = TYPE_ICONS[cat] || "file";

                  return (
                    <div
                      key={resource.id}
                      className={`ac-unit-resource ac-rm-row ${isInspected ? "is-selected-inspector" : ""} ${isChecked ? "is-checked" : ""}`}
                      role="row"
                    >
                      <div className="ac-rm-selection" role="cell">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectResource(resource.id)}
                          aria-label={`Seleccionar ${resource.name || "recurso"}`}
                        />
                      </div>
                      <div className="ac-rm-name" role="cell">
                        <span className={`ac-rm-file-icon ac-rm-type-icon is-${cat}`} aria-hidden="true">
                          {cat === "pdf" ? getResourceIcon("document", resource.name) : <ActiveClassroomIcon name={iconName} />}
                        </span>
                        <button
                          type="button"
                          className="ac-rm-name-btn"
                          aria-label={`Inspeccionar ${resource.name || "recurso"}`}
                          onClick={() => handleNameClick(resource)}
                        >
                          <span className="ac-rm-name-text">{resource.name || "Recurso sin nombre"}</span>
                        </button>
                      </div>
                      <div className="ac-rm-format" role="cell">
                        <span className="ac-rm-format-tag">{formatLabel || "ARCHIVO"}</span>
                        {sizeLabel && <span className="ac-rm-size-text">{sizeLabel}</span>}
                      </div>
                      <div className="ac-rm-state" role="cell">
                        <div className={`ac-rm-status is-${statusInfo.key}`}>
                          <span className="ac-rm-status-badge">
                            <ActiveClassroomIcon name={getStatusIconName(statusInfo.key)} aria-hidden="true" />
                            <span>{statusInfo.label}</span>
                          </span>
                          {statusInfo.detail && (statusInfo.label === "Procesada" || ["error", "changed", "unavailable"].includes(statusInfo.key)) && <small className="ac-rm-status-detail">{statusInfo.detail}</small>}
                        </div>
                      </div>
                      <div className="ac-rm-association" role="cell">
                        <div className="ac-rm-badge-list">
                          {isGen && <span className="ac-rm-badge is-general">General</span>}
                          {slideAssocs.slice(0, 3).map((s, idx) => (
                            <span key={idx} className="ac-rm-badge is-slide">{s.label}</span>
                          ))}
                          {slideAssocs.length > 3 && (
                            <span className="ac-rm-badge-more">+{slideAssocs.length - 3} más</span>
                          )}
                          {!isGen && slideAssocs.length === 0 && (
                            <span className="ac-rm-no-assoc">Sin asociación</span>
                          )}
                        </div>
                      </div>
                      <div className="ac-rm-actions" role="cell">
                        {typeof renderActions === "function" ? renderActions(resource) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {totalItems > 0 && (
            <div className="ac-rm-pagination">
              <span className="ac-res-range-indicator">
                Mostrando {startIdx}–{endIdx} de {totalItems} recursos
              </span>
              {totalPages > 1 && (
                <div className="ac-res-page-controls">
                  <button
                    type="button"
                    className="ac-res-page-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Página anterior"
                  >
                    <ActiveClassroomIcon name="chevron-left" aria-hidden="true" />
                  </button>
                  <span className="ac-res-page-status" aria-live="polite">
                    Página {currentPage} de {totalPages}
                  </span>
                  <button
                    type="button"
                    className="ac-res-page-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Página siguiente"
                  >
                    <ActiveClassroomIcon name="chevron-right" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {hasInspector && (
          <div className="ac-rm-inspector-slot">
            {renderInspector(selectedResource)}
          </div>
        )}
      </div>
    </section>
  );
}
