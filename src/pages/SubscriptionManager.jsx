import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { db } from "../services/firebase";

const subscriptionCategories = [
  "Software",
  "Diseno",
  "Comunicacion",
  "Productividad",
  "Hosting",
  "Inteligencia artificial",
  "Educacion",
  "Otro",
];

const subscriptionStatuses = ["Activa", "Pausada", "Cancelada"];
const billingCycles = ["Mensual", "Anual", "Unico"];
const currencies = ["MXN", "USD"];

const subscriptionFormInitialState = {
  name: "",
  provider: "",
  category: "Software",
  status: "Activa",
  amount: "",
  currency: "MXN",
  billingCycle: "Mensual",
  renewalDate: "",
  ownerArea: "Desarrollo de Proyectos",
  seats: 1,
  paymentMethod: "",
  notes: "",
};

function normalizeSubscription(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    name: String(data.name || ""),
    provider: String(data.provider || ""),
    category: String(data.category || "Software"),
    status: subscriptionStatuses.includes(data.status) ? data.status : "Activa",
    amount: Number(data.amount || 0),
    currency: currencies.includes(data.currency) ? data.currency : "MXN",
    billingCycle: billingCycles.includes(data.billingCycle) ? data.billingCycle : "Mensual",
    renewalDate: String(data.renewalDate || ""),
    ownerArea: String(data.ownerArea || "Desarrollo de Proyectos"),
    seats: Number(data.seats || 1),
    paymentMethod: String(data.paymentMethod || ""),
    notes: String(data.notes || ""),
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
  };
}

