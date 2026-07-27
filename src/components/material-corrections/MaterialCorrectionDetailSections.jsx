import {
  DISTRIBUTION_DESTINATIONS,
  DISTRIBUTION_STATUS_OPTIONS,
  MATERIAL_CORRECTION_PRIORITY_OPTIONS,
  MATERIAL_CORRECTION_STATUS_OPTIONS,
} from "../../material-corrections/constants";
import {
  formatFileSize,
  formatMaterialCorrectionDate,
  getErrorTypeLabel,
  getMaterialTypeLabel,
  getOptionLabel,
} from "../../material-corrections/utils";
import MaterialCorrectionIcon from "./MaterialCorrectionIcon";

const HISTORY_FIELD_LABELS = {
  appliedSolution: "Solución aplicada",
  archived: "Archivo",
  assignedTo: "Responsable",
  confirmedClassification: "Clasificación",
  correctedFileLink: "Archivo corregido",
  deleted: "Eliminación",
  distribution: "Publicación",
  duplicateFolio: "Reporte relacionado",
  priority: "Prioridad",
  reviewResult: "Resultado de revisión",
  status: "Estado",
};

const HISTORY_ACTION_LABELS = {
  archive: "Reporte archivado",
  comment: "Comentario agregado",
  created: "Reporte creado",
  delete: "Reporte eliminado",
  delete_evidence: "Evidencia eliminada",
  evidence_uploaded: "Evidencia agregada",
  reclassify: "Reporte reclasificado",
  reopen: "Reporte reabierto",
  update: "Reporte actualizado",
};

const HISTORY_VALUE_LABELS = new Map([
  ...MATERIAL_CORRECTION_STATUS_OPTIONS.map((option) => [option.value, option.label]),
  ...MATERIAL_CORRECTION_PRIORITY_OPTIONS.map((option) => [option.value, option.label]),
]);

function historyValue(value) {
  if (value === null || value === undefined || value === "") return "Sin valor";
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return formatMaterialCorrectionDate(value);
    if (value.name) return value.name;
    return "Datos actualizados";
  }
  const stringValue = String(value);
  return HISTORY_VALUE_LABELS.get(stringValue) || stringValue;
}

function SectionTitle({ icon, title, detail }) {
  return (
    <header className="material-detail-section-heading">
      <div>
        <span className="material-detail-section-icon">
          <MaterialCorrectionIcon name={icon} />
        </span>
        <h2>{title}</h2>
      </div>
      {detail && <span>{detail}</span>}
    </header>
  );
}

export function MaterialCorrectionDetailHeader({ report, onBack }) {
  const status = getOptionLabel(MATERIAL_CORRECTION_STATUS_OPTIONS, report.status);
  const priority = getOptionLabel(MATERIAL_CORRECTION_PRIORITY_OPTIONS, report.priority);
  return (
    <header className="module-topbar purchase-module-topbar purchase-focused-topbar material-detail-topbar">
      <div className="module-topbar-main">
        <div className="module-topbar-module-icon purchase-topbar-module-icon">
          <MaterialCorrectionIcon className="purchase-svg-icon" />
        </div>
        <div className="module-topbar-copy">
          <p className="module-topbar-kicker">CORRECCIONES DE MATERIAL</p>
          <h1>{report.folio}</h1>
          <p>
            {report.levelName || "Sin nivel"} · Unidad {report.unitNumber || "—"}
            {report.unitName ? ` · ${report.unitName}` : ""}
            {" · "}{formatMaterialCorrectionDate(report.createdAt)}
          </p>
        </div>
      </div>
      <div className="module-topbar-actions purchase-topbar-actions compact material-detail-topbar-actions">
        <div className="material-detail-topbar-badges">
          <span className={`material-status status-${report.status}`}>{status}</span>
          <span className={`material-priority priority-${report.priority}`}>{priority}</span>
        </div>
        <button type="button" className="module-topbar-button" onClick={onBack}>
          <MaterialCorrectionIcon name="back" className="purchase-svg-icon" />
          Volver
        </button>
      </div>
    </header>
  );
}

