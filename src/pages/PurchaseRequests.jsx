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
  const [showForm, setShowForm] = useState(false);
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
    return requests.find((request) => request.id === selectedRequestId) || requests[0] || null;
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
    const urgent = requests.filter((request) => request.priority === "urgent").length;

    return { total, pending, inProcess, delivered, urgent };
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
      setShowForm(false);
      setSelectedRequestId(requestRef.id);
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
      setSelectedRequestId((currentId) => (currentId === request.id ? null : currentId));
      setMessage("Solicitud eliminada correctamente.");
    } catch (deleteError) {
      console.error("No se pudo eliminar la solicitud:", deleteError);
      const detail = deleteError?.code ? ` (${deleteError.code})` : "";
      setError(`No se pudo eliminar la solicitud${detail}. Revisa permisos o conexión.`);
    } finally {
      setDeletingRequestId(null);
    }
  }

  return (
    <section className="purchase-requests-page visual-page">
      <div className="visual-page-header purchase-page-header">
        <div>
          <span className="breadcrumb-line">Desarrollo de Proyectos / Compras</span>
          <h2>Solicitudes de compra</h2>
          <p>
            Registra necesidades de compra, revisa el avance y conserva una bitácora
            de cada cambio.
          </p>
        </div>

        <div className="visual-page-actions">
          <button
            type="button"
            className="visual-primary-button"
            onClick={() => {
              setShowForm((current) => !current);
              setMessage("");
              setError("");
            }}
          >
            {showForm ? "Cerrar formulario" : "+ Nueva solicitud"}
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="purchase-metrics-grid">
        <div className="simple-metric purchase-total-metric">
          <div className="simple-metric-icon">Σ</div>
          <div>
            <strong>{metrics.total}</strong>
            <h4>{isAdmin ? "Todas las solicitudes" : "Mis solicitudes"}</h4>
            <p>Registros visibles para tu usuario.</p>
          </div>
        </div>

        <div className="simple-metric simple-gold">
          <div className="simple-metric-icon">!</div>
          <div>
            <strong>{metrics.pending}</strong>
            <h4>Pendientes</h4>
            <p>Esperando revisión inicial.</p>
          </div>
        </div>

        <div className="simple-metric simple-purple">
          <div className="simple-metric-icon">↻</div>
          <div>
            <strong>{metrics.inProcess}</strong>
            <h4>En proceso</h4>
            <p>Aprobadas, comprándose o en camino.</p>
          </div>
        </div>

        <div className="simple-metric simple-green">
          <div className="simple-metric-icon">✓</div>
          <div>
            <strong>{metrics.delivered}</strong>
            <h4>Entregadas</h4>
            <p>Compra cerrada y entregada.</p>
          </div>
        </div>

        <div className="simple-metric simple-red">
          <div className="simple-metric-icon">↑</div>
          <div>
            <strong>{metrics.urgent}</strong>
            <h4>Urgentes</h4>
            <p>Marcadas con prioridad urgente.</p>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="card purchase-form-card">
          <div className="section-title-row">
            <span className="section-title-icon section-title-blue">+</span>
            <div>
              <h3>Nueva solicitud de compra</h3>
              <p>Incluye detalles suficientes para evaluar y comprar correctamente.</p>
            </div>
          </div>

          <form className="purchase-form" onSubmit={handleCreateRequest}>
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
              <select
                value={form.priority}
                onChange={(event) => updateForm("priority", event.target.value)}
              >
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

            <div className="purchase-form-actions">
              <button
                type="button"
                className="visual-outline-button"
                onClick={() => setShowForm(false)}
                disabled={saving}
              >
                Cancelar
              </button>

              <button type="submit" className="visual-primary-button" disabled={saving}>
                {saving ? "Guardando..." : "Registrar solicitud"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="purchase-layout">
        <div className="card purchase-list-card">
          <div className="purchase-toolbar">
            <div>
              <h3>{isAdmin ? "Todas las solicitudes" : "Mis solicitudes"}</h3>
              <p>
                {loading
                  ? "Cargando registros..."
                  : `Mostrando ${filteredRequests.length} de ${requests.length} solicitudes.`}
              </p>
            </div>

            <div className="purchase-filters">
              <div className="visual-search purchase-search">
                <span>⌕</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar solicitud"
                />
              </div>

              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos los estados</option>
                {PURCHASE_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>

              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
              >
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
            <div className="purchase-request-list">
              {filteredRequests.map((request) => {
                const status = statusConfig(request.status);
                const priority = priorityConfig(request.priority);
                const selected = selectedRequest?.id === request.id;
                const canCancel =
                  request.status === "pending_review" && request.requestedByUid === firebaseUser?.uid;

                return (
                  <button
                    key={request.id}
                    type="button"
                    className={`purchase-request-card ${selected ? "selected" : ""}`}
                    onClick={() => setSelectedRequestId(request.id)}
                  >
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

                      {canCancel && (
                        <div className="purchase-card-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="visual-outline-button danger-outline-button"
                            onClick={() => handleCancelRequest(request)}
                          >
                            Cancelar solicitud
                          </button>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="purchase-detail-panel">
          {selectedRequest ? (
            <div className="card purchase-detail-card">
              <div className="purchase-detail-header">
                <div className="purchase-detail-avatar">{getInitials(selectedRequest.itemName)}</div>
                <div>
                  <span className="breadcrumb-line">Detalle de solicitud</span>
                  <h3>{selectedRequest.itemName}</h3>
                  <p>{selectedRequest.department || "Sin área"}</p>
                </div>
              </div>

              <div className="purchase-detail-badges">
                <span className={`purchase-badge tone-${statusConfig(selectedRequest.status).tone}`}>
                  {statusConfig(selectedRequest.status).label}
                </span>
                <span className={`purchase-badge tone-${priorityConfig(selectedRequest.priority).tone}`}>
                  Prioridad {priorityConfig(selectedRequest.priority).label}
                </span>
              </div>

              <div className="purchase-detail-grid">
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

              <div className="purchase-detail-section">
                <strong>Descripción</strong>
                <p>{selectedRequest.description}</p>
              </div>

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

              {isAdmin && (
                <div className="purchase-admin-panel">
                  <div className="section-title-row no-border no-margin">
                    <span className="section-title-icon section-title-purple">⚙</span>
                    <div>
                      <h3>Control administrativo</h3>
                      <p>Cambia el estado visible para el solicitante.</p>
                    </div>
                  </div>

                  <label className="visual-field">
                    <span>Estado</span>
                    <select value={adminStatus} onChange={(event) => setAdminStatus(event.target.value)}>
                      {PURCHASE_STATUSES.filter((status) => status.value !== "cancelled").map(
                        (status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        )
                      )}
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

                  <div className="purchase-delete-zone">
                    <strong>Eliminar solicitud</strong>
                    <p>
                      Usa esta opción solo para registros duplicados, pruebas o solicitudes capturadas por error.
                    </p>
                    <button
                      type="button"
                      className="danger-table-button purchase-delete-button"
                      onClick={() => handleDeleteRequest(selectedRequest)}
                      disabled={deletingRequestId === selectedRequest.id}
                    >
                      {deletingRequestId === selectedRequest.id ? "Eliminando..." : "Eliminar solicitud"}
                    </button>
                  </div>
                </div>
              )}

              <div className="purchase-log-section">
                <div className="section-title-row no-border no-margin">
                  <span className="section-title-icon section-title-blue">◷</span>
                  <div>
                    <h3>Bitácora</h3>
                    <p>Registro automático de movimientos.</p>
                  </div>
                </div>

                {logsLoading ? (
                  <div className="purchase-log-empty">Cargando bitácora...</div>
                ) : logs.length === 0 ? (
                  <div className="purchase-log-empty">Sin movimientos registrados.</div>
                ) : (
                  <div className="purchase-log-list">
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
          ) : (
            <div className="card purchase-detail-card">
              <div className="empty-state small">
                <p>Selecciona una solicitud para ver el detalle.</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
