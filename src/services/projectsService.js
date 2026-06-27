import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const PROJECTS_COLLECTION = "projects";
const UPDATES_COLLECTION = "projectUpdates";
const EVIDENCE_COLLECTION = "evidence";
const PROJECT_LOGS_COLLECTION = "projectLogs";

export const PROJECT_STATUS = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En proceso",
  READY_FOR_REVIEW: "Listo para revisión",
  FINISHED: "Finalizado",
  CANCELLED: "Cancelado",
  DELETED: "Eliminado",
};

export const PROJECT_LOG_TYPES = {
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_UPDATED: "PROJECT_UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  PROGRESS_CHANGED: "PROGRESS_CHANGED",
  EVIDENCE_UPLOADED: "EVIDENCE_UPLOADED",
  EVIDENCE_REVIEWED: "EVIDENCE_REVIEWED",
  COMMENT_ADDED: "COMMENT_ADDED",
  REVIEW_REQUESTED: "REVIEW_REQUESTED",
  CORRECTIONS_REQUESTED: "CORRECTIONS_REQUESTED",
  PROJECT_APPROVED: "PROJECT_APPROVED",
  PROJECT_FINISHED: "PROJECT_FINISHED",
  PROJECT_CANCELLED: "PROJECT_CANCELLED",
  PROJECT_DELETED: "PROJECT_DELETED",
  PROJECT_RESTORED: "PROJECT_RESTORED",
  INTERNAL_NOTE_UPDATED: "INTERNAL_NOTE_UPDATED",
};

function getCurrentUserUid(currentUser) {
  return currentUser?.uid || currentUser?.id || "";
}

function isAdmin(currentUser) {
  return currentUser?.role === "admin";
}

function isActiveUser(currentUser) {
  return currentUser?.active === true;
}

function requireActiveUser(currentUser) {
  if (!getCurrentUserUid(currentUser)) {
    throw new Error("No se encontró el UID del usuario actual.");
  }

  if (!isActiveUser(currentUser)) {
    throw new Error("Tu usuario no está activo.");
  }
}

