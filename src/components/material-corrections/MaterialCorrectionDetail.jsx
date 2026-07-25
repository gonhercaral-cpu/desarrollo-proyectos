import { useEffect, useMemo, useRef, useState } from "react";
import {
  DISTRIBUTION_DESTINATIONS,
  DISTRIBUTION_STATUS_OPTIONS,
  MATERIAL_CORRECTION_PRIORITY_OPTIONS,
  MATERIAL_CORRECTION_STATUS_OPTIONS,
  MATERIAL_TYPE_OPTIONS,
} from "../../material-corrections/constants";
import {
  formatFileSize,
  formatMaterialCorrectionDate,
  getErrorTypeLabel,
  getMaterialTypeLabel,
  getOptionLabel,
  validateInternalCorrectedFile,
} from "../../material-corrections/utils";
import {
  addMaterialCorrectionComment,
  deleteMaterialCorrectionEvidence,
  getMaterialCorrectionEvidenceDownloadUrl,
  subscribeToMaterialCorrectionDetail,
  updateMaterialCorrectionReport,
  uploadMaterialCorrectionEvidence,
} from "../../services/materialCorrectionsService";

function managementForm(report) {
  return {
    priority: report?.priority || "normal",
    status: report?.status || "reported",
    assignedUid: report?.assignedTo?.uid || "",
    reviewResult: report?.reviewResult || "",
    appliedSolution: report?.appliedSolution || "",
    correctedFileLink: report?.correctedFileLink || "",
    duplicateFolio: report?.duplicateFolio || "",
    distribution: report?.distribution || {},
  };
}

function classificationForm(report) {
  const classification = report?.confirmedClassification || report?.originalClassification || {};
  return {
    levelName: classification.levelName || report?.levelName || "",
    bookName: classification.bookName || report?.bookName || "",
    unitNumber: classification.unitNumber || report?.unitNumber || "",
    unitName: classification.unitName || report?.unitName || "",
    lessonNumber: classification.lessonNumber || report?.lessonNumber || "",
    materialType: classification.materialType || report?.materialType || "other",
    materialName: classification.materialName || report?.materialName || "",
    pageNumber: classification.pageNumber || report?.pageNumber || "",
    exerciseNumber: classification.exerciseNumber || report?.exerciseNumber || "",
    questionNumber: classification.questionNumber || report?.questionNumber || "",
    slideNumber: classification.slideNumber || report?.slideNumber || "",
    songName: classification.songName || report?.songName || "",
    timestamp: classification.timestamp || report?.timestamp || "",
  };
}

function historyValue(value) {
  if (value === null || value === undefined || value === "") return "Sin valor";
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return formatMaterialCorrectionDate(value);
    if (value.name) return value.name;
    return JSON.stringify(value);
  }
  return String(value);
}

function OriginalData({ report }) {
  const original = report.originalClassification || {};
  return (
    <section className="material-detail-section">
      <header><h3>Información original</h3><span>Solo lectura</span></header>
      <div className="material-original-grid">
        <dl className="material-data-list">
          <div><dt>Reportante</dt><dd>{report.reportedBy?.name}</dd></div>
          <div><dt>Puesto</dt><dd>{report.reportedBy?.position}</dd></div>
          <div><dt>Plantel</dt><dd>{report.reportedBy?.campus}</dd></div>
          <div><dt>Contacto</dt><dd>{report.reportedBy?.contact}</dd></div>
          <div><dt>Fecha</dt><dd>{formatMaterialCorrectionDate(report.createdAt)}</dd></div>
          <div><dt>Folio</dt><dd>{report.folio}</dd></div>
        </dl>
        <dl className="material-data-list">
          <div><dt>Nivel</dt><dd>{original.levelName || "—"}</dd></div>
          <div><dt>Libro</dt><dd>{original.bookName || "—"}</dd></div>
          <div><dt>Unidad</dt><dd>{original.unitNumber || original.unitName || "—"}</dd></div>
          <div><dt>Lección</dt><dd>{original.lessonNumber || "—"}</dd></div>
          <div><dt>Material</dt><dd>{getMaterialTypeLabel(original.materialType)}{original.materialName ? ` · ${original.materialName}` : ""}</dd></div>
          <div><dt>Ubicación</dt><dd>{[
            original.pageNumber && `Pág. ${original.pageNumber}`,
            original.slideNumber && `Diap. ${original.slideNumber}`,
            original.exerciseNumber && `Ej. ${original.exerciseNumber}`,
            original.questionNumber && `Preg. ${original.questionNumber}`,
            original.timestamp,
          ].filter(Boolean).join(" · ") || "—"}</dd></div>
        </dl>
      </div>
      <div className="material-original-text">
        <article><h4>Tipo de error</h4><p>{getErrorTypeLabel(report.errorType)}</p></article>
        <article><h4>Descripción</h4><p>{report.description}</p></article>
        <article><h4>Texto actual</h4><p>{report.currentContent || "Sin texto registrado."}</p></article>
        <article><h4>Corrección sugerida</h4><p>{report.suggestedCorrection || "Sin sugerencia."}</p></article>
      </div>
      {report.externalEvidenceUrl && (
        <a href={report.externalEvidenceUrl} target="_blank" rel="noreferrer" className="material-external-evidence">
          Abrir evidencia externa
        </a>
      )}
    </section>
  );
}

