import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getProjectById, updateProjectAdmin } from "../services/projectsService";
import { getCollaborators } from "../services/usersService";
import {
  AREAS,
  PRIORITIES,
  PROJECT_STATUSES,
  REQUESTER_AREAS,
} from "../data/catalogs";

export default function EditProject({ projectId, onBack, onSaved }) {
  const { profile } = useAuth();

  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    requesterName: "",
    requesterArea: "",
    responsibleArea: "",
    assignedToUid: "",
    assignedToEmail: "",
    assignedToName: "",
    status: "Asignado",
    priority: "Media",
    progress: 0,
    deadline: "",
    acceptanceCriteria: "",
    references: "",
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setMessage("");

      try {
        const [projectData, collaboratorsData] = await Promise.all([
          getProjectById(projectId),
          getCollaborators(),
        ]);

        if (!projectData) {
          setMessage("No se encontró el proyecto.");
          return;
        }

        setCollaborators(collaboratorsData);

        setForm({
          title: projectData.title || "",
          description: projectData.description || "",
          requesterName: projectData.requesterName || "",
          requesterArea: projectData.requesterArea || "",
          responsibleArea: projectData.responsibleArea || "",
          assignedToUid: projectData.assignedToUid || "",
          assignedToEmail: projectData.assignedToEmail || "",
          assignedToName: projectData.assignedToName || "",
          status: projectData.status || "Asignado",
          priority: projectData.priority || "Media",
          progress: projectData.progress || 0,
          deadline: projectData.deadline || "",
          acceptanceCriteria: projectData.acceptanceCriteria || "",
          references: projectData.references || "",
        });
      } catch (error) {
        console.error(error);
        setMessage("No se pudo cargar la información del proyecto.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [projectId]);

  function handleChange(event) {
    const { name, value } = event.target;

    if (name === "assignedToUid") {
      const selectedUser = collaborators.find((user) => user.id === value);

      setForm((current) => ({
        ...current,
        assignedToUid: selectedUser?.id || "",
        assignedToEmail: selectedUser?.email || "",
        assignedToName: selectedUser?.name || "",
        responsibleArea: selectedUser?.area || current.responsibleArea,
      }));

      return;
    }

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setSaving(true);
    setMessage("");

    try {
      await updateProjectAdmin(projectId, form, profile);

      setMessage("Proyecto actualizado correctamente.");

      if (onSaved) {
        onSaved();
      }
    } catch (error) {
      console.error(error);
      setMessage("No se pudo actualizar el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  const filteredCollaborators = form.responsibleArea
    ? collaborators.filter((user) => user.area === form.responsibleArea)
    : collaborators;

  if (loading) {
    return <p>Cargando editor del proyecto...</p>;
  }

  return (
    <div>
      <button className="secondary-button" onClick={onBack}>
        ← Volver
      </button>

      <h2>Editar proyecto</h2>
      <p className="page-description">
        Esta pantalla es solo para administrador. Aquí puedes corregir datos,
        reasignar responsable, cambiar prioridad o ajustar fecha compromiso.
      </p>

      <div className="card">
        {message && <div className="message-box">{message}</div>}

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group full">
            <label>Título del proyecto</label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group full">
            <label>Descripción</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Solicitante</label>
            <input
              name="requesterName"
              value={form.requesterName}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Área solicitante</label>
            <select
              name="requesterArea"
              value={form.requesterArea}
              onChange={handleChange}
              required
            >
              <option value="">Seleccionar...</option>
              {REQUESTER_AREAS.map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Área responsable</label>
            <select
              name="responsibleArea"
              value={form.responsibleArea}
              onChange={handleChange}
              required
            >
              <option value="">Seleccionar...</option>
              {AREAS.map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Responsable asignado</label>
            <select
              name="assignedToUid"
              value={form.assignedToUid}
              onChange={handleChange}
              required
            >
              <option value="">Seleccionar...</option>
              {filteredCollaborators.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} — {user.area}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Estado</label>
            <select name="status" value={form.status} onChange={handleChange}>
              {PROJECT_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Prioridad</label>
            <select
              name="priority"
              value={form.priority}
              onChange={handleChange}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Avance (%)</label>
            <input
              type="number"
              name="progress"
              min="0"
              max="100"
              value={form.progress}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Fecha compromiso</label>
            <input
              type="date"
              name="deadline"
              value={form.deadline}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group full">
            <label>Criterios de aceptación</label>
            <textarea
              name="acceptanceCriteria"
              value={form.acceptanceCriteria}
              onChange={handleChange}
            />
          </div>

          <div className="form-group full">
            <label>Referencias</label>
            <textarea
              name="references"
              value={form.references}
              onChange={handleChange}
            />
          </div>

          <div className="form-group full">
            <button disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}