import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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

function getCurrentUserUid(currentUser) {
  return currentUser?.uid || currentUser?.id || "";
}

function isAdmin(currentUser) {
  return currentUser?.role === "admin";
}

function isActiveUser(currentUser) {
  return currentUser?.active === true;
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
    project.assignedToUid === uid
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

  return project.assignedToUid === uid;
}

function sortByCreatedAtDesc(projects) {
  return [...projects].sort((a, b) => {
    const aSeconds = a.createdAt?.seconds || 0;
    const bSeconds = b.createdAt?.seconds || 0;

    return bSeconds - aSeconds;
  });
}

function removeDuplicatedProjects(projects) {
  const projectsMap = new Map();

  projects.forEach((project) => {
    projectsMap.set(project.id, project);
  });

  return Array.from(projectsMap.values());
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

    createdByUid: currentUserUid,
    createdByEmail: currentUser.email || "",
    createdByName: currentUser.name || "",

    assignedToUid: projectData.assignedToUid || "",
    assignedToEmail: projectData.assignedToEmail || "",
    assignedToName: projectData.assignedToName || "",

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

// Esta función es la que conviene usar para el dashboard.
// Si el usuario es admin, ve todos los proyectos.
// Si no es admin, ve solo los proyectos creados por él o asignados a él.
export async function getVisibleProjects(currentUser) {
  const currentUserUid = getCurrentUserUid(currentUser);

  if (!currentUserUid || !isActiveUser(currentUser)) {
    return [];
  }

  if (isAdmin(currentUser)) {
    return getAllProjects();
  }

  const assignedProjects = await getProjectsAssignedTo(currentUserUid);
  const createdProjects = await getProjectsCreatedBy(currentUserUid);

  const projects = removeDuplicatedProjects([
    ...assignedProjects,
    ...createdProjects,
  ]);

  return sortByCreatedAtDesc(projects);
}

// Esta función queda por compatibilidad,
// por si alguna pantalla vieja todavía busca proyectos por email.
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

// Esta versión valida si el usuario tiene permiso para ver el proyecto.
// Es útil para ProjectDetail.jsx.
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

  await updateDoc(projectRef, {
    status: updateData.status,
    progress: Number(updateData.progress),
    updatedAt: serverTimestamp(),
    ...(updateData.status === "Finalizado"
      ? { closedAt: serverTimestamp() }
      : {}),
  });

  await addProjectUpdate({
    projectId,

    userUid: currentUserUid,
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",

    oldStatus: project.status,
    newStatus: updateData.status,
    progress: Number(updateData.progress),
    comment: updateData.comment || "",
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

  await addDoc(evidenceRef, {
    ...evidenceData,

    userUid: currentUserUid,
    userEmail: currentUser.email || "",
    userName: currentUser.name || "",

    createdAt: serverTimestamp(),
  });
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