export default function MaterialCorrectionDetail({
  reportId,
  assignees,
  isAdmin,
  onBack,
  onDeleted,
}) {
  const [report, setReport] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [evidences, setEvidences] = useState([]);
  const [form, setForm] = useState(() => managementForm(null));
  const [classification, setClassification] = useState(() => classificationForm(null));
  const [reclassifying, setReclassifying] = useState(false);
  const [comment, setComment] = useState("");
  const [commentVisibility, setCommentVisibility] = useState("internal");
  const [informationRequest, setInformationRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState(false);
  const uploadAbortRef = useRef(null);

  useEffect(() => {
    const unsubscribe = subscribeToMaterialCorrectionDetail(reportId, {
      onReport: (nextReport) => {
        setReport(nextReport);
        if (nextReport) {
          setForm(managementForm(nextReport));
          setClassification(classificationForm(nextReport));
        }
        setLoading(false);
      },
      onComments: setComments,
      onHistory: setHistory,
      onEvidences: setEvidences,
      onError: (subscriptionError) => {
        setError(subscriptionError.message || "No se pudo cargar detalle.");
        setLoading(false);
      },
    });
    return unsubscribe;
  }, [reportId]);

  const publicComments = useMemo(
    () => comments.filter((item) => item.visibility === "public"),
    [comments]
  );
  const internalComments = useMemo(
    () => comments.filter((item) => item.visibility === "internal"),
    [comments]
  );

  function setManagementField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setDistributionField(key, field, value) {
    setForm((current) => ({
      ...current,
      distribution: {
        ...current.distribution,
        [key]: {
          ...(current.distribution?.[key] || {}),
          [field]: value,
        },
      },
    }));
  }

  async function runAction(action, callback) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await callback();
      setSuccess("Cambios guardados.");
      if (action === "delete") onDeleted?.();
    } catch (actionError) {
      setError(actionError.message || "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  function saveManagement() {
    const assignedTo = assignees.find((assignee) => assignee.uid === form.assignedUid) || null;
    runAction("update", () => updateMaterialCorrectionReport(reportId, {
      priority: form.priority,
      status: form.status,
      assignedTo,
      reviewResult: form.reviewResult,
      appliedSolution: form.appliedSolution,
      correctedFileLink: form.correctedFileLink,
      duplicateFolio: form.duplicateFolio,
      distribution: form.distribution,
    }));
  }

  function saveReclassification() {
    runAction("reclassify", async () => {
      await updateMaterialCorrectionReport(reportId, {
        confirmedClassification: classification,
      }, "reclassify");
      setReclassifying(false);
    });
  }

  function reopenReport() {
    runAction("reopen", () => updateMaterialCorrectionReport(
      reportId,
      { status: "under_review" },
      "reopen"
    ));
  }

  function archiveReport() {
    runAction("archive", () => updateMaterialCorrectionReport(reportId, {}, "archive"));
  }

  function deleteReport() {
    if (!window.confirm("Ocultar este reporte como eliminado. Historial se conservará para auditoría.")) return;
    runAction("delete", () => updateMaterialCorrectionReport(reportId, {}, "delete"));
  }

  function submitComment(event) {
    event.preventDefault();
    if (!comment.trim()) return;
    runAction("comment", async () => {
      await addMaterialCorrectionComment(reportId, {
        message: comment,
        visibility: commentVisibility,
        type: "comment",
      });
      setComment("");
    });
  }

  function requestInformation(event) {
    event.preventDefault();
    if (!informationRequest.trim()) return;
    runAction("request-information", async () => {
      await addMaterialCorrectionComment(reportId, {
        message: informationRequest,
        visibility: "public",
        type: "information_request",
      });
      setInformationRequest("");
    });
  }

  async function openEvidence(evidence) {
    try {
      const result = await getMaterialCorrectionEvidenceDownloadUrl({
        reportId,
        evidenceId: evidence.id,
      });
      window.location.assign(result.url);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  function removeEvidence(evidence) {
    if (!window.confirm(`Eliminar evidencia "${evidence.originalName}" de forma permanente.`)) return;
    runAction("delete-evidence", () => deleteMaterialCorrectionEvidence(reportId, evidence.id));
  }

  async function uploadCorrectedFile(event) {
    const input = event.target;
    let file;
    try {
      file = validateInternalCorrectedFile(input.files?.[0]);
    } catch (validationError) {
      setError(validationError.message);
      input.value = "";
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setBusy(true);
    setUploadingFile(true);
    setError("");
    try {
      await uploadMaterialCorrectionEvidence({
        file,
        reportId,
        category: "internal_corrected",
        signal: controller.signal,
      });
      setSuccess("Archivo corregido cargado y validado.");
      input.value = "";
    } catch (uploadError) {
      setError(uploadError?.name === "AbortError" ? "Carga cancelada." : uploadError.message);
    } finally {
      setBusy(false);
      setUploadingFile(false);
      uploadAbortRef.current = null;
    }
  }

  if (loading) {
    return <section className="material-corrections-page"><p>Cargando reporte…</p></section>;
  }
  if (!report) {
    return (
      <section className="material-corrections-page">
        <button type="button" className="secondary-button" onClick={onBack}>Volver</button>
        <div className="form-error">Reporte no encontrado.</div>
      </section>
    );
  }

  return (
    <section className="material-corrections-page material-detail-page">
      <header className="material-detail-header">
        <button type="button" className="secondary-button" onClick={onBack}>← Volver</button>
        <div>
          <span>Correcciones de material</span>
          <h2>{report.folio}</h2>
          <p>{report.bookName} · Unidad {report.unitNumber || report.unitName}</p>
        </div>
        <div className={`material-priority priority-${report.priority}`}>
          {getOptionLabel(MATERIAL_CORRECTION_PRIORITY_OPTIONS, report.priority)}
        </div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}
      {success && <div className="success-box" role="status">{success}</div>}

      <OriginalData report={report} />

      <section className="material-detail-section">
        <header>
          <h3>Clasificación confirmada</h3>
          <button type="button" className="secondary-button" onClick={() => setReclassifying((current) => !current)}>
            {reclassifying ? "Cancelar" : "Reclasificar"}
          </button>
        </header>
        {reclassifying ? (
          <div className="material-management-grid">
            <label>Nivel<input value={classification.levelName} onChange={(event) => setClassification({ ...classification, levelName: event.target.value })} /></label>
            <label>Libro<input value={classification.bookName} onChange={(event) => setClassification({ ...classification, bookName: event.target.value })} /></label>
            <label>Unidad<input type="number" min="1" value={classification.unitNumber} onChange={(event) => setClassification({ ...classification, unitNumber: event.target.value })} /></label>
            <label>Nombre de unidad<input value={classification.unitName} onChange={(event) => setClassification({ ...classification, unitName: event.target.value })} /></label>
            <label>Lección<input type="number" min="1" value={classification.lessonNumber} onChange={(event) => setClassification({ ...classification, lessonNumber: event.target.value })} /></label>
            <label>Tipo de material<select value={classification.materialType} onChange={(event) => setClassification({ ...classification, materialType: event.target.value })}>{MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Material<input value={classification.materialName} onChange={(event) => setClassification({ ...classification, materialName: event.target.value })} /></label>
            <label>Página<input value={classification.pageNumber} onChange={(event) => setClassification({ ...classification, pageNumber: event.target.value })} /></label>
            <label>Diapositiva<input value={classification.slideNumber} onChange={(event) => setClassification({ ...classification, slideNumber: event.target.value })} /></label>
            <label>Ejercicio<input value={classification.exerciseNumber} onChange={(event) => setClassification({ ...classification, exerciseNumber: event.target.value })} /></label>
            <label>Pregunta<input value={classification.questionNumber} onChange={(event) => setClassification({ ...classification, questionNumber: event.target.value })} /></label>
            <label>Minuto o sección<input value={classification.timestamp} onChange={(event) => setClassification({ ...classification, timestamp: event.target.value })} /></label>
            <div className="material-grid-wide"><button type="button" onClick={saveReclassification} disabled={busy}>Guardar reclasificación</button></div>
          </div>
        ) : (
          <p>
            {classification.levelName} · {classification.bookName} · Unidad {classification.unitNumber || classification.unitName}
            {" · "}{getMaterialTypeLabel(classification.materialType)}
          </p>
        )}
      </section>

      <section className="material-detail-section">
        <header><h3>Gestión interna</h3><span>Editable según permisos</span></header>
        <div className="material-management-grid">
          <label>
            Prioridad
            <select value={form.priority} onChange={(event) => setManagementField("priority", event.target.value)}>
              {MATERIAL_CORRECTION_PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Responsable
            <select value={form.assignedUid} onChange={(event) => setManagementField("assignedUid", event.target.value)}>
              <option value="">Sin responsable</option>
              {assignees.map((assignee) => <option key={assignee.uid} value={assignee.uid}>{assignee.name}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(event) => setManagementField("status", event.target.value)}>
              {MATERIAL_CORRECTION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Reporte duplicado relacionado
            <input placeholder="MAT-2026-000001" value={form.duplicateFolio} onChange={(event) => setManagementField("duplicateFolio", event.target.value)} />
          </label>
          <label className="material-grid-wide">
            Resultado de revisión
            <textarea rows="4" value={form.reviewResult} onChange={(event) => setManagementField("reviewResult", event.target.value)} maxLength={6000} />
          </label>
          <label className="material-grid-wide">
            Solución aplicada
            <textarea rows="4" value={form.appliedSolution} onChange={(event) => setManagementField("appliedSolution", event.target.value)} maxLength={6000} />
          </label>
          <label className="material-grid-wide">
            Enlace al archivo corregido
            <input type="url" placeholder="https://..." value={form.correctedFileLink} onChange={(event) => setManagementField("correctedFileLink", event.target.value)} />
          </label>
          <label className="material-corrected-upload">
            Archivo corregido
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.ogg,.mp4,.mov,.webm,.docx,.pptx,.xlsx,.zip" onChange={uploadCorrectedFile} disabled={busy} />
          </label>
          {uploadingFile && <button type="button" className="secondary-button" onClick={() => uploadAbortRef.current?.abort()}>Cancelar carga</button>}
        </div>
      </section>

      <section className="material-detail-section">
        <header><h3>Publicación y distribución</h3><span>Todos los destinos requeridos deben completarse</span></header>
        <div className="material-distribution-list">
          {DISTRIBUTION_DESTINATIONS.map((destination) => {
            const value = form.distribution?.[destination.key] || {};
            return (
              <article key={destination.key}>
                <div className="material-distribution-title">
                  <strong>{destination.label}</strong>
                  <label><input type="checkbox" checked={value.required === true} onChange={(event) => setDistributionField(destination.key, "required", event.target.checked)} /> Requerido</label>
                </div>
                <label>Estado<select value={value.status || "pending"} onChange={(event) => setDistributionField(destination.key, "status", event.target.value)}>{DISTRIBUTION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label>Enlace<input type="url" value={value.link || ""} onChange={(event) => setDistributionField(destination.key, "link", event.target.value)} placeholder="https://..." /></label>
                <label>Comentario<input value={value.comment || ""} onChange={(event) => setDistributionField(destination.key, "comment", event.target.value)} maxLength={1200} /></label>
                {value.date && <small>{formatMaterialCorrectionDate(value.date)} · {value.user?.name || "Usuario"}</small>}
              </article>
            );
          })}
        </div>
        <button type="button" onClick={saveManagement} disabled={busy}>Guardar gestión y publicación</button>
      </section>

      <section className="material-detail-section">
        <header><h3>Evidencias y archivos</h3><span>{evidences.filter((item) => item.status === "ready").length}</span></header>
        {evidences.filter((item) => item.status === "ready").length === 0 ? (
          <p className="material-empty">Sin evidencias validadas.</p>
        ) : (
          <ul className="material-detail-evidence-list">
            {evidences.filter((item) => item.status === "ready").map((evidence) => (
              <li key={evidence.id}>
                <button type="button" onClick={() => openEvidence(evidence)}>
                  {evidence.originalName}
                  <small>{formatFileSize(evidence.size)} · {evidence.source}</small>
                </button>
                {isAdmin && (
                  <button type="button" className="material-evidence-delete" onClick={() => removeEvidence(evidence)}>
                    Eliminar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="material-detail-section material-comments-section">
        <header><h3>Comentarios</h3><span>Públicos e internos separados</span></header>
        <div className="material-comment-columns">
          <article>
            <h4>Internos</h4>
            {internalComments.length === 0 ? <p className="material-empty">Sin comentarios internos.</p> : (
              <ul>{internalComments.map((item) => <li key={item.id}><p>{item.message}</p><small>{item.author?.name} · {formatMaterialCorrectionDate(item.createdAt)}</small></li>)}</ul>
            )}
          </article>
          <article>
            <h4>Públicos</h4>
            {publicComments.length === 0 ? <p className="material-empty">Sin comentarios públicos.</p> : (
              <ul>{publicComments.map((item) => <li key={item.id} className={item.type === "information_request" ? "request" : ""}><p>{item.message}</p><small>{item.author?.name} · {formatMaterialCorrectionDate(item.createdAt)}</small></li>)}</ul>
            )}
          </article>
        </div>
        <form onSubmit={submitComment} className="material-inline-form">
          <label>
            Nuevo comentario
            <textarea rows="3" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={4000} />
          </label>
          <label>
            Visibilidad
            <select value={commentVisibility} onChange={(event) => setCommentVisibility(event.target.value)}>
              <option value="internal">Interno</option>
              <option value="public">Público</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !comment.trim()}>Agregar comentario</button>
        </form>
        <form onSubmit={requestInformation} className="material-inline-form material-information-request">
          <label>
            Solicitud de información al reportante
            <textarea rows="3" value={informationRequest} onChange={(event) => setInformationRequest(event.target.value)} maxLength={4000} />
          </label>
          <button type="submit" disabled={busy || !informationRequest.trim()}>Solicitar información</button>
        </form>
      </section>

      <section className="material-detail-section">
        <header><h3>Historial</h3><span>{history.length} cambios</span></header>
        {history.length === 0 ? <p className="material-empty">Sin cambios registrados.</p> : (
          <ol className="material-history-list">
            {history.map((item) => (
              <li key={item.id}>
                <strong>{item.field || item.action}</strong>
                <span>{historyValue(item.previousValue)} → {historyValue(item.newValue)}</span>
                <small>{item.actor?.name || "Sistema"} · {formatMaterialCorrectionDate(item.createdAt)}</small>
              </li>
            ))}
          </ol>
        )}
      </section>

      {isAdmin && (
        <section className="material-detail-section material-admin-actions">
          <header><h3>Acciones administrativas</h3></header>
          {["completed", "dismissed", "duplicate"].includes(report.status) && <button type="button" className="secondary-button" onClick={reopenReport} disabled={busy}>Reabrir</button>}
          <button type="button" className="secondary-button" onClick={archiveReport} disabled={busy}>Archivar</button>
          <button type="button" className="danger-button" onClick={deleteReport} disabled={busy}>Eliminar</button>
        </section>
      )}
    </section>
  );
}
