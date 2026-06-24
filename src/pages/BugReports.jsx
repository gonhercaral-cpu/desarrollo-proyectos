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

function SvgIcon({ children, className = "" }) {
  return (
    <svg className={`printshop-svg-icon bug-svg-icon ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function IconBug() {
  return (
    <SvgIcon>
      <path d="M8.5 8.2A3.5 3.5 0 0 1 12 5a3.5 3.5 0 0 1 3.5 3.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7 11.5c0-2.2 1.8-4 4-4h2c2.2 0 4 1.8 4 4v3.2a5 5 0 0 1-10 0v-3.2Z" stroke="currentColor" strokeWidth="1.9" />
      <path d="M4.8 10.2 3 8.8M19.2 10.2 21 8.8M5 16h-2M19 16h2M7.2 20.1 5.8 22M16.8 20.1l1.4 1.9M12 8v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconList() {
  return (
    <SvgIcon>
      <path d="M8 6h11M8 12h11M8 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconClock() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.8V12l3 1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function IconAlert() {
  return (
    <SvgIcon>
      <path d="M12 3.8 21 19H3L12 3.8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconCheck() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="m8.5 12.2 2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function IconSearch() {
  return (
    <SvgIcon>
      <circle cx="10.8" cy="10.8" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="m15.5 15.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconPlus() {
  return (
    <SvgIcon>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconUpload() {
  return (
    <SvgIcon>
      <path d="M12 16V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m8 9 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9A2.5 2.5 0 0 0 19 18.5V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconImage() {
  return (
    <SvgIcon>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="m7 16 3.2-3.2 2.4 2.4 2.2-2.2L18 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
    </SvgIcon>
  );
}

function IconVideo() {
  return (
    <SvgIcon>
      <rect x="4" y="7" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="m15 10 5-2.5v9L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function IconEdit() {
  return (
    <SvgIcon>
      <path d="M4 20h4l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m14.5 7.5 2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconTrash() {
  return (
    <SvgIcon>
      <path d="M5 7h14M10 11v5M14 11v5M8 7l.7-2h6.6L16 7M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function IconArrowLeft() {
  return (
    <SvgIcon>
      <path d="M14 6 8 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

function IconUser() {
  return (
    <SvgIcon>
      <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

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
  const isVideo = file.type?.startsWith("video/");

  return (
    <a className="bug-evidence-item" href={file.url} target="_blank" rel="noreferrer">
      <span>{isVideo ? <IconVideo /> : <IconImage />}</span>
      <div>
        <strong>{file.name || "Evidencia"}</strong>
        <small>
          {getEvidenceKind(file.type)} · {formatFileSize(file.size)}
        </small>
      </div>
    </a>
  );
}

function ReportPreview({ form, files }) {
  return (
    <div className="bug-preview-card">
      <span className="preview-label">Vista previa</span>
      <h3>{form.title || "Título del reporte"}</h3>
      <p>{form.description || "Aquí aparecerá la descripción del error que se enviará para revisión."}</p>
      <div className="preview-badges">
        <span className="area-chip area-blue">{form.module || "Módulo"}</span>
        <ReportBadge type="priority" value={form.priority || "media"} />
      </div>
      <div className="bug-preview-files">
        <strong>{files.length}</strong>
        <span>{files.length === 1 ? "evidencia seleccionada" : "evidencias seleccionadas"}</span>
      </div>
    </div>
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
  const [activeView, setActiveView] = useState("list");
  const [selectedReportId, setSelectedReportId] = useState("");
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
      newReports: reports.filter((report) => (report.status || "nuevo") === "nuevo").length,
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

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const attentionReports = useMemo(
    () =>
      reports
        .filter((report) => ["critica", "alta"].includes(report.priority) && !["resuelto", "cerrado"].includes(report.status))
        .slice(0, 3),
    [reports]
  );

  const statusCounts = useMemo(
    () =>
      STATUS_OPTIONS.map((status) => ({
        ...status,
        count: reports.filter((report) => (report.status || "nuevo") === status.value).length,
      })),
    [reports]
  );

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function scrollToTop() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function openList() {
    setActiveView("list");
    setSelectedReportId("");
    cancelAdminEdit();
    scrollToTop();
  }

  function openNewReport() {
    setActiveView("new");
    setSelectedReportId("");
    cancelAdminEdit();
    scrollToTop();
  }

  function openReportDetail(report) {
    setSelectedReportId(report.id);
    setActiveView("detail");
    cancelAdminEdit();
    scrollToTop();
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
      setActiveView("list");
      setMessage("Reporte enviado correctamente. Administración podrá revisarlo desde este módulo.");
      scrollToTop();
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
        ...(nextStatus === "resuelto" || nextStatus === "cerrado" ? { resolvedAt: serverTimestamp() } : {}),
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
        evidenceFiles.filter((file) => file?.path).map((file) => deleteObject(ref(storage, file.path)))
      );

      await deleteDoc(doc(db, "bugReports", report.id));

      if (adminEditingId === report.id) {
        cancelAdminEdit();
      }

      if (selectedReportId === report.id) {
        openList();
      }

      setMessage("Reporte eliminado correctamente.");
    } catch (deleteError) {
      console.error("No se pudo eliminar el reporte:", deleteError);
      setError("No se pudo eliminar el reporte. Revisa los permisos e intenta de nuevo.");
    } finally {
      setDeletingReportId("");
    }
  }

  function renderTopbar() {
    return (
      <section className="printshop-topbar bug-module-topbar">
        <div className="printshop-topbar-main">
          <div className="printshop-topbar-module-icon bug-topbar-icon">
            <IconBug />
          </div>
          <div className="printshop-topbar-copy">
            <p className="printshop-kicker">Control de incidencias</p>
            <h1>Reporte de errores</h1>
            <p>Registra fallas del sistema, revisa evidencias y da seguimiento hasta su solución.</p>
          </div>
        </div>

        <div className="bug-topbar-actions">
          <label className="printshop-search bug-topbar-search">
            <span><IconSearch /></span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar reporte, módulo o persona"
            />
          </label>
          <button type="button" className="bug-topbar-button" onClick={openNewReport}>
            <IconPlus />
            Nuevo reporte
          </button>
        </div>
      </section>
    );
  }

  function renderMessages() {
    if (!message && !error) return null;

    return <div className={error ? "bug-message bug-message-error" : "bug-message bug-message-success"}>{error || message}</div>;
  }

  function renderMetrics() {
    return (
      <div className="bug-metrics-grid">
        <div className="bug-metric-card bug-metric-blue">
          <span><IconList /></span>
          <div>
            <strong>{metrics.total}</strong>
            <h4>Total de reportes</h4>
            <p>{isAdmin ? "Registros recibidos" : "Mis reportes"}</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-orange">
          <span><IconClock /></span>
          <div>
            <strong>{metrics.open}</strong>
            <h4>Abiertos</h4>
            <p>Pendientes de atención</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-red">
          <span><IconAlert /></span>
          <div>
            <strong>{metrics.highPriority}</strong>
            <h4>Alta prioridad</h4>
            <p>Requieren revisión pronta</p>
          </div>
        </div>

        <div className="bug-metric-card bug-metric-green">
          <span><IconCheck /></span>
          <div>
            <strong>{metrics.resolved}</strong>
            <h4>Resueltos</h4>
            <p>Solucionados o cerrados</p>
          </div>
        </div>
      </div>
    );
  }

  function renderAttention() {
    return (
      <section className="bug-attention-card">
        <div className="bug-section-title">
          <span><IconAlert /></span>
          <div>
            <h3>Requiere atención</h3>
            <p>Reportes críticos o de alta prioridad que siguen abiertos.</p>
          </div>
        </div>

        <div className="bug-attention-list">
          {attentionReports.length === 0 ? (
            <div className="bug-attention-empty">No hay reportes críticos por ahora.</div>
          ) : (
            attentionReports.map((report) => (
              <button type="button" key={report.id} onClick={() => openReportDetail(report)}>
                <strong>{report.title || "Reporte sin título"}</strong>
                <span>{report.module || "Sin módulo"}</span>
                <ReportBadge type="priority" value={report.priority || "media"} />
              </button>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderFilters() {
    return (
      <section className="bug-filter-card">
        <div className="bug-section-title">
          <span><IconSearch /></span>
          <div>
            <h3>Filtros de trabajo</h3>
            <p>Mostrando {filteredReports.length} de {reports.length} reporte(s).</p>
          </div>
        </div>

        <div className="bug-filter-controls">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos los estados</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>

          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">Todas las prioridades</option>
            {PRIORITIES.map((priority) => (
              <option key={priority.value} value={priority.value}>{priority.label}</option>
            ))}
          </select>

          <button
            type="button"
            className="visual-outline-button bug-compact-button"
            onClick={() => {
              setStatusFilter("all");
              setPriorityFilter("all");
              setSearchTerm("");
            }}
          >
            Limpiar
          </button>
        </div>
      </section>
    );
  }

  function renderReportList() {
    return (
      <section className="card bug-list-card-redesign">
        <div className="bug-panel-header">
          <div className="bug-section-title">
            <span><IconList /></span>
            <div>
              <h3>{isAdmin ? "Todos los reportes" : "Mis reportes"}</h3>
              <p>{isAdmin ? "Da seguimiento administrativo a las incidencias." : "Consulta el estado de los errores que reportaste."}</p>
            </div>
          </div>
          <span className="bug-count-pill">{filteredReports.length} visibles</span>
        </div>

        {loading ? (
          <div className="bug-empty-state">Cargando reportes...</div>
        ) : filteredReports.length === 0 ? (
          <div className="bug-empty-state">
            <span><IconBug /></span>
            <strong>No hay reportes con esos filtros</strong>
            <p>Registra un nuevo reporte o ajusta los filtros de búsqueda.</p>
          </div>
        ) : (
          <div className="bug-report-list-redesign">
            {filteredReports.map((report) => (
              <article className="bug-report-card-redesign" key={report.id}>
                <div className="bug-report-icon"><IconBug /></div>
                <div className="bug-report-main">
                  <div className="bug-report-title-row">
                    <h4>{report.title || "Reporte sin título"}</h4>
                    <div>
                      <ReportBadge type="priority" value={report.priority || "media"} />
                      <ReportBadge type="status" value={report.status || "nuevo"} />
                    </div>
                  </div>

                  <p>{report.description || "Sin descripción registrada."}</p>

                  <div className="bug-report-meta-grid">
                    <span><b>Módulo</b>{report.module || "Sin módulo"}</span>
                    <span><b>Fecha</b>{formatDate(report.createdAt)}</span>
                    {isAdmin && <span><b>Reportó</b>{report.reporterName || "Usuario"}</span>}
                    <span><b>Evidencias</b>{report.evidenceCount || report.evidenceFiles?.length || 0}</span>
                  </div>
                </div>

                <div className="bug-report-card-actions">
                  <button type="button" className="visual-outline-button bug-compact-button" onClick={() => openReportDetail(report)}>
                    Ver detalle
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="visual-outline-button bug-compact-button"
                      onClick={() => {
                        openReportDetail(report);
                        startAdminEdit(report);
                      }}
                    >
                      Seguimiento
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderSideSummary() {
    return (
      <aside className="bug-side-stack">
        <section className="card bug-side-card">
          <div className="bug-section-title">
            <span><IconList /></span>
            <div>
              <h3>Resumen rápido</h3>
              <p>Distribución general.</p>
            </div>
          </div>
          <div className="bug-status-summary-list">
            {statusCounts.map((status) => (
              <div key={status.value}>
                <span>{status.label}</span>
                <strong>{status.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </aside>
    );
  }

  function renderListView() {
    return (
      <>
        {renderMetrics()}
        {renderAttention()}
        {renderFilters()}
        <div className="bug-main-layout">
          {renderReportList()}
          {renderSideSummary()}
        </div>
      </>
    );
  }

  function renderNewReportView() {
    return (
      <section className="bug-focused-panel">
        <div className="bug-focused-header">
          <div className="bug-section-title">
            <span><IconPlus /></span>
            <div>
              <p className="bug-focused-kicker">Vista enfocada</p>
              <h3>Nuevo reporte</h3>
              <p>Describe qué pasó y agrega evidencia para facilitar la revisión.</p>
            </div>
          </div>
          <button type="button" className="visual-outline-button bug-back-button" onClick={openList}>
            <IconArrowLeft />
            Volver a reportes
          </button>
        </div>

        <div className="bug-focused-layout">
          <form className="bug-report-form-redesign" onSubmit={handleSubmit}>
            <section className="card bug-form-section-card">
              <div className="bug-section-title bug-form-section-title">
                <span><IconEdit /></span>
                <div>
                  <h3>Datos del error</h3>
                  <p>Completa los campos básicos para documentar la incidencia.</p>
                </div>
              </div>

              <div className="bug-form-grid">
                <label className="visual-field">
                  <span>Módulo afectado <b>*</b></span>
                  <select value={form.module} onChange={(event) => updateForm("module", event.target.value)}>
                    <option value="">Selecciona un módulo</option>
                    {MODULE_OPTIONS.map((moduleName) => (
                      <option key={moduleName} value={moduleName}>{moduleName}</option>
                    ))}
                  </select>
                </label>

                <label className="visual-field">
                  <span>Prioridad</span>
                  <select value={form.priority} onChange={(event) => updateForm("priority", event.target.value)}>
                    {PRIORITIES.map((priority) => (
                      <option key={priority.value} value={priority.value}>{priority.label}</option>
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
              </div>
            </section>

            <section className="card bug-form-section-card">
              <div className="bug-section-title bug-form-section-title">
                <span><IconUpload /></span>
                <div>
                  <h3>Evidencias</h3>
                  <p>Adjunta capturas o videos para mostrar claramente el problema.</p>
                </div>
              </div>

              <div className="bug-evidence-uploader-redesign">
                <label className="bug-dropzone-redesign">
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/quicktime,video/webm"
                    multiple
                    onChange={handleFileSelection}
                  />
                  <span><IconUpload /></span>
                  <strong>Subir evidencias</strong>
                  <p>Imágenes o videos. Máximo {MAX_FILES} archivos.</p>
                  <small>Imágenes hasta 15 MB · Videos hasta 120 MB</small>
                </label>

                <div className="bug-selected-files-redesign">
                  {files.length === 0 ? (
                    <div className="bug-empty-files">Aún no has seleccionado evidencias.</div>
                  ) : (
                    files.map((file, index) => (
                      <button type="button" key={`${file.name}-${index}`} onClick={() => removeSelectedFile(index)}>
                        <span>{isVideoFile(file) ? <IconVideo /> : <IconImage />}</span>
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

              <div className="bug-form-actions-redesign">
                <button type="button" className="visual-outline-button" onClick={resetForm} disabled={saving}>Limpiar</button>
                <button type="submit" className="visual-primary-button" disabled={saving}>
                  {saving ? "Enviando reporte..." : "Enviar reporte"}
                </button>
              </div>
            </section>
          </form>

          <aside className="bug-focused-side">
            <ReportPreview form={form} files={files} />
          </aside>
        </div>
      </section>
    );
  }

  function renderAdminEditor(report) {
    if (!isAdmin) return null;

    return (
      <section className="card bug-detail-admin-card">
        <div className="bug-section-title">
          <span><IconEdit /></span>
          <div>
            <h3>Seguimiento administrativo</h3>
            <p>Actualiza el estado y deja un comentario operativo.</p>
          </div>
        </div>

        {adminEditingId === report.id ? (
          <div className="bug-admin-editor-redesign">
            <label className="visual-field">
              <span>Estado</span>
              <select value={adminDraft.status} onChange={(event) => setAdminDraft((current) => ({ ...current, status: event.target.value }))}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </label>

            <label className="visual-field full">
              <span>Comentario administrativo</span>
              <textarea
                value={adminDraft.adminComment}
                onChange={(event) => setAdminDraft((current) => ({ ...current, adminComment: event.target.value }))}
                placeholder="Agrega detalles de seguimiento o solución."
              />
            </label>

            <div className="bug-admin-actions-redesign">
              <button type="button" className="visual-outline-button" onClick={cancelAdminEdit} disabled={adminSaving}>Cancelar</button>
              <button type="button" className="visual-primary-button" onClick={() => saveAdminUpdate(report)} disabled={adminSaving}>
                {adminSaving ? "Guardando..." : "Guardar seguimiento"}
              </button>
            </div>
          </div>
        ) : (
          <div className="bug-admin-actions-redesign">
            <button type="button" className="visual-primary-button" onClick={() => startAdminEdit(report)}>
              Dar seguimiento
            </button>
            <button
              type="button"
              className="bug-delete-button-redesign"
              onClick={() => deleteReport(report)}
              disabled={deletingReportId === report.id}
            >
              <IconTrash />
              {deletingReportId === report.id ? "Eliminando..." : "Eliminar reporte"}
            </button>
          </div>
        )}
      </section>
    );
  }

  function renderDetailView() {
    if (!selectedReport) {
      return (
        <section className="card bug-list-card-redesign">
          <div className="bug-empty-state">
            <span><IconBug /></span>
            <strong>Selecciona un reporte</strong>
            <p>El detalle aparecerá en este espacio.</p>
            <button type="button" className="visual-primary-button bug-compact-button" onClick={openList}>Volver al listado</button>
          </div>
        </section>
      );
    }

    return (
      <section className="bug-focused-panel">
        <div className="bug-focused-header">
          <div className="bug-section-title">
            <span><IconBug /></span>
            <div>
              <p className="bug-focused-kicker">Detalle del reporte</p>
              <h3>{selectedReport.title || "Reporte sin título"}</h3>
              <p>{selectedReport.module || "Sin módulo"} · {formatDate(selectedReport.createdAt)}</p>
            </div>
          </div>
          <button type="button" className="visual-outline-button bug-back-button" onClick={openList}>
            <IconArrowLeft />
            Volver a reportes
          </button>
        </div>

        <div className="bug-detail-layout">
          <main className="bug-detail-main">
            <section className="card bug-detail-summary-card">
              <div className="bug-detail-title-row">
                <div>
                  <h3>{selectedReport.title || "Reporte sin título"}</h3>
                  <p>{selectedReport.description || "Sin descripción registrada."}</p>
                </div>
                <div className="bug-detail-badges">
                  <ReportBadge type="priority" value={selectedReport.priority || "media"} />
                  <ReportBadge type="status" value={selectedReport.status || "nuevo"} />
                </div>
              </div>

              <div className="bug-detail-meta-grid">
                <div><span>Módulo</span><strong>{selectedReport.module || "Sin módulo"}</strong></div>
                <div><span>Reportó</span><strong>{selectedReport.reporterName || "Usuario"}</strong></div>
                <div><span>Correo</span><strong>{selectedReport.reporterEmail || "Sin correo"}</strong></div>
                <div><span>Fecha</span><strong>{formatDate(selectedReport.createdAt)}</strong></div>
              </div>
            </section>

            {selectedReport.steps && (
              <section className="card bug-detail-card">
                <div className="bug-section-title">
                  <span><IconList /></span>
                  <div>
                    <h3>Pasos reportados</h3>
                    <p>Información para intentar reproducir el error.</p>
                  </div>
                </div>
                <p className="bug-detail-text">{selectedReport.steps}</p>
              </section>
            )}

            <section className="card bug-detail-card">
              <div className="bug-section-title">
                <span><IconImage /></span>
                <div>
                  <h3>Evidencias</h3>
                  <p>Archivos adjuntos al reporte.</p>
                </div>
              </div>

              {Array.isArray(selectedReport.evidenceFiles) && selectedReport.evidenceFiles.length > 0 ? (
                <div className="bug-evidence-grid-redesign">
                  {selectedReport.evidenceFiles.map((file, index) => (
                    <EvidenceLink key={`${file.path || file.url}-${index}`} file={file} />
                  ))}
                </div>
              ) : (
                <div className="bug-empty-files">Este reporte no tiene evidencias adjuntas.</div>
              )}
            </section>

            {selectedReport.adminComment && (
              <section className="card bug-detail-card bug-admin-comment-card">
                <div className="bug-section-title">
                  <span><IconEdit /></span>
                  <div>
                    <h3>Comentario administrativo</h3>
                    <p>Último seguimiento registrado.</p>
                  </div>
                </div>
                <p className="bug-detail-text">{selectedReport.adminComment}</p>
              </section>
            )}

            {Array.isArray(selectedReport.adminHistory) && selectedReport.adminHistory.length > 0 && (
              <section className="card bug-detail-card">
                <div className="bug-section-title">
                  <span><IconClock /></span>
                  <div>
                    <h3>Historial de seguimiento</h3>
                    <p>Cambios administrativos registrados.</p>
                  </div>
                </div>
                <div className="bug-history-list">
                  {selectedReport.adminHistory.slice().reverse().map((item, index) => (
                    <div key={`${item.changedAt}-${index}`}>
                      <span><IconClock /></span>
                      <div>
                        <strong>{getOption(STATUS_OPTIONS, item.status).label}</strong>
                        <p>{item.comment || "Sin comentario adicional."}</p>
                        <small>{item.changedByName || "Administrador"} · {formatDate(item.changedAt)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>

          <aside className="bug-detail-side">
            <section className="card bug-side-card">
              <div className="bug-section-title">
                <span><IconUser /></span>
                <div>
                  <h3>Datos del reporte</h3>
                  <p>Resumen operativo.</p>
                </div>
              </div>
              <div className="bug-status-summary-list">
                <div><span>Estado</span><strong>{getOption(STATUS_OPTIONS, selectedReport.status || "nuevo").label}</strong></div>
                <div><span>Prioridad</span><strong>{getOption(PRIORITIES, selectedReport.priority || "media").label}</strong></div>
                <div><span>Evidencias</span><strong>{selectedReport.evidenceCount || selectedReport.evidenceFiles?.length || 0}</strong></div>
              </div>
            </section>
            {renderAdminEditor(selectedReport)}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <div className="bug-reports-page bug-reports-redesign visual-page">
      {renderTopbar()}
      {renderMessages()}
      {activeView === "new" ? renderNewReportView() : activeView === "detail" ? renderDetailView() : renderListView()}
    </div>
  );
}