export function MaterialCorrectionDetailNavigation() {
  return (
    <nav className="material-detail-navigation" aria-label="Secciones del reporte">
      {[
        ["error", "Error"],
        ["gestion", "Gestión"],
        ["publicacion", "Publicación"],
        ["evidencias", "Evidencias"],
        ["comentarios", "Comentarios"],
        ["historial", "Historial"],
      ].map(([id, label]) => (
        <a key={id} href={`#material-detail-${id}`}>{label}</a>
      ))}
    </nav>
  );
}

export function ErrorReportedSection({ report }) {
  const original = report.originalClassification || {};
  const location = [
    original.pageNumber && `Página ${original.pageNumber}`,
    original.slideNumber && `Diapositiva ${original.slideNumber}`,
    original.exerciseNumber && `Ejercicio ${original.exerciseNumber}`,
    original.questionNumber && `Pregunta ${original.questionNumber}`,
    original.timestamp,
  ].filter(Boolean);
  const historical = [
    original.bookName && `Libro: ${original.bookName}`,
    original.lessonNumber && `Lección: ${original.lessonNumber}`,
    original.materialName && `Material: ${original.materialName}`,
  ].filter(Boolean);

  return (
    <section id="material-detail-error" className="material-detail-section material-error-reported">
      <SectionTitle icon="error" title="Error reportado" detail="Información original" />
      <div className="material-error-tags">
        <span>{getMaterialTypeLabel(original.materialType || report.materialType)}</span>
        <span className="error-type">{getErrorTypeLabel(report.errorType)}</span>
        <span>{original.levelName || report.levelName || "Sin nivel"}</span>
        <span>
          Unidad {original.unitNumber || report.unitNumber || "—"}
          {(original.unitName || report.unitName) ? ` · ${original.unitName || report.unitName}` : ""}
        </span>
        {location.map((item) => <span key={item}>{item}</span>)}
      </div>
      <div className="material-error-description-card">
        <span>Descripción</span>
        <p>{report.description}</p>
      </div>
      {(report.currentContent || report.suggestedCorrection) && (
        <div className="material-error-comparison">
          {report.currentContent && (
            <article className="current">
              <span>Texto actual</span>
              <p>{report.currentContent}</p>
            </article>
          )}
          {report.suggestedCorrection && (
            <article className="suggested">
              <span>Corrección sugerida</span>
              <p>{report.suggestedCorrection}</p>
            </article>
          )}
        </div>
      )}
      {report.blocksClass && (
        <div className="material-blocks-class" role="note">
          <MaterialCorrectionIcon name="urgent" />
          Impide impartir correctamente la clase
        </div>
      )}
      {historical.length > 0 && (
        <p className="material-historical-context">
          <strong>Datos históricos:</strong> {historical.join(" · ")}
        </p>
      )}
    </section>
  );
}

export function ReporterSection({ report }) {
  const reporter = report.reportedBy || {};
  return (
    <section className="material-detail-section material-sidebar-section">
      <SectionTitle icon="person" title="Reportante" />
      <dl className="material-compact-data">
        <div><dt>Nombre</dt><dd>{reporter.name || "Sin nombre"}</dd></div>
        <div><dt>Plantel</dt><dd>{reporter.campus || "Sin plantel"}</dd></div>
        {reporter.position && <div><dt>Puesto histórico</dt><dd>{reporter.position}</dd></div>}
        {reporter.contact && <div><dt>Contacto histórico</dt><dd>{reporter.contact}</dd></div>}
      </dl>
    </section>
  );
}

