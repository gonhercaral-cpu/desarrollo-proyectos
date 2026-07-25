import { useRef, useState } from "react";
import {
  ERROR_TYPE_OPTIONS,
  MATERIAL_LOCATION_FIELDS,
  MATERIAL_TYPE_OPTIONS,
  REPORTER_POSITION_OPTIONS,
} from "../material-corrections/constants";
import {
  formatFileSize,
  validateMaterialEvidenceFiles,
} from "../material-corrections/utils";
import {
  checkMaterialCorrectionDuplicates,
  createMaterialCorrectionReport,
  uploadMaterialCorrectionEvidence,
} from "../services/materialCorrectionsService";

const INITIAL_FORM = {
  reporterName: "",
  reporterPosition: "director",
  campus: "",
  contact: "",
  levelName: "",
  bookName: "",
  unitNumber: "",
  unitName: "",
  lessonNumber: "",
  materialType: "student_book",
  materialName: "",
  pageNumber: "",
  exerciseNumber: "",
  questionNumber: "",
  slideNumber: "",
  songName: "",
  timestamp: "",
  errorType: "spelling",
  description: "",
  currentContent: "",
  suggestedCorrection: "",
  blocksClass: false,
  externalEvidenceUrl: "",
  website: "",
};

const LOCATION_LABELS = {
  pageNumber: "Página",
  exerciseNumber: "Ejercicio",
  questionNumber: "Pregunta",
  slideNumber: "Número de diapositiva",
  songName: "Nombre de canción",
  timestamp: "Minuto o sección",
};
const INITIAL_FORM_STARTED_AT = Date.now();

function buildPayload(form, formStartedAt, duplicateWarningAcknowledged) {
  return {
    formStartedAt,
    website: form.website,
    duplicateWarningAcknowledged,
    reportedBy: {
      name: form.reporterName,
      position: form.reporterPosition,
      campus: form.campus,
      contact: form.contact,
    },
    classification: {
      levelName: form.levelName,
      bookName: form.bookName,
      unitNumber: form.unitNumber,
      unitName: form.unitName,
      lessonNumber: form.lessonNumber,
      materialType: form.materialType,
      materialName: form.materialName,
      pageNumber: form.pageNumber,
      exerciseNumber: form.exerciseNumber,
      questionNumber: form.questionNumber,
      slideNumber: form.slideNumber,
      songName: form.songName,
      timestamp: form.timestamp,
    },
    error: {
      errorType: form.errorType,
      description: form.description,
      currentContent: form.currentContent,
      suggestedCorrection: form.suggestedCorrection,
      blocksClass: form.blocksClass,
    },
    externalEvidenceUrl: form.externalEvidenceUrl,
  };
}

function validateForm(form) {
  const required = [
    ["reporterName", "Nombre"],
    ["campus", "Plantel"],
    ["contact", "Correo o teléfono"],
    ["levelName", "Nivel"],
    ["bookName", "Libro o programa"],
    ["description", "Descripción"],
  ];
  const missing = required.filter(([key]) => !String(form[key] || "").trim()).map(([, label]) => label);
  if (!form.unitNumber && !form.unitName.trim()) missing.push("Unidad");
  if (missing.length) throw new Error(`Completa: ${missing.join(", ")}.`);
  if (form.unitNumber && (!Number.isInteger(Number(form.unitNumber)) || Number(form.unitNumber) < 1)) {
    throw new Error("Unidad debe ser un número entero positivo.");
  }
  if (form.lessonNumber && (!Number.isInteger(Number(form.lessonNumber)) || Number(form.lessonNumber) < 1)) {
    throw new Error("Lección debe ser un número entero positivo.");
  }
  if (form.externalEvidenceUrl && !/^https:\/\//i.test(form.externalEvidenceUrl.trim())) {
    throw new Error("El enlace de evidencia debe usar HTTPS.");
  }
}