function requireAdmin(currentUser) {
  requireActiveUser(currentUser);

  if (!isAdmin(currentUser)) {
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

function getUserAuditData(currentUser) {
  return {
    uid: getCurrentUserUid(currentUser),
    email: currentUser?.email || "",
    name: currentUser?.name || "",
  };
}

function isProjectDeleted(project) {
  return project?.deleted === true || project?.status === PROJECT_STATUS.DELETED;
}

function isProjectFinished(project) {
  return (
    project?.status === PROJECT_STATUS.FINISHED ||
    project?.status === "Terminado" ||
    project?.status === "terminado" ||
    Boolean(project?.closedAt) ||
    Boolean(project?.finishedAt)
  );
}

function isProjectCancelled(project) {
  return (
    project?.status === PROJECT_STATUS.CANCELLED ||
    project?.status === "Cancelado" ||
    project?.status === "cancelado" ||
    Boolean(project?.cancelledAt)
  );
}

function isHistoricalProject(project) {
  return (
    isProjectDeleted(project) ||
    isProjectFinished(project) ||
    isProjectCancelled(project) ||
    project?.archived === true ||
    project?.status === "Archivado"
  );
}

function canAccessProject(project, currentUser) {
  const uid = getCurrentUserUid(currentUser);

  if (!uid || !project || !isActiveUser(currentUser)) {
    return false;
  }

  if (isAdmin(currentUser)) {
    return true;
  }

  return (
    project.createdByUid === uid ||
    project.assignedToUid === uid ||
    project.assignedToId === uid ||
    (Array.isArray(project.collaboratorIds) &&
      project.collaboratorIds.includes(uid))
  );
}

function canUpdateProject(project, currentUser) {
  const uid = getCurrentUserUid(currentUser);

  if (!uid || !project || !isActiveUser(currentUser)) {
    return false;
  }

  if (isAdmin(currentUser)) {
    return true;
  }

  if (isHistoricalProject(project)) {
    return false;
  }

  return (
    project.assignedToUid === uid ||
    project.assignedToId === uid ||
    (Array.isArray(project.collaboratorIds) &&
      project.collaboratorIds.includes(uid))
  );
}

function sortByCreatedAtDesc(projects) {
  return [...projects].sort((a, b) => {
    const aSeconds = a.createdAt?.seconds || 0;
    const bSeconds = b.createdAt?.seconds || 0;

    return bSeconds - aSeconds;
  });
}

function sortByDeadlineAsc(projects) {
  return [...projects].sort((a, b) => {
    const aDeadline = a.deadline || "";
    const bDeadline = b.deadline || "";

    return String(aDeadline).localeCompare(String(bDeadline));
  });
}

function removeDuplicatedProjects(projects) {
  const projectsMap = new Map();

  projects.forEach((project) => {
    projectsMap.set(project.id, project);
  });

  return Array.from(projectsMap.values());
}

function getStatusLogType(newStatus) {
  if (newStatus === "Listo para revisión") {
    return PROJECT_LOG_TYPES.REVIEW_REQUESTED;
  }

  if (newStatus === "Correcciones solicitadas") {
    return PROJECT_LOG_TYPES.CORRECTIONS_REQUESTED;
  }

  if (newStatus === "Aprobado para entrega") {
    return PROJECT_LOG_TYPES.PROJECT_APPROVED;
  }

  if (
    newStatus === PROJECT_STATUS.FINISHED ||
    newStatus === "Terminado" ||
    newStatus === "terminado"
  ) {
    return PROJECT_LOG_TYPES.PROJECT_FINISHED;
  }

  if (
    newStatus === PROJECT_STATUS.CANCELLED ||
    newStatus === "cancelado" ||
    newStatus === "Cancelado"
  ) {
    return PROJECT_LOG_TYPES.PROJECT_CANCELLED;
  }

  if (newStatus === PROJECT_STATUS.DELETED) {
    return PROJECT_LOG_TYPES.PROJECT_DELETED;
  }

  return PROJECT_LOG_TYPES.STATUS_CHANGED;
}

function parseProjectDate(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameMonthAndYear(value, referenceDate = new Date()) {
  const date = parseProjectDate(value);

  if (!date) return false;

  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth()
  );
}

function getDaysDifference(deadline) {
  const date = parseProjectDate(deadline);

  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  date.setHours(0, 0, 0, 0);

  const diff = date.getTime() - today.getTime();

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isProjectOverdue(project) {
  const days = getDaysDifference(project?.deadline);

  return days !== null && days < 0 && !isHistoricalProject(project);
}

function isProjectReadyForReview(project) {
  return project?.status === PROJECT_STATUS.READY_FOR_REVIEW;
}

function isProjectHighPriority(project) {
  return project?.priority === "Alta" && !isHistoricalProject(project);
}

function getProjectClosedDate(project) {
  return (
    project?.finishedAt ||
    project?.cancelledAt ||
    project?.deletedAt ||
    project?.archivedAt ||
    project?.closedAt ||
    project?.updatedAt ||
    project?.createdAt
  );
}

function isProjectStale(project, staleDays = 7) {
  if (isHistoricalProject(project)) return false;

  const updatedDate = parseProjectDate(project?.updatedAt || project?.createdAt);

  if (!updatedDate) return false;

  const now = new Date();
  const diff = now.getTime() - updatedDate.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  return days >= staleDays;
}

function buildWorkloadByResponsible(projects) {
  const map = new Map();

  projects.forEach((project) => {
    const responsible = project.assignedToName || "Sin responsable";

    if (!map.has(responsible)) {
      map.set(responsible, {
        responsible,
        active: 0,
        review: 0,
        overdue: 0,
        highPriority: 0,
        averageProgress: 0,
        progressTotal: 0,
      });
    }

    const item = map.get(responsible);

    item.active += 1;
    item.progressTotal += Number(project.progress || 0);

    if (isProjectReadyForReview(project)) item.review += 1;
    if (isProjectOverdue(project)) item.overdue += 1;
    if (isProjectHighPriority(project)) item.highPriority += 1;

    item.averageProgress =
      item.active === 0 ? 0 : Math.round(item.progressTotal / item.active);
  });

  return Array.from(map.values())
    .map((item) => ({
      responsible: item.responsible,
      active: item.active,
      review: item.review,
      overdue: item.overdue,
      highPriority: item.highPriority,
      averageProgress: item.averageProgress,
    }))
    .sort((a, b) => b.active - a.active || b.overdue - a.overdue);
}

function buildWorkloadByArea(projects) {
  const map = new Map();

  projects.forEach((project) => {
    const area =
      project.departmentName ||
      project.responsibleDepartmentName ||
      project.responsibleArea ||
      "Sin área";

    if (!map.has(area)) {
      map.set(area, {
        area,
        active: 0,
        review: 0,
        overdue: 0,
        highPriority: 0,
        averageProgress: 0,
        progressTotal: 0,
      });
    }

    const item = map.get(area);

    item.active += 1;
    item.progressTotal += Number(project.progress || 0);

    if (isProjectReadyForReview(project)) item.review += 1;
    if (isProjectOverdue(project)) item.overdue += 1;
    if (isProjectHighPriority(project)) item.highPriority += 1;

    item.averageProgress =
      item.active === 0 ? 0 : Math.round(item.progressTotal / item.active);
  });

  return Array.from(map.values())
    .map((item) => ({
      area: item.area,
      active: item.active,
      review: item.review,
      overdue: item.overdue,
      highPriority: item.highPriority,
      averageProgress: item.averageProgress,
    }))
    .sort((a, b) => b.active - a.active || b.overdue - a.overdue);
}

function buildExecutiveAlerts(projects) {
  const activeProjects = projects.filter((project) => !isHistoricalProject(project));

  const overdueProjects = activeProjects.filter(isProjectOverdue);
  const reviewProjects = activeProjects.filter(isProjectReadyForReview);
  const highPriorityProjects = activeProjects.filter(isProjectHighPriority);
  const staleProjects = activeProjects.filter((project) =>
    isProjectStale(project, 7)
  );
  const noEvidenceProjects = activeProjects.filter((project) => {
    return (
      !Array.isArray(project.evidenceFiles) ||
      project.evidenceFiles.length === 0
    );
  });

  return [
    {
      type: "overdue",
      level: overdueProjects.length > 0 ? "danger" : "ok",
      title: `${overdueProjects.length} proyectos atrasados`,
      detail: "Proyectos activos con fecha límite vencida.",
      projects: overdueProjects.slice(0, 5),
    },
    {
      type: "review",
      level: reviewProjects.length > 0 ? "warning" : "ok",
      title: `${reviewProjects.length} proyectos listos para revisión`,
      detail: "Requieren revisión administrativa.",
      projects: reviewProjects.slice(0, 5),
    },
    {
      type: "highPriority",
      level: highPriorityProjects.length > 0 ? "warning" : "ok",
      title: `${highPriorityProjects.length} proyectos de alta prioridad`,
      detail: "Prioridades activas que conviene monitorear.",
      projects: highPriorityProjects.slice(0, 5),
    },
    {
      type: "stale",
      level: staleProjects.length > 0 ? "warning" : "ok",
      title: `${staleProjects.length} proyectos sin actualización reciente`,
      detail: "Proyectos activos con 7 días o más sin movimientos.",
      projects: staleProjects.slice(0, 5),
    },
    {
      type: "noEvidence",
      level: noEvidenceProjects.length > 0 ? "info" : "ok",
      title: `${noEvidenceProjects.length} proyectos sin evidencia`,
      detail: "Proyectos activos que todavía no tienen evidencia registrada.",
      projects: noEvidenceProjects.slice(0, 5),
    },
  ];
}

function countLogsByType(logs, type) {
  return logs.filter((log) => log.type === type).length;
}

function getEvidenceIdentity(evidence) {
  if (!evidence) return "";

  return (
    evidence.id ||
    evidence.evidenceId ||
    evidence.filePath ||
    evidence.downloadUrl ||
    evidence.fileName ||
    evidence.name ||
    ""
  );
}

function normalizeEvidenceTarget(targetEvidence) {
  if (typeof targetEvidence === "number") {
    return {
      index: targetEvidence,
      identity: "",
    };
  }

  if (typeof targetEvidence === "string") {
    return {
      index: null,
      identity: targetEvidence,
    };
  }

  return {
    index:
      typeof targetEvidence?.index === "number"
        ? targetEvidence.index
        : typeof targetEvidence?.evidenceIndex === "number"
        ? targetEvidence.evidenceIndex
        : null,
    identity: getEvidenceIdentity(targetEvidence),
  };
}

function updateEvidenceListReviewStatus(list, targetEvidence, reviewData) {
  if (!Array.isArray(list)) {
    return list;
  }

  const target = normalizeEvidenceTarget(targetEvidence);

  return list.map((item, index) => {
    const itemIdentity = getEvidenceIdentity(item);

    const matchesByIndex = target.index !== null && index === target.index;
    const matchesByIdentity =
      target.identity && itemIdentity && target.identity === itemIdentity;

    if (!matchesByIndex && !matchesByIdentity) {
      return item;
    }

    return {
      ...item,
      ...reviewData,
    };
  });
}

function findEvidenceInProject(project, targetEvidence) {
  const target = normalizeEvidenceTarget(targetEvidence);

  const evidenceCollections = [
    project?.evidenceFiles,
    project?.evidences,
    project?.evidence,
    project?.files,
    project?.attachments,
  ];

  for (const list of evidenceCollections) {
    if (!Array.isArray(list)) continue;

    if (target.index !== null && list[target.index]) {
      return list[target.index];
    }

    const found = list.find((item) => {
      const itemIdentity = getEvidenceIdentity(item);
      return target.identity && itemIdentity && target.identity === itemIdentity;
    });

    if (found) return found;
  }

  if (Array.isArray(project?.advances)) {
    for (const advance of project.advances) {
      const files = Array.isArray(advance.files) ? advance.files : [];

      if (target.index !== null && files[target.index]) {
        return files[target.index];
      }

      const found = files.find((item) => {
        const itemIdentity = getEvidenceIdentity(item);
        return target.identity && itemIdentity && target.identity === itemIdentity;
      });

      if (found) return found;
    }
  }

  return null;
}

function updateEvidenceReviewInAdvances(advances, targetEvidence, reviewData) {
  if (!Array.isArray(advances)) {
    return advances;
  }

  const target = normalizeEvidenceTarget(targetEvidence);

  return advances.map((advance) => {
    if (!Array.isArray(advance.files)) {
      return advance;
    }

    return {
      ...advance,
      files: advance.files.map((file, index) => {
        const fileIdentity = getEvidenceIdentity(file);

        const matchesByIndex = target.index !== null && index === target.index;
        const matchesByIdentity =
          target.identity && fileIdentity && target.identity === fileIdentity;

        if (!matchesByIndex && !matchesByIdentity) {
          return file;
        }

        return {
          ...file,
          ...reviewData,
        };
      }),
    };
  });
}

export async function addProjectLog({
  projectId,
  type,
  title,
  description,
  currentUser,
  metadata = {},
}) {
  if (!projectId) {
    throw new Error("Falta el ID del proyecto para registrar la bitácora.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const logsRef = collection(db, PROJECT_LOGS_COLLECTION);

  await addDoc(logsRef, {
    projectId,
    type,
    title,
    description,
    userUid: userAuditData.uid,
    userEmail: userAuditData.email,
    userName: userAuditData.name,
    metadata,
    createdAt: serverTimestamp(),
  });
}

export async function getProjectLogs(projectId) {
  if (!projectId) {
    return [];
  }

  const logsRef = collection(db, PROJECT_LOGS_COLLECTION);

  const q = query(
    logsRef,
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getRecentProjectLogs(logLimit = 20) {
  const logsRef = collection(db, PROJECT_LOGS_COLLECTION);

  const q = query(logsRef, orderBy("createdAt", "desc"), limit(logLimit));

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createProject(projectData, currentUser) {
  const currentUserUid = getCurrentUserUid(currentUser);

  if (!currentUserUid) {
    throw new Error("No se encontró el UID del usuario actual.");
  }

  if (!isActiveUser(currentUser)) {
    throw new Error("Tu usuario no está activo.");
  }

  if (!isAdmin(currentUser)) {
    throw new Error("No tienes permiso para crear proyectos.");
  }

  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const docRef = await addDoc(projectsRef, {
    ...projectData,

    progress: Number(projectData.progress || 0),

    departmentId: projectData.departmentId || projectData.responsibleDepartmentId || "",
    departmentName:
      projectData.departmentName ||
      projectData.responsibleDepartmentName ||
      projectData.responsibleArea ||
      "",
    responsibleDepartmentId:
      projectData.responsibleDepartmentId || projectData.departmentId || "",
    responsibleDepartmentName:
      projectData.responsibleDepartmentName ||
      projectData.departmentName ||
      projectData.responsibleArea ||
      "",

    createdByUid: currentUserUid,
    createdByEmail: currentUser.email || "",
    createdByName: currentUser.name || "",

    assignedToUid: projectData.assignedToUid || projectData.assignedToId || "",
    assignedToId: projectData.assignedToId || projectData.assignedToUid || "",
    assignedToEmail: projectData.assignedToEmail || "",
    assignedToName: projectData.assignedToName || "",

    deleted: false,
    deletedAt: null,
    deletedByUid: "",
    deletedByEmail: "",
    deletedByName: "",

    finishedAt: null,
    finishedByUid: "",
    finishedByEmail: "",
    finishedByName: "",

    cancelledAt: null,
    cancelledByUid: "",
    cancelledByEmail: "",
    cancelledByName: "",

    archived: false,
    archivedAt: null,
    archivedByUid: "",
    archivedByEmail: "",
    archivedByName: "",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
  });

  await addProjectUpdate({
    projectId: docRef.id,

    userUid: currentUserUid,
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",

    oldStatus: "",
    newStatus: projectData.status,
    progress: Number(projectData.progress || 0),
    comment: "Proyecto creado, aprobado y asignado.",
  });

  await addProjectLog({
    projectId: docRef.id,
    type: PROJECT_LOG_TYPES.PROJECT_CREATED,
    title: "Proyecto creado",
    description: `${
      currentUser.name || currentUser.email || "Un administrador"
    } creó el proyecto.`,
    currentUser,
    metadata: {
      status: projectData.status || "",
      progress: Number(projectData.progress || 0),
      assignedToName: projectData.assignedToName || "",
      responsibleArea: projectData.responsibleArea || "",
      departmentId: projectData.departmentId || "",
      departmentName: projectData.departmentName || "",
      priority: projectData.priority || "",
    },
  });

  return docRef.id;
}

export async function getAllProjects() {
  const projectsRef = collection(db, PROJECTS_COLLECTION);
  const q = query(projectsRef, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getActiveProjects() {
  const projects = await getAllProjects();

  return projects.filter((project) => !isHistoricalProject(project));
}

export async function getProjectHistory() {
  const projects = await getAllProjects();

  return projects.filter((project) => isHistoricalProject(project));
}

export async function getProjectsAssignedTo(uid) {
  if (!uid) {
    return [];
  }

  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const q = query(
    projectsRef,
    where("assignedToUid", "==", uid),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getProjectsCreatedBy(uid) {
  if (!uid) {
    return [];
  }

  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const q = query(
    projectsRef,
    where("createdByUid", "==", uid),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getVisibleProjects(currentUser) {
  const currentUserUid = getCurrentUserUid(currentUser);

  if (!currentUserUid || !isActiveUser(currentUser)) {
    return [];
  }

  if (isAdmin(currentUser)) {
    return getActiveProjects();
  }

  const assignedProjects = await getProjectsAssignedTo(currentUserUid);
  const createdProjects = await getProjectsCreatedBy(currentUserUid);

  const projects = removeDuplicatedProjects([
    ...assignedProjects,
    ...createdProjects,
  ]);

  const activeProjects = projects.filter(
    (project) => !isHistoricalProject(project)
  );

  return sortByCreatedAtDesc(activeProjects);
}

export async function getProjectsAssignedToEmail(email) {
  if (!email) {
    return [];
  }

  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const q = query(
    projectsRef,
    where("assignedToEmail", "==", email),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getProjectById(projectId) {
  if (!projectId) {
    throw new Error("Falta el ID del proyecto.");
  }

  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
  const snapshot = await getDoc(projectRef);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function getProjectByIdForUser(projectId, currentUser) {
  const project = await getProjectById(projectId);

  if (!project) {
    return null;
  }

  if (!canAccessProject(project, currentUser)) {
    throw new Error("No tienes permiso para ver este proyecto.");
  }

  return project;
}

export async function updateProjectStatus(projectId, updateData, currentUser) {
  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  if (!canUpdateProject(project, currentUser)) {
    throw new Error("No tienes permiso para actualizar este proyecto.");
  }

  const currentUserUid = getCurrentUserUid(currentUser);
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  const newStatus = updateData.status;
  const newProgress = Number(updateData.progress || 0);

  const shouldCloseProject =
    newStatus === PROJECT_STATUS.FINISHED ||
    newStatus === "Terminado" ||
    newStatus === "terminado" ||
    newStatus === "Finalizado";

  await updateDoc(projectRef, {
    status: newStatus,
    progress: shouldCloseProject ? 100 : newProgress,
    updatedAt: serverTimestamp(),
    ...(shouldCloseProject
      ? {
          closedAt: serverTimestamp(),
          finishedAt: serverTimestamp(),
          finishedByUid: currentUserUid,
          finishedByEmail: currentUser.email || "",
          finishedByName: currentUser.name || "",
        }
      : {}),
  });

  await addProjectUpdate({
    projectId,
    userUid: currentUserUid,
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",
    oldStatus: project.status,
    newStatus,
    progress: shouldCloseProject ? 100 : newProgress,
    comment: updateData.comment || "",
  });

  await addProjectLog({
    projectId,
    type: getStatusLogType(newStatus),
    title: "Cambio de estado",
    description: `${
      currentUser.name || currentUser.email || "Un usuario"
    } cambió el estado de "${project.status || "Sin estado"}" a "${newStatus}".`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus,
      oldProgress: Number(project.progress || 0),
      newProgress: shouldCloseProject ? 100 : newProgress,
      comment: updateData.comment || "",
    },
  });
}

export async function softDeleteProject(projectId, currentUser) {
  requireAdmin(currentUser);

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  if (isProjectDeleted(project)) {
    throw new Error("Este proyecto ya está eliminado.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  await updateDoc(projectRef, {
    status: PROJECT_STATUS.DELETED,
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedByUid: userAuditData.uid,
    deletedByEmail: userAuditData.email,
    deletedByName: userAuditData.name,
    updatedAt: serverTimestamp(),
  });

  await addProjectUpdate({
    projectId,
    userUid: userAuditData.uid,
    userEmail: userAuditData.email,
    userName: userAuditData.name,
    oldStatus: project.status || "",
    newStatus: PROJECT_STATUS.DELETED,
    progress: Number(project.progress || 0),
    comment:
      "El administrador eliminó el proyecto. El proyecto fue movido al historial.",
  });

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.PROJECT_DELETED,
    title: "Proyecto eliminado",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } eliminó el proyecto y lo movió al historial.`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus: PROJECT_STATUS.DELETED,
      progress: Number(project.progress || 0),
    },
  });
}

export async function restoreProject(projectId, currentUser) {
  requireAdmin(currentUser);

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  const restoredStatus = PROJECT_STATUS.PENDING;

  await updateDoc(projectRef, {
    status: restoredStatus,
    deleted: false,
    deletedAt: null,
    deletedByUid: "",
    deletedByEmail: "",
    deletedByName: "",
    archived: false,
    archivedAt: null,
    archivedByUid: "",
    archivedByEmail: "",
    archivedByName: "",
    updatedAt: serverTimestamp(),
  });

  await addProjectUpdate({
    projectId,
    userUid: userAuditData.uid,
    userEmail: userAuditData.email,
    userName: userAuditData.name,
    oldStatus: project.status || "",
    newStatus: restoredStatus,
    progress: Number(project.progress || 0),
    comment: "El administrador restauró el proyecto desde el historial.",
  });

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.PROJECT_RESTORED,
    title: "Proyecto restaurado",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } restauró el proyecto desde el historial.`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus: restoredStatus,
      progress: Number(project.progress || 0),
    },
  });
}

export async function finishProject(projectId, currentUser, comment = "") {
  requireAdmin(currentUser);

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  if (isProjectDeleted(project)) {
    throw new Error("No se puede finalizar un proyecto eliminado.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  await updateDoc(projectRef, {
    status: PROJECT_STATUS.FINISHED,
    progress: 100,
    finishedAt: serverTimestamp(),
    finishedByUid: userAuditData.uid,
    finishedByEmail: userAuditData.email,
    finishedByName: userAuditData.name,
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addProjectUpdate({
    projectId,
    userUid: userAuditData.uid,
    userEmail: userAuditData.email,
    userName: userAuditData.name,
    oldStatus: project.status || "",
    newStatus: PROJECT_STATUS.FINISHED,
    progress: 100,
    comment: comment || "El administrador marcó el proyecto como finalizado.",
  });

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.PROJECT_FINISHED,
    title: "Proyecto finalizado",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } marcó el proyecto como finalizado.`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus: PROJECT_STATUS.FINISHED,
      oldProgress: Number(project.progress || 0),
      newProgress: 100,
      comment,
    },
  });
}

export async function cancelProject(projectId, currentUser, comment = "") {
  requireAdmin(currentUser);

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  if (isProjectDeleted(project)) {
    throw new Error("No se puede cancelar un proyecto eliminado.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  await updateDoc(projectRef, {
    status: PROJECT_STATUS.CANCELLED,
    cancelledAt: serverTimestamp(),
    cancelledByUid: userAuditData.uid,
    cancelledByEmail: userAuditData.email,
    cancelledByName: userAuditData.name,
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addProjectUpdate({
    projectId,
    userUid: userAuditData.uid,
    userEmail: userAuditData.email,
    userName: userAuditData.name,
    oldStatus: project.status || "",
    newStatus: PROJECT_STATUS.CANCELLED,
    progress: Number(project.progress || 0),
    comment: comment || "El administrador canceló el proyecto.",
  });

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.PROJECT_CANCELLED,
    title: "Proyecto cancelado",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } canceló el proyecto.`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus: PROJECT_STATUS.CANCELLED,
      progress: Number(project.progress || 0),
      comment,
    },
  });
}

export async function addProjectUpdate(updateData) {
  const updatesRef = collection(db, UPDATES_COLLECTION);

  await addDoc(updatesRef, {
    ...updateData,
    createdAt: serverTimestamp(),
  });
}

export async function getProjectUpdates(projectId) {
  const updatesRef = collection(db, UPDATES_COLLECTION);

  const q = query(
    updatesRef,
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function addProjectEvidence(evidenceData, currentUser) {
  const project = await getProjectById(evidenceData.projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  if (!canUpdateProject(project, currentUser)) {
    throw new Error("No tienes permiso para agregar evidencia a este proyecto.");
  }

  const currentUserUid = getCurrentUserUid(currentUser);
  const evidenceRef = collection(db, EVIDENCE_COLLECTION);

  const normalizedEvidenceData = {
    ...evidenceData,
    reviewStatus: evidenceData.reviewStatus || "pending",
    reviewedAt: evidenceData.reviewedAt || null,
    reviewedByUid: evidenceData.reviewedByUid || "",
    reviewedByEmail: evidenceData.reviewedByEmail || "",
    reviewedByName: evidenceData.reviewedByName || "",
    reviewComment: evidenceData.reviewComment || "",
  };

  await addDoc(evidenceRef, {
    ...normalizedEvidenceData,

    userUid: currentUserUid,
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",

    createdAt: serverTimestamp(),
  });

  const existingEvidenceFiles = Array.isArray(project.evidenceFiles)
    ? project.evidenceFiles
    : [];

  const projectRef = doc(db, PROJECTS_COLLECTION, evidenceData.projectId);

  await updateDoc(projectRef, {
    evidenceFiles: [
      ...existingEvidenceFiles,
      {
        ...normalizedEvidenceData,
        uploadedAt: serverTimestamp(),
        userUid: currentUserUid,
        userEmail: currentUser.email || "",
        userName: currentUser.name || "",
      },
    ],
    updatedAt: serverTimestamp(),
  });

  await addProjectLog({
    projectId: evidenceData.projectId,
    type: PROJECT_LOG_TYPES.EVIDENCE_UPLOADED,
    title: "Evidencia subida",
    description: `${
      currentUser.name || currentUser.email || "Un usuario"
    } subió una evidencia al proyecto.`,
    currentUser,
    metadata: {
      fileName: evidenceData.fileName || "",
      fileType: evidenceData.fileType || "",
      filePath: evidenceData.filePath || "",
      reviewStatus: normalizedEvidenceData.reviewStatus,
    },
  });
}

export async function updateEvidenceReviewStatus(
  projectId,
  targetEvidence,
  reviewStatus,
  currentUser,
  reviewComment = ""
) {
  requireAdmin(currentUser);

  if (!projectId) {
    throw new Error("Falta el ID del proyecto.");
  }

  if (!["pending", "approved", "rejected"].includes(reviewStatus)) {
    throw new Error("Estado de revisión no válido.");
  }

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado.");
  }

  const targetFound = findEvidenceInProject(project, targetEvidence);

  if (!targetFound) {
    throw new Error("No se encontró la evidencia dentro del proyecto.");
  }

  const userAuditData = getUserAuditData(currentUser);
  const reviewedAt = new Date();

  const reviewData = {
    reviewStatus,
    reviewedAt,
    reviewedByUid: userAuditData.uid,
    reviewedByEmail: userAuditData.email,
    reviewedByName: userAuditData.name || userAuditData.email,
    reviewComment: reviewComment || "",
  };

  const updatedEvidenceFiles = updateEvidenceListReviewStatus(
    project.evidenceFiles,
    targetEvidence,
    reviewData
  );

  const updatedEvidences = updateEvidenceListReviewStatus(
    project.evidences,
    targetEvidence,
    reviewData
  );

  const updatedEvidence = updateEvidenceListReviewStatus(
    project.evidence,
    targetEvidence,
    reviewData
  );

  const updatedFiles = updateEvidenceListReviewStatus(
    project.files,
    targetEvidence,
    reviewData
  );

  const updatedAttachments = updateEvidenceListReviewStatus(
    project.attachments,
    targetEvidence,
    reviewData
  );

  const updatedAdvances = updateEvidenceReviewInAdvances(
    project.advances,
    targetEvidence,
    reviewData
  );

  const reviewLabel =
    reviewStatus === "approved"
      ? "aprobó"
      : reviewStatus === "rejected"
      ? "rechazó"
      : "marcó como pendiente";

  const fileName =
    targetFound.fileName ||
    targetFound.name ||
    targetFound.originalFileName ||
    "una evidencia";

  const historyItem = {
    type: "Evidencia",
    title: "Revisión de evidencia",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } ${reviewLabel} la evidencia ${fileName}.`,
    createdAt: reviewedAt,
    createdByName: userAuditData.name || userAuditData.email || "Administrador",
    createdByEmail: userAuditData.email || "",
  };

  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  const updateData = {
    updatedAt: serverTimestamp(),
    history: Array.isArray(project.history)
      ? [...project.history, historyItem]
      : [historyItem],
  };

  if (Array.isArray(project.evidenceFiles)) {
    updateData.evidenceFiles = updatedEvidenceFiles;
  }

  if (Array.isArray(project.evidences)) {
    updateData.evidences = updatedEvidences;
  }

  if (Array.isArray(project.evidence)) {
    updateData.evidence = updatedEvidence;
  }

  if (Array.isArray(project.files)) {
    updateData.files = updatedFiles;
  }

  if (Array.isArray(project.attachments)) {
    updateData.attachments = updatedAttachments;
  }

  if (Array.isArray(project.advances)) {
    updateData.advances = updatedAdvances;
  }

  await updateDoc(projectRef, updateData);

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.EVIDENCE_REVIEWED,
    title: "Evidencia revisada",
    description: `${
      userAuditData.name || userAuditData.email || "Un administrador"
    } ${reviewLabel} la evidencia ${fileName}.`,
    currentUser,
    metadata: {
      fileName,
      reviewStatus,
      reviewComment: reviewComment || "",
    },
  });

  return {
    ...project,
    ...updateData,
    evidenceFiles: Array.isArray(project.evidenceFiles)
      ? updatedEvidenceFiles
      : project.evidenceFiles,
    evidences: Array.isArray(project.evidences)
      ? updatedEvidences
      : project.evidences,
    evidence: Array.isArray(project.evidence) ? updatedEvidence : project.evidence,
    files: Array.isArray(project.files) ? updatedFiles : project.files,
    attachments: Array.isArray(project.attachments)
      ? updatedAttachments
      : project.attachments,
    advances: Array.isArray(project.advances) ? updatedAdvances : project.advances,
  };
}

export async function getProjectEvidence(projectId) {
  const evidenceRef = collection(db, EVIDENCE_COLLECTION);

  const q = query(
    evidenceRef,
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function updateProjectAdmin(projectId, projectData, currentUser) {
  requireAdmin(currentUser);

  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado");
  }

  if (isProjectDeleted(project)) {
    throw new Error(
      "No se puede editar un proyecto eliminado. Primero debes restaurarlo."
    );
  }

  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  const newStatus = projectData.status;
  const newProgress = Number(projectData.progress || 0);

  const shouldCloseProject =
    newStatus === PROJECT_STATUS.FINISHED ||
    newStatus === "Terminado" ||
    newStatus === "terminado" ||
    newStatus === "Finalizado";

  await updateDoc(projectRef, {
    title: projectData.title,
    description: projectData.description,
    requesterName: projectData.requesterName,
    requesterArea: projectData.requesterArea,
    responsibleArea: projectData.responsibleArea,
    departmentId: projectData.departmentId || projectData.responsibleDepartmentId || "",
    departmentName:
      projectData.departmentName ||
      projectData.responsibleDepartmentName ||
      projectData.responsibleArea ||
      "",
    responsibleDepartmentId:
      projectData.responsibleDepartmentId || projectData.departmentId || "",
    responsibleDepartmentName:
      projectData.responsibleDepartmentName ||
      projectData.departmentName ||
      projectData.responsibleArea ||
      "",
    assignedToUid: projectData.assignedToUid || projectData.assignedToId || "",
    assignedToId: projectData.assignedToId || projectData.assignedToUid || "",
    assignedToEmail: projectData.assignedToEmail,
    assignedToName: projectData.assignedToName,
    status: newStatus,
    priority: projectData.priority,
    progress: shouldCloseProject ? 100 : newProgress,
    deadline: projectData.deadline,
    acceptanceCriteria: projectData.acceptanceCriteria,
    references: projectData.references,
    updatedAt: serverTimestamp(),
    ...(shouldCloseProject
      ? {
          closedAt: serverTimestamp(),
          finishedAt: serverTimestamp(),
          finishedByUid: getCurrentUserUid(currentUser),
          finishedByEmail: currentUser.email || "",
          finishedByName: currentUser.name || "",
        }
      : {}),
  });

  await addProjectUpdate({
    projectId,
    userUid: getCurrentUserUid(currentUser),
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",
    oldStatus: project.status,
    newStatus,
    progress: shouldCloseProject ? 100 : newProgress,
    comment: "El administrador editó la información general del proyecto.",
  });

  await addProjectLog({
    projectId,
    type: PROJECT_LOG_TYPES.PROJECT_UPDATED,
    title: "Proyecto editado",
    description: `${
      currentUser.name || currentUser.email || "Un administrador"
    } editó la información general del proyecto.`,
    currentUser,
    metadata: {
      oldStatus: project.status || "",
      newStatus,
      oldProgress: Number(project.progress || 0),
      newProgress: shouldCloseProject ? 100 : newProgress,
      assignedToName: projectData.assignedToName || "",
      responsibleArea: projectData.responsibleArea || "",
      departmentId: projectData.departmentId || "",
      departmentName: projectData.departmentName || "",
      priority: projectData.priority || "",
    },
  });
}

export async function getDashboardProjects() {
  const projectsRef = collection(db, PROJECTS_COLLECTION);
  const q = query(projectsRef, orderBy("deadline", "asc"));

  const snapshot = await getDocs(q);

  const projects = snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));

  return sortByDeadlineAsc(
    projects.filter((project) => !isHistoricalProject(project))
  );
}

export async function getExecutiveDashboardData() {
  const projects = await getAllProjects();
  const rawRecentLogs = await getRecentProjectLogs(60);

  const now = new Date();

  const activeProjects = projects.filter(
    (project) => !isHistoricalProject(project)
  );
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const recentLogs = rawRecentLogs
    .filter((log) => log.projectId && activeProjectIds.has(log.projectId))
    .slice(0, 20);

  const historicalProjects = projects.filter((project) =>
    isHistoricalProject(project)
  );

  const finishedProjects = historicalProjects.filter((project) =>
    isProjectFinished(project)
  );

  const cancelledProjects = historicalProjects.filter((project) =>
    isProjectCancelled(project)
  );

  const deletedProjects = historicalProjects.filter((project) =>
    isProjectDeleted(project)
  );

  const archivedProjects = historicalProjects.filter(
    (project) => project.archived === true || project.status === "Archivado"
  );

  const overdueProjects = activeProjects.filter(isProjectOverdue);
  const reviewProjects = activeProjects.filter(isProjectReadyForReview);
  const highPriorityProjects = activeProjects.filter(isProjectHighPriority);

  const createdThisMonth = projects.filter((project) =>
    isSameMonthAndYear(project.createdAt, now)
  );

  const finishedThisMonth = finishedProjects.filter((project) =>
    isSameMonthAndYear(project.finishedAt || project.closedAt, now)
  );

  const cancelledThisMonth = cancelledProjects.filter((project) =>
    isSameMonthAndYear(project.cancelledAt || project.closedAt, now)
  );

  const deletedThisMonth = deletedProjects.filter((project) =>
    isSameMonthAndYear(project.deletedAt, now)
  );

  const logsThisMonth = recentLogs.filter((log) =>
    isSameMonthAndYear(log.createdAt, now)
  );

  const recentlyClosedProjects = historicalProjects
    .slice()
    .sort((a, b) => {
      const dateA = parseProjectDate(getProjectClosedDate(a));
      const dateB = parseProjectDate(getProjectClosedDate(b));

      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, 8);

  return {
    generatedAt: now,

    metrics: {
      totalProjects: projects.length,

      active: activeProjects.length,
      historical: historicalProjects.length,
      finished: finishedProjects.length,
      cancelled: cancelledProjects.length,
      deleted: deletedProjects.length,
      archived: archivedProjects.length,

      overdue: overdueProjects.length,
      review: reviewProjects.length,
      highPriority: highPriorityProjects.length,

      createdThisMonth: createdThisMonth.length,
      finishedThisMonth: finishedThisMonth.length,
      cancelledThisMonth: cancelledThisMonth.length,
      deletedThisMonth: deletedThisMonth.length,

      recentActivity: recentLogs.length,
      activityThisMonth: logsThisMonth.length,

      evidenceUploadedThisMonth: countLogsByType(
        logsThisMonth,
        PROJECT_LOG_TYPES.EVIDENCE_UPLOADED
      ),

      statusChangesThisMonth: logsThisMonth.filter((log) =>
        [
          PROJECT_LOG_TYPES.STATUS_CHANGED,
          PROJECT_LOG_TYPES.REVIEW_REQUESTED,
          PROJECT_LOG_TYPES.CORRECTIONS_REQUESTED,
          PROJECT_LOG_TYPES.PROJECT_APPROVED,
          PROJECT_LOG_TYPES.PROJECT_FINISHED,
          PROJECT_LOG_TYPES.PROJECT_CANCELLED,
          PROJECT_LOG_TYPES.PROJECT_DELETED,
          PROJECT_LOG_TYPES.PROJECT_RESTORED,
        ].includes(log.type)
      ).length,
    },

    projects: {
      active: activeProjects,
      historical: historicalProjects,
      overdue: overdueProjects,
      review: reviewProjects,
      highPriority: highPriorityProjects,
      recentlyClosed: recentlyClosedProjects,
    },

    workloadByResponsible: buildWorkloadByResponsible(activeProjects),
    workloadByArea: buildWorkloadByArea(activeProjects),

    recentLogs,

    alerts: buildExecutiveAlerts(projects),
  };
}
