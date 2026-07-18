import EditorialIcon from "./EditorialIcon";
import { getPublicationStateLabel, getPublicationVariantLabel } from "../models/editorialPublication";
import { downloadableExports, variantLabel } from "../utils/editorialDownloads";

// Fase 7 — Biblioteca interna de materiales publicados (rail "Recursos"). Sólo
// lectura y descargas autorizadas; abre la vista de lectura reutilizando el
// renderizador. No expone portal público ni enlaces anónimos.
export default function EditorialLibraryPanel({ project, publications, caps, onOpenReadView, onDownload }) {
  const published = publications.filter((pub) => pub.status === "published");

  return (
    <aside className="editorial-structure-panel editorial-library-panel">
      <header>
        <strong>Biblioteca publicada</strong>
        <span>{published.length}</span>
      </header>

      {!caps.view ? (
        <div className="editorial-panel-empty">
          <EditorialIcon name="resources" size={28} />
          <p>Sin permiso de lectura.</p>
        </div>
      ) : published.length === 0 ? (
        <div className="editorial-panel-empty">
          <EditorialIcon name="resources" size={28} />
          <p>Aún no hay materiales publicados.</p>
        </div>
      ) : (
        <div className="editorial-library-list">
          {published.map((pub) => (
            <article className="editorial-library-item" key={pub.id}>
              <header>
                <strong>{project.name}</strong>
                <span className="editorial-pub-badge published">{getPublicationStateLabel(pub.status)}</span>
              </header>
              <small>Revisión {pub.revision} · {getPublicationVariantLabel(pub.variant)} · {pub.pageCount} págs</small>
              <div className="editorial-library-actions">
                <button type="button" onClick={() => onOpenReadView(pub)}>
                  <EditorialIcon name="eye" size={15} /> Leer
                </button>
                {caps.download &&
                  downloadableExports(pub).map((ref) => (
                    <button type="button" className="editorial-button primary compact" key={ref.exportId} title={`Descargar PDF ${variantLabel(ref.variant || ref.type)}`} onClick={() => onDownload(ref)}>
                      Descargar {variantLabel(ref.variant || ref.type)}
                    </button>
                  ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
