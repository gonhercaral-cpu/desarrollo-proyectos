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

export async function createProject(projectData, currentUser) {
  const projectsRef = collection(db, PROJECTS_COLLECTION);

  const docRef = await addDoc(projectsRef, {
    ...projectData,
    progress: Number(projectData.progress || 0),
    createdByEmail: currentUser.email,
    createdByName: currentUser.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
  });

  await addProjectUpdate({
    projectId: docRef.id,
    userEmail: currentUser.email,
    userName: currentUser.name,
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

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export async function getProjectsAssignedTo(email) {
  const projectsRef = collection(db, PROJECTS_COLLECTION);
  const q = query(
    projectsRef,
    where("assignedToEmail", "==", email),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
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

export async function updateProjectStatus(projectId, updateData, currentUser) {
  const project = await getProjectById(projectId);

  if (!project) {
    throw new Error("Proyecto no encontrado");
  }

  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);

  await updateDoc(projectRef, {
    status: updateData.status,
    progress: Number(updateData.progress),
    updatedAt: serverTimestamp(),
    ...(updateData.status === "Finalizado" ? { closedAt: serverTimestamp() } : {}),
  });

  await addProjectUpdate({
    projectId,
    userEmail: currentUser.email,
    userName: currentUser.name,
    oldStatus: project.status,
    newStatus: updateData.status,
    progress: Number(updateData.progress),
    comment: updateData.comment,
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

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export async function addProjectEvidence(evidenceData, currentUser) {
  const evidenceRef = collection(db, EVIDENCE_COLLECTION);

  await addDoc(evidenceRef, {
    ...evidenceData,
    userEmail: currentUser.email,
    userName: currentUser.name,
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

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}