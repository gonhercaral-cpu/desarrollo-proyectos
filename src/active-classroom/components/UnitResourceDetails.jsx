import { formatFileSize, formatResourceDate, getResourceIcon, getResourceKindLabel, isPreviewablePdf } from "../utils/resourceTypes";
import useActiveClassroomResourceUrl from "../hooks/useActiveClassroomResourceUrl";
import { isDriveResource } from "../utils/driveResources";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

const STATUS_ICONS = { ready: "check", pending: "clock", processing: "clock", error: "alert-circle", unavailable: "alert-circle", changed: "refresh" };

function DetailsPreview({ resource, url, error, loading }) {
  if (resource.kind === "image" && url) return <img src={url} alt={`Vista previa de ${resource.name}`} />;
  if (resource.kind === "audio" && url) return <audio src={url} controls preload="metadata" />;
  if (resource.kind === "video" && url) return <video src={url} controls preload="metadata" />;
  const pdf = isPreviewablePdf(resource);
  return <span className="ac-rm-preview-fallback">
    <i className={`ac-rm-type-icon is-${resource.kind}`} aria-hidden="true">{getResourceIcon(resource.kind, resource.name)}</i>
    <small role={error ? "alert" : "status"}>{error || (loading ? "Cargando archivo..." : url
      ? pdf ? "Abre el PDF en una pestaña nueva o descárgalo." : "Vista previa no disponible para este formato."
      : isDriveResource(resource) ? "Pulsa Abrir archivo para cargarlo desde Nube AES." : "Preparando archivo...")}</small>
  </span>;
}

export default function UnitResourceDetails({ resource, status, isGeneral, associationLabels = [], associationControls, actions, onClose, onReplace, disabled = false }) {
  const { url, error, loading, loadDriveContent, downloadName } = useActiveClassroomResourceUrl(resource);
  const drive = isDriveResource(resource);
  const kindLabel = getResourceKindLabel(resource.kind, resource.name);
  const pdf = isPreviewablePdf(resource);
  return <aside className="ac-rm-inspector" aria-label="Inspector del archivo seleccionado" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="ac-rm-inspector-head">
      <i className={`ac-rm-type-icon is-${resource.kind}`} aria-hidden="true">{getResourceIcon(resource.kind, resource.name)}</i>
      <div><h3>{resource.name}</h3><small>{kindLabel} · {formatFileSize(resource.sizeBytes)}</small></div>
      <button type="button" className="ac-rm-close" aria-label="Cerrar detalles" onClick={onClose}>×</button>
    </header>
    <div className="ac-rm-preview"><DetailsPreview resource={resource} url={url} error={error} loading={loading} /></div>
    {pdf && url && <a className="ac-rm-open-link" href={url} target="_blank" rel="noreferrer">Abrir PDF en pestaña nueva</a>}
    <section className="ac-rm-inspector-section">
      <h4>Información</h4>
      <dl className="ac-rm-info">
        <div><dt>Tipo</dt><dd>{kindLabel}</dd></div>
        <div><dt>Tamaño</dt><dd>{formatFileSize(resource.sizeBytes)}</dd></div>
        <div><dt>Última modificación</dt><dd>{formatResourceDate(resource.updatedAt)}</dd></div>
        <div><dt>Origen</dt><dd>{drive ? "Nube AES" : "Firebase Storage"}</dd></div>
      </dl>
    </section>
    <section className="ac-rm-inspector-section">
      <h4>Asociación</h4>
      <div className="ac-rm-badges">
        {isGeneral && <span className="ac-rm-badge is-general">General</span>}
        {associationLabels.map((label) => <span key={label} className="ac-rm-badge is-slide">{label}</span>)}
        {!isGeneral && !associationLabels.length && <small>Sin asociación.</small>}
      </div>
      {associationControls}
    </section>
    <section className="ac-rm-inspector-section">
      <h4>Estado</h4>
      <p className={`ac-rm-inspector-status is-${status.key}`} role="status">
        <ActiveClassroomIcon name={STATUS_ICONS[status.key] || "check"} size={20} />
        <span><strong>{status.label}</strong><small>{status.detail}</small></span>
      </p>
    </section>
    <footer className="ac-rm-inspector-footer">
      <button type="button" className="ac-rm-replace" disabled={disabled} onClick={onReplace}><ActiveClassroomIcon name="upload" size={18} />Reemplazar archivo</button>
      <div className="ac-rm-footer-row">
        {drive && !url && <button type="button" className="ac-rm-open" disabled={loading} onClick={loadDriveContent}>{loading ? "Cargando archivo..." : "Abrir archivo"}</button>}
        <a className={`ac-rm-download ${url ? "" : "is-disabled"}`} href={url || undefined} download={downloadName || resource.name} target="_blank" rel="noreferrer" aria-disabled={!url} onClick={(event) => { if (!url) event.preventDefault(); }}><ActiveClassroomIcon name="upload" size={18} className="is-download" />Descargar</a>
        {actions}
      </div>
    </footer>
  </aside>;
}
