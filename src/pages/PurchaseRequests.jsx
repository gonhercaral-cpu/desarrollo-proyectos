import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getFirestore,
  doc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

const db = getFirestore();

const PURCHASE_STATUSES = [
  { value: "pending_review", label: "Pendiente de revisión", tone: "gold" },
  { value: "reviewing", label: "En revisión", tone: "blue" },
  { value: "approved", label: "Aprobada", tone: "green" },
  { value: "purchasing", label: "En proceso de compra", tone: "purple" },
  { value: "purchased", label: "Comprada / en camino", tone: "teal" },
  { value: "received", label: "Recibida", tone: "orange" },
  { value: "delivered", label: "Entregada", tone: "green" },
  { value: "rejected", label: "Rechazada", tone: "red" },
  { value: "cancelled", label: "Cancelada", tone: "gray" },
];

const PRIORITIES = [
  { value: "low", label: "Baja", tone: "gray" },
  { value: "normal", label: "Normal", tone: "blue" },
  { value: "high", label: "Alta", tone: "orange" },
  { value: "urgent", label: "Urgente", tone: "red" },
];

const DEPARTMENTS = [
  "Administración",
  "Recepción",
  "Dirección Académica",
  "Material para clases",
  "Soporte Técnico",
  "Producción audiovisual",
  "Programación",
  "Coffee Beans Factory",
  "Otro",
];

const INITIAL_FORM = {
  itemName: "",
  description: "",
  department: "Soporte Técnico",
  priority: "normal",
  quantity: 1,
  suggestedLink: "",
  projectName: "",
  requesterComment: "",
};

function getProfileName(profile, firebaseUser) {
  return (
    profile?.name ||
    profile?.displayName ||
    firebaseUser?.displayName ||
    firebaseUser?.email ||
    "Usuario"
  );
}

function getProfileEmail(profile, firebaseUser) {
  return profile?.email || firebaseUser?.email || "";
}