export function DistributionSection({ distribution, onChange }) {
  return (
    <section id="material-detail-publicacion" className="material-detail-section">
      <SectionTitle
        icon="distribution"
        title="Publicación y distribución"
        detail="Completar destinos requeridos"
      />
      <div className="material-distribution-compact">
        {DISTRIBUTION_DESTINATIONS.map((destination) => {
          const value = distribution?.[destination.key] || {};
          const status = value.status || "pending";
          return (
            <article key={destination.key}>
              <div className="material-distribution-row-heading">
                <strong>{destination.label}</strong>
                <span className={`material-distribution-badge status-${status}`}>
                  {getOptionLabel(DISTRIBUTION_STATUS_OPTIONS, status)}
                </span>
              </div>
              <div className="material-distribution-row-fields">
                <label className="material-required-toggle">
                  <input
                    type="checkbox"
                    checked={value.required === true}
                    onChange={(event) => onChange(destination.key, "required", event.target.checked)}
                  />
                  Requerido
                </label>
                <label>
                  <span>Estado</span>
                  <select
                    value={status}
                    onChange={(event) => onChange(destination.key, "status", event.target.value)}
                  >
                    {DISTRIBUTION_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Enlace</span>
                  <input
                    type="url"
                    value={value.link || ""}
                    onChange={(event) => onChange(destination.key, "link", event.target.value)}
                    placeholder="https://..."
                  />
                </label>
                <label>
                  <span>Comentario</span>
                  <input
                    value={value.comment || ""}
                    onChange={(event) => onChange(destination.key, "comment", event.target.value)}
                    maxLength={1200}
                  />
                </label>
              </div>
              {(value.date || value.user?.name) && (
                <small>
                  {value.date ? formatMaterialCorrectionDate(value.date) : ""}
                  {value.date && value.user?.name ? " · " : ""}
                  {value.user?.name || ""}
                </small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function evidenceType(evidence) {
  const type = evidence.contentType || "";
  if (type.startsWith("image/")) return "Imagen";
  if (type.startsWith("audio/")) return "Audio";
  if (type.startsWith("video/")) return "Video";
  if (type === "application/pdf") return "PDF";
  return "Archivo";
}

export function EvidenceSection({
  evidences,
  externalUrl,
  isAdmin,
  onOpen,
  onDelete,
}) {
  const ready = evidences.filter((item) => item.status === "ready");
  return (
    <section id="material-detail-evidencias" className="material-detail-section material-sidebar-section">
      <SectionTitle icon="evidence" title="Evidencias y archivos" detail={`${ready.length}`} />
      {ready.length === 0 && !externalUrl ? (
        <p className="material-empty compact">Sin evidencias validadas.</p>
      ) : (
        <ul className="material-evidence-compact-list">
          {ready.map((evidence) => (
            <li key={evidence.id}>
              <span className="material-evidence-type">{evidenceType(evidence)}</span>
              <div>
                <strong>{evidence.originalName}</strong>
                <small>
                  {formatFileSize(evidence.size)}
                  {evidence.source === "internal_corrected" ? " · Archivo corregido" : ""}
                </small>
              </div>
              <button type="button" className="material-icon-action" onClick={() => onOpen(evidence)}>
                Abrir
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="material-icon-action danger"
                  onClick={() => onDelete(evidence)}
                >
                  Eliminar
                </button>
              )}
            </li>
          ))}
          {externalUrl && (
            <li>
              <span className="material-evidence-type">Enlace</span>
              <div><strong>Evidencia externa</strong><small>Drive o sitio externo</small></div>
              <a href={externalUrl} target="_blank" rel="noreferrer">Abrir</a>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export function CommentsSection({
  activeTab,
  comments,
  expanded,
  comment,
  informationRequest,
  busy,
  onTabChange,
  onExpand,
  onCommentChange,
  onInformationRequestChange,
  onSubmitComment,
  onRequestInformation,
}) {
  const shown = expanded ? comments : comments.slice(0, 3);
  const isPublic = activeTab === "public";
  return (
    <section id="material-detail-comentarios" className="material-detail-section material-sidebar-section">
      <SectionTitle icon="comments" title="Comentarios" detail={`${comments.length}`} />
      <div className="material-comment-tabs" role="tablist" aria-label="Tipo de comentario">
        {[
          ["internal", "Internos"],
          ["public", "Públicos"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            className={activeTab === value ? "active" : ""}
            onClick={() => onTabChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="material-empty compact">Sin comentarios {isPublic ? "públicos" : "internos"}.</p>
      ) : (
        <ul className="material-comment-compact-list">
          {shown.map((item) => (
            <li key={item.id} className={item.type === "information_request" ? "request" : ""}>
              <p>{item.message}</p>
              <small>{item.author?.name || "Sistema"} · {formatMaterialCorrectionDate(item.createdAt)}</small>
            </li>
          ))}
        </ul>
      )}
      {comments.length > 3 && (
        <button type="button" className="material-text-action" onClick={onExpand}>
          {expanded ? "Mostrar menos" : `Ver ${comments.length - 3} más`}
        </button>
      )}
      <form onSubmit={onSubmitComment} className="material-comment-form">
        <label>
          <span>Nuevo comentario {isPublic ? "público" : "interno"}</span>
          <textarea
            rows="2"
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            maxLength={4000}
          />
        </label>
        <button type="submit" disabled={busy || !comment.trim()}>Agregar</button>
      </form>
      {isPublic && (
        <form onSubmit={onRequestInformation} className="material-comment-form information">
          <label>
            <span>Solicitud de información</span>
            <textarea
              rows="2"
              value={informationRequest}
              onChange={(event) => onInformationRequestChange(event.target.value)}
              maxLength={4000}
            />
          </label>
          <button type="submit" disabled={busy || !informationRequest.trim()}>Solicitar</button>
        </form>
      )}
    </section>
  );
}

export function HistorySection({ history, expanded, onExpand }) {
  const shown = expanded ? history : history.slice(0, 4);
  return (
    <section id="material-detail-historial" className="material-detail-section material-sidebar-section">
      <SectionTitle icon="history" title="Historial" detail={`${history.length} cambios`} />
      {shown.length === 0 ? (
        <p className="material-empty compact">Sin cambios registrados.</p>
      ) : (
        <ol className="material-history-compact-list">
          {shown.map((item) => (
            <li key={item.id}>
              <strong>
                {HISTORY_FIELD_LABELS[item.field]
                  || HISTORY_ACTION_LABELS[item.action]
                  || "Actualización"}
              </strong>
              {(item.previousValue !== undefined || item.newValue !== undefined) && (
                <span>{historyValue(item.previousValue)} → {historyValue(item.newValue)}</span>
              )}
              <small>{item.actor?.name || "Sistema"} · {formatMaterialCorrectionDate(item.createdAt)}</small>
            </li>
          ))}
        </ol>
      )}
      {history.length > 4 && (
        <button type="button" className="material-text-action" onClick={onExpand}>
          {expanded ? "Ocultar historial completo" : "Ver historial completo"}
        </button>
      )}
    </section>
  );
}

export function AdminActionsSection({ report, busy, onReopen, onArchive, onDelete }) {
  return (
    <section className="material-detail-section material-sidebar-section material-admin-actions">
      <SectionTitle icon="archive" title="Acciones administrativas" />
      <div>
        {["completed", "dismissed", "duplicate"].includes(report.status) && (
          <button type="button" className="secondary-button" onClick={onReopen} disabled={busy}>
            Reabrir
          </button>
        )}
        <button type="button" className="secondary-button" onClick={onArchive} disabled={busy}>
          Archivar
        </button>
        <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>
          Eliminar
        </button>
      </div>
    </section>
  );
}

export function MaterialCorrectionConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}) {
  return (
    <div
      className="modal-backdrop material-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-confirm-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="material-confirm-dialog">
        <span className={`material-confirm-icon ${danger ? "danger" : ""}`}>
          <MaterialCorrectionIcon name={danger ? "delete" : "error"} />
        </span>
        <div>
          <h2 id="material-confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="material-confirm-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy} autoFocus>
            Cancelar
          </button>
          <button
            type="button"
            className={danger ? "danger-button" : "visual-primary-button"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