export default function PublicMaterialCorrectionReport() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [files, setFiles] = useState([]);
  const [fileStates, setFileStates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(0);
  const [result, setResult] = useState(null);
  const formStartedAtRef = useRef(INITIAL_FORM_STARTED_AT);
  const uploadControllerRef = useRef(null);

  const visibleLocationFields = MATERIAL_LOCATION_FIELDS[form.materialType] || [];

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if ([
      "levelName",
      "bookName",
      "unitNumber",
      "unitName",
      "materialType",
      "pageNumber",
      "slideNumber",
      "description",
    ].includes(key)) {
      setDuplicateWarning(0);
    }
  }

  function handleFiles(event) {
    try {
      const selected = validateMaterialEvidenceFiles(event.target.files);
      setFiles(selected);
      setFileStates(selected.map((file) => ({
        name: file.name,
        progress: 0,
        status: "pending",
        error: "",
      })));
      setError("");
    } catch (validationError) {
      event.target.value = "";
      setFiles([]);
      setFileStates([]);
      setError(validationError.message);
    }
  }

  async function submit({ acknowledgeDuplicate = false } = {}) {
    if (busy) return;
    setError("");
    try {
      validateForm(form);
      validateMaterialEvidenceFiles(files);
      setBusy(true);
      const payload = buildPayload(form, formStartedAtRef.current, acknowledgeDuplicate);
      if (!acknowledgeDuplicate && !duplicateWarning) {
        const duplicateResult = await checkMaterialCorrectionDuplicates({
          formStartedAt: formStartedAtRef.current,
          website: form.website,
          classification: payload.classification,
          description: form.description,
        });
        if (duplicateResult.possibleDuplicateCount > 0) {
          setDuplicateWarning(duplicateResult.possibleDuplicateCount);
          return;
        }
      }
      const creation = await createMaterialCorrectionReport(payload);
      if (creation.duplicateWarning) {
        setDuplicateWarning(creation.possibleDuplicateCount || 1);
        return;
      }

      const controller = new AbortController();
      uploadControllerRef.current = controller;
      const failedFiles = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setFileStates((current) => current.map((item, itemIndex) => (
          itemIndex === index ? { ...item, status: "uploading", progress: 5 } : item
        )));
        try {
          await uploadMaterialCorrectionEvidence({
            file,
            folio: creation.folio,
            token: creation.token,
            signal: controller.signal,
            onProgress: (progress) => {
              setFileStates((current) => current.map((item, itemIndex) => (
                itemIndex === index ? { ...item, progress } : item
              )));
            },
          });
          setFileStates((current) => current.map((item, itemIndex) => (
            itemIndex === index ? { ...item, status: "ready", progress: 100 } : item
          )));
        } catch (uploadError) {
          const message = uploadError?.name === "AbortError"
            ? "Carga cancelada."
            : uploadError.message;
          failedFiles.push(file.name);
          setFileStates((current) => current.map((item, itemIndex) => (
            itemIndex === index ? { ...item, status: "error", error: message } : item
          )));
          if (uploadError?.name === "AbortError") break;
        }
      }
      const trackingUrl = `${window.location.origin}/seguimiento-error-material/${encodeURIComponent(creation.folio)}?token=${encodeURIComponent(creation.token)}`;
      setResult({
        ...creation,
        trackingUrl,
        failedFiles,
      });
    } catch (submitError) {
      setError(submitError.message || "No se pudo registrar el reporte.");
    } finally {
      setBusy(false);
      uploadControllerRef.current = null;
    }
  }

  function resetForm() {
    setForm(INITIAL_FORM);
    setFiles([]);
    setFileStates([]);
    setBusy(false);
    setError("");
    setDuplicateWarning(0);
    setResult(null);
    formStartedAtRef.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (result) {
    return (
      <main className="certificate-public-page request-page material-public-page">
        <header className="tracking-topbar">
          <div className="tracking-brand">
            <img src="/active-logo.png" alt="Active for Life" className="tracking-brand-logo" />
          </div>
        </header>
        <section className="tracking-hero request-hero material-correction-hero">
          <div>
            <p className="tracking-eyebrow">Correcciones de material</p>
            <h1>Reporte recibido</h1>
            <p>Guarda enlace privado. Token permite consultar avance y agregar información.</p>
          </div>
        </section>
        <section className="tracking-main-card success-request-card material-public-card">
          <div className="success-box visual-success-box">
            <p>Folio</p>
            <strong>{result.folio}</strong>
          </div>
          <label className="material-copy-link">
            Enlace de seguimiento
            <input value={result.trackingUrl} readOnly />
          </label>
          {result.failedFiles.length > 0 && (
            <div className="form-error" role="alert">
              Reporte guardado. No se cargaron: {result.failedFiles.join(", ")}.
              Puedes agregarlos desde seguimiento.
            </div>
          )}
          <div className="form-actions success-request-actions">
            <button type="button" onClick={() => navigator.clipboard.writeText(result.trackingUrl)}>
              Copiar enlace de seguimiento
            </button>
            <button type="button" className="secondary-button" onClick={resetForm}>
              Reportar otro error
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="certificate-public-page request-page material-public-page">
      <header className="tracking-topbar">
        <div className="tracking-brand">
          <img src="/active-logo.png" alt="Active for Life" className="tracking-brand-logo" />
        </div>
      </header>

      <section className="tracking-hero request-hero material-correction-hero">
        <div>
          <p className="tracking-eyebrow">Dirección Académica</p>
          <h1>Reportar error en material</h1>
          <p>Ubica error, explica corrección y adjunta evidencia. No necesitas iniciar sesión.</p>
        </div>
      </section>

      <form
        className="tracking-main-card request-main-card material-public-card"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {error && <div className="form-error" role="alert">{error}</div>}

        <input
          className="material-honeypot"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={form.website}
          onChange={(event) => setField("website", event.target.value)}
          name="website"
        />

        <fieldset className="material-public-section">
          <legend><span>1</span> Reportante</legend>
          <div className="material-public-grid">
            <label>
              Nombre *
              <input value={form.reporterName} onChange={(event) => setField("reporterName", event.target.value)} maxLength={160} required />
            </label>
            <label>
              Puesto *
              <select value={form.reporterPosition} onChange={(event) => setField("reporterPosition", event.target.value)}>
                {REPORTER_POSITION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Plantel *
              <input value={form.campus} onChange={(event) => setField("campus", event.target.value)} maxLength={160} required />
            </label>
            <label>
              Correo o teléfono *
              <input value={form.contact} onChange={(event) => setField("contact", event.target.value)} maxLength={254} required />
            </label>
          </div>
        </fieldset>

        <fieldset className="material-public-section">
          <legend><span>2</span> Ubicación del error</legend>
          <div className="material-public-grid">
            <label>
              Nivel *
              <input value={form.levelName} onChange={(event) => setField("levelName", event.target.value)} maxLength={160} required />
            </label>
            <label>
              Libro o programa *
              <input value={form.bookName} onChange={(event) => setField("bookName", event.target.value)} maxLength={200} required />
            </label>
            <label>
              Unidad número *
              <input type="number" min="1" max="9999" value={form.unitNumber} onChange={(event) => setField("unitNumber", event.target.value)} />
            </label>
            <label>
              Nombre de unidad
              <input value={form.unitName} onChange={(event) => setField("unitName", event.target.value)} maxLength={200} />
            </label>
            <label>
              Lección
              <input type="number" min="1" max="9999" value={form.lessonNumber} onChange={(event) => setField("lessonNumber", event.target.value)} />
            </label>
            <label>
              Tipo de material *
              <select value={form.materialType} onChange={(event) => setField("materialType", event.target.value)}>
                {MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="material-grid-wide">
              Nombre del material
              <input value={form.materialName} onChange={(event) => setField("materialName", event.target.value)} maxLength={240} />
            </label>
            {visibleLocationFields.map((key) => (
              <label key={key}>
                {LOCATION_LABELS[key]}
                <input value={form[key]} onChange={(event) => setField(key, event.target.value)} maxLength={240} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="material-public-section">
          <legend><span>3</span> Error</legend>
          <div className="material-public-grid">
            <label className="material-grid-wide">
              Tipo de error *
              <select value={form.errorType} onChange={(event) => setField("errorType", event.target.value)}>
                {ERROR_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="material-grid-wide">
              Descripción *
              <textarea value={form.description} onChange={(event) => setField("description", event.target.value)} rows="5" maxLength={5000} required />
            </label>
            <label>
              Texto actual
              <textarea value={form.currentContent} onChange={(event) => setField("currentContent", event.target.value)} rows="4" maxLength={5000} />
            </label>
            <label>
              Corrección sugerida
              <textarea value={form.suggestedCorrection} onChange={(event) => setField("suggestedCorrection", event.target.value)} rows="4" maxLength={5000} />
            </label>
          </div>
          <label className="material-blocks-class">
            <input type="checkbox" checked={form.blocksClass} onChange={(event) => setField("blocksClass", event.target.checked)} />
            <span>
              <strong>Este error impide impartir correctamente la clase</strong>
              <small>Reporte será marcado urgente.</small>
            </span>
          </label>
        </fieldset>

        <fieldset className="material-public-section">
          <legend><span>4</span> Evidencias</legend>
          <label className="material-file-drop">
            <strong>Adjuntar hasta 5 archivos</strong>
            <span>Imágenes 10 MB · PDF 20 MB · Audio 25 MB · Video 100 MB</span>
            <input
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.ogg,.mp4,.mov,.webm"
              onChange={handleFiles}
              disabled={busy}
            />
          </label>
          {files.length > 0 && (
            <ul className="material-file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}`}>
                  <span>{file.name} · {formatFileSize(file.size)}</span>
                  <span>{fileStates[index]?.status === "ready" ? "Validado" : `${fileStates[index]?.progress || 0}%`}</span>
                  {fileStates[index]?.error && <small>{fileStates[index].error}</small>}
                </li>
              ))}
            </ul>
          )}
          <label className="material-external-link">
            Enlace externo o de Drive
            <input type="url" placeholder="https://..." value={form.externalEvidenceUrl} onChange={(event) => setField("externalEvidenceUrl", event.target.value)} maxLength={2000} />
          </label>
        </fieldset>

        {duplicateWarning > 0 && (
          <section className="material-duplicate-warning" role="alert">
            <strong>Encontramos {duplicateWarning} posible{duplicateWarning === 1 ? "" : "s"} duplicado{duplicateWarning === 1 ? "" : "s"}.</strong>
            <p>Revisa ubicación y descripción. Puedes enviar si corresponde a otro hallazgo.</p>
            <button type="button" onClick={() => submit({ acknowledgeDuplicate: true })} disabled={busy}>
              Enviar de todos modos
            </button>
          </section>
        )}

        <div className="form-actions material-submit-actions">
          <button type="submit" disabled={busy || duplicateWarning > 0}>
            {busy ? "Enviando y validando…" : "Enviar reporte"}
          </button>
          {busy && files.length > 0 && (
            <button type="button" className="secondary-button" onClick={() => uploadControllerRef.current?.abort()}>
              Cancelar cargas
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
