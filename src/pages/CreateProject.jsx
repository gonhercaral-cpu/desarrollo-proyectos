import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { createProject } from "../services/projectsService";
import { getCollaborators } from "../services/usersService";
import { AREAS, PRIORITIES, PROJECT_STATUSES, REQUESTER_AREAS } from "../data/catalogs";

export default function CreateProject() {
  const { profile } = useAuth();

  const [collaborators, setCollaborators] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    requesterName: "",
    requesterArea: "",
    responsibleArea: "",
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
    async function loadCollaborators() {
      try {
        const data = await getCollaborators();
        setCollaborators(data);
      } catch (error) {
        console.error(error);
        setMessage("No se pudieron cargar los colaboradores.");
      } finally {
        setLoadingUsers(false);
      }
    }

    loadCollaborators();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    if (name === "assignedToEmail") {
      const selectedUser = collaborators.find((user) => user.email === value);

      setForm((current) => ({
        ...current,
        assignedToEmail: value,
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
      await createProject(form, profile);

      setForm({
        title: "",
        description: "",
        requesterName: "",
        requesterArea: "",
        responsibleArea: "",
        assignedToEmail: "",
        assignedToName: "",
        status: "Asignado",
        priority: "Media",
        progress: 0,
        deadline: "",
        acceptanceCriteria: "",
        references: "",
      });

      setMessage("Proyecto creado y asignado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo crear el proyecto. Revisa la consola.");
    } finally {
      setSaving(false);
    }
  }

  const filteredCollaborators = form.responsibleArea
    ? collaborators.filter((user) => user.area === form.responsibleArea)
    : collaborators;

  return (
    <div>
      <h2>Alta, aprobación y asignación de proyecto</h2>
      <p className="page-description">
        Llena este formulario durante la reunión con el solicitante. Al guardar,
        el proyecto quedará aprobado y asignado al responsable seleccionado.
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
              placeholder="Ej. Presentación para Unit 5 - Level 2"
              required
            />
          </div>

          <div className="form-group full">
            <label>Descripción clara del trabajo</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe qué se necesita, para qué se usará y qué resultado se espera."
              required
            />
          </div>

          <div className="form-group">
            <label>Nombre del solicitante</label>
            <input
              name="requesterName"
              value={form.requesterName}
              onChange={handleChange}
              placeholder="Ej. Dirección Académica"
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
              name="assignedToEmail"
              value={form.assignedToEmail}
              onChange={handleChange}
              disabled={loadingUsers}
              required
            >
              <option value="">
                {loadingUsers ? "Cargando usuarios..." : "Seleccionar..."}
              </option>
              {filteredCollaborators.map((user) => (
                <option key={user.id} value={user.email}>
                  {user.name} — {user.area}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Prioridad aprobada</label>
            <select name="priority" value={form.priority} onChange={handleChange}>
              {PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Estado inicial</label>
            <select name="status" value={form.status} onChange={handleChange}>
              {PROJECT_STATUSES.slice(0, 4).map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Avance inicial (%)</label>
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
              placeholder="Ej. Debe estar listo para imprimir, sin errores y aprobado por Dirección Académica."
            />
          </div>

          <div className="form-group full">
            <label>Referencias o enlaces</label>
            <textarea
              name="references"
              value={form.references}
              onChange={handleChange}
              placeholder="Links de Drive, Canva, ejemplos, instrucciones o materiales base."
            />
          </div>

          <div className="form-group full">
            <button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Aprobar y asignar proyecto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}