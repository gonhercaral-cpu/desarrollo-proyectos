import { useMemo, useState } from "react";
import {
  canPublishReviewStatus,
  EDITORIAL_PUBLICATION_VARIANTS,
  getPublicationStateLabel,
  getPublicationVariantLabel,
  isPublishableExport,
  isPublishableVersion,
} from "../../models/editorialPublication";
import { downloadableExports, variantLabel } from "../../utils/editorialDownloads";

// Fase 7 — Panel de publicaciones inmutables. Sólo publica documentos aprobados
// o listos para imprenta; congela versión (snapshot) + exportaciones terminadas.
export default function EditorialPublicationsPanel({
  publications,
  versions,
  exports,
  reviewStatus,
  caps,
  busy,
  error,
  onPublish,
  onUnpublish,
  onRepublish,
  onArchive,
  onOpenSource,
  onDownloadExport,
}) {
  const publishableVersions = useMemo(() => versions.filter(isPublishableVersion), [versions]);
  const publishableExports = useMemo(() => exports.filter(isPublishableExport), [exports]);
  const [form, setForm] = useState({ versionId: "", variant: "student", exportIds: [], notes: "" });

  const canPublishNow = canPublishReviewStatus(reviewStatus);
  const readyToSubmit =
    caps.publish && canPublishNow && form.versionId && form.exportIds.length > 0 && !busy;

  const selectedVersion = publishableVersions.find((version) => version.id === form.versionId) || null;

  function toggleExport(id) {
    setForm((prev) => ({
      ...prev,
      exportIds: prev.exportIds.includes(id)
        ? prev.exportIds.filter((value) => value !== id)
        : [...prev.exportIds, id],
    }));
  }

  function submit() {
    if (!readyToSubmit) return;
    onPublish({
      version: selectedVersion,
      exports: publishableExports.filter((item) => form.exportIds.includes(item.id)),
      variant: form.variant,
      reviewStatus,
      notes: form.notes,
    });
    setForm({ versionId: "", variant: "student", exportIds: [], notes: "" });
  }

  return (
    <section className="editorial-production-section editorial-publications">
      {error && <p className="editorial-notice warning">{error}</p>}

      {caps.publish ? (
        <div className="editorial-publish-form">
          <h4>Publicar revisión</h4>
          {!canPublishNow && (
            <p className="editorial-notice warning">
              Sólo se publican documentos aprobados o listos para imprenta. Estado actual: {reviewStatus}.
            </p>
          )}
          <label>
            Versión (snapshot)
            <select
              value={form.versionId}
              onChange={(event) => setForm({ ...form, versionId: event.target.value })}
              disabled={!canPublishNow}
            >
              <option value="">Selecciona una versión lista</option>
              {publishableVersions.map((version) => (
                <option value={version.id} key={version.id}>
                  v{version.versionNumber} · {version.name} · {version.pageCount} págs
                </option>
              ))}
            </select>
          </label>
          <label>
            Variante
            <select
              value={form.variant}
              onChange={(event) => setForm({ ...form, variant: event.target.value })}
              disabled={!canPublishNow}
            >
              {EDITORIAL_PUBLICATION_VARIANTS.map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <fieldset className="editorial-publish-exports">
            <legend>Exportaciones terminadas</legend>
            {publishableExports.length === 0 && <p className="editorial-hint">No hay exportaciones terminadas.</p>}
            {publishableExports.map((item) => (
              <label className="check-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={form.exportIds.includes(item.id)}
                  onChange={() => toggleExport(item.id)}
                  disabled={!canPublishNow}
                />
                {item.type} · {item.variant} · {item.sizeBytes ? `${Math.round(item.sizeBytes / 1024)} KB` : ""}
              </label>
            ))}
          </fieldset>
          <label>
            Notas
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Contexto de la publicación" />
          </label>
          <button type="button" className="editorial-button primary compact" disabled={!readyToSubmit} onClick={submit}>
            {busy ? "Publicando…" : "Publicar revisión"}
          </button>
        </div>
      ) : (
        <p className="editorial-hint">No tienes permiso para publicar. Puedes consultar el historial.</p>
      )}

      <div className="editorial-publications-list">
        <h4>Historial de publicaciones</h4>
        {publications.length === 0 && <p className="editorial-hint">Sin publicaciones.</p>}
        {publications.map((pub) => (
          <article className={`editorial-publication-item state-${pub.status}`} key={pub.id}>
            <header>
              <strong>Revisión {pub.revision} · {getPublicationVariantLabel(pub.variant)}</strong>
              <span className={`editorial-pub-badge ${pub.status}`}>{getPublicationStateLabel(pub.status)}</span>
            </header>
            <small>
              v{pub.versionNumber} · {pub.pageCount} págs · {(pub.exports || []).length} archivo(s)
              {pub.publishedByName ? ` · ${pub.publishedByName}` : ""}
            </small>
            {pub.notes && <p className="editorial-pub-notes">{pub.notes}</p>}
            <div className="editorial-pub-downloads">
              {caps.download && downloadableExports(pub).length > 0 ? (
                downloadableExports(pub).map((ref) => (
                  <button type="button" className="editorial-button primary compact" key={ref.exportId} title={`Descargar PDF ${variantLabel(ref.variant || ref.type)}`} onClick={() => onDownloadExport(ref)}>
                    Descargar {variantLabel(ref.variant || ref.type)}
                  </button>
                ))
              ) : (
                <span className="editorial-hint">{caps.download ? "Sin archivo descargable." : "Sin permiso de descarga."}</span>
              )}
            </div>
            <div className="editorial-pub-actions">
              <button type="button" onClick={() => onOpenSource(pub)}>Abrir documento fuente</button>
              {caps.publish && pub.status === "published" && (
                <button type="button" onClick={() => onUnpublish(pub)}>Despublicar</button>
              )}
              {caps.publish && pub.status === "unpublished_after_release" && (
                <button type="button" onClick={() => onRepublish(pub)}>Volver a publicar</button>
              )}
              {caps.manage && pub.status !== "archived" && (
                <button type="button" onClick={() => onArchive(pub)}>Archivar</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
