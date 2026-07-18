import { useMemo, useState } from "react";
import { getReviewStatusLabel } from "../../models/editorialProduction";
import { projectDisplayLabel, projectSubLabel, filterLinkableProjects } from "../../utils/editorialProjectPicker";

// Fase 7 — Vinculación con proyectos operativos. Muestra métricas derivadas del
// documento (no duplicadas), permite vincular/desvincular y adjuntar
// exportaciones terminadas como evidencia. No duplica lógica de Proyectos:
// delega en projectsService vía handlers del shell.
export default function EditorialProjectLinkPanel({
  metrics,
  visibleProjects,
  linkedProjects,
  exports,
  caps,
  busy,
  error,
  onLink,
  onUnlink,
  onAttachEvidence,
}) {
  const [pickProjectId, setPickProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [evidenceExportId, setEvidenceExportId] = useState("");
  const linkedIds = useMemo(() => new Set(linkedProjects.map((project) => project.id)), [linkedProjects]);
  const selectable = useMemo(() => filterLinkableProjects(visibleProjects, linkedIds, search), [linkedIds, search, visibleProjects]);
  const completedExports = exports.filter((item) => item.status === "completed");

  return (
    <section className="editorial-production-section editorial-project-link">
      {error && <p className="editorial-notice warning">{error}</p>}

      <div className="editorial-metrics-grid">
        <h4>Métricas derivadas</h4>
        <dl>
          <dt>Estado</dt><dd>{getReviewStatusLabel(metrics.reviewStatus)}</dd>
          <dt>Páginas</dt><dd>{metrics.pageCount}</dd>
          <dt>Versión</dt><dd>{metrics.revision || "—"}</dd>
          <dt>Preflight</dt><dd>{metrics.preflightErrors} errores</dd>
          <dt>Publicación</dt><dd>{metrics.isPublished ? `Rev. ${metrics.latestPublishedRevision}` : "Sin publicar"}</dd>
        </dl>
      </div>

      {caps.edit_content && (
        <div className="editorial-project-picker">
          <h4>Vincular a proyecto operativo</h4>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar proyecto por nombre…"
            aria-label="Buscar proyecto"
          />
          <ul className="editorial-project-options" role="listbox" aria-label="Proyectos disponibles">
            {selectable.length === 0 ? (
              <li className="editorial-hint">{visibleProjects.length === 0 ? "No hay proyectos disponibles." : "Sin coincidencias."}</li>
            ) : (
              selectable.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={pickProjectId === project.id}
                    className={pickProjectId === project.id ? "selected" : ""}
                    onClick={() => setPickProjectId(project.id)}
                  >
                    <strong>{projectDisplayLabel(project)}</strong>
                    <small>{projectSubLabel(project)}</small>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="editorial-project-picker-actions">
            <button type="button" onClick={() => { setPickProjectId(""); setSearch(""); }}>Cancelar</button>
            <button type="button" className="editorial-button primary compact" disabled={busy || !pickProjectId} onClick={() => { onLink(pickProjectId); setPickProjectId(""); setSearch(""); }}>
              {busy ? "Vinculando…" : "Vincular"}
            </button>
          </div>
        </div>
      )}

      <div className="editorial-linked-projects">
        <h4>Proyectos vinculados</h4>
        {linkedProjects.length === 0 && <p className="editorial-hint">Sin vínculos.</p>}
        {linkedProjects.map((project) => (
          <article className="editorial-linked-project" key={project.id}>
            <strong>{project.name || project.id}</strong>
            <small>{project.status || "Sin estado"}</small>
            <div className="editorial-linked-actions">
              {caps.edit_content && <button type="button" onClick={() => onUnlink(project.id)}>Desvincular</button>}
              {caps.edit_content && completedExports.length > 0 && (
                <>
                  <select value={evidenceExportId} onChange={(event) => setEvidenceExportId(event.target.value)}>
                    <option value="">Exportación…</option>
                    {completedExports.map((item) => (
                      <option value={item.id} key={item.id}>{item.type} · {item.variant}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !evidenceExportId}
                    onClick={() => onAttachEvidence(project.id, completedExports.find((item) => item.id === evidenceExportId))}
                  >
                    Adjuntar evidencia
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
