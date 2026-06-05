import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  addProjectEvidence,
  getProjectById,
  getProjectEvidence,
  getProjectUpdates,
  updateProjectStatus,
} from "../services/projectsService";
import { uploadEvidenceFile } from "../services/storageService";
import {
  COLLABORATOR_STATUSES,
  PROJECT_STATUSES,
} from "../data/catalogs";

const CLOSED_STATUSES = ["Finalizado", "Cancelado"];

const EVIDENCE_REQUIRED_STATUSES = [
  "Listo para revisión",
  "Aprobado para entrega",
  "Finalizado",
];

const ADMIN_ONLY_STATUSES = [
  "Aprobado para entrega",
  "Finalizado",
  "Cancelado",
];

export default function ProjectDetail({ projectId, onBack, onEditProject }) {
  const { profile, isAdmin } = useAuth();

  const [project, setProject] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

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
    setMessage("");

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
          status: projectData.status || "",
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
    if (projectId) {
      loadProjectData();
    }
  }, [projectId]);

  function isProjectClosed() {
    return CLOSED_STATUSES.includes(project?.status);
  }

  function canUpdateProject() {
    if (isProjectClosed()) {
      return false;
    }

    return isAdmin || project?.assignedToUid === profile?.uid;
  }

  function canAddEvidence() {
    if (isProjectClosed()) {
      return false;
    }

    return isAdmin || project?.assignedToUid === profile?.uid;
  }

  function shouldShowAdministrativeReview() {
    return isAdmin && project?.status?.trim() === "Listo para revisión";
  }

  function getAvailableStatuses() {
    if (isAdmin) {
      return PROJECT_STATUSES;
    }

    if (
      Array.isArray(COLLABORATOR_STATUSES) &&
      COLLABORATOR_STATUSES.length > 0
    ) {
      return COLLABORATOR_STATUSES;
    }

    return PROJECT_STATUSES.filter(
      (status) => !ADMIN_ONLY_STATUSES.includes(status)
    );
  }

  function hasEvidenceForStatusChange() {
    return (
      evidence.length > 0 ||
      Boolean(evidenceForm.link) ||
      Boolean(selectedFile)
    );
  }

  function validateStatusRules() {
    const selectedStatus = updateForm.status;
    const progressNumber = Number(updateForm.progress);

    if (isProjectClosed()) {
      return "Este proyecto ya está cerrado y no se puede actualizar.";
    }

    if (!isAdmin && ADMIN_ONLY_STATUSES.includes(selectedStatus)) {
      return "Solo un administrador puede aprobar, finalizar o cancelar un proyecto.";
    }

    if (
      EVIDENCE_REQUIRED_STATUSES.includes(selectedStatus) &&
      !hasEvidenceForStatusChange()
    ) {
      return "Para marcar este estado, agrega un link o selecciona un archivo de evidencia.";
    }

    if (selectedStatus === "Finalizado" && progressNumber < 100) {
      return "Para finalizar el proyecto, el avance debe estar en 100%.";
    }

    if (progressNumber < 0 || progressNumber > 100) {
      return "El avance debe estar entre 0% y 100%.";
    }

    return "";
  }

  function handleEditProjectClick() {
    if (isProjectClosed()) {
      setMessage("Este proyecto ya está cerrado y no se puede editar.");
      return;
    }

    if (typeof onEditProject === "function") {
      onEditProject(projectId);
      return;
    }

    console.error("Falta enviar onEditProject desde el componente padre.");
    setMessage(
      "No se pudo abrir la edición del proyecto. Falta configurar la función de edición."
    );
  }

  function formatDateTime(timestamp) {
    if (!timestamp) {
      return "Fecha no disponible";
    }

    let date;

    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else {
      date = new Date(timestamp);
    }

    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatFileSize(size) {
    if (!size || size <= 0) {
      return "";
    }

    return `${(size / 1024 / 1024).toFixed(2)} MB`;
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

  function handleFileChange(event) {
    const file = event.target.files[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const maxSizeInMB = 20;
    const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

    if (file.size > maxSizeInBytes) {
      setMessage(`El archivo no debe pesar más de ${maxSizeInMB} MB.`);
      event.target.value = "";
      setSelectedFile(null);
      return;
    }

    setMessage("");
    setSelectedFile(file);
  }

  function resetEvidenceForm() {
    setEvidenceForm({
      title: "",
      link: "",
      comment: "",
    });

    setSelectedFile(null);
  }

  async function uploadSelectedFileIfNeeded() {
    if (!selectedFile) {
      return null;
    }

    return uploadEvidenceFile(projectId, selectedFile, profile);
  }

  async function handleAdministrativeReview(newStatus) {
    setMessage("");

    if (!isAdmin) {
      setMessage("Solo un administrador puede hacer la revisión administrativa.");
      return;
    }

    if (isProjectClosed()) {
      setMessage("Este proyecto ya está cerrado y no se puede revisar.");
      return;
    }

    if (project.status?.trim() !== "Listo para revisión") {
      setMessage("Este proyecto todavía no está listo para revisión.");
      return;
    }

    setSavingUpdate(true);

    try {
      await updateProjectStatus(
        projectId,
        {
          status: newStatus,
          progress:
            newStatus === "Aprobado para entrega"
              ? 100
              : Number(project.progress || 0),
          comment:
            newStatus === "Aprobado para entrega"
              ? "El proyecto fue aprobado administrativamente."
              : "Se solicitaron correcciones al responsable del proyecto.",
        },
        profile
      );

      setMessage("Revisión administrativa guardada correctamente.");
      await loadProjectData();
    } catch (error) {
      console.error(error);
      setMessage("No se pudo guardar la revisión administrativa.");
    } finally {
      setSavingUpdate(false);
    }
  }

  async function handleUpdateSubmit(event) {
    event.preventDefault();
    setMessage("");

    const validationMessage = validateStatusRules();

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSavingUpdate(true);

    try {
      const uploadedFileData = await uploadSelectedFileIfNeeded();

      if (evidenceForm.link || uploadedFileData) {
        await addProjectEvidence(
          {
            projectId,
            title:
              evidenceForm.title ||
              selectedFile?.name ||
              "Evidencia del proyecto",
            link: evidenceForm.link || uploadedFileData?.downloadUrl || "",
            comment: evidenceForm.comment,
            fileName: uploadedFileData?.fileName || "",
            filePath: uploadedFileData?.filePath || "",
            fileType: uploadedFileData?.fileType || "",
            fileSize: uploadedFileData?.fileSize || 0,
            downloadUrl: uploadedFileData?.downloadUrl || "",
          },
          profile
        );

        resetEvidenceForm();
      }

      await updateProjectStatus(
        projectId,
        {
          ...updateForm,
          progress: Number(updateForm.progress),
        },
        profile
      );

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

    if (isProjectClosed()) {
      setMessage("Este proyecto ya está cerrado y no se puede agregar evidencia.");
      return;
    }

    if (!evidenceForm.link && !selectedFile) {
      setMessage("Agrega un link o selecciona un archivo como evidencia.");
      return;
    }

    setSavingEvidence(true);

    try {
      const uploadedFileData = await uploadSelectedFileIfNeeded();

      await addProjectEvidence(
        {
          projectId,
          title:
            evidenceForm.title ||
            selectedFile?.name ||
            "Evidencia del proyecto",
          link: evidenceForm.link || uploadedFileData?.downloadUrl || "",
          comment: evidenceForm.comment,
          fileName: uploadedFileData?.fileName || "",
          filePath: uploadedFileData?.filePath || "",
          fileType: uploadedFileData?.fileType || "",
          fileSize: uploadedFileData?.fileSize || 0,
          downloadUrl: uploadedFileData?.downloadUrl || "",
        },
        profile
      );

      resetEvidenceForm();

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
        <button className="secondary-button" onClick={onBack}>
          ← Volver
        </button>

        <p>Proyecto no encontrado.</p>
      </div>
    );
  }

  return (
    <div>
      <button className="secondary-button" onClick={onBack}>
        ← Volver
      </button>

      {isAdmin && !isProjectClosed() && (
        <button
          type="button"
          className="secondary-button"
          onClick={handleEditProjectClick}
        >
          Editar proyecto
        </button>
      )}

      <h2>{project.title}</h2>
      <p className="page-description">{project.description}</p>

      {message && <div className="message-box">{message}</div>}

      {isProjectClosed() && (
        <div className="message-box">
          Este proyecto está cerrado con el estado:{" "}
          <strong>{project.status}</strong>. Ya no se pueden registrar
          actualizaciones ni evidencias.
        </div>
      )}

      {shouldShowAdministrativeReview() && (
        <div className="card">
          <h3>Revisión administrativa</h3>

          <p>
            Este proyecto fue marcado como{" "}
            <strong>Listo para revisión</strong>. Revisa la evidencia subida
            por el responsable antes de aprobarlo o solicitar correcciones.
          </p>

          {evidence.length === 0 ? (
            <div className="message-box">
              Este proyecto todavía no tiene evidencia registrada. Antes de
              aprobarlo, revisa que el responsable haya subido archivos o links
              de evidencia.
            </div>
          ) : (
            <p>
              Evidencias registradas: <strong>{evidence.length}</strong>
            </p>
          )}

          <div className="button-row">
            <button
              type="button"
              onClick={() =>
                handleAdministrativeReview("Aprobado para entrega")
              }
              disabled={savingUpdate || evidence.length === 0}
            >
              {savingUpdate ? "Guardando..." : "Aprobar para entrega"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                handleAdministrativeReview("Correcciones solicitadas")
              }
              disabled={savingUpdate}
            >
              {savingUpdate ? "Guardando..." : "Solicitar correcciones"}
            </button>
          </div>
        </div>
      )}

      <div className="details-grid">
        <div className="card">
          <h3>Información general</h3>

          <p>
            <strong>Solicitante:</strong> {project.requesterName}
          </p>

          <p>
            <strong>Área solicitante:</strong> {project.requesterArea}
          </p>

          <p>
            <strong>Responsable:</strong> {project.assignedToName}
          </p>

          <p>
            <strong>Área responsable:</strong> {project.responsibleArea}
          </p>

          <p>
            <strong>Estado:</strong> {project.status}
          </p>

          <p>
            <strong>Prioridad:</strong> {project.priority}
          </p>

          <p>
            <strong>Avance:</strong> {project.progress}%
          </p>

          <p>
            <strong>Fecha compromiso:</strong> {project.deadline}
          </p>
        </div>

        <div className="card">
          <h3>Criterios y referencias</h3>

          <p>
            <strong>Criterios de aceptación:</strong>
          </p>
          <p>{project.acceptanceCriteria || "No especificados."}</p>

          <p>
            <strong>Referencias:</strong>
          </p>
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
                {getAvailableStatuses().map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
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
              <small>
                Será obligatoria si marcas el proyecto como Listo para revisión,
                Aprobado para entrega o Finalizado.
              </small>
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
              <label>Archivo de evidencia</label>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp4"
              />

              {selectedFile && (
                <small className="file-preview">
                  Archivo seleccionado: {selectedFile.name}
                </small>
              )}
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
              <button type="submit" disabled={savingUpdate}>
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

                  {item.downloadUrl ? (
                    <a
                      href={item.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir archivo: {item.fileName || "Evidencia"}
                    </a>
                  ) : item.link ? (
                    <a href={item.link} target="_blank" rel="noreferrer">
                      {item.link}
                    </a>
                  ) : (
                    <span>Sin link disponible</span>
                  )}

                  {item.fileSize > 0 && (
                    <span>Tamaño: {formatFileSize(item.fileSize)}</span>
                  )}

                  {item.comment && <span>{item.comment}</span>}

                  <small>
                    Subido por {item.userName || "Usuario no identificado"} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </small>
                </div>
              ))}
            </div>
          )}

          {canAddEvidence() && (
            <form onSubmit={handleEvidenceSubmit} className="evidence-form">
              <h4>Agregar evidencia</h4>

              <label>Título</label>
              <input
                name="title"
                value={evidenceForm.title}
                onChange={handleEvidenceChange}
                placeholder="Ej. Archivo final, captura, evidencia de avance"
              />

              <label>Link</label>
              <input
                name="link"
                value={evidenceForm.link}
                onChange={handleEvidenceChange}
                placeholder="https://drive.google.com/..."
              />

              <label>Archivo</label>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp4"
              />

              {selectedFile && (
                <small className="file-preview">
                  Archivo seleccionado: {selectedFile.name}
                </small>
              )}

              <label>Comentario</label>
              <textarea
                name="comment"
                value={evidenceForm.comment}
                onChange={handleEvidenceChange}
                placeholder="Describe brevemente qué contiene esta evidencia."
              />

              <button type="submit" disabled={savingEvidence}>
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
                    {update.userName || "Usuario no identificado"} ·{" "}
                    {update.progress}% de avance ·{" "}
                    {formatDateTime(update.createdAt)}
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