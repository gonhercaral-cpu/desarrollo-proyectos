import {
  formatMaterialCorrectionDate,
  getErrorTypeLabel,
  getMaterialTypeLabel,
  getPriorityOption,
  getStatusOption,
  isDistributionPending,
} from "../../material-corrections/utils";

export default function MaterialCorrectionRow({
  report,
  onOpen,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}) {
  const status = getStatusOption(report.status);
  const priority = getPriorityOption(report.priority);
  return (
    <article
      className="material-correction-row"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {draggable && <span className="material-drag-handle" title="Arrastrar para ordenar" aria-hidden="true">⋮⋮</span>}
      <button type="button" className="material-row-main" onClick={() => onOpen(report.id)}>
        <span className="material-row-folio">{report.folio}</span>
        <span className="material-row-location">
          <strong>{report.levelName || "Sin nivel"}</strong>
          <small>
            Unidad {report.unitNumber || "—"}
            {report.unitName ? ` · ${report.unitName}` : ""}
          </small>
        </span>
        <span className="material-row-classification">
          <strong>{getMaterialTypeLabel(report.materialType)}</strong>
          <small>{getErrorTypeLabel(report.errorType)}</small>
        </span>
        <span className="material-row-reporter">
          <strong>{report.reportedBy?.name || "Sin reportante"}</strong>
          <small>{report.reportedBy?.campus || "Sin plantel"}</small>
        </span>
        <span className="material-row-date">{formatMaterialCorrectionDate(report.createdAt)}</span>
        <span className={`material-priority priority-${report.priority}`}>{priority.label}</span>
        <span className="material-row-owner">{report.assignedTo?.name || "Sin responsable"}</span>
        <span className={`material-status status-${report.status}`}>{status.label}</span>
        <span className="material-row-indicators" aria-label="Indicadores">
          <i className={Number(report.evidenceCount || 0) > 0 ? "active" : ""} title={`${report.evidenceCount || 0} evidencias`}>E</i>
          <i className={isDistributionPending(report, "inPersonDrive") ? "pending" : "active"} title="Publicación presencial">P</i>
          <i className={isDistributionPending(report, "onlineDrive") ? "pending" : "active"} title="Publicación en línea">L</i>
        </span>
      </button>
    </article>
  );
}
