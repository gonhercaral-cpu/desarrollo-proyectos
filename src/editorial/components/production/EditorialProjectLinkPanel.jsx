import { useMemo, useState } from "react";
import { getReviewStatusLabel } from "../../models/editorialProduction";

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
  const [evidenceExportId, setEvidenceExportId] = useState("");
  const linkedIds = useMemo(() => new Set(linkedProjects.map((project) => project.id)), [linkedProjects]);
  const selectable = visibleProjects.filter((project) => !linkedIds.has(project.id));
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
        <div className="editorial-inline-form">
          <select value={pickProjectId} onChange={(event) => setPickProjectId(event.target.value)}>
            <option value="">Selecciona proyecto operativo</option>
            {selectable.map((project) => (
              <option value={project.id} key={project.id}>{project.name || project.id}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !pickProjectId} onClick={() => { onLink(pickProjectId); setPickProjectId(""); }}>
            {busy ? "Vinculando…" : "Vincular"}
          </button>
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
