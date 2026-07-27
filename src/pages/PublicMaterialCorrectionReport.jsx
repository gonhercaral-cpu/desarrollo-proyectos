import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ERROR_TYPE_OPTIONS,
  MATERIAL_TYPES_WITH_PAGE,
  MATERIAL_TYPE_OPTIONS,
} from "../material-corrections/constants";
import {
  formatFileSize,
  validateMaterialEvidenceFiles,
} from "../material-corrections/utils";
import {
  checkMaterialCorrectionDuplicates,
  createMaterialCorrectionReport,
  uploadMaterialCorrectionEvidence,
  listActiveMaterialCorrectionLevels,
} from "../services/materialCorrectionsService";
import { loadPublicCertificatePeople } from "../services/publicCertificatePeopleService";
import { PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES } from "../utils/certificateSignerCampus";

const INITIAL_FORM = {
  reporterId: "",
  campus: "",
  levelId: "",
  unitNumber: "",
  unitName: "",
  materialType: "student_book",
  pageNumber: "",
  errorType: "spelling",
  description: "",
  currentContent: "",
  suggestedCorrection: "",
  blocksClass: false,
  externalEvidenceUrl: "",
  website: "",
};

const INITIAL_FORM_STARTED_AT = Date.now();
const REPORTERS_CACHE_KEY = "dp.materialCorrections.publicReporters";
const LEVELS_CACHE_KEY = "dp.materialCorrections.publicLevels";

