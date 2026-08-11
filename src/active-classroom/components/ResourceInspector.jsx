import {
  formatFileSize,
  formatResourceDate,
  getResourceIcon,
  getResourceKindLabel,
  isPreviewablePdf,
} from "../utils/resourceTypes";
import useActiveClassroomResourceUrl from "../hooks/useActiveClassroomResourceUrl";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

function Preview({ resource, downloadUrl, urlError }) {
  if (!resource) {
    return (
      <span className="ac-preview-fallback">
        <i className="ac-empty-file-icon" aria-hidden="true">
          <ActiveClassroomIcon name="file" size={54} />
        </i>
        <strong>Sin archivo seleccionado</strong>
        <small>Selecciona un recurso para ver los detalles en la vista previa.</small>
      </span>
    );
  }

  if (resource.kind === "image" && downloadUrl) {
    return <img src={downloadUrl} alt={`Vista previa de ${resource.name}`} />;
  }
  if (resource.kind === "audio" && downloadUrl) {
    return <audio src={downloadUrl} controls preload="metadata" />;
  }
  if (resource.kind === "video" && downloadUrl) {
    return <video src={downloadUrl} controls preload="metadata" />;
  }
  if (isPreviewablePdf(resource) && downloadUrl) {
    return (
      <object data={downloadUrl} type="application/pdf">
        <span className="ac-preview-fallback">
          <i>PDF</i>
          <strong>{resource.name}</strong>
          <small>Navegador no pudo mostrar PDF. Usa Descargar.</small>
        </span>
      </object>
    );
  }

  return (
    <span className="ac-preview-fallback">
      <i className={`is-${resource.kind}`}>{getResourceIcon(resource.kind, resource.name)}</i>
      <strong>{resource.name}</strong>
      <small>{urlError || (downloadUrl
        ? "Vista previa no disponible para este formato. Descarga archivo para abrirlo."
        : "Preparando archivo...")}</small>
    </span>
  );
}

export default function ResourceInspector({ resource, saving, onTogglePublished, onDelete }) {
  const { url: downloadUrl, error: urlError } = useActiveClassroomResourceUrl(resource);

  return (
    <aside className="ac-inspector" aria-label="Inspector del archivo seleccionado">
      <div className="ac-inspector-title">
        <h2>Inspector</h2>
        {resource ? (
          <span className={`ac-status-pill ${resource.published ? "is-active" : "is-draft"}`}>
            {resource.published ? "Publicado" : "Borrador"}
          </span>
        ) : (
          <span className="ac-inspector-info" title="Selecciona un recurso para inspeccionarlo">
            <ActiveClassroomIcon name="info" size={17} />
          </span>
        )}
      </div>

      <div className="ac-inspector-details">
        <h3>Vista previa</h3>
        <div className={`ac-file-preview ${isPreviewablePdf(resource) ? "is-pdf" : ""}`}>
          <Preview resource={resource} downloadUrl={downloadUrl} urlError={urlError} />
        </div>

        <section className="ac-inspector-meta">
          {resource ? (
            <>
              <div className="ac-selected-file-heading">
                <i className={`ac-file-icon is-${resource.kind}`} aria-hidden="true">
                  {getResourceIcon(resource.kind, resource.name)}
                </i>
                <div>
                  <strong>{resource.name}</strong>
                  <small>{formatFileSize(resource.sizeBytes)} · {getResourceKindLabel(resource.kind, resource.name)}</small>
                </div>
              </div>
              <dl className="ac-file-metadata">
                <div><dt>Tipo</dt><dd>{getResourceKindLabel(resource.kind, resource.name)}</dd></div>
                <div><dt>Modificado</dt><dd>{formatResourceDate(resource.updatedAt)}</dd></div>
                <div><dt>Responsable</dt><dd>{resource.updatedByName || resource.createdByName || "Administrador"}</dd></div>
                <div><dt>Persistencia</dt><dd>Firebase Storage</dd></div>
              </dl>
            </>
          ) : (
            <p>Selecciona un recurso para consultar metadatos y acciones.</p>
          )}
        </section>

        {resource && (
          <div className="ac-inspector-actions">
            <a
              href={downloadUrl || undefined}
              download={resource.name}
              target="_blank"
              rel="noreferrer"
              className={!downloadUrl ? "is-disabled" : ""}
              aria-disabled={!downloadUrl}
              onClick={(event) => {
                if (!downloadUrl) event.preventDefault();
              }}
            >
              Descargar
            </a>
            <button
              type="button"
              disabled={saving}
              onClick={() => onTogglePublished(resource)}
            >
              {resource.published ? "Pasar a borrador" : "Publicar"}
            </button>
            <button
              type="button"
              className="is-danger"
              disabled={saving}
              onClick={() => onDelete(resource)}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