function formatMoney(amount, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function getMonthlyEquivalent(subscription) {
  const amount = Number(subscription.amount || 0);

  if (subscription.status !== "Activa") return 0;
  if (subscription.billingCycle === "Anual") return amount / 12;
  if (subscription.billingCycle === "Unico") return 0;
  return amount;
}

function getRenewalTone(renewalDate) {
  if (!renewalDate) return "neutral";

  const today = new Date();
  const renewal = new Date(`${renewalDate}T00:00:00`);

  if (Number.isNaN(renewal.getTime())) return "neutral";

  const days = Math.ceil((renewal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (days < 0) return "red";
  if (days <= 15) return "orange";
  if (days <= 45) return "blue";
  return "green";
}

function formatDateLabel(value) {
  if (!value) return "Sin fecha";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(date);
}

function MetricCard({ label, value, helper, tone = "blue" }) {
  return (
    <article className={`subscription-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function StatusPill({ tone = "blue", children }) {
  return <span className={`subscription-status-pill ${tone}`}>{children}</span>;
}

function SubscriptionIcon() {
  return (
    <svg className="subscription-topbar-icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="M16 16h.01" />
      <path d="M7 3v4" />
      <path d="M17 3v4" />
    </svg>
  );
}

export default function SubscriptionManager() {
  const { profile, isAdmin } = useAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todas");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(subscriptionFormInitialState);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      setError("Solo los administradores pueden acceder al gestor de suscripciones.");
      return undefined;
    }

    setLoading(true);
    setError("");

    const subscriptionsQuery = query(
      collection(db, "subscriptions"),
      orderBy("updatedAt", "desc")
    );

    return onSnapshot(
      subscriptionsQuery,
      (snapshot) => {
        setSubscriptions(snapshot.docs.map((item) => normalizeSubscription(item)));
        setLoading(false);
      },
      (snapshotError) => {
        console.error("No se pudieron cargar las suscripciones:", snapshotError);
        setError("No se pudieron cargar las suscripciones. Revisa permisos o conexion.");
        setLoading(false);
      }
    );
  }, [isAdmin]);

  const filteredSubscriptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return subscriptions.filter((subscription) => {
      const matchesSearch =
        !normalizedSearch ||
        `${subscription.name} ${subscription.provider} ${subscription.category} ${subscription.ownerArea}`
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesStatus = statusFilter === "Todas" || subscription.status === statusFilter;
      const matchesCategory = categoryFilter === "Todas" || subscription.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [subscriptions, search, statusFilter, categoryFilter]);

  const stats = useMemo(() => {
    const active = subscriptions.filter((subscription) => subscription.status === "Activa");
    const monthlyByCurrency = active.reduce((totals, subscription) => {
      const currency = subscription.currency || "MXN";
      totals[currency] = (totals[currency] || 0) + getMonthlyEquivalent(subscription);
      return totals;
    }, {});
    const upcomingRenewals = active.filter((subscription) => {
      const tone = getRenewalTone(subscription.renewalDate);
      return tone === "orange" || tone === "red";
    }).length;

    return {
      total: subscriptions.length,
      active: active.length,
      upcomingRenewals,
      monthlyByCurrency,
    };
  }, [subscriptions]);

  const monthlySummary = Object.entries(stats.monthlyByCurrency)
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" / ") || "$0.00";

  function resetForm() {
    setSelectedId("");
    setForm(subscriptionFormInitialState);
    setMessage("");
  }

  function selectSubscription(subscription) {
    setSelectedId(subscription.id);
    setMessage("");
    setForm({
      name: subscription.name,
      provider: subscription.provider,
      category: subscription.category,
      status: subscription.status,
      amount: String(subscription.amount || ""),
      currency: subscription.currency,
      billingCycle: subscription.billingCycle,
      renewalDate: subscription.renewalDate,
      ownerArea: subscription.ownerArea,
      seats: Number(subscription.seats || 1),
      paymentMethod: subscription.paymentMethod,
      notes: subscription.notes,
    });
  }

  function handleInputChange(event) {
    const { name, value } = event.target;

    setMessage("");
    setForm((current) => ({
      ...current,
      [name]: name === "seats" ? Number(value) : value,
    }));
  }

  async function saveSubscription(event) {
    event.preventDefault();
    setMessage("");

    const name = form.name.trim();
    const provider = form.provider.trim();
    const amount = Number(form.amount || 0);

    if (!name || !provider) {
      setMessage("Indica nombre y proveedor de la suscripcion.");
      return;
    }

    if (amount < 0) {
      setMessage("El costo no puede ser negativo.");
      return;
    }

    const auditName = profile?.name || profile?.email || "Administrador";
    const payload = {
      name,
      provider,
      category: form.category,
      status: form.status,
      amount,
      currency: form.currency,
      billingCycle: form.billingCycle,
      renewalDate: form.renewalDate,
      ownerArea: form.ownerArea.trim() || "Desarrollo de Proyectos",
      seats: Number(form.seats || 1),
      paymentMethod: form.paymentMethod.trim(),
      notes: form.notes.trim(),
      updatedAt: serverTimestamp(),
      updatedByUid: profile?.uid || profile?.id || "",
      updatedByName: auditName,
      updatedByEmail: profile?.email || "",
    };

    try {
      setSaving(true);

      if (selectedId) {
        await updateDoc(doc(db, "subscriptions", selectedId), payload);
        setMessage("Suscripcion actualizada correctamente.");
      } else {
        await addDoc(collection(db, "subscriptions"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: profile?.uid || profile?.id || "",
          createdByName: auditName,
          createdByEmail: profile?.email || "",
        });
        setMessage("Suscripcion registrada correctamente.");
      }

      resetForm();
    } catch (saveError) {
      console.error("No se pudo guardar la suscripcion:", saveError);
      setMessage("No se pudo guardar la suscripcion. Revisa permisos o conexion.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubscription(subscription) {
    if (!subscription?.id) return;

    const confirmed = window.confirm(`Eliminar la suscripcion ${subscription.name}?`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "subscriptions", subscription.id));
      if (selectedId === subscription.id) resetForm();
    } catch (deleteError) {
      console.error("No se pudo eliminar la suscripcion:", deleteError);
      setMessage("No se pudo eliminar la suscripcion.");
    }
  }

  if (!isAdmin) {
    return (
      <section className="subscription-manager-page">
        <div className="subscription-topbar">
          <div className="subscription-topbar-main">
            <span className="subscription-topbar-module-icon">
              <SubscriptionIcon />
            </span>
            <div className="subscription-topbar-copy">
              <p>ADMINISTRACION</p>
              <h1>Gestor de suscripciones</h1>
              <span>Solo administradores pueden acceder a este modulo.</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="subscription-manager-page">
      <div className="subscription-topbar">
        <div className="subscription-topbar-main">
          <span className="subscription-topbar-module-icon">
            <SubscriptionIcon />
          </span>
          <div className="subscription-topbar-copy">
            <p>ADMINISTRACION</p>
            <h1>Gestor de suscripciones</h1>
            <span>Controla suscripciones activas, renovaciones y gasto mensual estimado del area.</span>
          </div>
        </div>
      </div>

      <div className="subscription-metrics-grid">
        <MetricCard tone="blue" label="Suscripciones" value={stats.total} helper="Registradas" />
        <MetricCard tone="green" label="Activas" value={stats.active} helper="En uso actualmente" />
        <MetricCard tone="orange" label="Renovaciones" value={stats.upcomingRenewals} helper="Vencidas o proximas" />
        <MetricCard tone="teal" label="Gasto mensual" value={monthlySummary} helper="Estimado por moneda" />
      </div>

      <div className="subscription-layout">
        <div className="subscription-main-panel">
          <div className="subscription-toolbar">
            <label>
              <span>Buscar</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre, proveedor, area o categoria"
              />
            </label>

            <label>
              <span>Estado</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option>Todas</option>
                {subscriptionStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Categoria</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option>Todas</option>
                {subscriptionCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>

          {error && <div className="message-box">{error}</div>}

          {loading ? (
            <div className="empty-state small">
              <p>Cargando suscripciones...</p>
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="empty-state small">
              <p>No hay suscripciones con los filtros seleccionados.</p>
            </div>
          ) : (
            <div className="subscription-list">
              {filteredSubscriptions.map((subscription) => (
                <article
                  key={subscription.id}
                  className={`subscription-card ${selectedId === subscription.id ? "active" : ""}`}
                >
                  <button type="button" onClick={() => selectSubscription(subscription)}>
                    <div>
                      <strong>{subscription.name}</strong>
                      <span>{subscription.provider} / {subscription.category}</span>
                    </div>
                    <div>
                      <b>{formatMoney(subscription.amount, subscription.currency)}</b>
                      <small>{subscription.billingCycle}</small>
                    </div>
                  </button>

                  <div className="subscription-card-footer">
                    <StatusPill tone={subscription.status === "Activa" ? "green" : subscription.status === "Pausada" ? "orange" : "red"}>
                      {subscription.status}
                    </StatusPill>
                    <StatusPill tone={getRenewalTone(subscription.renewalDate)}>
                      {formatDateLabel(subscription.renewalDate)}
                    </StatusPill>
                    <button type="button" className="danger-table-button" onClick={() => deleteSubscription(subscription)}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="subscription-form-panel">
          <div className="subscription-panel-header">
            <div>
              <span>{selectedId ? "Editar" : "Nueva"}</span>
              <h2>{selectedId ? "Editar suscripcion" : "Nueva suscripcion"}</h2>
            </div>
            {selectedId && (
              <button type="button" className="visual-outline-button" onClick={resetForm}>
                Nueva
              </button>
            )}
          </div>

          <form className="subscription-form" onSubmit={saveSubscription}>
            <label className="full">
              <span>Nombre</span>
              <input name="name" value={form.name} onChange={handleInputChange} placeholder="Ej. Adobe Creative Cloud" />
            </label>

            <label>
              <span>Proveedor</span>
              <input name="provider" value={form.provider} onChange={handleInputChange} placeholder="Ej. Adobe" />
            </label>

            <label>
              <span>Categoria</span>
              <select name="category" value={form.category} onChange={handleInputChange}>
                {subscriptionCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Costo</span>
              <input type="number" min="0" step="0.01" name="amount" value={form.amount} onChange={handleInputChange} />
            </label>

            <label>
              <span>Moneda</span>
              <select name="currency" value={form.currency} onChange={handleInputChange}>
                {currencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Ciclo</span>
              <select name="billingCycle" value={form.billingCycle} onChange={handleInputChange}>
                {billingCycles.map((cycle) => (
                  <option key={cycle}>{cycle}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Estado</span>
              <select name="status" value={form.status} onChange={handleInputChange}>
                {subscriptionStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Renovacion</span>
              <input type="date" name="renewalDate" value={form.renewalDate} onChange={handleInputChange} />
            </label>

            <label>
              <span>Usuarios/licencias</span>
              <input type="number" min="1" name="seats" value={form.seats} onChange={handleInputChange} />
            </label>

            <label>
              <span>Area responsable</span>
              <input name="ownerArea" value={form.ownerArea} onChange={handleInputChange} />
            </label>

            <label className="full">
              <span>Metodo de pago</span>
              <input name="paymentMethod" value={form.paymentMethod} onChange={handleInputChange} placeholder="Tarjeta, transferencia, cuenta..." />
            </label>

            <label className="full">
              <span>Notas</span>
              <textarea name="notes" value={form.notes} onChange={handleInputChange} placeholder="Uso, responsable, restricciones o datos de renovacion" />
            </label>

            {message && <div className="message-box full">{message}</div>}

            <div className="subscription-form-actions full">
              <button type="submit" className="visual-primary-button" disabled={saving}>
                {saving ? "Guardando..." : selectedId ? "Guardar cambios" : "Registrar suscripcion"}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </section>
  );
}
