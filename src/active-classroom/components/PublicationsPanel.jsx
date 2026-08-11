import {
  formatFileSize,
  formatResourceDate,
  getResourceIcon,
  getResourceKindLabel,
} from "../utils/resourceTypes";

export default function PublicationsPanel({ resources, folders, saving, onTogglePublished, onSelectResource }) {
  const publishedCount = resources.filter((resource) => resource.published).length;
  const draftsCount = resources.length - publishedCount;

  return (
    <section className="ac-section-panel">
      <header className="ac-section-heading">
        <div>
          <span>CONTROL DE CONTENIDO</span>
          <h2>Publicaciones</h2>
          <p>Define qué recursos quedan disponibles para experiencia docente.</p>
        </div>
        <div className="ac-publication-metrics">
          <article><strong>{publishedCount}</strong><span>Publicados</span></article>
          <article><strong>{draftsCount}</strong><span>Borradores</span></article>
        </div>
      </header>

      <div className="ac-publication-list">
        {resources.length === 0 && (
          <div className="ac-empty-state">
            <strong>Sin recursos</strong>
            <small>Sube archivos desde Biblioteca para administrarlos aquí.</small>
          </div>
        )}
        {resources.map((resource) => {
          const unit = folders.find((folder) => folder.id === resource.folderId);
          const level = folders.find((folder) => folder.id === unit?.parentId);

          return (
            <article key={resource.id} className="ac-publication-row">
              <button type="button" className="ac-publication-resource" onClick={() => onSelectResource(resource.id)}>
                <i className={`ac-file-icon is-${resource.kind}`} aria-hidden="true">
                  {getResourceIcon(resource.kind, resource.name)}
                </i>
                <span>
                  <strong>{resource.name}</strong>
                  <small>
                    {level?.name || "Sin Nivel"} / {unit?.name || "Sin Unit"} · {getResourceKindLabel(resource.kind, resource.name)} · {formatFileSize(resource.sizeBytes)}
                  </small>
                </span>
              </button>
              <span className="ac-publication-date">{formatResourceDate(resource.updatedAt)}</span>
              <button
                type="button"
                className={`ac-publish-toggle ${resource.published ? "is-published" : ""}`}
                disabled={saving}
                onClick={() => onTogglePublished(resource)}
              >
                {resource.published ? "Publicado" : "Borrador"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
