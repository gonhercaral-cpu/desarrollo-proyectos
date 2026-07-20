import EditorialIcon from "./EditorialIcon";
import EditorialWorkspace from "./editor/EditorialWorkspace";
import EditorialZoomControls from "./editor/EditorialZoomControls";
import { getPublicationStateLabel } from "../models/editorialPublication";
import { downloadableExports, variantLabel } from "../utils/editorialDownloads";

const noop = () => {};

// Fase 7 — Vista interna de solo lectura. Reutiliza el renderizador editorial
// (EditorialWorkspace) sin herramientas de edición y SIN capturas. Ofrece
// navegación por páginas, pliegos, zoom, índice, metadata, variante y descargas.
export default function EditorialReadView({
  project,
  navigation,
  metrics,
  spreadSlots,
  zoom,
  viewMode,
  onZoomChange,
  onViewModeChange,
  variant,
  onVariantChange,
  caps,
  publications = [],
  relatedProjects = [],
  onDownloadPublication,
  onClose,
}) {
  const pages = navigation.pages;
  const activeId = navigation.selectedPageId;
  const activeIndex = pages.findIndex((page) => page.id === activeId);
  const metadata = project.academicMetadata || {};
  const published = publications.filter((pub) => pub.status === "published");

  return (
    <div className="editorial-readview-layer" role="dialog" aria-modal="true" aria-label="Vista de lectura editorial">
      <header className="editorial-readview-topbar">
        <div className="editorial-readview-title">
          <span className="editorial-eyebrow">Vista de lectura</span>
          <strong>{project.name}</strong>
        </div>
        <div className="editorial-variant-toggle" aria-label="Variante académica">
          <button type="button" className={variant === "student" ? "active" : ""} onClick={() => onVariantChange("student")}>Alumno</button>
          <button
            type="button"
            className={variant === "teacher" ? "active" : ""}
            onClick={() => onVariantChange("teacher")}
            disabled={!caps.viewTeacher}
            title={!caps.viewTeacher ? "Sin permiso para la variante Maestro" : undefined}
          >
            Maestro
          </button>
        </div>
        <button type="button" className="editorial-icon-button" onClick={onClose} aria-label="Cerrar vista de lectura">
          <EditorialIcon name="close" />
        </button>
      </header>

      <div className="editorial-readview-body">
        <aside className="editorial-readview-index" aria-label="Índice de páginas">
          <h4>Índice</h4>
          <ol>
            {pages.map((page) => (
              <li key={page.id}>
                <button type="button" className={page.id === activeId ? "active" : ""} onClick={() => navigation.selectPage(page.id)}>
                  <span>{navigation.numbering.get(page.id)?.label || "—"}</span>
                  <em>{page.name}</em>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <div className="editorial-readview-canvas">
          <EditorialWorkspace
            metrics={metrics}
            zoom={zoom}
            unit={project.unit || "in"}
            viewMode={viewMode}
            showRulers={false}
            guideSettings={{}}
            spreadSlots={spreadSlots}
            onZoomChange={onZoomChange}
            onSelectPage={navigation.selectPage}
            onSelectElement={noop}
            onChangeElement={noop}
            onAcademicDrop={noop}
            readOnly
          />
          <div className="editorial-readview-controls">
            <button type="button" disabled={activeIndex <= 0} onClick={() => navigation.selectPage(pages[activeIndex - 1]?.id)}>Anterior</button>
            <span>{activeIndex + 1} / {pages.length}</span>
            <button type="button" disabled={activeIndex >= pages.length - 1} onClick={() => navigation.selectPage(pages[activeIndex + 1]?.id)}>Siguiente</button>
            <EditorialZoomControls zoom={zoom} viewMode={viewMode} onZoomChange={onZoomChange} onViewModeChange={onViewModeChange} onFit={noop} />
          </div>
        </div>

        <aside className="editorial-readview-meta" aria-label="Metadata y materiales">
          <section>
            <h4>Metadata</h4>
            <dl>
              <dt>Tipo</dt><dd>{project.type}</dd>
              <dt>Serie</dt><dd>{metadata.seriesName || project.seriesName || "—"}</dd>
              <dt>Nivel</dt><dd>{metadata.levelName || project.levelName || "—"}</dd>
              <dt>Unidad</dt><dd>{metadata.unitTitle || project.unitTitle || "—"}</dd>
              <dt>Páginas</dt><dd>{pages.length}</dd>
            </dl>
          </section>

          {caps.download && published.length > 0 && (
            <section>
              <h4>Descargas publicadas</h4>
              {published.map((pub) => (
                <div className="editorial-readview-download" key={pub.id}>
                  <strong>Rev. {pub.revision} · {getPublicationStateLabel(pub.status)}</strong>
                  {downloadableExports(pub).map((ref) => (
                    <button type="button" className="editorial-button primary compact" key={ref.exportId} title={`Descargar PDF ${variantLabel(ref.variant || ref.type)}`} onClick={() => onDownloadPublication(ref)}>
                      Descargar {variantLabel(ref.variant || ref.type)}
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}

          {relatedProjects.length > 0 && (
            <section>
              <h4>Materiales relacionados</h4>
              <ul>
                {relatedProjects.map((related) => (
                  <li key={related.id}>{related.name}</li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
