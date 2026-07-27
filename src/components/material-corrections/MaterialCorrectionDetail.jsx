import { useEffect, useMemo, useRef, useState } from "react";
import {
  MATERIAL_CORRECTION_PRIORITY_OPTIONS,
  MATERIAL_TYPES_WITH_PAGE,
  MATERIAL_TYPE_OPTIONS,
} from "../../material-corrections/constants";
import {
  applyPersistedMaterialCorrectionPublicationSettings,
  buildMaterialCorrectionDetailUpdate,
  createMaterialCorrectionClassificationDraft,
  createMaterialCorrectionManagementDraft,
  getMaterialCorrectionDetailPermissions,
  materialCorrectionDraftsMatch,
} from "../../material-corrections/detailState";
import { formatMaterialCorrectionDate, getMaterialTypeLabel } from "../../material-corrections/utils";
import {
  addMaterialCorrectionComment,
  deleteMaterialCorrectionEvidence,
  getMaterialCorrectionEvidenceDownloadUrl,
  subscribeToMaterialCorrectionDetail,
  updateMaterialCorrectionReport,
  uploadMaterialCorrectionEvidence,
} from "../../services/materialCorrectionsService";
import { validateInternalCorrectedFile } from "../../material-corrections/utils";
import {
  AdminActionsSection,
  CommentsSection,
  DistributionSection,
  ErrorReportedSection,
  EvidenceSection,
  HistorySection,
  MaterialCorrectionConfirmDialog,
  MaterialCorrectionDetailHeader,
  MaterialCorrectionDetailNavigation,
  ReporterSection,
} from "./MaterialCorrectionDetailSections";
import MaterialCorrectionIcon from "./MaterialCorrectionIcon";

