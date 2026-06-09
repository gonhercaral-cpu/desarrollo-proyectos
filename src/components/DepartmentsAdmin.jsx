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

  return (
    <section className="departments-admin-redesign visual-page">
      <div className="departments-hero">
        <div>
          <span className="breadcrumb-line">Panel de administrador</span>
          <h2>Departamentos</h2>
          <p>
            Organiza las áreas funcionales de Desarrollo de Proyectos sin
            saturar la vista administrativa.
          </p>
        </div>

        <div className="departments-hero-actions">
          <button
            type="button"
            className="visual-outline-button"
            onClick={loadDepartments}
            disabled={loading || saving}
          >
            ↻ Actualizar
          </button>

          <button
            type="button"
            className="visual-primary-button"
            onClick={resetForm}
            disabled={saving}
          >
            ＋ Nuevo departamento
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {successMessage && <div className="message-box">{successMessage}</div>}

      <section className="departments-metrics-grid">
        <DepartmentMetricCard
          icon="🏛"
          label="Total departamentos"
          value={departments.length}
          detail="áreas visibles"
          colorClass="department-metric-blue"
        />

        <DepartmentMetricCard
          icon="✓"
          label="Activos"
          value={activeDepartmentsCount}
          detail="disponibles para asignar"
          colorClass="department-metric-green"
        />

        <DepartmentMetricCard
          icon="×"
          label="Inactivos"
          value={inactiveDepartmentsCount}
          detail="ocultos temporalmente"
          colorClass="department-metric-red"
        />
      </section>

      <div className="departments-workspace">
        <main className="departments-list-panel">
          <div className="departments-toolbar">
            <div>
              <h3>Departamentos registrados</h3>
              <p>
                Selecciona una tarjeta para editarla. Puedes desactivar un
                departamento o eliminarlo del panel sin borrar su historial.
              </p>
            </div>

            <div className="departments-toolbar-actions">
              <div className="visual-search departments-search">
                <span>⌕</span>
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
              <div>⌛</div>
              <p>Cargando departamentos...</p>
            </div>
          ) : filteredDepartments.length === 0 ? (
            <div className="departments-empty-card">
              <div>▯</div>
              <p>No hay departamentos con esos filtros.</p>
            </div>
          ) : (
            <div className="department-card-grid">
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

          <section className="departments-distribution-card">
            <div className="departments-mini-header">
              <div>
                <h3>Distribución por departamento</h3>
                <p>Vista rápida para revisar el estado de las áreas visibles.</p>
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
        </main>

        <aside className="department-editor-panel">
          <div className="department-editor-header">
            <div
              className={`department-editor-icon ${getDepartmentColorClass(
                formData.name || selectedDepartment?.name
              )}`}
            >
              {getDepartmentIcon(formData.name || selectedDepartment?.name)}
            </div>

            <div>
              <h3>
                {editingDepartmentId
                  ? "Editar departamento"
                  : "Nuevo departamento"}
              </h3>

              <p>
                {editingDepartmentId
                  ? "Ajusta la información principal del área."
                  : "Crea una nueva área funcional para el sistema."}
              </p>
            </div>
          </div>

          <form className="department-editor-form" onSubmit={handleSubmit}>
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

            <label className="department-toggle-row">
              <div>
                <span>Departamento activo</span>
                <small>
                  Los departamentos activos aparecen al crear proyectos y
                  asignar colaboradores.
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

            <div className="department-editor-preview">
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

            <div className="department-editor-actions">
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

              {editingDepartmentId && (
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={resetForm}
                  disabled={saving}
                >
                  Cancelar edición
                </button>
              )}
            </div>
          </form>
        </aside>
      </div>
    </section>
  );
}

function DepartmentMetricCard({ icon, label, value, detail, colorClass }) {
  return (
    <article className={`department-metric-card ${colorClass}`}>
      <div className="department-metric-icon">{icon}</div>

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
        {getDepartmentIcon(departmentName)}
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
            ✎
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
            {department.active ? "⊘" : "✓"}
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
            🗑
          </button>
        </div>
      )}
    </article>
  );
}

function getDepartmentIcon(name = "") {
  const normalizedName = String(name).toLowerCase();

  if (normalizedName.includes("audiovisual")) return "🎬";
  if (normalizedName.includes("software")) return "⌨";
  if (normalizedName.includes("material")) return "📚";
  if (normalizedName.includes("redes")) return "💬";
  if (normalizedName.includes("imprenta")) return "🖨";
  if (normalizedName.includes("soporte")) return "🎧";
  if (normalizedName.includes("dirección")) return "🏛";
  if (normalizedName.includes("general")) return "▦";

  return "▤";
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