function getInitials(nameOrEmail) {
  const clean = String(nameOrEmail || "Usuario").trim();
  if (!clean) return "U";

  const parts = clean
    .replace(/@.*/, "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusConfig(value) {
  return PURCHASE_STATUSES.find((item) => item.value === value) || PURCHASE_STATUSES[0];
}

function priorityConfig(value) {
  return PRIORITIES.find((item) => item.value === value) || PRIORITIES[1];
}

function sortByCreatedAtDesc(a, b) {
  const aTime = a.createdAt?.toMillis?.() || 0;
  const bTime = b.createdAt?.toMillis?.() || 0;
  return bTime - aTime;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function PurchaseModuleIcon({ name }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  const paths = {
    overview: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="2" {...common} />
        <rect x="13" y="4" width="7" height="7" rx="2" {...common} />
        <rect x="4" y="13" width="7" height="7" rx="2" {...common} />
        <rect x="13" y="13" width="7" height="7" rx="2" {...common} />
      </>
    ),
    request: (
      <>
        <path d="M7 3h7l4 4v14H7z" {...common} />
        <path d="M14 3v5h5" {...common} />
        <path d="M9.5 12h7" {...common} />
        <path d="M9.5 16h5" {...common} />
      </>
    ),
    list: (
      <>
        <path d="M8 6h12" {...common} />
        <path d="M8 12h12" {...common} />
        <path d="M8 18h12" {...common} />
        <path d="M4 6h.01" {...common} />
        <path d="M4 12h.01" {...common} />
        <path d="M4 18h.01" {...common} />
      </>
    ),
    check: (
      <>
        <path d="M20 7 10 17l-5-5" {...common} />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.5 20h19z" {...common} />
        <path d="M12 9v4" {...common} />
        <path d="M12 17h.01" {...common} />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" {...common} />
        <path d="M12 8v5l3 2" {...common} />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" {...common} />
        <path d="M10 11v6" {...common} />
        <path d="M14 11v6" {...common} />
        <path d="M6 7l1 14h10l1-14" {...common} />
        <path d="M9 7V4h6v3" {...common} />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" {...common} />
        <path d="m20 20-3.5-3.5" {...common} />
      </>
    ),
    back: (
      <>
        <path d="m11 6-6 6 6 6" {...common} />
        <path d="M5 12h14" {...common} />
      </>
    ),
  };

  return (
    <span className={`purchase-svg-icon purchase-svg-icon-${name || "overview"}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">{paths[name] || paths.overview}</svg>
    </span>
  );
}

export default function PurchaseRequests() {
  const { firebaseUser, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const requesterName = getProfileName(profile, firebaseUser);
  const requesterEmail = getProfileEmail(profile, firebaseUser);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusedView, setFocusedView] = useState("list");
  const [form, setForm] = useState(INITIAL_FORM);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  const [adminStatus, setAdminStatus] = useState("pending_review");
  const [adminComment, setAdminComment] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingRequestId, setDeletingRequestId] = useState(null);

  useEffect(() => {
    if (!firebaseUser?.uid || !profile) return undefined;

    setLoading(true);
    setError("");

    const baseQuery = isAdmin
      ? query(collection(db, "purchaseRequests"))
      : query(
          collection(db, "purchaseRequests"),
          where("requestedByUid", "==", firebaseUser.uid)
        );

    const unsubscribe = onSnapshot(
      baseQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((document) => ({ id: document.id, ...document.data() }))
          .sort(sortByCreatedAtDesc);

        setRequests(rows);
        setLoading(false);
      },
      (snapshotError) => {
        console.error("No se pudieron cargar las solicitudes de compra:", snapshotError);
        setError("No se pudieron cargar las solicitudes de compra. Revisa permisos o conexión.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firebaseUser?.uid, isAdmin, profile]);

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    return requests.find((request) => request.id === selectedRequestId) || null;
  }, [requests, selectedRequestId]);

  useEffect(() => {
    if (!selectedRequest?.id) {
      setAdminStatus("pending_review");
      setAdminComment("");
      setRejectionReason("");
      setLogs([]);
      return undefined;
    }

    setAdminStatus(selectedRequest.status || "pending_review");
    setAdminComment(selectedRequest.adminComment || "");
    setRejectionReason(selectedRequest.rejectionReason || "");
    setLogsLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "purchaseRequests", selectedRequest.id, "logs"),
      (snapshot) => {
        const rows = snapshot.docs
          .map((document) => ({ id: document.id, ...document.data() }))
          .sort(sortByCreatedAtDesc);

        setLogs(rows);
        setLogsLoading(false);
      },
      (snapshotError) => {
        console.error("No se pudo cargar la bitácora de compra:", snapshotError);
        setLogs([]);
        setLogsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedRequest?.id, selectedRequest?.status, selectedRequest?.adminComment, selectedRequest?.rejectionReason]);

  const metrics = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((request) => request.status === "pending_review").length;
    const inProcess = requests.filter((request) =>
      ["reviewing", "approved", "purchasing", "purchased"].includes(request.status)
    ).length;
    const delivered = requests.filter((request) => request.status === "delivered").length;
    const rejected = requests.filter((request) => request.status === "rejected").length;
    const urgent = requests.filter((request) => request.priority === "urgent").length;

    return { total, pending, inProcess, delivered, rejected, urgent };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm);

    return requests.filter((request) => {
      const matchesStatus = statusFilter === "all" || request.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || request.priority === priorityFilter;
      const searchableText = normalizeText(
        [
          request.itemName,
          request.description,
          request.department,
          request.requestedByName,
          request.requestedByEmail,
          request.projectName,
        ].join(" ")
      );
      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);

      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [priorityFilter, requests, searchTerm, statusFilter]);

  const attentionRequests = useMemo(() => {
    return requests
      .filter((request) =>
        request.status === "pending_review" || request.priority === "urgent" || request.status === "reviewing"
      )
      .slice(0, 4);
  }, [requests]);

  async function addLog(requestId, type, messageText) {
    await addDoc(collection(db, "purchaseRequests", requestId, "logs"), {
      requestId,
      type,
      message: messageText,
      createdByUid: firebaseUser.uid,
      createdByName: requesterName,
      createdByEmail: requesterEmail,
      createdAt: serverTimestamp(),
    });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateView() {
    setFocusedView("create");
    setSelectedRequestId(null);
    setMessage("");
    setError("");
  }

  function openDetailView(request) {
    if (!request?.id) return;
    setSelectedRequestId(request.id);
    setFocusedView("detail");
    setMessage("");
    setError("");
  }

  function backToList() {
    setFocusedView("list");
    setMessage("");
    setError("");
  }

  async function handleCreateRequest(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    const itemName = form.itemName.trim();
    const description = form.description.trim();
    const quantity = Number(form.quantity || 1);

    if (!itemName || !description) {
      setError("Escribe qué se necesita y una descripción breve.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity < 1) {
      setError("La cantidad debe ser mayor a cero.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        itemName,
        description,
        department: form.department,
        priority: form.priority,
        quantity,
        suggestedLink: form.suggestedLink.trim(),
        projectName: form.projectName.trim(),
        requesterComment: form.requesterComment.trim(),

        status: "pending_review",
        adminComment: "",
        rejectionReason: "",

        requestedByUid: firebaseUser.uid,
        requestedByName: requesterName,
        requestedByEmail: requesterEmail,
        createdByUid: firebaseUser.uid,
        createdByName: requesterName,
        createdByEmail: requesterEmail,

        purchasedAt: null,
        receivedAt: null,
        deliveredAt: null,
        cancelledAt: null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: firebaseUser.uid,
        updatedByName: requesterName,
        updatedByEmail: requesterEmail,
      };

      const requestRef = await addDoc(collection(db, "purchaseRequests"), payload);

      try {
        await addLog(requestRef.id, "created", `Solicitud creada: ${itemName}.`);
      } catch (logError) {
        console.warn(
          "La solicitud fue creada, pero no se pudo guardar la bitácora inicial:",
          logError
        );
      }

      setForm({
        ...INITIAL_FORM,
        department: profile?.area || INITIAL_FORM.department,
      });
      setSelectedRequestId(requestRef.id);
      setFocusedView("detail");
      setMessage("Solicitud de compra registrada correctamente.");
    } catch (createError) {
      console.error("No se pudo crear la solicitud de compra:", createError);
      const detail = createError?.code ? ` (${createError.code})` : "";
      setError(`No se pudo registrar la solicitud${detail}. Revisa permisos o conexión.`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAdminUpdate() {
    if (!selectedRequest?.id || !isAdmin) return;

    setUpdatingStatus(true);
    setMessage("");
    setError("");

    try {
      const previousStatusLabel = statusConfig(selectedRequest.status).label;
      const nextStatusLabel = statusConfig(adminStatus).label;
      const statusChanged = selectedRequest.status !== adminStatus;
      const commentChanged = (selectedRequest.adminComment || "") !== adminComment.trim();
      const rejectionChanged = (selectedRequest.rejectionReason || "") !== rejectionReason.trim();

      const payload = {
        status: adminStatus,
        adminComment: adminComment.trim(),
        rejectionReason: rejectionReason.trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: firebaseUser.uid,
        updatedByName: requesterName,
        updatedByEmail: requesterEmail,
      };

      if (adminStatus === "purchased" && !selectedRequest.purchasedAt) {
        payload.purchasedAt = serverTimestamp();
      }

      if (adminStatus === "received" && !selectedRequest.receivedAt) {
        payload.receivedAt = serverTimestamp();
      }

      if (adminStatus === "delivered" && !selectedRequest.deliveredAt) {
        payload.deliveredAt = serverTimestamp();
      }

      await updateDoc(doc(db, "purchaseRequests", selectedRequest.id), payload);

      if (statusChanged) {
        await addLog(
          selectedRequest.id,
          "status_changed",
          `Estado actualizado de “${previousStatusLabel}” a “${nextStatusLabel}”.`
        );
      }

      if (commentChanged) {
        await addLog(selectedRequest.id, "admin_comment", "Comentario administrativo actualizado.");
      }

      if (rejectionChanged && adminStatus === "rejected") {
        await addLog(selectedRequest.id, "rejection_reason", "Motivo de rechazo actualizado.");
      }

      setMessage("Solicitud actualizada correctamente.");
    } catch (updateError) {
      console.error("No se pudo actualizar la solicitud:", updateError);
      setError("No se pudo actualizar la solicitud. Revisa permisos o conexión.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleCancelRequest(request) {
    if (!request?.id || request.status !== "pending_review") return;

    const confirmed = window.confirm("¿Cancelar esta solicitud de compra?");
    if (!confirmed) return;

    setMessage("");
    setError("");

    try {
      await updateDoc(doc(db, "purchaseRequests", request.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledByUid: firebaseUser.uid,
        updatedAt: serverTimestamp(),
        updatedByUid: firebaseUser.uid,
        updatedByName: requesterName,
        updatedByEmail: requesterEmail,
      });

      try {
        await addLog(request.id, "cancelled", "Solicitud cancelada por el solicitante.");
      } catch (logError) {
        console.warn(
          "La solicitud fue cancelada, pero no se pudo guardar la bitácora:",
          logError
        );
      }

      setMessage("Solicitud cancelada correctamente.");
    } catch (cancelError) {
      console.error("No se pudo cancelar la solicitud:", cancelError);
      setError("No se pudo cancelar la solicitud. Revisa permisos o conexión.");
    }
  }

  async function handleDeleteRequest(request) {
    if (!request?.id || !isAdmin) return;

    const confirmed = window.confirm(
      `¿Eliminar definitivamente la solicitud “${request.itemName || "sin nombre"}”? Esta acción la quitará de la lista de solicitudes.`
    );

    if (!confirmed) return;

    setMessage("");
    setError("");
    setDeletingRequestId(request.id);

    try {
      await deleteDoc(doc(db, "purchaseRequests", request.id));

      setRequests((current) => current.filter((item) => item.id !== request.id));
      setSelectedRequestId(null);
      setFocusedView("list");
      setMessage("Solicitud eliminada correctamente.");
    } catch (deleteError) {
      console.error("No se pudo eliminar la solicitud:", deleteError);
      const detail = deleteError?.code ? ` (${deleteError.code})` : "";
      setError(`No se pudo eliminar la solicitud${detail}. Revisa permisos o conexión.`);
    } finally {
      setDeletingRequestId(null);
    }
  }

  const renderCreateView = () => (
    <div className="purchase-focused-view">
      <button type="button" className="purchase-back-button" onClick={backToList}>
        <PurchaseModuleIcon name="back" />
        Regresar a solicitudes
      </button>

      <div className="purchase-focused-header">
        <div>
          <span className="purchase-focused-kicker">Vista enfocada</span>
          <h2>Nueva solicitud de compra</h2>
          <p>Registra solo la información necesaria para que Administración pueda revisar, aprobar y dar seguimiento.</p>
        </div>
        <PurchaseModuleIcon name="request" />
      </div>

      <div className="purchase-focused-card purchase-create-focused-card">
        <form className="purchase-focused-form" onSubmit={handleCreateRequest}>
          <label className="visual-field">
            <span>¿Qué necesitas? <b>*</b></span>
            <input
              type="text"
              value={form.itemName}
              onChange={(event) => updateForm("itemName", event.target.value)}
              placeholder="Ej. Mouse inalámbrico, cable HDMI, no break..."
              maxLength={120}
            />
          </label>

          <label className="visual-field">
            <span>Cantidad <b>*</b></span>
            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(event) => updateForm("quantity", event.target.value)}
            />
          </label>

          <label className="visual-field full">
            <span>Descripción / justificación <b>*</b></span>
            <textarea
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              placeholder="Explica para qué se necesita, dónde se usará y cualquier detalle importante."
              maxLength={700}
            />
          </label>

          <label className="visual-field">
            <span>Área / departamento</span>
            <select
              value={form.department}
              onChange={(event) => updateForm("department", event.target.value)}
            >
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
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

          <label className="visual-field">
            <span>Link sugerido</span>
            <input
              type="url"
              value={form.suggestedLink}
              onChange={(event) => updateForm("suggestedLink", event.target.value)}
              placeholder="https://..."
            />
          </label>

          <label className="visual-field">
            <span>Proyecto relacionado</span>
            <input
              type="text"
              value={form.projectName}
              onChange={(event) => updateForm("projectName", event.target.value)}
              placeholder="Opcional"
              maxLength={120}
            />
          </label>

          <label className="visual-field full">
            <span>Comentario adicional</span>
            <textarea
              value={form.requesterComment}
              onChange={(event) => updateForm("requesterComment", event.target.value)}
              placeholder="Opcional: marca, modelo, medidas, color, proveedor, etc."
              maxLength={500}
            />
          </label>

          <div className="purchase-focused-actions">
            <button type="button" className="visual-outline-button" onClick={backToList} disabled={saving}>
              Cancelar
            </button>

            <button type="submit" className="visual-primary-button" disabled={saving}>
              {saving ? "Guardando..." : "Registrar solicitud"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderDetailView = () => {
    if (!selectedRequest) {
      return (
        <div className="purchase-focused-view">
          <button type="button" className="purchase-back-button" onClick={backToList}>
            <PurchaseModuleIcon name="back" />
            Regresar a solicitudes
          </button>
          <div className="purchase-focused-card">
            <div className="empty-state small">
              <p>La solicitud seleccionada ya no está disponible.</p>
            </div>
          </div>
        </div>
      );
    }

    const status = statusConfig(selectedRequest.status);
    const priority = priorityConfig(selectedRequest.priority);
    const canCancel =
      selectedRequest.status === "pending_review" && selectedRequest.requestedByUid === firebaseUser?.uid;

    return (
      <div className="purchase-focused-view">
        <button type="button" className="purchase-back-button" onClick={backToList}>
          <PurchaseModuleIcon name="back" />
          Regresar a solicitudes
        </button>

        <div className="purchase-focused-header purchase-detail-focused-header">
          <div className="purchase-focused-title-group">
            <div className="purchase-detail-avatar">{getInitials(selectedRequest.itemName)}</div>
            <div>
              <span className="purchase-focused-kicker">Detalle de solicitud</span>
              <h2>{selectedRequest.itemName}</h2>
              <p>{selectedRequest.quantity || 1} pieza(s) · {selectedRequest.department || "Sin área"}</p>
            </div>
          </div>

          <div className="purchase-detail-badges focused">
            <span className={`purchase-badge tone-${status.tone}`}>{status.label}</span>
            <span className={`purchase-badge tone-${priority.tone}`}>Prioridad {priority.label}</span>
          </div>
        </div>

        <div className={`purchase-focused-detail-layout ${isAdmin ? "admin" : ""}`}>
          <div className="purchase-focused-card purchase-detail-main-card">
            <div className="purchase-detail-grid wide">
              <div>
                <span>Cantidad</span>
                <strong>{selectedRequest.quantity || 1}</strong>
              </div>
              <div>
                <span>Solicitante</span>
                <strong>{selectedRequest.requestedByName || "Usuario"}</strong>
              </div>
              <div>
                <span>Fecha de solicitud</span>
                <strong>{formatDate(selectedRequest.createdAt)}</strong>
              </div>
              <div>
                <span>Última actualización</span>
                <strong>{formatDate(selectedRequest.updatedAt)}</strong>
              </div>
            </div>

            <div className="purchase-detail-section first">
              <strong>Descripción</strong>
              <p>{selectedRequest.description}</p>
            </div>

            {selectedRequest.projectName && (
              <div className="purchase-detail-section">
                <strong>Proyecto relacionado</strong>
                <p>{selectedRequest.projectName}</p>
              </div>
            )}

            {selectedRequest.requesterComment && (
              <div className="purchase-detail-section">
                <strong>Comentario del solicitante</strong>
                <p>{selectedRequest.requesterComment}</p>
              </div>
            )}

            {selectedRequest.suggestedLink && (
              <div className="purchase-detail-section">
                <strong>Link sugerido</strong>
                <a href={selectedRequest.suggestedLink} target="_blank" rel="noreferrer">
                  Abrir enlace sugerido
                </a>
              </div>
            )}

            {selectedRequest.adminComment && !isAdmin && (
              <div className="purchase-detail-section purchase-admin-note">
                <strong>Comentario administrativo</strong>
                <p>{selectedRequest.adminComment}</p>
              </div>
            )}

            {selectedRequest.rejectionReason && !isAdmin && (
              <div className="purchase-detail-section purchase-rejection-note">
                <strong>Motivo</strong>
                <p>{selectedRequest.rejectionReason}</p>
              </div>
            )}

            {canCancel && (
              <div className="purchase-inline-warning">
                <div>
                  <strong>Solicitud pendiente</strong>
                  <p>Puedes cancelarla mientras todavía no ha sido revisada.</p>
                </div>
                <button
                  type="button"
                  className="visual-outline-button danger-outline-button"
                  onClick={() => handleCancelRequest(selectedRequest)}
                >
                  Cancelar solicitud
                </button>
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="purchase-focused-card purchase-admin-focused-card">
              <div className="purchase-card-heading">
                <PurchaseModuleIcon name="check" />
                <div>
                  <h3>Actualizar solicitud</h3>
                  <p>Cambia el estado visible para el solicitante.</p>
                </div>
              </div>

              <label className="visual-field">
                <span>Estado</span>
                <select value={adminStatus} onChange={(event) => setAdminStatus(event.target.value)}>
                  {PURCHASE_STATUSES.filter((item) => item.value !== "cancelled").map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="visual-field">
                <span>Comentario administrativo</span>
                <textarea
                  value={adminComment}
                  onChange={(event) => setAdminComment(event.target.value)}
                  placeholder="Ej. Se comprará junto con otros accesorios esta semana."
                />
              </label>

              {adminStatus === "rejected" && (
                <label className="visual-field">
                  <span>Motivo de rechazo</span>
                  <textarea
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    placeholder="Explica brevemente por qué no se realizará la compra."
                  />
                </label>
              )}

              <button
                type="button"
                className="visual-primary-button"
                onClick={handleAdminUpdate}
                disabled={updatingStatus}
              >
                {updatingStatus ? "Actualizando..." : "Guardar avance"}
              </button>

              <div className="purchase-delete-zone compact">
                <div>
                  <strong>Eliminar solicitud</strong>
                  <p>Solo para registros duplicados, pruebas o capturas por error.</p>
                </div>
                <button
                  type="button"
                  className="danger-table-button purchase-delete-button"
                  onClick={() => handleDeleteRequest(selectedRequest)}
                  disabled={deletingRequestId === selectedRequest.id}
                >
                  {deletingRequestId === selectedRequest.id ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          )}

          <div className="purchase-focused-card purchase-log-focused-card">
            <div className="purchase-card-heading compact-heading">
              <PurchaseModuleIcon name="clock" />
              <div>
                <h3>Bitácora</h3>
                <p>Movimientos registrados automáticamente.</p>
              </div>
            </div>

            {logsLoading ? (
              <div className="purchase-log-empty">Cargando bitácora...</div>
            ) : logs.length === 0 ? (
              <div className="purchase-log-empty">Sin movimientos registrados.</div>
            ) : (
              <div className="purchase-log-list focused-log-list">
                {logs.map((log) => (
                  <div key={log.id} className="purchase-log-item">
                    <span />
                    <div>
                      <strong>{log.message}</strong>
                      <small>
                        {log.createdByName || "Usuario"} · {formatDate(log.createdAt)}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderListView = () => (
    <>
      <div className="purchase-hero-card">
        <div className="purchase-hero-content">
          <span>Centro de compras</span>
          <h2>Solicitudes de compra</h2>
          <p>
            Revisa necesidades pendientes, da seguimiento administrativo y conserva una bitácora clara de cada solicitud.
          </p>
        </div>

        <div className="purchase-hero-actions">
          <div className="purchase-hero-search">
            <PurchaseModuleIcon name="search" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar solicitud, área o solicitante"
            />
          </div>

          <button type="button" className="purchase-hero-button" onClick={openCreateView}>
            <PurchaseModuleIcon name="request" />
            Nueva solicitud
          </button>
        </div>
      </div>

      <div className="purchase-compact-metrics">
        <div className="purchase-compact-metric total">
          <PurchaseModuleIcon name="list" />
          <div>
            <strong>{metrics.total}</strong>
            <span>{isAdmin ? "Todas" : "Mías"}</span>
          </div>
        </div>
        <div className="purchase-compact-metric pending">
          <PurchaseModuleIcon name="alert" />
          <div>
            <strong>{metrics.pending}</strong>
            <span>Pendientes</span>
          </div>
        </div>
        <div className="purchase-compact-metric process">
          <PurchaseModuleIcon name="clock" />
          <div>
            <strong>{metrics.inProcess}</strong>
            <span>En proceso</span>
          </div>
        </div>
        <div className="purchase-compact-metric delivered">
          <PurchaseModuleIcon name="check" />
          <div>
            <strong>{metrics.delivered}</strong>
            <span>Entregadas</span>
          </div>
        </div>
        <div className="purchase-compact-metric urgent">
          <PurchaseModuleIcon name="alert" />
          <div>
            <strong>{metrics.urgent}</strong>
            <span>Urgentes</span>
          </div>
        </div>
      </div>

      <div className="purchase-workspace-grid">
        <div className="purchase-panel-card purchase-list-panel-card">
          <div className="purchase-panel-header">
            <div>
              <h3>{isAdmin ? "Todas las solicitudes" : "Mis solicitudes"}</h3>
              <p>
                {loading
                  ? "Cargando registros..."
                  : `Mostrando ${filteredRequests.length} de ${requests.length} solicitudes.`}
              </p>
            </div>

            <div className="purchase-compact-filters">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos los estados</option>
                {PURCHASE_STATUSES.map((status) => (
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
          </div>

          {loading ? (
            <div className="empty-state">
              <p>Cargando solicitudes de compra...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="empty-state">
              <div>□</div>
              <p>No hay solicitudes con los filtros actuales.</p>
            </div>
          ) : (
            <div className="purchase-request-list modern-list">
              {filteredRequests.map((request) => {
                const status = statusConfig(request.status);
                const priority = priorityConfig(request.priority);
                const canCancel =
                  request.status === "pending_review" && request.requestedByUid === firebaseUser?.uid;

                return (
                  <article key={request.id} className="purchase-modern-row">
                    <button type="button" className="purchase-modern-main" onClick={() => openDetailView(request)}>
                      <div className="purchase-request-icon">{getInitials(request.itemName)}</div>

                      <div className="purchase-request-content">
                        <div className="purchase-request-title-row">
                          <div>
                            <h4>{request.itemName}</h4>
                            <span>
                              {request.quantity || 1} pieza(s) · {request.department || "Sin área"}
                            </span>
                          </div>

                          <div className="purchase-request-badges">
                            <span className={`purchase-badge tone-${status.tone}`}>{status.label}</span>
                            <span className={`purchase-badge tone-${priority.tone}`}>{priority.label}</span>
                          </div>
                        </div>

                        <p>{request.description}</p>

                        <div className="purchase-request-meta">
                          <span>Solicitó: {request.requestedByName || "Usuario"}</span>
                          <span>Fecha: {formatDate(request.createdAt)}</span>
                          {request.projectName && <span>Proyecto: {request.projectName}</span>}
                        </div>
                      </div>
                    </button>

                    <div className="purchase-row-actions">
                      <button type="button" className="visual-detail-button" onClick={() => openDetailView(request)}>
                        Ver detalle
                      </button>
                      {canCancel && (
                        <button
                          type="button"
                          className="visual-outline-button danger-outline-button"
                          onClick={() => handleCancelRequest(request)}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="purchase-side-summary">
          <div className="purchase-panel-card purchase-attention-card">
            <div className="purchase-card-heading">
              <PurchaseModuleIcon name="alert" />
              <div>
                <h3>Requiere atención</h3>
                <p>Pendientes, urgentes o en revisión.</p>
              </div>
            </div>

            {attentionRequests.length === 0 ? (
              <div className="purchase-side-empty">No hay solicitudes críticas por ahora.</div>
            ) : (
              <div className="purchase-attention-list">
                {attentionRequests.map((request) => (
                  <button key={request.id} type="button" onClick={() => openDetailView(request)}>
                    <strong>{request.itemName}</strong>
                    <span>{statusConfig(request.status).label} · {priorityConfig(request.priority).label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="purchase-panel-card purchase-status-summary-card">
            <div className="purchase-card-heading compact-heading">
              <PurchaseModuleIcon name="overview" />
              <div>
                <h3>Resumen rápido</h3>
                <p>Distribución general.</p>
              </div>
            </div>
            <div className="purchase-status-bars">
              <div>
                <span>Pendientes</span>
                <strong>{metrics.pending}</strong>
              </div>
              <div>
                <span>En proceso</span>
                <strong>{metrics.inProcess}</strong>
              </div>
              <div>
                <span>Rechazadas</span>
                <strong>{metrics.rejected}</strong>
              </div>
              <div>
                <span>Entregadas</span>
                <strong>{metrics.delivered}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );

  return (
    <section className="purchase-requests-page purchase-redesign visual-page">
      {message && <div className="message-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {focusedView === "create" && renderCreateView()}
      {focusedView === "detail" && renderDetailView()}
      {focusedView === "list" && renderListView()}
    </section>
  );
}
