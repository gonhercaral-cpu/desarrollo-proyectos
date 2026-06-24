import { useEffect, useMemo, useState } from "react";
import {
  createDepartment,
  getDepartments,
  softDeleteDepartment,
  toggleDepartmentStatus,
  updateDepartment,
} from "../services/departmentsService";

const EMPTY_FORM = {
  name: "",
  description: "",
  active: true,
};

const FILTERS = {
  ALL: "all",
  ACTIVE: "active",
  INACTIVE: "inactive",
};

export default function DepartmentsAdmin() {
  const [departments, setDepartments] = useState([]);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editingDepartmentId, setEditingDepartmentId] = useState(null);
  const [editorFocused, setEditorFocused] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(FILTERS.ALL);

  const activeDepartmentsCount = useMemo(() => {
    return departments.filter((department) => department.active).length;
  }, [departments]);

  const inactiveDepartmentsCount = useMemo(() => {
    return departments.filter((department) => !department.active).length;
  }, [departments]);

  const selectedDepartment = useMemo(() => {
    if (!editingDepartmentId) return null;

    return (
      departments.find((department) => department.id === editingDepartmentId) ||
      null
    );
  }, [departments, editingDepartmentId]);

  const filteredDepartments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return departments.filter((department) => {
      const searchableText = [
        department.name,
        department.description,
        department.active ? "activo" : "inactivo",
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      const matchesStatus =
        statusFilter === FILTERS.ALL ||
        (statusFilter === FILTERS.ACTIVE && department.active) ||
        (statusFilter === FILTERS.INACTIVE && !department.active);

      return matchesSearch && matchesStatus;
    });
  }, [departments, searchTerm, statusFilter]);

  const departmentDistribution = useMemo(() => {
    const total = departments.length || 1;

    return departments
      .slice()
      .sort((a, b) => Number(a.order || 999) - Number(b.order || 999))
      .map((department) => ({
        id: department.id,
        name: department.name || "Sin nombre",
        percentage: Math.max(8, Math.round((1 / total) * 100)),
        active: department.active !== false,
      }))
      .slice(0, 6);
  }, [departments]);

  useEffect(() => {
    loadDepartments();
  }, []);

  async function loadDepartments() {
    try {
      setLoading(true);
      setError("");

      const departmentsData = await getDepartments();
      setDepartments(departmentsData);
    } catch (err) {
      console.error("No se pudieron cargar los departamentos:", err);
      setError("No se pudieron cargar los departamentos.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target;

    setFormData((currentData) => ({
      ...currentData,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function resetForm() {
    setFormData(EMPTY_FORM);
    setEditingDepartmentId(null);
    setEditorFocused(false);
    setError("");
    setSuccessMessage("");
  }

  function openNewDepartment() {
    setFormData(EMPTY_FORM);
    setEditingDepartmentId(null);
    setEditorFocused(true);
    setError("");
    setSuccessMessage("");
  }

  function startEditing(department) {
    setEditingDepartmentId(department.id);

    setFormData({
      name: department.name || "",
      description: department.description || "",
      active: department.active ?? true,
    });

    setEditorFocused(true);
    setError("");
    setSuccessMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");

      if (!formData.name.trim()) {
        setError("Escribe el nombre del departamento.");
        return;
      }

      const payload = {
        name: formData.name,
        description: formData.description,
        active: formData.active,
      };

      if (editingDepartmentId) {
        await updateDepartment(editingDepartmentId, payload);
        setSuccessMessage("Departamento actualizado correctamente.");
      } else {
        await createDepartment(payload);
        setSuccessMessage("Departamento creado correctamente.");
      }

      resetForm();
      await loadDepartments();
    } catch (err) {
      console.error("No se pudo guardar el departamento:", err);
      setError(err.message || "No se pudo guardar el departamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(department) {
    const action = department.active ? "desactivar" : "activar";

    const confirmed = window.confirm(
      `¿Seguro que deseas ${action} el departamento "${department.name}"?`
    );

    if (!confirmed) return;

    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");

      await toggleDepartmentStatus(department.id, department.active);

      setSuccessMessage(
        department.active
          ? "Departamento desactivado correctamente."
          : "Departamento activado correctamente."
      );

      if (editingDepartmentId === department.id) {
        resetForm();
      }

      await loadDepartments();
    } catch (err) {
      console.error("No se pudo cambiar el estatus del departamento:", err);
      setError("No se pudo cambiar el estatus del departamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSoftDeleteDepartment(department) {
    const confirmed = window.confirm(
      `¿Seguro que deseas eliminar "${department.name}"?\n\nNo se borrará definitivamente de Firestore. Solo se ocultará del sistema y ya no aparecerá como departamento disponible.`
    );

    if (!confirmed) return;

    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");

      await softDeleteDepartment(department.id);

      if (editingDepartmentId === department.id) {
        resetForm();
      }

      setSuccessMessage("Departamento eliminado del panel correctamente.");
      await loadDepartments();
    } catch (err) {
      console.error("No se pudo eliminar el departamento:", err);
      setError("No se pudo eliminar el departamento.");
    } finally {
      setSaving(false);
    }
  }

  function selectAndFocusDepartment(department) {
    startEditing(department);
  }

  const distributionPanel = (
    <section className="departments-distribution-card departments-distribution-polished departments-distribution-side-card">
      <div className="departments-mini-header departments-mini-header-polished">
        <div className="departments-toolbar-title">
          <span className="departments-section-icon soft-purple">
            <SvgIcon name="chart" />
          </span>
          <div>
            <h3>Distribución por departamento</h3>
            <p>Vista rápida del estado de las áreas visibles.</p>
          </div>
        </div>

        <span>{departments.length} áreas</span>
      </div>

      <div className="departments-distribution-list">
        {departmentDistribution.length === 0 ? (
          <p className="departments-muted-text">
            Aún no hay departamentos para mostrar.
          </p>
        ) : (
          departmentDistribution.map((item) => (
            <div className="departments-distribution-row" key={item.id}>
              <span>{item.name}</span>

              <div className="departments-distribution-track">
                <div
                  className={
                    item.active
                      ? "departments-distribution-fill"
                      : "departments-distribution-fill inactive"
                  }
                  style={{ width: `${item.percentage}%` }}
                />
              </div>

              <strong>{item.active ? "Activo" : "Inactivo"}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );

  const editorPanel = (
    <section className="department-focused-editor-card">
      <div className="department-focused-header">
        <div className="department-editor-header department-editor-header-polished department-focused-title">
          <div
            className={`department-editor-icon ${getDepartmentColorClass(
              formData.name || selectedDepartment?.name
            )}`}
          >
            <DepartmentIcon name={formData.name || selectedDepartment?.name} />
          </div>

          <div>
            <span>Administración de áreas</span>
            <h3>
              {editingDepartmentId ? "Editar departamento" : "Nuevo departamento"}
            </h3>
            <p>
              {editingDepartmentId
                ? "Actualiza el nombre, descripción y disponibilidad del departamento."
                : "Crea una nueva área funcional sin saturar la vista principal."}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="visual-outline-button"
          onClick={resetForm}
          disabled={saving}
        >
          ← Volver a departamentos
        </button>
      </div>

      <div className="department-focused-layout">
        <form className="department-editor-form department-focused-form" onSubmit={handleSubmit}>
          <div className="department-focused-section-title">
            <span className="departments-section-icon soft-blue">
              <SvgIcon name="edit" />
            </span>
            <div>
              <h3>Datos del departamento</h3>
              <p>Define cómo aparecerá esta área dentro del sistema.</p>
            </div>
          </div>

          <label>
            <span>Nombre del departamento</span>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Ej. Imprenta"
              disabled={saving}
            />
          </label>

          <label>
            <span>Descripción</span>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe qué hace este departamento."
              rows={5}
              disabled={saving}
            />
          </label>

          <label className="department-toggle-row department-toggle-polished">
            <div>
              <span>Departamento activo</span>
              <small>
                Los departamentos activos aparecen al crear proyectos y asignar colaboradores.
              </small>
            </div>

            <input
              type="checkbox"
              name="active"
              checked={formData.active}
              onChange={handleChange}
              disabled={saving}
            />
          </label>

          <div className="department-editor-actions department-editor-actions-polished department-focused-actions">
            <button
              type="submit"
              className="visual-primary-button"
              disabled={saving}
            >
              {saving
                ? "Guardando..."
                : editingDepartmentId
                ? "Guardar cambios"
                : "Crear departamento"}
            </button>

            <button
              type="button"
              className="visual-outline-button"
              onClick={resetForm}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </form>

        <aside className="department-focused-side">
          <div className="department-editor-preview department-editor-preview-polished department-focused-preview">
            <span>Vista previa</span>

            <DepartmentCard
              department={{
                id: "preview",
                name: formData.name || "Nombre del departamento",
                description:
                  formData.description ||
                  "Aquí aparecerá una descripción breve del departamento.",
                active: formData.active,
              }}
              preview
            />
          </div>
        </aside>
      </div>
    </section>
  );

  return (
    <section className="departments-admin-redesign departments-admin-polished visual-page">
      <div className="printshop-topbar departments-module-topbar">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon departments-module-icon">
            <SvgIcon name="departments" />
          </span>

          <div className="printshop-topbar-copy">
            <p className="printshop-kicker">ADMINISTRACIÓN</p>
            <h1>Departamentos</h1>
            <p>
              Organiza las áreas funcionales de Desarrollo de Proyectos y mantén disponibles solo las áreas que se usan en el sistema.
            </p>
          </div>
        </div>

        <div className="departments-topbar-actions">
          <button
            type="button"
            className="visual-outline-button departments-hero-button"
            onClick={loadDepartments}
            disabled={loading || saving}
          >
            <SvgIcon name="refresh" />
            Actualizar
          </button>

          <button
            type="button"
            className="visual-primary-button departments-hero-button"
            onClick={openNewDepartment}
            disabled={saving}
          >
            <SvgIcon name="plus" />
            Nuevo departamento
          </button>
        </div>
      </div>

      {error && <div className="error-box departments-message-box">{error}</div>}
      {successMessage && (
        <div className="message-box departments-message-box">{successMessage}</div>
      )}

      {editorFocused ? (
        editorPanel
      ) : (
        <>
          <section className="departments-metrics-grid departments-metrics-polished">
            <DepartmentMetricCard
              icon="departments"
              label="Total departamentos"
              value={departments.length}
              detail="áreas registradas"
              colorClass="department-metric-blue"
            />

            <DepartmentMetricCard
              icon="checkCircle"
              label="Activos"
              value={activeDepartmentsCount}
              detail="disponibles para asignar"
              colorClass="department-metric-green"
            />

            <DepartmentMetricCard
              icon="xCircle"
              label="Inactivos"
              value={inactiveDepartmentsCount}
              detail="ocultos temporalmente"
              colorClass="department-metric-red"
            />
          </section>

          <div className="departments-workspace departments-workspace-polished departments-workspace-compact">
            <main className="departments-list-panel departments-list-polished">
              <div className="departments-toolbar departments-toolbar-polished">
                <div className="departments-toolbar-title">
                  <span className="departments-section-icon soft-blue">
                    <SvgIcon name="list" />
                  </span>
                  <div>
                    <h3>Departamentos registrados</h3>
                    <p>
                      Selecciona una tarjeta para editarla, desactivarla o retirarla del panel sin borrar su historial.
                    </p>
                  </div>
                </div>

                <div className="departments-toolbar-actions">
                  <div className="visual-search departments-search">
                    <span>
                      <SvgIcon name="search" />
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar departamento..."
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value={FILTERS.ALL}>Todos</option>
                    <option value={FILTERS.ACTIVE}>Activos</option>
                    <option value={FILTERS.INACTIVE}>Inactivos</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="departments-empty-card">
                  <div>
                    <SvgIcon name="loader" />
                  </div>
                  <p>Cargando departamentos...</p>
                </div>
              ) : filteredDepartments.length === 0 ? (
                <div className="departments-empty-card">
                  <div>
                    <SvgIcon name="empty" />
                  </div>
                  <p>No hay departamentos con esos filtros.</p>
                </div>
              ) : (
                <div className="department-card-grid departments-card-grid-polished">
                  {filteredDepartments.map((department) => (
                    <DepartmentCard
                      key={department.id}
                      department={department}
                      selected={editingDepartmentId === department.id}
                      saving={saving}
                      onSelect={() => selectAndFocusDepartment(department)}
                      onToggleStatus={() => handleToggleStatus(department)}
                      onSoftDelete={() => handleSoftDeleteDepartment(department)}
                    />
                  ))}
                </div>
              )}
            </main>

            <aside className="departments-side-panel-polished">
              <section className="departments-quick-card">
                <span className="departments-section-icon soft-blue">
                  <SvgIcon name="plus" />
                </span>
                <div>
                  <h3>Nuevo departamento</h3>
                  <p>Crea o edita departamentos en una vista enfocada para no saturar el listado principal.</p>
                </div>
                <button
                  type="button"
                  className="visual-primary-button"
                  onClick={openNewDepartment}
                  disabled={saving}
                >
                  + Crear departamento
                </button>
              </section>

              {distributionPanel}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function DepartmentMetricCard({ icon, label, value, detail, colorClass }) {
  return (
    <article className={`department-metric-card ${colorClass}`}>
      <div className="department-metric-icon">
        <SvgIcon name={icon} />
      </div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function DepartmentCard({
  department,
  selected = false,
  preview = false,
  saving = false,
  onSelect,
  onToggleStatus,
  onSoftDelete,
}) {
  const departmentName = department.name || "Sin nombre";

  return (
    <article
      className={`department-card-visual ${selected ? "selected" : ""} ${
        preview ? "preview" : ""
      }`}
      onClick={preview ? undefined : onSelect}
    >
      <div
        className={`department-card-icon ${getDepartmentColorClass(
          departmentName
        )}`}
      >
        <DepartmentIcon name={departmentName} />
      </div>

      <div className="department-card-content">
        <div className="department-card-title-row">
          <h4>{departmentName}</h4>

          <span
            className={
              department.active
                ? "department-status-badge active"
                : "department-status-badge inactive"
            }
          >
            {department.active ? "Activo" : "Inactivo"}
          </span>
        </div>

        <p>
          {department.description ||
            "Sin descripción registrada para este departamento."}
        </p>

        <div className="department-card-meta">
          <span>{department.active ? "Disponible" : "Oculto"}</span>
        </div>
      </div>

      {!preview && (
        <div className="department-card-actions">
          <button
            type="button"
            title="Editar departamento"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
            disabled={saving}
          >
            <SvgIcon name="edit" />
          </button>

          <button
            type="button"
            title={department.active ? "Desactivar" : "Activar"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStatus?.();
            }}
            disabled={saving}
          >
            <SvgIcon name={department.active ? "disable" : "check"} />
          </button>

          <button
            type="button"
            className="department-danger-action"
            title="Eliminar del panel"
            onClick={(event) => {
              event.stopPropagation();
              onSoftDelete?.();
            }}
            disabled={saving}
          >
            <SvgIcon name="trash" />
          </button>
        </div>
      )}
    </article>
  );
}

function DepartmentIcon({ name = "" }) {
  const normalizedName = String(name).toLowerCase();

  if (normalizedName.includes("audiovisual")) return <SvgIcon name="video" />;
  if (normalizedName.includes("software")) return <SvgIcon name="code" />;
  if (normalizedName.includes("material")) return <SvgIcon name="book" />;
  if (normalizedName.includes("redes")) return <SvgIcon name="chat" />;
  if (normalizedName.includes("imprenta")) return <SvgIcon name="printer" />;
  if (normalizedName.includes("soporte")) return <SvgIcon name="support" />;
  if (normalizedName.includes("dirección")) return <SvgIcon name="building" />;
  if (normalizedName.includes("general")) return <SvgIcon name="grid" />;

  return <SvgIcon name="department" />;
}

function SvgIcon({ name }) {
  const commonProps = {
    className: "departments-svg-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };

  const strokeProps = {
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (name) {
    case "departments":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M4 20h16" />
          <path {...strokeProps} d="M6 20V8l6-4 6 4v12" />
          <path {...strokeProps} d="M9 20v-6h6v6" />
          <path {...strokeProps} d="M9 10h.01M12 10h.01M15 10h.01" />
        </svg>
      );
    case "department":
      return (
        <svg {...commonProps}>
          <rect {...strokeProps} x="4" y="4" width="16" height="16" rx="2" />
          <path {...strokeProps} d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "video":
      return (
        <svg {...commonProps}>
          <rect {...strokeProps} x="4" y="6" width="11" height="12" rx="2" />
          <path {...strokeProps} d="m15 10 5-3v10l-5-3" />
        </svg>
      );
    case "code":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="m8 9-4 3 4 3" />
          <path {...strokeProps} d="m16 9 4 3-4 3" />
          <path {...strokeProps} d="m14 5-4 14" />
        </svg>
      );
    case "book":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path {...strokeProps} d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
          <path {...strokeProps} d="M8 7h8M8 11h6" />
        </svg>
      );
    case "chat":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6a8 8 0 1 1 18-5Z" />
          <path {...strokeProps} d="M8 11h8M8 15h5" />
        </svg>
      );
    case "printer":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M7 8V3h10v5" />
          <path {...strokeProps} d="M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
          <path {...strokeProps} d="M7 14h10v7H7z" />
          <path {...strokeProps} d="M9 17h6" />
        </svg>
      );
    case "support":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M4 13v-1a8 8 0 0 1 16 0v1" />
          <path {...strokeProps} d="M5 13h2v5H5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2Z" />
          <path {...strokeProps} d="M19 13h-2v5h2a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
          <path {...strokeProps} d="M17 18a5 5 0 0 1-5 3" />
        </svg>
      );
    case "building":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M3 21h18" />
          <path {...strokeProps} d="M5 21V7l7-4 7 4v14" />
          <path {...strokeProps} d="M9 21v-8h6v8" />
          <path {...strokeProps} d="M9 9h.01M12 9h.01M15 9h.01" />
        </svg>
      );
    case "grid":
      return (
        <svg {...commonProps}>
          <rect {...strokeProps} x="4" y="4" width="6" height="6" rx="1" />
          <rect {...strokeProps} x="14" y="4" width="6" height="6" rx="1" />
          <rect {...strokeProps} x="4" y="14" width="6" height="6" rx="1" />
          <rect {...strokeProps} x="14" y="14" width="6" height="6" rx="1" />
        </svg>
      );
    case "checkCircle":
      return (
        <svg {...commonProps}>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
    case "xCircle":
      return (
        <svg {...commonProps}>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="m9 9 6 6M15 9l-6 6" />
        </svg>
      );
    case "list":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M8 6h12M8 12h12M8 18h12" />
          <path {...strokeProps} d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case "chart":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M4 19V5" />
          <path {...strokeProps} d="M4 19h16" />
          <path {...strokeProps} d="M8 16v-4M12 16V8M16 16v-7" />
        </svg>
      );
    case "search":
      return (
        <svg {...commonProps}>
          <circle {...strokeProps} cx="11" cy="11" r="7" />
          <path {...strokeProps} d="m20 20-3.5-3.5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M20 7v5h-5" />
          <path {...strokeProps} d="M4 17v-5h5" />
          <path {...strokeProps} d="M19 12a7 7 0 0 0-12-5l-3 3" />
          <path {...strokeProps} d="M5 12a7 7 0 0 0 12 5l3-3" />
        </svg>
      );
    case "plus":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M12 5v14M5 12h14" />
        </svg>
      );
    case "edit":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M12 20h9" />
          <path {...strokeProps} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </svg>
      );
    case "disable":
      return (
        <svg {...commonProps}>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="m5.8 5.8 12.4 12.4" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="m5 13 4 4L19 7" />
        </svg>
      );
    case "trash":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M3 6h18" />
          <path {...strokeProps} d="M8 6V4h8v2" />
          <path {...strokeProps} d="M6 6l1 15h10l1-15" />
          <path {...strokeProps} d="M10 11v6M14 11v6" />
        </svg>
      );
    case "loader":
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      );
    case "empty":
    default:
      return (
        <svg {...commonProps}>
          <path {...strokeProps} d="M12 3v18M3 12h18" />
        </svg>
      );
  }
}

function getDepartmentColorClass(name = "") {
  const normalizedName = String(name).toLowerCase();

  if (normalizedName.includes("audiovisual")) return "department-purple";
  if (normalizedName.includes("software")) return "department-blue";
  if (normalizedName.includes("material")) return "department-orange";
  if (normalizedName.includes("redes")) return "department-pink";
  if (normalizedName.includes("imprenta")) return "department-teal";
  if (normalizedName.includes("soporte")) return "department-indigo";
  if (normalizedName.includes("dirección")) return "department-gold";
  if (normalizedName.includes("general")) return "department-gray";

  return "department-gray";
}
