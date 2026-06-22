import { useEffect, useMemo, useState } from "react";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useAuth } from "../context/AuthContext";
import { db, storage } from "../services/firebase";

const MODULE_OPTIONS = [
  "Tablero",
  "Mensajes",
  "Mis proyectos",
  "Agenda del equipo",
  "Solicitudes de compra",
  "Incubadora de ideas",
  "Imprenta",
  "Soporte Técnico",
  "Todos los proyectos",
  "Colaboradores",
  "Departamentos",
  "Dashboard ejecutivo",
  "Login / acceso",
  "Otro",
];

const PRIORITIES = [
  { value: "baja", label: "Baja", className: "bug-priority-low" },
  { value: "media", label: "Media", className: "bug-priority-medium" },
  { value: "alta", label: "Alta", className: "bug-priority-high" },
  { value: "critica", label: "Crítica", className: "bug-priority-critical" },
];

const STATUS_OPTIONS = [
  { value: "nuevo", label: "Nuevo", className: "bug-status-new" },
  { value: "en_revision", label: "En revisión", className: "bug-status-review" },
  { value: "en_proceso", label: "En proceso", className: "bug-status-progress" },
  { value: "resuelto", label: "Resuelto", className: "bug-status-resolved" },
  { value: "no_reproducible", label: "No se pudo reproducir", className: "bug-status-muted" },
  { value: "cerrado", label: "Cerrado", className: "bug-status-closed" },
];

const MAX_FILES = 6;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_VIDEO_SIZE = 120 * 1024 * 1024;

const EMPTY_FORM = {
  module: "",
  title: "",
  description: "",
  steps: "",
  priority: "media",
};

function getOption(list, value) {
  return list.find((item) => item.value === value) || list[0];
}

function getCurrentUserId(firebaseUser, profile) {
  return firebaseUser?.uid || profile?.uid || profile?.id || "";
}

function getCurrentUserName(profile, firebaseUser) {
  return profile?.name || firebaseUser?.displayName || profile?.email || firebaseUser?.email || "Usuario";
}

