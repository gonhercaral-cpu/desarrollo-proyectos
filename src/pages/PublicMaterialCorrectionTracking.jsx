import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  MATERIAL_CORRECTION_STATUS_OPTIONS,
  PUBLIC_PROGRESS_STATUSES,
} from "../material-corrections/constants";
import {
  formatFileSize,
  formatMaterialCorrectionDate,
  getMaterialTypeLabel,
  validateMaterialEvidenceFiles,
} from "../material-corrections/utils";
import {
  addPublicMaterialCorrectionInformation,
  getMaterialCorrectionEvidenceDownloadUrl,
  getMaterialCorrectionTracking,
  uploadMaterialCorrectionEvidence,
} from "../services/materialCorrectionsService";

function distributionLabel(destination) {
  if (!destination?.required) return "No aplica";
  if (destination.status === "completed") return "Publicado";
  return "Pendiente";
}

export default function PublicMaterialCorrectionTracking() {
  const { folio = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const abortRef = useRef(null);

  const statusOption = useMemo(
    () => MATERIAL_CORRECTION_STATUS_OPTIONS.find((option) => option.value === report?.status),
    [report?.status]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      if (!token) throw new Error("Enlace incompleto: falta token de seguimiento.");
      setReport(await getMaterialCorrectionTracking(folio, token));
    } catch (loadError) {
      setError(loadError.message || "No se pudo consultar seguimiento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    getMaterialCorrectionTracking(folio, token)
      .then((nextReport) => {
        if (!active) return;
        setReport(nextReport);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || "No se pudo consultar seguimiento.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [folio, token]);

  function selectFiles(event) {
    try {
      setFiles(validateMaterialEvidenceFiles(event.target.files, report?.evidences?.length || 0));
      setError("");
    } catch (validationError) {
      setFiles([]);
      event.target.value = "";
      setError(validationError.message);
    }
  }

  async function addInformation(event) {
    event.preventDefault();
    if (!message.trim() && files.length === 0) {
      setError("Agrega información o una evidencia.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (message.trim()) {
        await addPublicMaterialCorrectionInformation({ folio, token, message });
        setMessage("");
      }
      const failedFiles = [];
      for (const file of files) {
        try {
          await uploadMaterialCorrectionEvidence({
            file,
            folio,
            token,
            additional: true,
            signal: controller.signal,
          });
        } catch (uploadError) {
          if (uploadError?.name === "AbortError") throw uploadError;
          failedFiles.push({ file, message: uploadError.message });
        }
      }
      setFiles(failedFiles.map((item) => item.file));
      if (failedFiles.length) {
        throw new Error(`No se cargaron: ${failedFiles.map((item) => item.file.name).join(", ")}.`);
      }
      setSuccess("Información agregada correctamente.");
      await load();
    } catch (submitError) {
      setError(submitError?.name === "AbortError" ? "Carga cancelada." : submitError.message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function downloadEvidence(evidenceId) {
    try {
      const result = await getMaterialCorrectionEvidenceDownloadUrl({
        folio,
        token,
        evidenceId,
      });
      window.location.assign(result.url);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  return (
    <main className="certificate-public-page tracking-page material-public-page">
      <header className="tracking-topbar">
        <div className="tracking-brand">
          <img src="/active-logo.png" alt="Active for Life" className="tracking-brand-logo" />
        </div>
      </header>
      <section className="tracking-hero material-correction-hero">
        <div>
          <p className="tracking-eyebrow">Correcciones de material</p>
          <h1>Seguimiento de reporte</h1>
          <p>Enlace privado. No lo compartas fuera de personal autorizado.</p>
        </div>
      </section>

      {loading ? (
        <section className="tracking-main-card material-public-card"><p>Cargando seguimiento…</p></section>
      ) : error && !report ? (
        <section className="tracking-main-card material-public-card">
          <div className="form-error" role="alert">{error}</div>
        </section>
      ) : report && (
        <section className="tracking-main-card material-public-card material-tracking-card">
          {error && <div className="form-error" role="alert">{error}</div>}
          {success && <div className="success-box" role="status">{success}</div>}

          <header className="material-tracking-summary">
            <div><span>Folio</span><strong>{report.folio}</strong></div>
            <div><span>Estado</span><strong>{report.statusLabel || statusOption?.publicLabel}</strong></div>
            <div><span>Fecha</span><strong>{formatMaterialCorrectionDate(report.createdAt)}</strong></div>
          </header>

          {!["dismissed", "duplicate"].includes(report.status) && (
            <ol className="material-public-progress" aria-label="Avance de corrección">
              {PUBLIC_PROGRESS_STATUSES.map((status, index) => {
                const currentIndex = PUBLIC_PROGRESS_STATUSES.indexOf(report.status === "needs_information" ? "under_review" : report.status);
                return (
                  <li key={status} className={index <= currentIndex ? "complete" : ""}>
                    <span>{index + 1}</span>
                    <small>{MATERIAL_CORRECTION_STATUS_OPTIONS.find((option) => option.value === status)?.publicLabel}</small>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="material-tracking-grid">
            <article>
              <h2>Material reportado</h2>
              <dl className="material-data-list">
                <div><dt>Nivel</dt><dd>{report.material.levelName}</dd></div>
                <div><dt>Libro o programa</dt><dd>{report.material.bookName}</dd></div>
                <div><dt>Unidad</dt><dd>{report.material.unitNumber || report.material.unitName || "Sin dato"}</dd></div>
                <div><dt>Material</dt><dd>{getMaterialTypeLabel(report.material.materialType)}{report.material.materialName ? ` · ${report.material.materialName}` : ""}</dd></div>
              </dl>
            </article>
            <article>
              <h2>Publicación</h2>
              <div className="material-public-distribution">
                <div>
                  <span>Clases presenciales</span>
                  <strong>{distributionLabel(report.distribution.inPerson)}</strong>
                  {report.distribution.inPerson.link && <a href={report.distribution.inPerson.link} target="_blank" rel="noreferrer">Abrir material</a>}
                </div>
                <div>
                  <span>Clases en línea</span>
                  <strong>{distributionLabel(report.distribution.online)}</strong>
                  {report.distribution.online.link && <a href={report.distribution.online.link} target="_blank" rel="noreferrer">Abrir material</a>}
                </div>
              </div>
            </article>
          </div>

          <article className="material-public-comments">
            <h2>Comentarios públicos y solicitudes</h2>
            {report.comments.length === 0 ? (
              <p className="material-empty">Sin comentarios públicos.</p>
            ) : (
              <ul>
                {report.comments.map((comment) => (
                  <li key={comment.id} className={comment.type === "information_request" ? "request" : ""}>
                    <strong>{comment.type === "information_request" ? "Solicitud de información" : comment.authorName}</strong>
                    <p>{comment.message}</p>
                    <small>{formatMaterialCorrectionDate(comment.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </article>

          {report.evidences.length > 0 && (
            <article className="material-public-comments">
              <h2>Evidencias autorizadas</h2>
              <ul>
                {report.evidences.map((evidence) => (
                  <li key={evidence.id}>
                    <button type="button" className="material-evidence-link" onClick={() => downloadEvidence(evidence.id)}>
                      {evidence.name} · {formatFileSize(evidence.size)}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          )}

          <form className="material-add-information" onSubmit={addInformation}>
            <h2>Agregar información o evidencia</h2>
            <label>
              Información adicional
              <textarea rows="4" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} />
            </label>
            {report.evidenceSlotsRemaining > 0 && (
              <label>
                Evidencias ({report.evidenceSlotsRemaining} disponibles)
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.ogg,.mp4,.mov,.webm"
                  onChange={selectFiles}
                  disabled={busy}
                />
                {files.length > 0 && (
                  <small>{files.map((file) => `${file.name} (${formatFileSize(file.size)})`).join(", ")}</small>
                )}
              </label>
            )}
            <div className="form-actions">
              <button type="submit" disabled={busy}>{busy ? "Enviando…" : "Agregar información"}</button>
              {busy && <button type="button" className="secondary-button" onClick={() => abortRef.current?.abort()}>Cancelar</button>}
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
