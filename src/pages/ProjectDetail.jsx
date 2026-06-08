import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { uploadEvidenceFile } from "../services/storageService";
import { useAuth } from "../context/AuthContext";
import {
  addProjectLog,
  getProjectLogs,
  updateEvidenceReviewStatus,
  PROJECT_LOG_TYPES,
} from "../services/projectsService";
import { calculateAutomaticProgress } from "../utils/progressUtils";

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
  const [internalNotesHistory, setInternalNotesHistory] = useState([]);
  const [loadingInternalNotes, setLoadingInternalNotes] = useState(false);
  const [reviewingEvidenceKey, setReviewingEvidenceKey] = useState("");

  const [newAdvance, setNewAdvance] = useState("");
  const [advanceFiles, setAdvanceFiles] = useState([]);
  const [publishingAdvance, setPublishingAdvance] = useState(false);
  const [activeCommentTarget, setActiveCommentTarget] = useState(null);
  const [advanceCommentDraft, setAdvanceCommentDraft] = useState("");
  const [addingAdvanceComment, setAddingAdvanceComment] = useState(false);

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

      if (isAdmin) {
        await loadInternalNotes(projectId);
      } else {
        setInternalNotesHistory([]);
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
  }, [projectId, isAdmin]);

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

  async function loadInternalNotes(targetProjectId = projectId) {
    if (!targetProjectId || !isAdmin) {
      setInternalNotesHistory([]);
      return;
    }

    setLoadingInternalNotes(true);

    try {
      const notesRef = collection(db, "projectInternalNotes");
      const notesQuery = query(notesRef, where("projectId", "==", targetProjectId));
      const snapshot = await getDocs(notesQuery);

      const notes = snapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort((a, b) => {
          const dateA = getDateObject(a.createdAt);
          const dateB = getDateObject(b.createdAt);

          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;

          return dateB.getTime() - dateA.getTime();
        });

      setInternalNotesHistory(notes);
    } catch (error) {
      console.warn("No se pudieron cargar las notas internas:", error);
      setInternalNotesHistory([]);
    } finally {
      setLoadingInternalNotes(false);
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

          // Toda evidencia nueva inicia pendiente de revisión administrativa.
          reviewStatus: uploadedFile.reviewStatus || "pending",
          reviewedAt: uploadedFile.reviewedAt || null,
          reviewedByUid: uploadedFile.reviewedByUid || "",
          reviewedByName: uploadedFile.reviewedByName || "",
          reviewedByEmail: uploadedFile.reviewedByEmail || "",
          reviewComment: uploadedFile.reviewComment || "",
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


  function handleAdvanceFilesChange(event) {
    setAdvanceFiles(Array.from(event.target.files || []));
  }

  function removeAdvanceFile(fileIndex) {
    setAdvanceFiles((current) =>
      current.filter((_, index) => index !== fileIndex)
    );
  }

  async function handlePublishAdvance(event) {
    event.preventDefault();

    const cleanAdvance = newAdvance.trim();

    if (!project || (!cleanAdvance && advanceFiles.length === 0)) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden publicar avances en un proyecto que está en historial.");
      return;
    }

    setPublishingAdvance(true);
    setMessage("");

    try {
      if (!firebaseUser?.uid) {
        throw new Error("No se encontró el UID del usuario actual.");
      }

      const now = Timestamp.now();
      const projectRef = doc(db, "projects", project.id);

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

      const uploadedItems = [];

      for (const file of advanceFiles) {
        const uploadedFile = await uploadEvidenceFile(
          project.id,
          file,
          currentUserForUpload,
          profile
        );

        uploadedItems.push({
          ...uploadedFile,
          fileName: uploadedFile.fileName || file.name,
          uploadedAt: now,
          uploadedByUid: firebaseUser.uid,
          uploadedByName: profile?.name || firebaseUser?.email || "Usuario",
          uploadedByEmail: firebaseUser?.email || "",

          // Toda evidencia nueva inicia pendiente de revisión administrativa.
          reviewStatus: uploadedFile.reviewStatus || "pending",
          reviewedAt: uploadedFile.reviewedAt || null,
          reviewedByUid: uploadedFile.reviewedByUid || "",
          reviewedByName: uploadedFile.reviewedByName || "",
          reviewedByEmail: uploadedFile.reviewedByEmail || "",
          reviewComment: uploadedFile.reviewComment || "",
        });
      }

      const advanceItem = {
        id: `advance-${Date.now()}`,
        type: "advance",
        text:
          cleanAdvance ||
          (uploadedItems.length === 1
            ? `Se adjuntó la evidencia ${uploadedItems[0].fileName}.`
            : `Se adjuntaron ${uploadedItems.length} evidencias.`),
        files: uploadedItems,
        authorUid: firebaseUser.uid,
        authorName: profile?.name || firebaseUser?.email || "Usuario",
        authorEmail: firebaseUser?.email || "",
        createdAt: now,
      };

      const historyItem = {
        type: "Avance",
        title: "Avance publicado",
        description: advanceItem.text,
        createdAt: now,
        createdByName: profile?.name || firebaseUser?.email || "Usuario",
        createdByEmail: firebaseUser?.email || "",
      };

      const updateData = {
        advances: arrayUnion(advanceItem),
        updatedAt: now,
        history: arrayUnion(historyItem),
      };

      if (uploadedItems.length > 0) {
        updateData.evidenceFiles = arrayUnion(...uploadedItems);
      }

      await updateDoc(projectRef, updateData);

      setProject((current) => ({
        ...current,
        advances: [...normalizeArray(current?.advances), advanceItem],
        evidenceFiles:
          uploadedItems.length > 0
            ? [...normalizeArray(current?.evidenceFiles), ...uploadedItems]
            : normalizeArray(current?.evidenceFiles),
        updatedAt: now,
        history: [...normalizeArray(current?.history), historyItem],
      }));

      await registerProjectLog({
        type: PROJECT_LOG_TYPES.PROGRESS_CHANGED || PROJECT_LOG_TYPES.PROJECT_UPDATED,
        title: "Avance publicado",
        description: `${profile?.name || firebaseUser?.email || "Un usuario"} publicó un avance en el proyecto.`,
        metadata: {
          advance: advanceItem.text,
          files: uploadedItems.map((item) => ({
            fileName: item.fileName || "",
            fileType: item.fileType || "",
            filePath: item.filePath || "",
          })),
        },
      });

      setNewAdvance("");
      setAdvanceFiles([]);
      setMessage("Avance publicado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage(
        error.message ||
          "No se pudo publicar el avance. Revisa permisos de Firestore y Storage."
      );
    } finally {
      setPublishingAdvance(false);
    }
  }

  async function handleAddAdvanceComment(event, targetId) {
    event.preventDefault();

    const cleanComment = advanceCommentDraft.trim();

    if (!cleanComment || !project || !targetId) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden agregar comentarios a un proyecto que está en historial.");
      return;
    }

    setAddingAdvanceComment(true);
    setMessage("");

    try {
      const now = Timestamp.now();
      const projectRef = doc(db, "projects", project.id);

      const commentItem = {
        text: cleanComment,
        authorName: profile?.name || firebaseUser?.email || "Usuario",
        authorEmail: firebaseUser?.email || "",
        createdAt: now,
        advanceId: targetId,
        context: "advance",
      };

      const historyItem = {
        type: "Comentario",
        title: "Comentario en avance",
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
        description: `${profile?.name || firebaseUser?.email || "Un usuario"} comentó un avance del proyecto.`,
        metadata: {
          comment: cleanComment,
          advanceId: targetId,
        },
      });

      setAdvanceCommentDraft("");
      setActiveCommentTarget(null);
      setMessage("Comentario publicado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo publicar el comentario.");
    } finally {
      setAddingAdvanceComment(false);
    }
  }

  async function handleReviewEvidence(file, reviewStatus) {
    if (!project || !file || !isAdmin) return;

    if (projectIsHistorical) {
      setMessage("No se puede revisar evidencia de un proyecto que está en historial.");
      return;
    }

    const evidenceKey = getEvidenceKey(file);
    setReviewingEvidenceKey(`${evidenceKey}-${reviewStatus}`);
    setMessage("");

    try {
      await updateEvidenceReviewStatus(
        project.id,
        file,
        reviewStatus,
        getCurrentUserForLog()
      );

      await loadProject();

      if (reviewStatus === "approved") {
        setMessage("Evidencia aprobada correctamente.");
      } else if (reviewStatus === "rejected") {
        setMessage("Evidencia rechazada correctamente.");
      } else {
        setMessage("La evidencia quedó pendiente de revisión.");
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "No se pudo actualizar la revisión de la evidencia.");
    } finally {
      setReviewingEvidenceKey("");
    }
  }

  async function handleSaveInternalNotes() {
    if (!project || !isAdmin) return;

    if (isHistoricalProject(project)) {
      setMessage("No se pueden agregar notas internas a un proyecto que está en historial.");
      return;
    }

    const cleanNotes = internalNotesDraft.trim();

    if (!cleanNotes) {
      setMessage("Escribe una nota interna antes de guardarla.");
      return;
    }

    setSavingInternalNotes(true);
    setMessage("");

    try {
      const now = Timestamp.now();
      const currentUser = getCurrentUserForLog();

      const noteItem = {
        projectId: project.id,
        text: cleanNotes,
        createdAt: now,
        createdByUid: currentUser.uid,
        createdByName: currentUser.name || "Administrador",
        createdByEmail: currentUser.email || "",
      };

      const noteRef = await addDoc(collection(db, "projectInternalNotes"), noteItem);

      setInternalNotesHistory((current) => [
        {
          id: noteRef.id,
          ...noteItem,
        },
        ...current,
      ]);

      setInternalNotesDraft("");
      setEditingInternalNotes(false);
      setMessage("Nota interna agregada correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo guardar la nota interna.");
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
        description: `Avance automático actual: ${calculateAutomaticProgress(
          project
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

  const advanceComments = useMemo(() => {
    return comments.filter((comment) => comment.advanceId);
  }, [comments]);

  const generalComments = useMemo(() => {
    return comments.filter((comment) => !comment.advanceId);
  }, [comments]);

  const advancesFeed = useMemo(() => {
    const registeredAdvances = normalizeArray(project?.advances).map((advance, index) => ({
      id: advance.id || `advance-${index}`,
      type: "advance",
      text: advance.text || advance.description || "Avance registrado.",
      files: removeDuplicateFiles(normalizeArray(advance.files).map(normalizeFileItem)),
      authorName:
        advance.authorName ||
        advance.createdByName ||
        advance.uploadedByName ||
        "Usuario",
      authorEmail: advance.authorEmail || advance.createdByEmail || "",
      createdAt: advance.createdAt || advance.uploadedAt || project?.updatedAt,
    }));

    const legacyEvidenceEntries = evidenceFiles.map((file, index) => ({
      id: `evidence-${getFileName(file)}-${index}`,
      type: "evidence",
      text: `Se adjuntó la evidencia ${getFileName(file)}.`,
      files: [file],
      authorName:
        file.uploadedByName ||
        file.authorName ||
        project?.assignedToName ||
        "Usuario",
      authorEmail: file.uploadedByEmail || "",
      createdAt:
        file.uploadedAt ||
        file.createdAt ||
        file.date ||
        file.uploadDate ||
        project?.updatedAt,
      legacy: true,
    }));

    const legacyCommentEntries = generalComments.map((comment, index) => ({
      id: `comment-${index}`,
      type: "comment",
      text: comment.text || comment.comment || "Comentario registrado.",
      files: [],
      authorName: comment.authorName || "Usuario",
      authorEmail: comment.authorEmail || "",
      createdAt: comment.createdAt,
      legacy: true,
    }));

    const baseItems =
      registeredAdvances.length > 0
        ? registeredAdvances
        : [...legacyEvidenceEntries, ...legacyCommentEntries];

    return baseItems
      .slice()
      .sort((a, b) => {
        const dateA = getDateObject(a.createdAt);
        const dateB = getDateObject(b.createdAt);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return dateB.getTime() - dateA.getTime();
      });
  }, [project, evidenceFiles, generalComments]);

  const legacyInternalNotes = useMemo(() => {
    return (
      project?.internalNotes ||
      project?.adminNotes ||
      project?.notesInternal ||
      project?.privateNotes ||
      ""
    );
  }, [project]);

  useEffect(() => {
    setInternalNotesDraft("");
  }, [project?.id]);

  const daysDifference = getDaysDifference(project?.deadline);
  const projectIsHistorical = isHistoricalProject(project);
  const isClosed = CLOSED_STATUSES.includes(project?.status) || projectIsHistorical;
  const isOverdue = daysDifference !== null && daysDifference < 0 && !isClosed;
  const automaticProgress = calculateAutomaticProgress(project);

  const metrics = {
    daysLate: isOverdue ? Math.abs(daysDifference) : 0,
    progress: automaticProgress,
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
    <div className="visual-page project-detail-page project-detail-redesign">
      <div className="project-detail-topline">
        <div>
          <span className="breadcrumb-line">
            Inicio / Proyectos / {getProjectCode(project)} / Detalle
          </span>

          <h2>Detalle de proyecto</h2>
          <p>
            Consulta la información general, avances, evidencias y seguimiento
            del proyecto.
          </p>
        </div>

        <div className="visual-page-actions">
          <select
            className="status-change-select status-pill-select"
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

          {isAdmin && !projectIsHistorical && (
            <button
              className="visual-outline-button"
              onClick={() => onEditProject(project.id)}
            >
              ✎ Editar proyecto
            </button>
          )}

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

      <section className="visual-card project-hero-overview">
        <div className="project-hero-content">
          <div className="project-title-area">
            <span className="project-code-badge">{getProjectCode(project)}</span>
            <div>
              <h3>{project.title || "Proyecto sin título"}</h3>
              <p>
                {project.shortDescription ||
                  "Proyecto registrado para validar y dar seguimiento al flujo de trabajo desde la solicitud hasta el cierre."}
              </p>
            </div>
          </div>

          <div className="hero-progress-area">
            <div className="hero-progress-label">
              <span>Avance general</span>
              <strong>{automaticProgress}%</strong>
            </div>

            <div className="area-progress-track">
              <div
                className="area-progress-fill"
                style={{ width: `${automaticProgress}%` }}
              />
            </div>
          </div>

          <div className="hero-meta-grid">
            <HeroMeta
              icon="●"
              label="Estado"
              value={
                isOverdue
                  ? "Atrasado"
                  : isClosed
                  ? project.status
                  : project.status || "Sin estado"
              }
              color={isOverdue ? "red" : isClosed ? "green" : "green"}
            />

            <HeroMeta
              icon="◷"
              label="Fecha límite"
              value={formatPlainDate(project.deadline)}
              color="blue"
            />

            <HeroMeta
              icon="⚑"
              label="Prioridad"
              value={project.priority || "Sin prioridad"}
              color={project.priority === "Alta" ? "red" : "gold"}
            />

            <HeroMeta
              icon="▣"
              label="Área responsable"
              value={project.responsibleArea || "Sin área"}
              color="blue"
            />
          </div>
        </div>

        <div className="project-hero-illustration" aria-hidden="true">
          <div className="illustration-board">
            <span />
            <span />
            <span />
          </div>
          <div className="illustration-plant" />
        </div>
      </section>

      <div className="project-detail-layout redesigned-detail-layout">
        <main className="project-detail-main redesigned-detail-main">
          <section className="visual-card description-focus-card">
            <div className="description-focus-icon">▧</div>

            <div>
              <SectionTitle
                icon=""
                title="Descripción del proyecto"
                color="blue"
              />

              <p className="project-description-text prominent-description">
                {project.description ||
                  "Este proyecto no tiene descripción registrada."}
              </p>
            </div>
          </section>

          <section className="visual-card advances-card">
            <div className="advances-header">
              <div>
                <SectionTitle
                  icon="↗"
                  title="Avances"
                  color="blue"
                  count={advancesFeed.length}
                />
                <p>
                  Comparte avances, adjunta evidencia y conversa con el equipo
                  desde una sola sección.
                </p>
              </div>
            </div>

            <form className="advance-composer" onSubmit={handlePublishAdvance}>
              <span className="avatar-mini advance-avatar">
                {getInitials(profile?.name || firebaseUser?.email || "Usuario")}
              </span>

              <div className="advance-composer-box">
                <textarea
                  value={newAdvance}
                  disabled={publishingAdvance || projectIsHistorical}
                  onChange={(event) => setNewAdvance(event.target.value)}
                  placeholder={
                    projectIsHistorical
                      ? "Los avances están deshabilitados porque el proyecto está en historial."
                      : "Describe tu avance..."
                  }
                  rows={3}
                />

                <div className="advance-composer-footer">
                  <label className="attach-evidence-chip">
                    ⌘ Adjuntar evidencia
                    <input
                      type="file"
                      multiple
                      disabled={publishingAdvance || projectIsHistorical}
                      onChange={handleAdvanceFilesChange}
                    />
                  </label>

                  <span className="advance-help-text">
                    PDF, DOC, XLS, PPT, imágenes (máx. 20 MB)
                  </span>

                  <button
                    type="submit"
                    className="visual-primary-button publish-advance-button"
                    disabled={
                      publishingAdvance ||
                      projectIsHistorical ||
                      (!newAdvance.trim() && advanceFiles.length === 0)
                    }
                  >
                    {publishingAdvance ? "Publicando..." : "Publicar avance"}
                  </button>
                </div>

                {advanceFiles.length > 0 && (
                  <div className="selected-advance-files">
                    {advanceFiles.map((file, index) => (
                      <button
                        type="button"
                        key={`${file.name}-${index}`}
                        onClick={() => removeAdvanceFile(index)}
                      >
                        <span>{getFileType({ fileName: file.name }).toUpperCase()}</span>
                        {file.name}
                        <b>×</b>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>

            {advancesFeed.length === 0 ? (
              <EmptyState text="Aún no hay avances, evidencias o comentarios registrados." />
            ) : (
              <div className="advance-timeline">
                {advancesFeed.map((advance) => {
                  const commentsForAdvance = advanceComments.filter(
                    (comment) => comment.advanceId === advance.id
                  );

                  return (
                    <article className="advance-item" key={advance.id}>
                      <span className="timeline-dot" />

                      <div className="advance-entry">
                        <div className="advance-entry-header">
                          <span className="avatar-mini">
                            {getInitials(advance.authorName || "Usuario")}
                          </span>

                          <div>
                            <strong>{advance.authorName || "Usuario"}</strong>
                            <div className="advance-entry-meta">
                              <small>{formatDate(advance.createdAt)}</small>
                              <Badge color={advance.type === "comment" ? "gold" : "blue"}>
                                {advance.type === "comment"
                                  ? "Comentario"
                                  : advance.type === "evidence"
                                  ? "Evidencia"
                                  : "Avance"}
                              </Badge>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="advance-comment-toggle"
                            disabled={projectIsHistorical}
                            onClick={() => {
                              setActiveCommentTarget(
                                activeCommentTarget === advance.id ? null : advance.id
                              );
                              setAdvanceCommentDraft("");
                            }}
                          >
                            Comentar
                          </button>
                        </div>

                        <p>{advance.text}</p>

                        {advance.files.length > 0 && (
                          <div className="advance-files-grid">
                            {advance.files.map((file, fileIndex) => {
                              const evidenceKey = getEvidenceKey(file);
                              const approveKey = `${evidenceKey}-approved`;
                              const rejectKey = `${evidenceKey}-rejected`;
                              const pendingKey = `${evidenceKey}-pending`;

                              return (
                                <div
                                  key={`${getFileName(file)}-${fileIndex}`}
                                  className="advance-file-review-card"
                                >
                                  <a
                                    href={getFileUrl(file)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="advance-file-chip"
                                  >
                                    <span
                                      className={`file-type-icon file-${getFileType(file)}`}
                                    >
                                      {getFileType(file).toUpperCase()}
                                    </span>

                                    <div>
                                      <strong>{getFileName(file)}</strong>
                                      <small>{getFileUrl(file) ? "Abrir archivo" : "Sin enlace"}</small>
                                    </div>
                                  </a>

                                  <div className="evidence-review-footer">
                                    <Badge color={getEvidenceReviewBadgeColor(file.reviewStatus)}>
                                      {getEvidenceReviewLabel(file.reviewStatus)}
                                    </Badge>

                                    {file.reviewedByName && (
                                      <small className="evidence-review-meta">
                                        Revisó: {file.reviewedByName}
                                      </small>
                                    )}
                                  </div>

                                  {isAdmin && !projectIsHistorical && (
                                    <div className="evidence-review-actions">
                                      <button
                                        type="button"
                                        className="evidence-review-button evidence-approve-button"
                                        disabled={reviewingEvidenceKey === approveKey}
                                        onClick={() =>
                                          handleReviewEvidence(file, "approved")
                                        }
                                      >
                                        {reviewingEvidenceKey === approveKey
                                          ? "Aprobando..."
                                          : "Aprobar"}
                                      </button>

                                      <button
                                        type="button"
                                        className="evidence-review-button evidence-reject-button"
                                        disabled={reviewingEvidenceKey === rejectKey}
                                        onClick={() =>
                                          handleReviewEvidence(file, "rejected")
                                        }
                                      >
                                        {reviewingEvidenceKey === rejectKey
                                          ? "Rechazando..."
                                          : "Rechazar"}
                                      </button>

                                      <button
                                        type="button"
                                        className="evidence-review-button evidence-pending-button"
                                        disabled={reviewingEvidenceKey === pendingKey}
                                        onClick={() =>
                                          handleReviewEvidence(file, "pending")
                                        }
                                      >
                                        {reviewingEvidenceKey === pendingKey
                                          ? "Actualizando..."
                                          : "Pendiente"}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="advance-entry-actions">
                          <span>☵ {commentsForAdvance.length} comentario(s)</span>
                        </div>

                        {activeCommentTarget === advance.id && (
                          <form
                            className="advance-comment-form"
                            onSubmit={(event) =>
                              handleAddAdvanceComment(event, advance.id)
                            }
                          >
                            <textarea
                              rows={2}
                              value={advanceCommentDraft}
                              disabled={addingAdvanceComment || projectIsHistorical}
                              onChange={(event) =>
                                setAdvanceCommentDraft(event.target.value)
                              }
                              placeholder="Escribe un comentario sobre este avance..."
                            />

                            <div>
                              <button
                                type="submit"
                                className="visual-primary-button"
                                disabled={
                                  addingAdvanceComment ||
                                  projectIsHistorical ||
                                  !advanceCommentDraft.trim()
                                }
                              >
                                {addingAdvanceComment ? "Publicando..." : "Publicar comentario"}
                              </button>
                            </div>
                          </form>
                        )}

                        {commentsForAdvance.length > 0 && (
                          <div className="advance-comments-list">
                            {commentsForAdvance.map((comment, index) => (
                              <div className="advance-comment" key={index}>
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
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="visual-card formal-log-card">
            <SectionTitle
              icon="◷"
              title="Bitácora formal del proyecto"
              color="blue"
              count={formalLogItems.length}
            />

            {formalLogItems.length === 0 ? (
              <EmptyState text="Aún no hay registros en la bitácora." small />
            ) : (
              <div className="formal-log-table">
                <div className="formal-log-table-head">
                  <span>Fecha y hora</span>
                  <span>Tipo</span>
                  <span>Descripción</span>
                  <span>Registrado por</span>
                </div>

                {formalLogItems.slice(0, 6).map((item, index) => (
                  <div className="formal-log-table-row" key={item.id || index}>
                    <span>{formatDate(item.createdAt)}</span>

                    <Badge color={getProjectLogColor(item.type)}>
                      {getProjectLogLabel(item.type)}
                    </Badge>

                    <p>{item.description || item.title || "Actualización registrada."}</p>

                    <strong>{getLogUserName(item)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="project-detail-side redesigned-detail-side">
          <section className="visual-card side-compact-card">
            <div className="side-card-title-row">
              <SectionTitle icon="👥" title="Responsables" color="blue" />
            </div>

            <div className="responsible-list">
              <ResponsibleItem
                name={project.assignedToName || "Sin responsable"}
                role="Líder del proyecto"
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

          <section className="visual-card side-compact-card">
            <SectionTitle icon="▱" title="Indicadores" color="blue" />

            <div className="indicator-grid redesigned-indicator-grid">
              <Indicator
                color={isOverdue ? "red" : "blue"}
                icon="◷"
                value={
                  daysDifference === null
                    ? "—"
                    : isOverdue
                    ? Math.abs(daysDifference)
                    : daysDifference
                }
                label={isOverdue ? "días vencido" : "días restantes"}
              />
              <Indicator
                color="blue"
                icon="◔"
                value={`${metrics.progress}%`}
                label="avance general"
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
            </div>
          </section>

          {isAdmin && (
            <section className="visual-card side-compact-card internal-notes-admin-card">
              <div className="section-header-with-action compact-action-header">
                <SectionTitle icon="✎" title="Notas internas" color="purple" />

                {!editingInternalNotes && !projectIsHistorical && (
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={() => {
                      setInternalNotesDraft("");
                      setEditingInternalNotes(true);
                    }}
                  >
                    Nueva nota
                  </button>
                )}
              </div>

              <p className="internal-notes-admin-help">
                Solo visible para administradores.
              </p>

              {editingInternalNotes && (
                <div className="internal-notes-editor">
                  <textarea
                    rows={5}
                    maxLength={500}
                    value={internalNotesDraft}
                    disabled={savingInternalNotes || projectIsHistorical}
                    onChange={(event) =>
                      setInternalNotesDraft(event.target.value)
                    }
                    placeholder="Escribe aquí una nota interna para administración..."
                  />

                  <small className="field-counter">
                    {internalNotesDraft.length}/500
                  </small>

                  <div className="comment-form-actions">
                    <button
                      type="button"
                      className="visual-primary-button"
                      disabled={
                        savingInternalNotes ||
                        projectIsHistorical ||
                        !internalNotesDraft.trim()
                      }
                      onClick={handleSaveInternalNotes}
                    >
                      {savingInternalNotes ? "Guardando..." : "Guardar nota"}
                    </button>

                    <button
                      type="button"
                      className="visual-outline-button"
                      disabled={savingInternalNotes}
                      onClick={() => {
                        setInternalNotesDraft("");
                        setEditingInternalNotes(false);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="internal-notes-history">
                <div className="internal-notes-history-header">
                  <strong>Historial interno</strong>
                  <span>{internalNotesHistory.length} nota(s)</span>
                </div>

                {loadingInternalNotes ? (
                  <div className="internal-note-loading">
                    Cargando notas internas...
                  </div>
                ) : internalNotesHistory.length > 0 ? (
                  internalNotesHistory.map((note) => (
                    <article className="internal-note-history-item" key={note.id}>
                      <div className="internal-note-history-top">
                        <span className="avatar-mini">
                          {getInitials(
                            note.createdByName ||
                              note.createdByEmail ||
                              "Administrador"
                          )}
                        </span>
                        <div>
                          <strong>
                            {note.createdByName ||
                              note.createdByEmail ||
                              "Administrador"}
                          </strong>
                          <small>{formatDate(note.createdAt)}</small>
                        </div>
                      </div>

                      <p>{note.text}</p>
                    </article>
                  ))
                ) : legacyInternalNotes ? (
                  <article className="internal-note-history-item legacy-internal-note">
                    <div className="internal-note-history-top">
                      <span className="legacy-note-icon">▤</span>
                      <div>
                        <strong>Nota heredada</strong>
                        <small>Guardada antes del historial interno</small>
                      </div>
                    </div>

                    <p>{legacyInternalNotes}</p>
                  </article>
                ) : (
                  <EmptyState text="No hay notas internas registradas." small />
                )}
              </div>
            </section>
          )}

          <section className="visual-card side-compact-card">
            <SectionTitle icon="☑" title="Próximas acciones" color="blue" />

            <div className="next-actions-list">
              <ActionItem
                text="Revisar avances recientes del proyecto"
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
                text="Comentar observaciones del equipo"
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

          <section className="visual-card side-compact-card">
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


function HeroMeta({ icon, label, value, color }) {
  return (
    <div className="hero-meta-item">
      <span className={`hero-meta-icon hero-meta-${color}`}>{icon}</span>

      <div>
        <small>{label}</small>
        <strong>{value || "Sin dato"}</strong>
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


function getDateObject(value) {
  if (!value) return null;

  const date =
    typeof value === "string"
      ? new Date(value.includes("T") ? value : `${value}T00:00:00`)
      : value?.toDate?.() || new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
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

function normalizeText(value) {
  if (!value) return "";

  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getEvidenceKey(file) {
  if (!file) return "evidence";

  return (
    file.filePath ||
    file.downloadUrl ||
    file.downloadURL ||
    file.url ||
    file.fileUrl ||
    file.fileURL ||
    file.fileName ||
    file.name ||
    "evidence"
  );
}

function getEvidenceReviewLabel(status) {
  const normalizedStatus = normalizeText(status);

  if (normalizedStatus === "approved" || normalizedStatus === "aprobado") {
    return "Aprobada";
  }

  if (normalizedStatus === "rejected" || normalizedStatus === "rechazado") {
    return "Rechazada";
  }

  return "Pendiente de revisión";
}

function getEvidenceReviewBadgeColor(status) {
  const normalizedStatus = normalizeText(status);

  if (normalizedStatus === "approved" || normalizedStatus === "aprobado") {
    return "green";
  }

  if (normalizedStatus === "rejected" || normalizedStatus === "rechazado") {
    return "red";
  }

  return "gold";
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