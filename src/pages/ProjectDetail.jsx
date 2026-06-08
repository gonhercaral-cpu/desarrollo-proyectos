import { useEffect, useMemo, useState } from "react";
import {
  arrayUnion,
  doc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { uploadEvidenceFile } from "../services/storageService";
import { useAuth } from "../context/AuthContext";
import {
  addProjectLog,
  getProjectLogs,
  PROJECT_LOG_TYPES,
} from "../services/projectsService";

const PROJECT_STATUSES = [
  "Por iniciar",
  "En planeación",
  "En proceso",
  "En espera de información",
  "Listo para revisión",
  "Correcciones solicitadas",
  "Aprobado para entrega",
  "Finalizado",
  "Terminado",
  "Cancelado",
  "Pausado",
  "Eliminado",
  "Archivado",
];

const COLLABORATOR_STATUSES = [
  "Por iniciar",
  "En planeación",
  "En proceso",
  "En espera de información",
  "Listo para revisión",
  "Pausado",
];

const CLOSED_STATUSES = [
  "Finalizado",
  "Terminado",
  "Cancelado",
  "Eliminado",
  "Archivado",
];

export default function ProjectDetail({ projectId, onBack, onEditProject }) {
  const { profile, firebaseUser, isAdmin } = useAuth();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [addingComment, setAddingComment] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [editingInternalNotes, setEditingInternalNotes] = useState(false);
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [savingInternalNotes, setSavingInternalNotes] = useState(false);
  const [message, setMessage] = useState("");
  const [projectLogs, setProjectLogs] = useState([]);

  async function loadProject() {
    if (!projectId) return;

    setLoading(true);
    setMessage("");

    try {
      const projectRef = doc(db, "projects", projectId);
      const snapshot = await getDoc(projectRef);

      if (!snapshot.exists()) {
        setMessage("No se encontró el proyecto.");
        setProject(null);
        setProjectLogs([]);
        return;
      }

      setProject({
        id: snapshot.id,
        ...snapshot.data(),
      });

      try {
        const logs = await getProjectLogs(projectId);
        setProjectLogs(logs);
      } catch (logError) {
        console.warn("No se pudo cargar la bitácora formal:", logError);
        setProjectLogs([]);
      }
    } catch (error) {
      console.error(error);
      setMessage("No se pudo cargar el detalle del proyecto.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  function getCurrentUserForLog() {
    return {
      uid: firebaseUser?.uid || profile?.uid || profile?.id || "",
      id: firebaseUser?.uid || profile?.uid || profile?.id || "",
      email: firebaseUser?.email || profile?.email || "",
      name:
        profile?.name ||
        firebaseUser?.displayName ||
        firebaseUser?.email ||
        "Usuario",
      role: profile?.role || "",
      active: profile?.active !== false,
    };
  }

  async function refreshProjectLogs() {
    if (!projectId) return;

    try {
      const logs = await getProjectLogs(projectId);
      setProjectLogs(logs);
    } catch (error) {
      console.warn("No se pudo actualizar la bitácora formal:", error);
    }
  }

  async function registerProjectLog(logData) {
    try {
      await addProjectLog({
        ...logData,
        projectId: project.id,
        currentUser: getCurrentUserForLog(),
      });

      await refreshProjectLogs();
    } catch (error) {
      console.warn("No se pudo registrar la bitácora formal:", error);
    }
  }

  async function handleStatusChange(nextStatus) {
    if (!project || !nextStatus || nextStatus === project.status) return;

    if (isHistoricalProject(project)) {
      setMessage("No se puede cambiar el estado de un proyecto que está en historial.");
      return;
    }

    setChangingStatus(true);
    setMessage("");

    try {
      const now = Timestamp.now();
      const projectRef = doc(db, "projects", project.id);
      const isClosingStatus = CLOSED_STATUSES.includes(nextStatus);

      const historyItem = {
        type: "Estado",
        title: "Cambio de estado",
        description: `Cambió el estado del proyecto de ${
          project.status || "Sin estado"
        } a ${nextStatus}.`,
        createdAt: now,
        createdByName: profile?.name || firebaseUser?.email || "Usuario",
        createdByEmail: firebaseUser?.email || "",
      };

      const updateData = {
        status: nextStatus,
        updatedAt: now,
        history: arrayUnion(historyItem),
      };

      if (isClosingStatus) {
        updateData.closedAt = project.closedAt || now;
        updateData.closedByUid = firebaseUser?.uid || "";
        updateData.closedByName =
          profile?.name || firebaseUser?.email || "Usuario";
      }

      if (isAdmin && !isClosingStatus) {
        updateData.closedAt = null;
        updateData.closedByUid = "";
        updateData.closedByName = "";
      }

      await updateDoc(projectRef, updateData);

      setProject((current) => ({
        ...current,
        ...updateData,
        history: [...normalizeArray(current?.history), historyItem],
        updatedAt: now,
        status: nextStatus,
      }));

      await registerProjectLog({
        type: getStatusProjectLogType(nextStatus),
        title: getStatusProjectLogTitle(nextStatus),
        description: `${profile?.name || firebaseUser?.email || "Un usuario"} cambió el estado de "${project.status || "Sin estado"}" a "${nextStatus}".`,
        metadata: {
          oldStatus: project.status || "",
          newStatus: nextStatus,
          closed: isClosingStatus,
        },
      });

      setMessage("Estado actualizado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage(
        "No se pudo actualizar el estado del proyecto. Revisa que tengas permisos para hacer este cambio."
      );
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleUploadEvidence(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length || !project) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden subir evidencias a un proyecto que está en historial.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      if (!firebaseUser?.uid) {
        throw new Error("No se encontró el UID del usuario actual.");
      }

      const uploadedItems = [];
      const now = Timestamp.now();

      const currentUserForUpload = {
        ...firebaseUser,
        uid: firebaseUser.uid,
        email: firebaseUser.email || profile?.email || "",
        name:
          profile?.name ||
          firebaseUser.displayName ||
          firebaseUser.email ||
          "Usuario",
      };

      for (const file of files) {
        const uploadedFile = await uploadEvidenceFile(
          project.id,
          file,
          currentUserForUpload,
          profile
        );

        const evidenceItem = {
          ...uploadedFile,
          fileName: uploadedFile.fileName || file.name,
          uploadedAt: now,
          uploadedByUid: firebaseUser.uid,
          uploadedByName: profile?.name || firebaseUser?.email || "Usuario",
          uploadedByEmail: firebaseUser?.email || "",
        };

        uploadedItems.push(evidenceItem);
      }

      const historyItem = {
        type: "Archivo",
        title: "Evidencia agregada",
        description:
          uploadedItems.length === 1
            ? `Subió el archivo ${uploadedItems[0].fileName}.`
            : `Subió ${uploadedItems.length} archivos de evidencia.`,
        createdAt: now,
        createdByName: profile?.name || firebaseUser?.email || "Usuario",
        createdByEmail: firebaseUser?.email || "",
      };

      const projectRef = doc(db, "projects", project.id);

      await updateDoc(projectRef, {
        evidenceFiles: arrayUnion(...uploadedItems),
        updatedAt: now,
        history: arrayUnion(historyItem),
      });

      setProject((current) => ({
        ...current,
        evidenceFiles: [
          ...normalizeArray(current?.evidenceFiles),
          ...uploadedItems,
        ],
        updatedAt: now,
        history: [...normalizeArray(current?.history), historyItem],
      }));

      await registerProjectLog({
        type: PROJECT_LOG_TYPES.EVIDENCE_UPLOADED,
        title: "Evidencia subida",
        description:
          uploadedItems.length === 1
            ? `${profile?.name || firebaseUser?.email || "Un usuario"} subió el archivo ${uploadedItems[0].fileName}.`
            : `${profile?.name || firebaseUser?.email || "Un usuario"} subió ${uploadedItems.length} archivos de evidencia.`,
        metadata: {
          files: uploadedItems.map((item) => ({
            fileName: item.fileName || "",
            fileType: item.fileType || "",
            filePath: item.filePath || "",
          })),
        },
      });

      setMessage("Archivo(s) subido(s) correctamente.");
    } catch (error) {
      console.error(error);
      setMessage(
        error.message ||
          "No se pudieron subir los archivos. Revisa permisos de Firestore y Storage."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleAddComment(event) {
    event.preventDefault();

    const cleanComment = newComment.trim();

    if (!cleanComment || !project) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden agregar comentarios a un proyecto que está en historial.");
      return;
    }

    setAddingComment(true);
    setMessage("");

    try {
      const now = Timestamp.now();
      const projectRef = doc(db, "projects", project.id);

      const commentItem = {
        text: cleanComment,
        authorName: profile?.name || firebaseUser?.email || "Usuario",
        authorEmail: firebaseUser?.email || "",
        createdAt: now,
      };

      const historyItem = {
        type: "Comentario",
        title: "Comentario agregado",
        description: cleanComment,
        createdAt: now,
        createdByName: profile?.name || firebaseUser?.email || "Usuario",
        createdByEmail: firebaseUser?.email || "",
      };

      await updateDoc(projectRef, {
        comments: arrayUnion(commentItem),
        history: arrayUnion(historyItem),
        updatedAt: now,
      });

      setProject((current) => ({
        ...current,
        comments: [...normalizeArray(current?.comments), commentItem],
        history: [...normalizeArray(current?.history), historyItem],
        updatedAt: now,
      }));

      await registerProjectLog({
        type: PROJECT_LOG_TYPES.COMMENT_ADDED,
        title: "Comentario agregado",
        description: `${profile?.name || firebaseUser?.email || "Un usuario"} agregó un comentario al proyecto.`,
        metadata: {
          comment: cleanComment,
        },
      });

      setNewComment("");
      setMessage("Comentario publicado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo publicar el comentario.");
    } finally {
      setAddingComment(false);
    }
  }

  async function handleSaveInternalNotes() {
    if (!project || !isAdmin) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden modificar notas internas de un proyecto que está en historial.");
      return;
    }

    setSavingInternalNotes(true);
    setMessage("");

    try {
      const now = Timestamp.now();
      const projectRef = doc(db, "projects", project.id);

      const cleanNotes = internalNotesDraft.trim();

      const historyItem = {
        type: "Nota interna",
        title: "Notas internas actualizadas",
        description:
          "El administrador actualizó las notas internas del proyecto.",
        createdAt: now,
        createdByName: profile?.name || firebaseUser?.email || "Administrador",
        createdByEmail: firebaseUser?.email || "",
      };

      await updateDoc(projectRef, {
        internalNotes: cleanNotes,
        updatedAt: now,
        history: arrayUnion(historyItem),
      });

      setProject((current) => ({
        ...current,
        internalNotes: cleanNotes,
        updatedAt: now,
        history: [...normalizeArray(current?.history), historyItem],
      }));

      await registerProjectLog({
        type: PROJECT_LOG_TYPES.INTERNAL_NOTE_UPDATED,
        title: "Notas internas actualizadas",
        description: `${profile?.name || firebaseUser?.email || "Un administrador"} actualizó las notas internas del proyecto.`,
        metadata: {
          hasInternalNotes: Boolean(cleanNotes),
        },
      });

      setEditingInternalNotes(false);
      setMessage("Notas internas actualizadas correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron guardar las notas internas.");
    } finally {
      setSavingInternalNotes(false);
    }
  }

  const availableStatuses = isAdmin ? PROJECT_STATUSES : COLLABORATOR_STATUSES;

  const evidenceFiles = useMemo(() => {
    const allFiles = [
      ...normalizeArray(project?.evidenceFiles),
      ...normalizeArray(project?.evidences),
      ...normalizeArray(project?.evidence),
      ...normalizeArray(project?.files),
      ...normalizeArray(project?.attachments),
      ...normalizeArray(project?.attachedFiles),
      ...normalizeArray(project?.projectFiles),
      ...normalizeArray(project?.documents),
      ...normalizeArray(project?.uploadedFiles),
    ];

    return removeDuplicateFiles(allFiles.map(normalizeFileItem));
  }, [project]);

  const historyItems = useMemo(() => {
    const history = normalizeArray(project?.history);

    if (history.length > 0) {
      return history.slice().reverse();
    }

    return [
      {
        type: "Actualización",
        createdByName: project?.assignedToName || "Sistema",
        description: `Actualizó el avance del proyecto al ${Number(
          project?.progress || 0
        )}%.`,
        createdAt: project?.updatedAt || project?.createdAt,
      },
      {
        type: "Estado",
        createdByName: project?.assignedToName || "Sistema",
        description: `Estado actual: ${project?.status || "Sin estado"}.`,
        createdAt: project?.createdAt,
      },
    ];
  }, [project]);

  const formalLogItems = useMemo(() => {
    if (projectLogs.length > 0) {
      return projectLogs;
    }

    return historyItems.map((item, index) => ({
      id: `legacy-${index}`,
      type: normalizeLegacyLogType(item.type),
      title: item.title || item.type || "Actualización registrada",
      description: item.description || item.title || "Actualización registrada.",
      userName: item.createdByName || "Sistema",
      userEmail: item.createdByEmail || "",
      createdAt: item.createdAt,
      metadata: {},
      legacy: true,
    }));
  }, [projectLogs, historyItems]);

  const comments = useMemo(() => {
    return normalizeArray(project?.comments).slice().reverse();
  }, [project]);

  const internalNotes = useMemo(() => {
    return (
      project?.internalNotes ||
      project?.adminNotes ||
      project?.notesInternal ||
      project?.privateNotes ||
      project?.notes ||
      ""
    );
  }, [project]);

  useEffect(() => {
    setInternalNotesDraft(internalNotes || "");
  }, [internalNotes]);

  const daysDifference = getDaysDifference(project?.deadline);
  const projectIsHistorical = isHistoricalProject(project);
  const isClosed = CLOSED_STATUSES.includes(project?.status) || projectIsHistorical;
  const isOverdue = daysDifference !== null && daysDifference < 0 && !isClosed;

  const metrics = {
    daysLate: isOverdue ? Math.abs(daysDifference) : 0,
    progress: Number(project?.progress || 0),
    comments: comments.length,
    evidence: evidenceFiles.length,
    logs: formalLogItems.length,
  };

  if (loading) {
    return (
      <div className="visual-page">
        <div className="dashboard-loading-card">
          Cargando detalle de proyecto...
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="visual-page">
        <div className="visual-card">
          <h2>Proyecto no encontrado</h2>
          <p>No se pudo encontrar la información de este proyecto.</p>

          <button className="visual-primary-button" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="visual-page project-detail-page">
      <div className="visual-page-header">
        <div>
          <h2>Detalle de proyecto</h2>
          <p>Todos los proyectos / Detalle de proyecto</p>
        </div>

        <div className="visual-page-actions">
          {isAdmin && !projectIsHistorical && (
            <button
              className="visual-outline-button"
              onClick={() => onEditProject(project.id)}
            >
              ✎ Editar proyecto
            </button>
          )}

          <select
            className="status-change-select"
            value={project.status || ""}
            disabled={changingStatus || projectIsHistorical}
            onChange={(event) => handleStatusChange(event.target.value)}
          >
            <option value="">
              {projectIsHistorical ? "Proyecto en historial" : "Cambiar estado"}
            </option>

            {availableStatuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>

          <button className="visual-outline-button" onClick={onBack}>
            ← Volver
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}

      {projectIsHistorical && (
        <div className="history-warning-card">
          <div>
            <strong>Este proyecto está en historial</strong>
            <p>
              Este proyecto está eliminado, finalizado, terminado, cancelado o archivado.
              Por seguridad, ya no se pueden subir evidencias, cambiar estados,
              publicar comentarios ni modificar información operativa.
            </p>
          </div>
        </div>
      )}

      <section className="project-hero-strip">
        <span className="project-code">{getProjectCode(project)}</span>

        <h3>{project.title || "Proyecto sin título"}</h3>

        <div className="project-hero-badges">
          <Badge color={isOverdue ? "red" : isClosed ? "green" : "blue"}>
            {isOverdue
              ? "◷ Atrasado"
              : isClosed
              ? "✓ Cerrado"
              : project.status || "Sin estado"}
          </Badge>

          <Badge color={project.priority === "Alta" ? "red" : "gold"}>
            ⚑ {project.priority || "Sin prioridad"}
          </Badge>

          <Badge color="blue">▣ {project.responsibleArea || "Sin área"}</Badge>
        </div>
      </section>

      <div className="project-detail-layout">
        <main className="project-detail-main">
          <section className="visual-card project-summary-card">
            <ProjectSteps status={project.status} />

            <div className="project-summary-grid">
              <div className="project-summary-left">
                <div className="project-document-icon">▧</div>

                <div>
                  <h3>{project.title || "Proyecto sin título"}</h3>
                  <p>
                    {project.shortDescription ||
                      "Proyecto registrado para validar y dar seguimiento al flujo de trabajo desde la solicitud hasta el cierre."}
                  </p>
                </div>

                <div className="detail-progress-row">
                  <span>Avance general</span>

                  <div className="area-progress-track">
                    <div
                      className="area-progress-fill"
                      style={{ width: `${Number(project.progress || 0)}%` }}
                    />
                  </div>

                  <strong>{Number(project.progress || 0)}%</strong>
                </div>
              </div>

              <div className="project-summary-info">
                <InfoItem
                  label="Área responsable"
                  value={project.responsibleArea}
                />
                <InfoItem label="Solicitante" value={project.requesterName} />
                <InfoItem
                  label="Responsable del proyecto"
                  value={project.assignedToName}
                  avatar
                />
              </div>

              <div className="project-summary-info">
                <InfoItem
                  label="Fecha de creación"
                  value={formatDate(project.createdAt)}
                />
                <InfoItem
                  label="Fecha límite"
                  value={formatPlainDate(project.deadline)}
                />

                {isClosed && (
                  <InfoItem
                    label="Fecha de cierre"
                    value={formatDate(project.closedAt)}
                  />
                )}

                <div className="info-item">
                  <span>Estado actual</span>
                  <Badge color={isOverdue ? "red" : isClosed ? "green" : "blue"}>
                    {isOverdue
                      ? "Atrasado"
                      : isClosed
                      ? project.status
                      : project.status || "Sin estado"}
                  </Badge>
                </div>

                <div className="info-item">
                  <span>Prioridad</span>
                  <Badge color={project.priority === "Alta" ? "red" : "gold"}>
                    {project.priority || "Sin prioridad"}
                  </Badge>
                </div>
              </div>
            </div>
          </section>

          <section className="visual-card">
            <SectionTitle
              icon="▧"
              title="Descripción del proyecto"
              color="red"
            />

            <p className="project-description-text">
              {project.description ||
                "Este proyecto no tiene descripción registrada."}
            </p>
          </section>

          <section className="visual-card">
            <div className="section-header-with-action">
              <SectionTitle
                icon="⌘"
                title="Evidencias y archivos"
                color="blue"
                count={evidenceFiles.length}
              />

              {!projectIsHistorical && (
                <label className="upload-evidence-button">
                  ＋ {uploading ? "Subiendo..." : "Subir archivo"}
                  <input
                    type="file"
                    multiple
                    disabled={uploading || projectIsHistorical}
                    onChange={handleUploadEvidence}
                  />
                </label>
              )}
            </div>

            <div className="visual-table-wrap">
              <table className="visual-table detail-files-table">
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Tipo</th>
                    <th>Fecha de carga</th>
                    <th>Subido por</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {evidenceFiles.map((file, index) => (
                    <tr key={`${getFileName(file)}-${index}`}>
                      <td>
                        <div className="file-name-cell">
                          <span
                            className={`file-type-icon file-${getFileType(
                              file
                            )}`}
                          >
                            {getFileType(file).toUpperCase()}
                          </span>

                          <strong>{getFileName(file)}</strong>
                        </div>
                      </td>

                      <td>
                        <Badge color={getFileBadgeColor(file)}>
                          {getFileType(file).toUpperCase()}
                        </Badge>
                      </td>

                      <td>
                        {formatDate(
                          file.uploadedAt ||
                            file.createdAt ||
                            file.date ||
                            file.uploadDate
                        )}
                      </td>

                      <td>
                        <div className="collaborator-cell">
                          <span className="avatar-mini">
                            {getInitials(
                              file.uploadedByName ||
                                file.authorName ||
                                project.assignedToName ||
                                "Usuario"
                            )}
                          </span>

                          {file.uploadedByName ||
                            file.authorName ||
                            "Sin usuario"}
                        </div>
                      </td>

                      <td>
                        <div className="table-actions">
                          {getFileUrl(file) ? (
                            <>
                              <a
                                href={getFileUrl(file)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ver archivo
                              </a>

                              <a
                                href={getFileUrl(file)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Descargar
                              </a>
                            </>
                          ) : (
                            <span>Sin enlace</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {evidenceFiles.length === 0 && (
                <EmptyState text="Aún no se han subido evidencias o archivos adjuntos." />
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionTitle
              icon="☵"
              title="Comentarios del proyecto"
              color="purple"
              count={comments.length}
            />

            <form className="comment-form" onSubmit={handleAddComment}>
              <textarea
                value={newComment}
                disabled={addingComment || projectIsHistorical}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder={
                  projectIsHistorical
                    ? "Los comentarios están deshabilitados porque el proyecto está en historial."
                    : "Escribe un comentario sobre este proyecto..."
                }
                rows={4}
              />

              <div className="comment-form-actions">
                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={
                    addingComment || projectIsHistorical || !newComment.trim()
                  }
                >
                  {addingComment ? "Publicando..." : "Publicar comentario"}
                </button>
              </div>
            </form>

            {comments.length === 0 ? (
              <EmptyState text="Aún no hay comentarios publicados." small />
            ) : (
              <div className="comment-list full-comment-list">
                {comments.map((comment, index) => (
                  <div className="comment-item" key={index}>
                    <span className="avatar-mini">
                      {getInitials(comment.authorName || "Usuario")}
                    </span>

                    <div>
                      <strong>{comment.authorName || "Usuario"}</strong>
                      <p>{comment.text || comment.comment}</p>
                      <small>{formatDate(comment.createdAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="visual-card">
            <SectionTitle
              icon="◷"
              title="Bitácora formal del proyecto"
              color="blue"
              count={formalLogItems.length}
            />

            {formalLogItems.length === 0 ? (
              <EmptyState text="Aún no hay registros en la bitácora." small />
            ) : (
              <div className="project-history-list formal-log-list">
                {formalLogItems.map((item, index) => (
                  <div className="history-row formal-log-row" key={item.id || index}>
                    <span className="history-dot" />

                    <span className="avatar-mini">
                      {getInitials(getLogUserName(item))}
                    </span>

                    <strong>{getLogUserName(item)}</strong>

                    <Badge color={getProjectLogColor(item.type)}>
                      {getProjectLogLabel(item.type)}
                    </Badge>

                    <div className="formal-log-content">
                      <b>{item.title || "Actualización registrada"}</b>
                      <p>{item.description || "Actualización registrada."}</p>
                    </div>

                    <small>{formatDate(item.createdAt)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="project-detail-side">
          <section className="visual-card">
            <SectionTitle icon="👥" title="Responsables" color="blue" />

            <div className="responsible-list">
              <ResponsibleItem
                name={project.assignedToName || "Sin responsable"}
                role="Responsable del proyecto"
                badge="Responsable"
                color="blue"
              />

              {normalizeArray(project.collaboratorNames).map((name) => (
                <ResponsibleItem
                  key={name}
                  name={name}
                  role="Colaborador(a)"
                  badge="Colaborador(a)"
                  color="green"
                />
              ))}
            </div>
          </section>

          <section className="visual-card">
            <SectionTitle icon="▱" title="Indicadores" color="blue" />

            <div className="indicator-grid">
              <Indicator
                color="red"
                icon="◷"
                value={metrics.daysLate}
                label="días atrasado"
              />
              <Indicator
                color="blue"
                icon="◔"
                value={`${metrics.progress}%`}
                label="avance"
              />
              <Indicator
                color="purple"
                icon="☵"
                value={metrics.comments}
                label="comentarios"
              />
              <Indicator
                color="green"
                icon="⌘"
                value={metrics.evidence}
                label="evidencias"
              />
              <Indicator
                color="blue"
                icon="◷"
                value={metrics.logs}
                label="bitácora"
              />
            </div>
          </section>

          {isAdmin && (
            <section className="visual-card">
              <div className="section-header-with-action">
                <SectionTitle icon="✎" title="Notas internas" color="purple" />

                {!editingInternalNotes && !projectIsHistorical && (
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={() => setEditingInternalNotes(true)}
                  >
                    ✎ Editar notas
                  </button>
                )}
              </div>

              {editingInternalNotes ? (
                <div className="internal-notes-editor">
                  <textarea
                    rows={5}
                    maxLength={500}
                    value={internalNotesDraft}
                    disabled={savingInternalNotes || projectIsHistorical}
                    onChange={(event) =>
                      setInternalNotesDraft(event.target.value)
                    }
                    placeholder="Escribe aquí tus notas internas como administrador..."
                  />

                  <small className="field-counter">
                    {internalNotesDraft.length}/500
                  </small>

                  <div className="comment-form-actions">
                    <button
                      type="button"
                      className="visual-primary-button"
                      disabled={savingInternalNotes || projectIsHistorical}
                      onClick={handleSaveInternalNotes}
                    >
                      {savingInternalNotes ? "Guardando..." : "Guardar notas"}
                    </button>

                    <button
                      type="button"
                      className="visual-outline-button"
                      disabled={savingInternalNotes}
                      onClick={() => {
                        setInternalNotesDraft(internalNotes || "");
                        setEditingInternalNotes(false);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : internalNotes ? (
                <p className="project-description-text">{internalNotes}</p>
              ) : (
                <EmptyState text="No hay notas internas registradas." small />
              )}
            </section>
          )}

          <section className="visual-card">
            <SectionTitle icon="☑" title="Próximas acciones" color="blue" />

            <div className="next-actions-list">
              <ActionItem
                text="Revisar avances y evidencias del proyecto"
                date={project.updatedAt || project.createdAt}
                status="Seguimiento"
                color="blue"
              />

              <ActionItem
                text="Validar fecha límite del proyecto"
                date={project.deadline}
                status={isOverdue ? "Atrasado" : "Pendiente"}
                color={isOverdue ? "red" : "gold"}
              />

              <ActionItem
                text="Publicar comentarios cuando haya observaciones"
                date={project.updatedAt || project.createdAt}
                status="Disponible"
                color="purple"
              />

              {project.status === "Listo para revisión" && (
                <ActionItem
                  text="Realizar revisión administrativa"
                  date={project.updatedAt || project.createdAt}
                  status="Requiere revisión"
                  color="red"
                />
              )}

              {isClosed && (
                <ActionItem
                  text={`Proyecto cerrado por ${
                    project.closedByName || "administración"
                  }`}
                  date={project.closedAt}
                  status={project.status}
                  color="green"
                  done
                />
              )}
            </div>
          </section>

          <section className="visual-card">
            <SectionTitle
              icon="☵"
              title="Últimos comentarios"
              color="purple"
              count={comments.length}
            />

            {comments.length === 0 ? (
              <EmptyState text="Aún no hay comentarios." small />
            ) : (
              <div className="comment-list">
                {comments.slice(0, 3).map((comment, index) => (
                  <div className="comment-item" key={index}>
                    <span className="avatar-mini">
                      {getInitials(comment.authorName || "Usuario")}
                    </span>

                    <div>
                      <strong>{comment.authorName || "Usuario"}</strong>
                      <p>{comment.text || comment.comment}</p>
                      <small>{formatDate(comment.createdAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin &&
            !projectIsHistorical &&
            project.status === "Listo para revisión" && (
            <section className="admin-review-visual-card">
              <div>
                <h3>Revisión administrativa</h3>
                <Badge color="gold">Pendiente</Badge>
              </div>

              <p>
                Este proyecto ya fue marcado como listo para revisión. Puedes
                revisarlo, solicitar correcciones o aprobarlo para entrega.
              </p>

              <div className="visual-page-actions">
                <button
                  className="visual-outline-button"
                  disabled={changingStatus}
                  onClick={() => handleStatusChange("Correcciones solicitadas")}
                >
                  Solicitar correcciones
                </button>

                <button
                  className="visual-primary-button"
                  disabled={changingStatus}
                  onClick={() => handleStatusChange("Aprobado para entrega")}
                >
                  Aprobar entrega
                </button>
              </div>
            </section>
          )}

          {isAdmin &&
            !projectIsHistorical &&
            project.status === "Aprobado para entrega" && (
            <section className="admin-review-visual-card">
              <div>
                <h3>Cierre del proyecto</h3>
                <Badge color="blue">Aprobado</Badge>
              </div>

              <p>
                Este proyecto ya fue aprobado para entrega. Puedes finalizarlo
                cuando ya esté completamente cerrado.
              </p>

              <div className="visual-page-actions">
                <button
                  className="visual-primary-button"
                  disabled={changingStatus}
                  onClick={() => handleStatusChange("Finalizado")}
                >
                  Finalizar proyecto
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProjectSteps({ status }) {
  const steps = [
    { title: "Solicitud", completed: true },
    {
      title: "Planeación",
      completed:
        status !== "Por iniciar" &&
        status !== "En planeación" &&
        status !== "Cancelado",
      current: status === "En planeación",
    },
    {
      title: "En proceso",
      completed:
        status === "Listo para revisión" ||
        status === "Correcciones solicitadas" ||
        status === "Aprobado para entrega" ||
        status === "Finalizado",
      current:
        status === "En proceso" ||
        status === "En espera de información" ||
        status === "Correcciones solicitadas" ||
        status === "Pausado",
    },
    {
      title: "Revisión",
      completed: status === "Aprobado para entrega" || status === "Finalizado",
      current: status === "Listo para revisión",
    },
    {
      title: "Cierre",
      completed: status === "Finalizado",
      current: status === "Finalizado" || status === "Cancelado",
    },
  ];

  return (
    <div className="project-steps">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className={`project-step ${
            step.completed ? "completed" : step.current ? "current" : ""
          }`}
        >
          <span>{step.completed ? "✓" : index + 1}</span>

          <div>
            <strong>{step.title}</strong>
            <small>
              {step.completed
                ? "Completado"
                : step.current
                ? "Actual"
                : "Pendiente"}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, color, count }) {
  return (
    <div className="detail-section-title">
      <span className={`detail-section-icon detail-${color}`}>{icon}</span>
      <h3>{title}</h3>

      {typeof count === "number" && (
        <b className={`section-count section-count-${color}`}>{count}</b>
      )}
    </div>
  );
}

function InfoItem({ label, value, avatar }) {
  return (
    <div className="info-item">
      <span>{label}</span>

      {avatar ? (
        <div className="collaborator-cell">
          <span className="avatar-mini">{getInitials(value)}</span>
          <strong>{value || "Sin dato"}</strong>
        </div>
      ) : (
        <strong>{value || "Sin dato"}</strong>
      )}
    </div>
  );
}

function ResponsibleItem({ name, role, badge, color }) {
  return (
    <div className="responsible-item">
      <span className="avatar-mini">{getInitials(name)}</span>

      <div>
        <strong>{name}</strong>
        <p>{role}</p>
      </div>

      <Badge color={color}>{badge}</Badge>
    </div>
  );
}

function Indicator({ color, icon, value, label }) {
  return (
    <div className={`indicator-card indicator-${color}`}>
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function ActionItem({ text, date, status, color, done }) {
  return (
    <div className={`action-item ${done ? "done" : ""}`}>
      <span>{done ? "✓" : ""}</span>
      <p>{text}</p>
      <small>{formatPlainDate(date)}</small>
      <Badge color={color}>{status}</Badge>
    </div>
  );
}

function EmptyState({ text, small }) {
  return (
    <div className={`empty-state ${small ? "small" : ""}`}>
      <div>▯</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function normalizeArray(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object" && !value.toDate) {
    return Object.values(value);
  }

  return [];
}

function normalizeFileItem(file) {
  if (!file) return {};

  if (typeof file === "string") {
    return {
      fileName: getNameFromUrl(file),
      downloadUrl: file,
      url: file,
    };
  }

  return {
    ...file,
    fileName:
      file.fileName ||
      file.name ||
      file.originalName ||
      file.filename ||
      file.title ||
      "Archivo",
    downloadUrl:
      file.downloadUrl ||
      file.downloadURL ||
      file.url ||
      file.fileUrl ||
      file.fileURL ||
      file.link ||
      "",
    uploadedAt:
      file.uploadedAt ||
      file.createdAt ||
      file.date ||
      file.uploadDate ||
      null,
    uploadedByName:
      file.uploadedByName ||
      file.authorName ||
      file.createdByName ||
      file.userName ||
      "",
  };
}

function removeDuplicateFiles(files) {
  const seen = new Set();

  return files.filter((file) => {
    const key = `${getFileName(file)}-${getFileUrl(file)}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getInitials(name = "") {
  return String(name)
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getDaysDifference(deadline) {
  if (!deadline) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date =
    typeof deadline === "string"
      ? new Date(`${deadline}T00:00:00`)
      : deadline?.toDate?.() || new Date(deadline);

  if (Number.isNaN(date.getTime())) return null;

  date.setHours(0, 0, 0, 0);

  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  const date = value?.toDate?.() || new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPlainDate(value) {
  if (!value) return "Sin fecha";

  const date =
    typeof value === "string"
      ? new Date(`${value}T00:00:00`)
      : value?.toDate?.() || new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFileName(file) {
  return (
    file?.fileName ||
    file?.name ||
    file?.originalName ||
    file?.filename ||
    file?.title ||
    getNameFromUrl(getFileUrl(file)) ||
    "Archivo"
  );
}

function getFileUrl(file) {
  return (
    file?.downloadUrl ||
    file?.downloadURL ||
    file?.url ||
    file?.fileUrl ||
    file?.fileURL ||
    file?.link ||
    ""
  );
}

function getNameFromUrl(url = "") {
  if (!url) return "Archivo";

  try {
    const decoded = decodeURIComponent(url);
    const cleanUrl = decoded.split("?")[0];
    const parts = cleanUrl.split("/");
    const lastPart = parts[parts.length - 1];

    return lastPart || "Archivo";
  } catch {
    return "Archivo";
  }
}

function getFileType(file) {
  const fileName = getFileName(file);
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "pdf") return "pdf";
  if (extension === "xlsx" || extension === "xls") return "xlsx";

  if (
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    extension === "webp"
  ) {
    return "jpg";
  }

  if (extension === "doc" || extension === "docx") return "doc";
  if (extension === "ppt" || extension === "pptx") return "ppt";

  return "file";
}

function getFileBadgeColor(file) {
  const type = getFileType(file);

  if (type === "pdf") return "red";
  if (type === "xlsx") return "green";
  if (type === "jpg") return "gold";
  if (type === "doc") return "blue";
  if (type === "ppt") return "purple";

  return "blue";
}


function isHistoricalProject(project) {
  return (
    project?.deleted === true ||
    project?.archived === true ||
    project?.status === "Eliminado" ||
    project?.status === "Finalizado" ||
    project?.status === "Terminado" ||
    project?.status === "Cancelado" ||
    project?.status === "Archivado" ||
    Boolean(project?.deletedAt) ||
    Boolean(project?.finishedAt) ||
    Boolean(project?.cancelledAt) ||
    Boolean(project?.archivedAt)
  );
}

function normalizeLegacyLogType(type = "") {
  if (type === "Comentario") return PROJECT_LOG_TYPES.COMMENT_ADDED;
  if (type === "Archivo") return PROJECT_LOG_TYPES.EVIDENCE_UPLOADED;
  if (type === "Estado") return PROJECT_LOG_TYPES.STATUS_CHANGED;
  if (type === "Edición") return PROJECT_LOG_TYPES.PROJECT_UPDATED;
  if (type === "Nota interna") return PROJECT_LOG_TYPES.INTERNAL_NOTE_UPDATED;

  return PROJECT_LOG_TYPES.PROJECT_UPDATED;
}

function getStatusProjectLogType(status = "") {
  if (status === "Listo para revisión") return PROJECT_LOG_TYPES.REVIEW_REQUESTED;
  if (status === "Correcciones solicitadas") {
    return PROJECT_LOG_TYPES.CORRECTIONS_REQUESTED;
  }
  if (status === "Aprobado para entrega") return PROJECT_LOG_TYPES.PROJECT_APPROVED;
  if (status === "Finalizado" || status === "Terminado") {
    return PROJECT_LOG_TYPES.PROJECT_FINISHED;
  }
  if (status === "Cancelado") return PROJECT_LOG_TYPES.PROJECT_CANCELLED;
  if (status === "Eliminado") return PROJECT_LOG_TYPES.PROJECT_DELETED;

  return PROJECT_LOG_TYPES.STATUS_CHANGED;
}

function getStatusProjectLogTitle(status = "") {
  if (status === "Listo para revisión") return "Proyecto enviado a revisión";
  if (status === "Correcciones solicitadas") return "Correcciones solicitadas";
  if (status === "Aprobado para entrega") return "Proyecto aprobado";
  if (status === "Finalizado" || status === "Terminado") {
    return "Proyecto finalizado";
  }
  if (status === "Cancelado") return "Proyecto cancelado";
  if (status === "Eliminado") return "Proyecto eliminado";

  return "Cambio de estado";
}

function getProjectLogLabel(type = "") {
  const labels = {
    [PROJECT_LOG_TYPES.PROJECT_CREATED]: "Creación",
    [PROJECT_LOG_TYPES.PROJECT_UPDATED]: "Edición",
    [PROJECT_LOG_TYPES.STATUS_CHANGED]: "Estado",
    [PROJECT_LOG_TYPES.PROGRESS_CHANGED]: "Avance",
    [PROJECT_LOG_TYPES.EVIDENCE_UPLOADED]: "Evidencia",
    [PROJECT_LOG_TYPES.COMMENT_ADDED]: "Comentario",
    [PROJECT_LOG_TYPES.REVIEW_REQUESTED]: "Revisión",
    [PROJECT_LOG_TYPES.CORRECTIONS_REQUESTED]: "Correcciones",
    [PROJECT_LOG_TYPES.PROJECT_APPROVED]: "Aprobación",
    [PROJECT_LOG_TYPES.PROJECT_FINISHED]: "Finalización",
    [PROJECT_LOG_TYPES.PROJECT_CANCELLED]: "Cancelación",
    [PROJECT_LOG_TYPES.PROJECT_DELETED]: "Eliminación",
    [PROJECT_LOG_TYPES.PROJECT_RESTORED]: "Restauración",
    [PROJECT_LOG_TYPES.INTERNAL_NOTE_UPDATED]: "Nota interna",
  };

  return labels[type] || "Bitácora";
}

function getProjectLogColor(type = "") {
  if (
    type === PROJECT_LOG_TYPES.PROJECT_DELETED ||
    type === PROJECT_LOG_TYPES.PROJECT_CANCELLED ||
    type === PROJECT_LOG_TYPES.CORRECTIONS_REQUESTED
  ) {
    return "red";
  }

  if (
    type === PROJECT_LOG_TYPES.PROJECT_FINISHED ||
    type === PROJECT_LOG_TYPES.PROJECT_APPROVED ||
    type === PROJECT_LOG_TYPES.PROJECT_RESTORED
  ) {
    return "green";
  }

  if (
    type === PROJECT_LOG_TYPES.EVIDENCE_UPLOADED ||
    type === PROJECT_LOG_TYPES.INTERNAL_NOTE_UPDATED
  ) {
    return "purple";
  }

  if (
    type === PROJECT_LOG_TYPES.REVIEW_REQUESTED ||
    type === PROJECT_LOG_TYPES.STATUS_CHANGED
  ) {
    return "blue";
  }

  if (type === PROJECT_LOG_TYPES.COMMENT_ADDED) return "gold";

  return "blue";
}

function getLogUserName(log) {
  return (
    log?.userName ||
    log?.createdByName ||
    log?.userEmail ||
    log?.createdByEmail ||
    "Sistema"
  );
}

function getHistoryColor(type = "") {
  if (type === "Comentario") return "green";
  if (type === "Archivo") return "purple";
  if (type === "Estado") return "blue";
  if (type === "Edición") return "gold";
  if (type === "Nota interna") return "purple";

  return "blue";
}

function getProjectCode(project) {
  return (
    project.projectCode ||
    project.code ||
    `PRY-${project.id.slice(0, 6).toUpperCase()}`
  );
}