export default function MaterialCorrectionDetail({
  reportId,
  assignees,
  levels = [],
  isAdmin,
  currentUserId,
  onBack,
  onDeleted,
}) {
  const [report, setReport] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [evidences, setEvidences] = useState([]);
  const [form, setForm] = useState(() => createMaterialCorrectionManagementDraft(null));
  const [baselineForm, setBaselineForm] = useState(() => createMaterialCorrectionManagementDraft(null));
  const [classification, setClassification] = useState(
    () => createMaterialCorrectionClassificationDraft(null)
  );
  const [baselineClassification, setBaselineClassification] = useState(
    () => createMaterialCorrectionClassificationDraft(null)
  );
  const [reclassifying, setReclassifying] = useState(false);
  const [commentTab, setCommentTab] = useState("internal");
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [informationRequest, setInformationRequest] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState(false);
  const uploadAbortRef = useRef(null);
  const dirtyRef = useRef(false);
  const loadedReportRef = useRef(false);

  const managementDirty = !materialCorrectionDraftsMatch(form, baselineForm);
  const classificationDirty = reclassifying
    && !materialCorrectionDraftsMatch(classification, baselineClassification);
  const dirty = managementDirty || classificationDirty;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    loadedReportRef.current = false;
    dirtyRef.current = false;
    const unsubscribe = subscribeToMaterialCorrectionDetail(reportId, {
      onReport: (nextReport) => {
        setReport(nextReport);
        if (nextReport && (!loadedReportRef.current || !dirtyRef.current)) {
          const nextForm = createMaterialCorrectionManagementDraft(nextReport);
          const nextClassification = createMaterialCorrectionClassificationDraft(nextReport);
          setForm(nextForm);
          setBaselineForm(nextForm);
          setClassification(nextClassification);
          setBaselineClassification(nextClassification);
        }
        loadedReportRef.current = true;
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

  useEffect(() => {
    function preventUnsavedExit(event) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", preventUnsavedExit);
    return () => window.removeEventListener("beforeunload", preventUnsavedExit);
  }, []);

  useEffect(() => {
    if (!confirmation) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape" && !busy) setConfirmation(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmation, busy]);

  const publicComments = useMemo(
    () => comments.filter((item) => item.visibility === "public"),
    [comments]
  );
  const internalComments = useMemo(
    () => comments.filter((item) => item.visibility === "internal"),
    [comments]
  );
  const activeComments = commentTab === "public" ? publicComments : internalComments;
  const permissions = useMemo(() => getMaterialCorrectionDetailPermissions({
    report,
    isAdmin,
    currentUserId,
  }), [report, isAdmin, currentUserId]);
  const pendingRequiredDestinations = Object.values(form.distribution || {}).filter(
    (destination) => destination?.required === true && destination.status !== "completed"
  ).length;
  const completionBlocker = !form.appliedSolution.trim()
    ? "Registra la solución aplicada."
    : (
      form.publicationSettings.enabled && pendingRequiredDestinations > 0
        ? `Faltan ${pendingRequiredDestinations} destinos requeridos.`
        : ""
    );

  function setManagementField(key, value) {
    setSuccess("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setStatus(value) {
    if (
      value === "completed"
      && !["corrected", "publishing"].includes(report.status)
    ) {
      setError("La corrección debe estar marcada como corregida antes de completar.");
      return;
    }
    if (value === "completed" && completionBlocker) {
      setError(`No se puede completar: ${completionBlocker}`);
      return;
    }
    setManagementField("status", value);
  }

  function setDistributionField(key, field, value) {
    setSuccess("");
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

  function setPublicationSetting(field, value) {
    setSuccess("");
    setForm((current) => ({
      ...current,
      publicationSettings: {
        ...current.publicationSettings,
        [field]: value,
        ...(field === "enabled" && !value ? { collaboratorCanEdit: false } : {}),
      },
    }));
  }

  async function runAction(action, callback, successMessage = "Cambios guardados.") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await callback();
      setSuccess(successMessage);
      if (action === "delete") onDeleted?.();
    } catch (actionError) {
      setError(actionError.message || "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAllChanges() {
    if (!dirty) return;
    const update = buildMaterialCorrectionDetailUpdate({
      form,
      classification,
      assignees,
      includeClassification: classificationDirty,
      includeAdministration: permissions.canEditAdministration,
      includeDistribution: permissions.canEditDistribution,
    });
    setBusy(true);
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await updateMaterialCorrectionReport(
        reportId,
        update.changes,
        update.action,
        permissions
      );
      const persistedForm = applyPersistedMaterialCorrectionPublicationSettings(
        form,
        result.publicationSettings
      );
      dirtyRef.current = false;
      setForm(persistedForm);
      setBaselineForm(persistedForm);
      setBaselineClassification(classification);
      setReport((current) => (
        current
          ? { ...current, publicationSettings: persistedForm.publicationSettings }
          : current
      ));
      setReclassifying(false);
      setSuccess("Cambios guardados correctamente.");
    } catch (saveError) {
      setError(saveError.message || "No se pudieron guardar los cambios.");
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }

  function discardChanges() {
    const nextForm = createMaterialCorrectionManagementDraft(report);
    const nextClassification = createMaterialCorrectionClassificationDraft(report);
    dirtyRef.current = false;
    setForm(nextForm);
    setBaselineForm(nextForm);
    setClassification(nextClassification);
    setBaselineClassification(nextClassification);
    setReclassifying(false);
    setError("");
    setSuccess("");
  }

  function requestBack() {
    if (!dirty) {
      onBack();
      return;
    }
    setConfirmation({
      type: "leave",
      title: "Descartar cambios pendientes",
      message: "Hay cambios sin guardar. Al volver a la bandeja se perderán.",
      confirmLabel: "Descartar y volver",
      danger: true,
    });
  }

  function toggleReclassification() {
    if (reclassifying) {
      setClassification(baselineClassification);
    }
    setReclassifying((current) => !current);
  }

  function reopenReport() {
    runAction(
      "reopen",
      () => updateMaterialCorrectionReport(
        reportId,
        { status: "under_review" },
        "reopen",
        permissions
      ),
      "Reporte reabierto."
    );
  }

  function requestArchiveReport() {
    setConfirmation({
      type: "archive-report",
      title: "Archivar reporte",
      message: "El reporte dejará de aparecer en la bandeja activa, pero conservará toda su información e historial.",
      confirmLabel: "Archivar reporte",
      danger: false,
    });
  }

  function requestDeleteReport() {
    setConfirmation({
      type: "delete-report",
      title: "Eliminar reporte",
      message: "Esta acción es destructiva para la operación: ocultará el reporte de forma definitiva. Su historial se conserva para auditoría y sólo administradores pueden ejecutarla.",
      confirmLabel: "Eliminar reporte",
      danger: true,
    });
  }

  function submitComment(event) {
    event.preventDefault();
    if (!comment.trim()) return;
    runAction("comment", async () => {
      await addMaterialCorrectionComment(reportId, {
        message: comment,
        visibility: commentTab,
        type: "comment",
      }, permissions);
      setComment("");
    }, "Comentario agregado.");
  }

  function requestInformation(event) {
    event.preventDefault();
    if (!informationRequest.trim()) return;
    runAction("request-information", async () => {
      await addMaterialCorrectionComment(reportId, {
        message: informationRequest,
        visibility: "public",
        type: "information_request",
      }, permissions);
      setInformationRequest("");
    }, "Solicitud enviada.");
  }

  async function openEvidence(evidence) {
    try {
      setError("");
      const result = await getMaterialCorrectionEvidenceDownloadUrl({
        reportId,
        evidenceId: evidence.id,
      });
      window.location.assign(result.url);
    } catch (downloadError) {
      setError(downloadError.message || "No se pudo abrir la evidencia.");
    }
  }

  function requestDeleteEvidence(evidence) {
    setConfirmation({
      type: "delete-evidence",
      evidence,
      title: "Eliminar evidencia",
      message: `La evidencia “${evidence.originalName}” se eliminará de forma permanente.`,
      confirmLabel: "Eliminar evidencia",
      danger: true,
    });
  }

  async function confirmAction() {
    const current = confirmation;
    if (!current) return;
    if (current.type === "leave") {
      setConfirmation(null);
      discardChanges();
      onBack();
      return;
    }
    if (current.type === "delete-report") {
      await runAction(
        "delete",
        () => updateMaterialCorrectionReport(reportId, {}, "delete", permissions),
        "Reporte eliminado."
      );
      setConfirmation(null);
      return;
    }
    if (current.type === "archive-report") {
      await runAction(
        "archive",
        () => updateMaterialCorrectionReport(reportId, {}, "archive", permissions),
        "Reporte archivado."
      );
      setConfirmation(null);
      return;
    }
    if (current.type === "delete-evidence") {
      await runAction(
        "delete-evidence",
        () => deleteMaterialCorrectionEvidence(
          reportId,
          current.evidence.id,
          permissions
        ),
        "Evidencia eliminada."
      );
      setConfirmation(null);
    }
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
        permissionContext: permissions,
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
    return (
      <section className="material-corrections-page purchase-requests-page purchase-redesign visual-page material-detail-page">
        <div className="material-detail-loading" role="status">Cargando reporte…</div>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="material-corrections-page purchase-requests-page purchase-redesign visual-page material-detail-page">
        <button type="button" className="secondary-button" onClick={onBack}>Volver</button>
        <div className="form-error">Reporte no encontrado.</div>
      </section>
    );
  }

  return (
    <section className="material-corrections-page purchase-requests-page purchase-redesign visual-page material-detail-page">
      <MaterialCorrectionDetailHeader report={report} onBack={requestBack} />
      <MaterialCorrectionDetailNavigation />

      {error && <div className="form-error material-detail-feedback" role="alert">{error}</div>}
      {success && <div className="success-box material-detail-feedback" role="status">{success}</div>}

      <div className="material-detail-layout">
        <main className="material-detail-main">
          <ErrorReportedSection report={report} />

          <div className={`material-save-bar ${dirty ? "has-changes" : ""}`}>
            <div>
              <MaterialCorrectionIcon name={dirty ? "error" : "completed"} />
              <span>{dirty ? "Cambios pendientes" : "Todos los cambios guardados"}</span>
            </div>
            <div>
              {dirty && (
                <button type="button" className="secondary-button" onClick={discardChanges} disabled={busy}>
                  Descartar
                </button>
              )}
              <button
                type="button"
                className="visual-primary-button"
                onClick={saveAllChanges}
                disabled={busy || !dirty}
              >
                <MaterialCorrectionIcon name="save" />
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>

          {report.status === "corrected" && (
            <p className="material-workflow-notice review">
              <MaterialCorrectionIcon name="review" />
              Corrección pendiente de revisión administrativa.
            </p>
          )}
          {report.status === "in_correction" && report.approvalComment && (
            <p className="material-workflow-notice warning">
              <MaterialCorrectionIcon name="error" />
              <span>
                <strong>El administrador devolvió el reporte para ajustes.</strong>
                {report.approvalComment}
              </span>
            </p>
          )}
          {!isAdmin && !permissions.isAssigned && (
            <p className="material-workflow-notice warning">
              <MaterialCorrectionIcon name="person" />
              Reporte de solo lectura: no eres responsable asignado.
            </p>
          )}

          <section id="material-detail-gestion" className="material-detail-section">
            <header className="material-detail-section-heading">
              <div>
                <span className="material-detail-section-icon">
                  <MaterialCorrectionIcon name="correction" />
                </span>
                <h2>Gestión interna</h2>
              </div>
              <span>Editable según permisos</span>
            </header>

            <div className="material-management-grid compact">
              <label>
                <span>Estado</span>
                <select
                  value={form.status}
                  onChange={(event) => setStatus(event.target.value)}
                  disabled={!permissions.canEditOperational || permissions.statusOptions.length <= 1}
                >
                  {permissions.statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Prioridad</span>
                <select
                  value={form.priority}
                  onChange={(event) => setManagementField("priority", event.target.value)}
                  disabled={!permissions.canEditOperational}
                >
                  {MATERIAL_CORRECTION_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Responsable</span>
                <select
                  value={form.assignedUid}
                  onChange={(event) => setManagementField("assignedUid", event.target.value)}
                  disabled={!permissions.canEditAdministration}
                >
                  <option value="">Sin responsable</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.uid} value={assignee.uid}>{assignee.name}</option>
                  ))}
                </select>
              </label>
              {isAdmin && <label>
                <span>Reporte duplicado</span>
                <input
                  placeholder="MAT-2026-000001"
                  value={form.duplicateFolio}
                  onChange={(event) => setManagementField("duplicateFolio", event.target.value)}
                />
              </label>}
            </div>

            <div className="material-classification-summary">
              <div>
                <span>Clasificación confirmada</span>
                <strong>
                  {classification.levelName || "Sin nivel"} · Unidad {classification.unitNumber || "—"}
                  {classification.unitName ? ` · ${classification.unitName}` : ""}
                  {" · "}{getMaterialTypeLabel(classification.materialType)}
                  {classification.pageNumber ? ` · Página ${classification.pageNumber}` : ""}
                </strong>
              </div>
              {isAdmin && (
                <button type="button" className="secondary-button" onClick={toggleReclassification}>
                  {reclassifying ? "Cancelar reclasificación" : "Reclasificar"}
                </button>
              )}
            </div>

            {reclassifying && (
              <div className="material-management-grid compact material-reclassification-grid">
                <label>
                  <span>Nivel</span>
                  <select
                    value={classification.levelId}
                    onChange={(event) => {
                      const level = levels.find((option) => option.id === event.target.value);
                      setClassification({
                        ...classification,
                        levelId: level?.id || "",
                        levelName: level?.name || "",
                      });
                    }}
                  >
                    {!levels.some((option) => option.id === classification.levelId)
                      && classification.levelName && (
                        <option value={classification.levelId}>
                          {classification.levelName} (histórico)
                        </option>
                    )}
                    <option value="">Seleccionar nivel activo</option>
                    {levels.map((level) => (
                      <option key={level.id} value={level.id}>{level.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unidad</span>
                  <input
                    type="number"
                    min="1"
                    value={classification.unitNumber}
                    onChange={(event) => setClassification({
                      ...classification,
                      unitNumber: event.target.value,
                    })}
                  />
                </label>
                <label>
                  <span>Nombre de unidad</span>
                  <input
                    value={classification.unitName}
                    onChange={(event) => setClassification({
                      ...classification,
                      unitName: event.target.value,
                    })}
                  />
                </label>
                <label>
                  <span>Tipo de material</span>
                  <select
                    value={classification.materialType}
                    onChange={(event) => {
                      const materialType = event.target.value;
                      setClassification({
                        ...classification,
                        materialType,
                        pageNumber: MATERIAL_TYPES_WITH_PAGE.has(materialType)
                          ? classification.pageNumber
                          : "",
                      });
                    }}
                  >
                    {MATERIAL_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {MATERIAL_TYPES_WITH_PAGE.has(classification.materialType) && (
                  <label>
                    <span>Página</span>
                    <input
                      value={classification.pageNumber}
                      onChange={(event) => setClassification({
                        ...classification,
                        pageNumber: event.target.value,
                      })}
                    />
                  </label>
                )}
              </div>
            )}

            <div className="material-management-long-fields">
              <label>
                <span>Resultado de revisión</span>
                <textarea
                  rows="3"
                  value={form.reviewResult}
                  onChange={(event) => setManagementField("reviewResult", event.target.value)}
                  maxLength={6000}
                  disabled={!permissions.canEditOperational}
                />
              </label>
              <label>
                <span>Solución aplicada</span>
                <textarea
                  rows="3"
                  value={form.appliedSolution}
                  onChange={(event) => setManagementField("appliedSolution", event.target.value)}
                  maxLength={6000}
                  disabled={!permissions.canEditOperational}
                />
              </label>
              <label>
                <span>Enlace al archivo corregido</span>
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.correctedFileLink}
                  onChange={(event) => setManagementField("correctedFileLink", event.target.value)}
                  disabled={!permissions.canEditOperational}
                />
              </label>
              <label className="material-corrected-upload">
                <span>Subir archivo corregido</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.ogg,.mp4,.mov,.webm,.docx,.pptx,.xlsx,.zip"
                  onChange={uploadCorrectedFile}
                  disabled={busy || !permissions.canEditOperational}
                />
              </label>
              {uploadingFile && (
                <button
                  type="button"
                  className="secondary-button material-cancel-upload"
                  onClick={() => uploadAbortRef.current?.abort()}
                >
                  Cancelar carga
                </button>
              )}
            </div>

            {isAdmin && ["corrected", "publishing"].includes(report.status) && (
              <section className="material-approval-panel" aria-labelledby="material-approval-title">
                <div>
                  <MaterialCorrectionIcon name="review" />
                  <div>
                    <h3 id="material-approval-title">Revisar y completar</h3>
                    <p>Valida solución y publicación antes de aprobar cierre definitivo.</p>
                  </div>
                </div>
                <label>
                  <span>Observación de aprobación o devolución</span>
                  <textarea
                    rows="2"
                    value={form.approvalComment}
                    onChange={(event) => setManagementField(
                      "approvalComment",
                      event.target.value
                    )}
                    maxLength={4000}
                    placeholder="Opcional al aprobar; recomendable si regresa a corrección."
                  />
                </label>
                {completionBlocker && (
                  <p className="material-approval-blocker">{completionBlocker}</p>
                )}
                <div className="material-approval-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setStatus("in_correction")}
                    disabled={busy}
                  >
                    <MaterialCorrectionIcon name="back" />
                    Regresar a corrección
                  </button>
                  <button
                    type="button"
                    className="visual-primary-button"
                    onClick={() => setStatus("completed")}
                    disabled={busy || Boolean(completionBlocker)}
                  >
                    <MaterialCorrectionIcon name="completed" />
                    Aprobar y marcar como completado
                  </button>
                </div>
              </section>
            )}

            <dl className="material-relevant-dates">
              <div><dt>Reportado</dt><dd>{formatMaterialCorrectionDate(report.createdAt)}</dd></div>
              {report.correctedAt && (
                <div><dt>Corregido</dt><dd>{formatMaterialCorrectionDate(report.correctedAt)}</dd></div>
              )}
              {report.completedAt && (
                <div><dt>Completado</dt><dd>{formatMaterialCorrectionDate(report.completedAt)}</dd></div>
              )}
              {report.updatedAt && (
                <div><dt>Actualizado</dt><dd>{formatMaterialCorrectionDate(report.updatedAt)}</dd></div>
              )}
            </dl>
          </section>

          <DistributionSection
            distribution={form.distribution}
            publicationSettings={form.publicationSettings}
            isAdmin={isAdmin}
            canEdit={permissions.canEditDistribution}
            onChange={setDistributionField}
            onSettingsChange={setPublicationSetting}
          />
        </main>

        <aside className="material-detail-sidebar">
          <ReporterSection report={report} />
          <EvidenceSection
            evidences={evidences}
            externalUrl={report.externalEvidenceUrl}
            isAdmin={isAdmin}
            onOpen={openEvidence}
            onDelete={requestDeleteEvidence}
          />
          <CommentsSection
            activeTab={commentTab}
            comments={activeComments}
            expanded={commentsExpanded}
            comment={comment}
            informationRequest={informationRequest}
            busy={busy}
            canComment={permissions.canComment}
            onTabChange={(nextTab) => {
              setCommentTab(nextTab);
              setCommentsExpanded(false);
            }}
            onExpand={() => setCommentsExpanded((current) => !current)}
            onCommentChange={setComment}
            onInformationRequestChange={setInformationRequest}
            onSubmitComment={submitComment}
            onRequestInformation={requestInformation}
          />
          <HistorySection
            history={history}
            expanded={historyExpanded}
            onExpand={() => setHistoryExpanded((current) => !current)}
          />
          {isAdmin && (
            <AdminActionsSection
              report={report}
              busy={busy}
              onReopen={reopenReport}
              onArchive={requestArchiveReport}
              onDelete={requestDeleteReport}
            />
          )}
        </aside>
      </div>

      {confirmation && (
        <MaterialCorrectionConfirmDialog
          {...confirmation}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmAction}
        />
      )}
    </section>
  );
}