function getCurrentUserEmail(profile, firebaseUser) {
  return profile?.email || firebaseUser?.email || "";
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(bytes = 0) {
  if (!bytes) return "0 KB";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function createSearchText(report) {
  return [
    report.title,
    report.description,
    report.steps,
    report.module,
    report.priority,
    report.status,
    report.reporterName,
    report.reporterEmail,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function sortReportsByDate(a, b) {
  const first = a.createdAt?.toMillis?.() || new Date(a.createdAt || 0).getTime() || 0;
  const second = b.createdAt?.toMillis?.() || new Date(b.createdAt || 0).getTime() || 0;
  return second - first;
}

function isImageFile(file) {
  return file?.type?.startsWith("image/");
}

function isVideoFile(file) {
  return file?.type?.startsWith("video/");
}

function getEvidenceKind(type = "") {
  if (type.startsWith("image/")) return "Imagen";
  if (type.startsWith("video/")) return "Video";
  return "Archivo";
}

function safeFileName(fileName = "archivo") {
  const cleanName = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

  return cleanName || "archivo";
}

function validateSelectedFiles(files) {
  if (files.length > MAX_FILES) {
    return `Puedes subir máximo ${MAX_FILES} evidencias por reporte.`;
  }

  const invalidType = files.find((file) => !isImageFile(file) && !isVideoFile(file));
  if (invalidType) {
    return "Solo se permiten evidencias en imagen o video.";
  }

  const oversizedImage = files.find((file) => isImageFile(file) && file.size > MAX_IMAGE_SIZE);
  if (oversizedImage) {
    return "Cada imagen debe pesar máximo 15 MB.";
  }

  const oversizedVideo = files.find((file) => isVideoFile(file) && file.size > MAX_VIDEO_SIZE);
  if (oversizedVideo) {
    return "Cada video debe pesar máximo 120 MB.";
  }

  return "";
}

async function uploadEvidenceFiles(files, { reportId, userUid }) {
  const uploadedFiles = [];

  for (const [index, file] of files.entries()) {
    const fileName = `${Date.now()}-${index}-${safeFileName(file.name)}`;
    const filePath = `bugReports/${userUid}/${reportId}/${fileName}`;
    const fileRef = ref(storage, filePath);

    await uploadBytes(fileRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        reportId,
        uploadedByUid: userUid,
      },
    });

    const url = await getDownloadURL(fileRef);

    uploadedFiles.push({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      url,
      path: filePath,
      kind: getEvidenceKind(file.type || ""),
      uploadedAt: new Date().toISOString(),
    });
  }

  return uploadedFiles;
}

function ReportBadge({ type, value }) {
  const option = type === "priority" ? getOption(PRIORITIES, value) : getOption(STATUS_OPTIONS, value);

  return <span className={`bug-badge ${option.className}`}>{option.label}</span>;
}

function EvidenceLink({ file }) {
  return (
    <a className="bug-evidence-item" href={file.url} target="_blank" rel="noreferrer">
      <span>{file.type?.startsWith("video/") ? "VID" : "IMG"}</span>
      <div>
        <strong>{file.name || "Evidencia"}</strong>
        <small>
          {getEvidenceKind(file.type)} · {formatFileSize(file.size)}
        </small>
      </div>
    </a>
  );
}

export default function BugReports() {
  const { profile, firebaseUser, isAdmin } = useAuth();
  const currentUserId = getCurrentUserId(firebaseUser, profile);
  const currentUserName = getCurrentUserName(profile, firebaseUser);
  const currentUserEmail = getCurrentUserEmail(profile, firebaseUser);

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [adminEditingId, setAdminEditingId] = useState("");
  const [adminDraft, setAdminDraft] = useState({ status: "nuevo", adminComment: "" });
  const [adminSaving, setAdminSaving] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState("");

  useEffect(() => {
    if (!currentUserId) {
      setReports([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const reportsQuery = isAdmin
      ? query(collection(db, "bugReports"))
      : query(collection(db, "bugReports"), where("reporterUid", "==", currentUserId));

    return onSnapshot(
      reportsQuery,
      (snapshot) => {
        const nextReports = snapshot.docs
          .map((reportDoc) => ({ id: reportDoc.id, ...reportDoc.data() }))
          .sort(sortReportsByDate);

        setReports(nextReports);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("No se pudieron cargar los reportes de errores:", snapshotError);
        setError("No se pudieron cargar los reportes de errores.");
        setLoading(false);
      }
    );
  }, [currentUserId, isAdmin]);

  const metrics = useMemo(() => {
    const openStatuses = new Set(["nuevo", "en_revision", "en_proceso", "no_reproducible"]);

    return {
      total: reports.length,
      open: reports.filter((report) => openStatuses.has(report.status || "nuevo")).length,
      highPriority: reports.filter((report) => ["alta", "critica"].includes(report.priority)).length,
      resolved: reports.filter((report) => ["resuelto", "cerrado"].includes(report.status)).length,
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    const cleanSearchTerm = searchTerm.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesStatus = statusFilter === "all" || (report.status || "nuevo") === statusFilter;
      const matchesPriority = priorityFilter === "all" || (report.priority || "media") === priorityFilter;
      const matchesSearch = !cleanSearchTerm || createSearchText(report).includes(cleanSearchTerm);

      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [reports, statusFilter, priorityFilter, searchTerm]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleFileSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";

    const nextFiles = [...files, ...selectedFiles];
    const validationMessage = validateSelectedFiles(nextFiles);

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setFiles(nextFiles);
    setError("");
  }

  function removeSelectedFile(indexToRemove) {
    setFiles((current) => current.filter((_, index) => index !== indexToRemove));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setFiles([]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!currentUserId) {
      setError("No se pudo identificar tu usuario. Vuelve a iniciar sesión.");
      return;
    }

    const cleanModule = normalizeText(form.module);
    const cleanTitle = normalizeText(form.title);
    const cleanDescription = normalizeText(form.description);
    const cleanSteps = normalizeText(form.steps);

    if (!cleanModule || !cleanTitle || !cleanDescription) {
      setError("Completa el módulo, el título y la descripción del error.");
      return;
    }

    const validationMessage = validateSelectedFiles(files);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSaving(true);

    try {
      const reportId = doc(collection(db, "bugReports")).id;
      const evidenceFiles = await uploadEvidenceFiles(files, {
        reportId,
        userUid: currentUserId,
      });

      await setDoc(doc(db, "bugReports", reportId), {
        module: cleanModule,
        title: cleanTitle,
        description: cleanDescription,
        steps: cleanSteps,
        priority: form.priority || "media",
        status: "nuevo",
        reporterUid: currentUserId,
        reporterName: currentUserName,
        reporterEmail: currentUserEmail,
        evidenceFiles,
        evidenceCount: evidenceFiles.length,
        imageEvidenceCount: evidenceFiles.filter((file) => file.type?.startsWith("image/")).length,
        videoEvidenceCount: evidenceFiles.filter((file) => file.type?.startsWith("video/")).length,
        adminComment: "",
        adminHistory: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        searchableText: [cleanModule, cleanTitle, cleanDescription, cleanSteps, currentUserName, currentUserEmail]
          .join(" ")
          .toLowerCase(),
      });

      resetForm();
      setMessage("Reporte enviado correctamente. Administración podrá revisarlo desde este módulo.");
    } catch (submitError) {
      console.error("No se pudo registrar el reporte:", submitError);
      setError("No se pudo registrar el reporte. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  function startAdminEdit(report) {
    setAdminEditingId(report.id);
    setAdminDraft({
      status: report.status || "nuevo",
      adminComment: report.adminComment || "",
    });
    setMessage("");
    setError("");
  }

  function cancelAdminEdit() {
    setAdminEditingId("");
    setAdminDraft({ status: "nuevo", adminComment: "" });
  }

  async function saveAdminUpdate(report) {
    if (!isAdmin || !report?.id) return;

    setAdminSaving(true);
    setMessage("");
    setError("");

    try {
      const cleanComment = normalizeText(adminDraft.adminComment);
      const nextStatus = adminDraft.status || "nuevo";
      const historyItem = {
        status: nextStatus,
        comment: cleanComment,
        changedAt: new Date().toISOString(),
        changedByUid: currentUserId,
        changedByName: currentUserName,
        changedByEmail: currentUserEmail,
      };

      await updateDoc(doc(db, "bugReports", report.id), {
        status: nextStatus,
        adminComment: cleanComment,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedByUid: currentUserId,
        updatedByName: currentUserName,
        updatedByEmail: currentUserEmail,
        adminHistory: arrayUnion(historyItem),
        ...(nextStatus === "resuelto" || nextStatus === "cerrado"
          ? { resolvedAt: serverTimestamp() }
          : {}),
      });

      cancelAdminEdit();
      setMessage("Reporte actualizado correctamente.");
    } catch (updateError) {
      console.error("No se pudo actualizar el reporte:", updateError);
      setError("No se pudo actualizar el reporte.");
    } finally {
      setAdminSaving(false);
    }
  }

  async function deleteReport(report) {
    if (!isAdmin || !report?.id) return;

    const confirmDelete = window.confirm(
      `¿Seguro que deseas eliminar el reporte "${report.title || "sin título"}"? Esta acción también intentará eliminar sus evidencias y no se puede deshacer.`
    );

    if (!confirmDelete) return;

    setDeletingReportId(report.id);
    setMessage("");
    setError("");

    try {
      const evidenceFiles = Array.isArray(report.evidenceFiles) ? report.evidenceFiles : [];

      await Promise.allSettled(
        evidenceFiles
          .filter((file) => file?.path)
          .map((file) => deleteObject(ref(storage, file.path)))
      );

      await deleteDoc(doc(db, "bugReports", report.id));

      if (adminEditingId === report.id) {
        cancelAdminEdit();
      }

      setMessage("Reporte eliminado correctamente.");
    } catch (deleteError) {
      console.error("No se pudo eliminar el reporte:", deleteError);
      setError("No se pudo eliminar el reporte. Revisa los permisos e intenta de nuevo.");
    } finally {
      setDeletingReportId("");
    }
  }

  return (
    <div className="bug-reports-page visual-page">
      <div className="visual-page-header bug-reports-header">
        <div>
          <span className="bug-kicker">Control de incidencias</span>
          <h2>Reporte de errores</h2>
          <p>
            Registra fallas del sistema con una descripción clara y evidencia en imagen o video.
          </p>
        </div>

        <div className="bug-header-summary">
          <strong>{metrics.total}</strong>
          <span>{isAdmin ? "reportes registrados" : "mis reportes"}</span>
        </div>
      </div>

      {(message || error) && (
        <div className={error ? "bug-message bug-message-error" : "bug-message bug-message-success"}>
          {error || message}
        </div>
      )}

      <div className="bug-metrics-grid">
        <div className="bug-metric-card bug-metric-blue">
          <span>▣</span>
          <div>
            <strong>{metrics.total}</strong>
            <p>Total de reportes</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-orange">
          <span>!</span>
          <div>
            <strong>{metrics.open}</strong>
            <p>Abiertos o en revisión</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-red">
          <span>▲</span>
          <div>
            <strong>{metrics.highPriority}</strong>
            <p>Alta prioridad</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-green">
          <span>✓</span>
          <div>
            <strong>{metrics.resolved}</strong>
            <p>Resueltos o cerrados</p>
          </div>
        </div>
      </div>

      <div className="bug-reports-layout">
        <section className="card bug-form-card">
          <div className="bug-section-title">
            <span>+</span>
            <div>
              <h3>Nuevo reporte</h3>
              <p>Describe qué pasó y agrega evidencia para facilitar la revisión.</p>
            </div>
          </div>

          <form className="bug-report-form" onSubmit={handleSubmit}>
            <label className="visual-field">
              <span>Módulo afectado <b>*</b></span>
              <select value={form.module} onChange={(event) => updateForm("module", event.target.value)}>
                <option value="">Selecciona un módulo</option>
                {MODULE_OPTIONS.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>
                    {moduleName}
                  </option>
                ))}
              </select>
            </label>

            <label className="visual-field">
              <span>Prioridad</span>
              <select value={form.priority} onChange={(event) => updateForm("priority", event.target.value)}>
                {PRIORITIES.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="visual-field full">
              <span>Título breve <b>*</b></span>
              <input
                value={form.title}
                maxLength={140}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="Ej. No me deja subir evidencia"
              />
            </label>

            <label className="visual-field full">
              <span>Descripción del error <b>*</b></span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="Explica qué ocurrió, qué mensaje apareció o qué comportamiento esperabas."
              />
            </label>

            <label className="visual-field full">
              <span>Pasos para reproducirlo</span>
              <textarea
                value={form.steps}
                onChange={(event) => updateForm("steps", event.target.value)}
                placeholder="Ej. Entré a Mis proyectos > abrí un proyecto > presioné Subir evidencia."
              />
            </label>

            <div className="bug-evidence-uploader full">
              <label className="bug-dropzone">
                <input
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,video/webm"
                  multiple
                  onChange={handleFileSelection}
                />
                <span>⇧</span>
                <strong>Subir evidencias</strong>
                <p>Imágenes o videos. Máximo {MAX_FILES} archivos.</p>
                <small>Imágenes hasta 15 MB · Videos hasta 120 MB</small>
              </label>

              <div className="bug-selected-files">
                {files.length === 0 ? (
                  <div className="bug-empty-files">Aún no has seleccionado evidencias.</div>
                ) : (
                  files.map((file, index) => (
                    <button type="button" key={`${file.name}-${index}`} onClick={() => removeSelectedFile(index)}>
                      <span>{isVideoFile(file) ? "VID" : "IMG"}</span>
                      <div>
                        <strong>{file.name}</strong>
                        <small>{formatFileSize(file.size)}</small>
                      </div>
                      <b>×</b>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="bug-form-actions full">
              <button type="button" className="visual-outline-button" onClick={resetForm} disabled={saving}>
                Limpiar
              </button>
              <button type="submit" className="visual-primary-button" disabled={saving}>
                {saving ? "Enviando reporte..." : "Enviar reporte"}
              </button>
            </div>
          </form>
        </section>

        <section className="card bug-list-card">
          <div className="bug-list-header">
            <div className="bug-section-title">
              <span>≡</span>
              <div>
                <h3>{isAdmin ? "Todos los reportes" : "Mis reportes"}</h3>
                <p>{isAdmin ? "Da seguimiento administrativo a las incidencias." : "Consulta el estado de los errores que reportaste."}</p>
              </div>
            </div>
          </div>

          <div className="bug-filters">
            <div className="visual-search bug-search">
              <span>⌕</span>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar reporte"
              />
            </div>

            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos los estados</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">Todas las prioridades</option>
              {PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="empty-state small">
              <p>Cargando reportes...</p>
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="empty-state small">
              <div>▢</div>
              <p>No hay reportes con esos filtros.</p>
            </div>
          ) : (
            <div className="bug-report-list">
              {filteredReports.map((report) => (
                <article className="bug-report-card" key={report.id}>
                  <div className="bug-report-top">
                    <div>
                      <div className="bug-report-title-row">
                        <h4>{report.title || "Reporte sin título"}</h4>
                        <ReportBadge type="priority" value={report.priority || "media"} />
                        <ReportBadge type="status" value={report.status || "nuevo"} />
                      </div>

                      <div className="bug-report-meta">
                        <span>{report.module || "Sin módulo"}</span>
                        <span>{formatDate(report.createdAt)}</span>
                        {isAdmin && <span>{report.reporterName || "Usuario"}</span>}
                      </div>
                    </div>
                  </div>

                  <p className="bug-report-description">{report.description}</p>

                  {report.steps && (
                    <div className="bug-report-steps">
                      <strong>Pasos reportados</strong>
                      <p>{report.steps}</p>
                    </div>
                  )}

                  {Array.isArray(report.evidenceFiles) && report.evidenceFiles.length > 0 && (
                    <div className="bug-evidence-grid">
                      {report.evidenceFiles.map((file, index) => (
                        <EvidenceLink key={`${file.path || file.url}-${index}`} file={file} />
                      ))}
                    </div>
                  )}

                  {report.adminComment && (
                    <div className="bug-admin-comment-box">
                      <strong>Comentario administrativo</strong>
                      <p>{report.adminComment}</p>
                    </div>
                  )}

                  {isAdmin && (
                    <div className="bug-admin-panel">
                      {adminEditingId === report.id ? (
                        <div className="bug-admin-editor">
                          <label>
                            <span>Estado</span>
                            <select
                              value={adminDraft.status}
                              onChange={(event) => setAdminDraft((current) => ({ ...current, status: event.target.value }))}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status.value} value={status.value}>
                                  {status.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Comentario administrativo</span>
                            <textarea
                              value={adminDraft.adminComment}
                              onChange={(event) => setAdminDraft((current) => ({ ...current, adminComment: event.target.value }))}
                              placeholder="Agrega detalles de seguimiento o solución."
                            />
                          </label>

                          <div className="bug-admin-actions">
                            <button type="button" className="visual-outline-button" onClick={cancelAdminEdit} disabled={adminSaving}>
                              Cancelar
                            </button>
                            <button type="button" className="visual-primary-button" onClick={() => saveAdminUpdate(report)} disabled={adminSaving}>
                              {adminSaving ? "Guardando..." : "Guardar seguimiento"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bug-admin-actions bug-admin-actions-row">
                          <button type="button" className="visual-outline-button" onClick={() => startAdminEdit(report)}>
                            Dar seguimiento
                          </button>
                          <button
                            type="button"
                            className="bug-delete-button"
                            onClick={() => deleteReport(report)}
                            disabled={deletingReportId === report.id}
                          >
                            {deletingReportId === report.id ? "Eliminando..." : "Eliminar"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