function readCachedOptions(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function cacheOptions(key, options) {
  try {
    window.localStorage.setItem(key, JSON.stringify(options));
  } catch {
    // El catálogo en memoria sigue disponible aunque el navegador bloquee storage.
  }
}

function buildPayload(
  form,
  reporter,
  level,
  formStartedAt,
  duplicateWarningAcknowledged
) {
  return {
    formStartedAt,
    website: form.website,
    duplicateWarningAcknowledged,
    reportedBy: {
      id: reporter?.id || "",
      name: reporter?.name || "",
      campusId: form.campus,
      campus: form.campus,
    },
    classification: {
      levelId: level?.id || "",
      levelName: level?.name || "",
      unitNumber: form.unitNumber,
      unitName: form.unitName,
      materialType: form.materialType,
      ...(MATERIAL_TYPES_WITH_PAGE.has(form.materialType)
        ? { pageNumber: form.pageNumber }
        : {}),
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
    ["reporterId", "Nombre del reportante"],
    ["campus", "Plantel"],
    ["levelId", "Nivel"],
    ["unitNumber", "Unidad"],
    ["description", "Descripción"],
  ];
  const missing = required.filter(([key]) => !String(form[key] || "").trim()).map(([, label]) => label);
  if (missing.length) throw new Error(`Completa: ${missing.join(", ")}.`);
  if (form.unitNumber && (!Number.isInteger(Number(form.unitNumber)) || Number(form.unitNumber) < 1)) {
    throw new Error("Unidad debe ser un número entero positivo.");
  }
  if (form.externalEvidenceUrl && !/^https:\/\//i.test(form.externalEvidenceUrl.trim())) {
    throw new Error("El enlace de evidencia debe usar HTTPS.");
  }
}

export default function PublicMaterialCorrectionReport() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [reporters, setReporters] = useState(() => readCachedOptions(REPORTERS_CACHE_KEY));
  const [levels, setLevels] = useState(() => readCachedOptions(LEVELS_CACHE_KEY));
  const [catalogLoading, setCatalogLoading] = useState({ reporters: true, levels: true });
  const [catalogErrors, setCatalogErrors] = useState({ reporters: "", levels: "" });
  const [files, setFiles] = useState([]);
  const [fileStates, setFileStates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(0);
  const [result, setResult] = useState(null);
  const formStartedAtRef = useRef(INITIAL_FORM_STARTED_AT);
  const uploadControllerRef = useRef(null);

  const principalReporters = useMemo(
    () => reporters.filter((person) => person.active !== false && person.type === "Principal"),
    [reporters]
  );
  const showsPage = MATERIAL_TYPES_WITH_PAGE.has(form.materialType);

  const loadReporters = useCallback(async () => {
    setCatalogLoading((current) => ({ ...current, reporters: true }));
    setCatalogErrors((current) => ({ ...current, reporters: "" }));
    try {
      const people = await loadPublicCertificatePeople();
      const principals = people.filter((person) => person.type === "Principal");
      setReporters(principals);
      cacheOptions(REPORTERS_CACHE_KEY, principals);
    } catch {
      setCatalogErrors((current) => ({
        ...current,
        reporters: "No se pudo actualizar el catálogo de reportantes.",
      }));
    } finally {
      setCatalogLoading((current) => ({ ...current, reporters: false }));
    }
  }, []);

  const loadLevels = useCallback(async () => {
    setCatalogLoading((current) => ({ ...current, levels: true }));
    setCatalogErrors((current) => ({ ...current, levels: "" }));
    try {
      const activeLevels = await listActiveMaterialCorrectionLevels();
      setLevels(activeLevels);
      cacheOptions(LEVELS_CACHE_KEY, activeLevels);
    } catch {
      setCatalogErrors((current) => ({
        ...current,
        levels: "No se pudo actualizar el catálogo de niveles.",
      }));
    } finally {
      setCatalogLoading((current) => ({ ...current, levels: false }));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadReporters();
      loadLevels();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLevels, loadReporters]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if ([
      "levelId",
      "unitNumber",
      "unitName",
      "materialType",
      "pageNumber",
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
      const reporter = principalReporters.find((person) => person.id === form.reporterId);
      const level = levels.find((option) => option.id === form.levelId);
      if (!reporter) throw new Error("Selecciona un reportante activo.");
      if (!level) throw new Error("Selecciona un nivel activo.");
      setBusy(true);
      const payload = buildPayload(
        form,
        reporter,
        level,
        formStartedAtRef.current,
        acknowledgeDuplicate
      );
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
          <div className="material-public-grid material-reporter-grid">
            <label>
              Nombre del reportante *
              <select
                value={form.reporterId}
                onChange={(event) => setField("reporterId", event.target.value)}
                disabled={catalogLoading.reporters && principalReporters.length === 0}
                required
              >
                <option value="">
                  {catalogLoading.reporters
                    ? "Cargando personas…"
                    : principalReporters.length
                      ? "Seleccionar persona"
                      : "Sin personas principales activas"}
                </option>
                {principalReporters.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
              {catalogErrors.reporters && (
                <span className="material-catalog-status" role="status">
                  {catalogErrors.reporters}
                  <button type="button" onClick={loadReporters}>Reintentar</button>
                </span>
              )}
            </label>
            <label>
              Plantel *
              <select value={form.campus} onChange={(event) => setField("campus", event.target.value)} required>
                <option value="">Seleccionar plantel</option>
                {PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES.map((campus) => (
                  <option key={campus} value={campus}>{campus}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="material-public-section">
          <legend><span>2</span> Ubicación del error</legend>
          <div className="material-public-grid material-location-grid">
            <label>
              Nivel *
              <select
                value={form.levelId}
                onChange={(event) => setField("levelId", event.target.value)}
                disabled={catalogLoading.levels && levels.length === 0}
                required
              >
                <option value="">
                  {catalogLoading.levels
                    ? "Cargando niveles…"
                    : levels.length
                      ? "Seleccionar nivel"
                      : "Sin niveles activos"}
                </option>
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>{level.name}</option>
                ))}
              </select>
              {catalogErrors.levels && (
                <span className="material-catalog-status" role="status">
                  {catalogErrors.levels}
                  <button type="button" onClick={loadLevels}>Reintentar</button>
                </span>
              )}
            </label>
            <label>
              Unidad *
              <input type="number" min="1" max="9999" value={form.unitNumber} onChange={(event) => setField("unitNumber", event.target.value)} required />
            </label>
            <label>
              Nombre de la unidad
              <input value={form.unitName} onChange={(event) => setField("unitName", event.target.value)} maxLength={200} />
            </label>
            <label>
              Tipo de material *
              <select value={form.materialType} onChange={(event) => setField("materialType", event.target.value)}>
                {MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {showsPage && (
              <label>
                Página
                <input value={form.pageNumber} onChange={(event) => setField("pageNumber", event.target.value)} maxLength={80} />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset className="material-public-section">
          <legend><span>3</span> Error</legend>
          <div className="material-public-grid material-error-grid">
            <label>
              Tipo de error *
              <select value={form.errorType} onChange={(event) => setField("errorType", event.target.value)}>
                {ERROR_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="material-error-description">
              Descripción *
              <textarea value={form.description} onChange={(event) => setField("description", event.target.value)} rows="3" maxLength={5000} required />
            </label>
            <label>
              Texto actual
              <textarea value={form.currentContent} onChange={(event) => setField("currentContent", event.target.value)} rows="3" maxLength={5000} />
            </label>
            <label>
              Corrección sugerida
              <textarea value={form.suggestedCorrection} onChange={(event) => setField("suggestedCorrection", event.target.value)} rows="3" maxLength={5000} />
            </label>
          </div>
          <label className="material-blocks-class">
            <input type="checkbox" checked={form.blocksClass} onChange={(event) => setField("blocksClass", event.target.checked)} />
            <span>
              <strong>Este error impide impartir correctamente la clase</strong>
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
