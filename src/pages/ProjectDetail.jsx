import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  addProjectEvidence,
  getProjectById,
  getProjectEvidence,
  getProjectUpdates,
  updateProjectStatus,
} from "../services/projectsService";
import { PROJECT_STATUSES } from "../data/catalogs";

export default function ProjectDetail({ projectId, onBack }) {
  const { profile, isAdmin } = useAuth();

  const [project, setProject] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [message, setMessage] = useState("");

  const [updateForm, setUpdateForm] = useState({
    status: "",
    progress: 0,
    comment: "",
  });

  const [evidenceForm, setEvidenceForm] = useState({
    title: "",
    link: "",
    comment: "",
  });

  async function loadProjectData() {
    setLoading(true);

    try {
      const [projectData, updatesData, evidenceData] = await Promise.all([
        getProjectById(projectId),
        getProjectUpdates(projectId),
        getProjectEvidence(projectId),
      ]);

      setProject(projectData);
      setUpdates(updatesData);
      setEvidence(evidenceData);

      if (projectData) {
        setUpdateForm({
          status: projectData.status,
          progress: projectData.progress || 0,
          comment: "",
        });
      }
    } catch (error) {
      console.error(error);
      setMessage("No se pudo cargar el proyecto.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjectData();
  }, [projectId]);

  function canUpdateProject() {
    return isAdmin || project?.assignedToEmail === profile.email;
  }

  function handleUpdateChange(event) {
    const { name, value } = event.target;

    setUpdateForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleEvidenceChange(event) {
    const { name, value } = event.target;

    setEvidenceForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleUpdateSubmit(event) {
    event.preventDefault();
    setMessage("");

    const requiresEvidence = [
      "Listo para revisión",
      "Aprobado para entrega",
      "Finalizado",
    ].includes(updateForm.status);

    if (requiresEvidence && evidence.length === 0 && !evidenceForm.link) {
      setMessage("Para marcar este estado, primero agrega una evidencia o pega un link de evidencia.");
      return;
    }

    setSavingUpdate(true);

    try {
      await updateProjectStatus(projectId, updateForm, profile);

      if (evidenceForm.link) {
        await addProjectEvidence(
          {
            projectId,
            title: evidenceForm.title || "Evidencia",
            link: evidenceForm.link,
            comment: evidenceForm.comment,
          },
          profile
        );

        setEvidenceForm({
          title: "",
          link: "",
          comment: "",
        });
      }

      setMessage("Proyecto actualizado correctamente.");
      await loadProjectData();
    } catch (error) {
      console.error(error);
      setMessage("No se pudo actualizar el proyecto.");
    } finally {
      setSavingUpdate(false);
    }
  }

  async function handleEvidenceSubmit(event) {
    event.preventDefault();
    setMessage("");
    setSavingEvidence(true);

    try {
      await addProjectEvidence(
        {
          projectId,
          title: evidenceForm.title,
          link: evidenceForm.link,
          comment: evidenceForm.comment,
        },
        profile
      );

      setEvidenceForm({
        title: "",
        link: "",
        comment: "",
      });

      setMessage("Evidencia agregada correctamente.");
      await loadProjectData();
    } catch (error) {
      console.error(error);
      setMessage("No se pudo agregar la evidencia.");
    } finally {
      setSavingEvidence(false);
    }
  }

  if (loading) {
    return <p>Cargando detalle del proyecto...</p>;
  }

  if (!project) {
    return (
      <div>
        <button onClick={onBack}>Volver</button>
        <p>Proyecto no encontrado.</p>
      </div>
    );
  }

  return (
    <div>
      <button className="secondary-button" onClick={onBack}>
        ← Volver
      </button>

      <h2>{project.title}</h2>
      <p className="page-description">{project.description}</p>

      {message && <div className="message-box">{message}</div>}

      <div className="details-grid">
        <div className="card">
          <h3>Información general</h3>
          <p><strong>Solicitante:</strong> {project.requesterName}</p>
          <p><strong>Área solicitante:</strong> {project.requesterArea}</p>
          <p><strong>Responsable:</strong> {project.assignedToName}</p>
          <p><strong>Área responsable:</strong> {project.responsibleArea}</p>
          <p><strong>Estado:</strong> {project.status}</p>
          <p><strong>Prioridad:</strong> {project.priority}</p>
          <p><strong>Avance:</strong> {project.progress}%</p>
          <p><strong>Fecha compromiso:</strong> {project.deadline}</p>
        </div>

        <div className="card">
          <h3>Criterios y referencias</h3>
          <p><strong>Criterios de aceptación:</strong></p>
          <p>{project.acceptanceCriteria || "No especificados."}</p>

          <p><strong>Referencias:</strong></p>
          <p>{project.references || "Sin referencias."}</p>
        </div>
      </div>

      {canUpdateProject() && (
        <div className="card">
          <h3>Actualizar proyecto</h3>

          <form onSubmit={handleUpdateSubmit} className="form-grid">
            <div className="form-group">
              <label>Estado</label>
              <select
                name="status"
                value={updateForm.status}
                onChange={handleUpdateChange}
              >
                {PROJECT_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Avance (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                name="progress"
                value={updateForm.progress}
                onChange={handleUpdateChange}
              />
            </div>

            <div className="form-group full">
              <label>Comentario de avance</label>
              <textarea
                name="comment"
                value={updateForm.comment}
                onChange={handleUpdateChange}
                placeholder="Describe qué avanzaste, qué falta o si hay algún bloqueo."
                required
              />
            </div>

            <div className="form-group full">
              <h4>Evidencia opcional en esta actualización</h4>
            </div>

            <div className="form-group">
              <label>Título de evidencia</label>
              <input
                name="title"
                value={evidenceForm.title}
                onChange={handleEvidenceChange}
                placeholder="Ej. Captura de avance"
              />
            </div>

            <div className="form-group">
              <label>Link de evidencia</label>
              <input
                name="link"
                value={evidenceForm.link}
                onChange={handleEvidenceChange}
                placeholder="https://drive.google.com/..."
              />
            </div>

            <div className="form-group full">
              <label>Comentario de evidencia</label>
              <textarea
                name="comment"
                value={evidenceForm.comment}
                onChange={handleEvidenceChange}
                placeholder="Explica brevemente qué demuestra la evidencia."
              />
            </div>

            <div className="form-group full">
              <button disabled={savingUpdate}>
                {savingUpdate ? "Guardando..." : "Guardar actualización"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="details-grid">
        <div className="card">
          <h3>Evidencias</h3>

          {evidence.length === 0 ? (
            <p>No hay evidencias registradas.</p>
          ) : (
            <div className="stack-list">
              {evidence.map((item) => (
                <div className="list-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <a href={item.link} target="_blank" rel="noreferrer">
                    {item.link}
                  </a>
                  <span>{item.comment}</span>
                  <small>{item.userName}</small>
                </div>
              ))}
            </div>
          )}

          {canUpdateProject() && (
            <form onSubmit={handleEvidenceSubmit} className="evidence-form">
              <h4>Agregar evidencia</h4>

              <label>Título</label>
              <input
                name="title"
                value={evidenceForm.title}
                onChange={handleEvidenceChange}
                required
              />

              <label>Link</label>
              <input
                name="link"
                value={evidenceForm.link}
                onChange={handleEvidenceChange}
                required
              />

              <label>Comentario</label>
              <textarea
                name="comment"
                value={evidenceForm.comment}
                onChange={handleEvidenceChange}
              />

              <button disabled={savingEvidence}>
                {savingEvidence ? "Agregando..." : "Agregar evidencia"}
              </button>
            </form>
          )}
        </div>

        <div className="card">
          <h3>Historial</h3>

          {updates.length === 0 ? (
            <p>No hay historial todavía.</p>
          ) : (
            <div className="stack-list">
              {updates.map((update) => (
                <div className="list-item" key={update.id}>
                  <strong>
                    {update.oldStatus || "Nuevo"} → {update.newStatus}
                  </strong>
                  <span>{update.comment}</span>
                  <small>
                    {update.userName} · {update.progress}% de avance
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}