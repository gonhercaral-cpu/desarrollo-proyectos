import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { toAcademicPersistenceFields } from "../models/editorialAcademic";
import { getEditorialDocumentRef, updateEditorialPage } from "./editorialPagesService";
import { updateEditorialProject, EDITORIAL_COLLECTIONS } from "./editorialProjectsService";
import { updateEditorialSection } from "./editorialSectionsService";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para actualizar metadata académica.");
  return uid;
}

export async function updateEditorialAcademicMetadata({ target, projectId, documentId, targetId, values, user }) {
  const uid = requireUser(user);
  const fields = toAcademicPersistenceFields(values);
  if (target === "project") return updateEditorialProject(projectId, fields, user);
  if (target === "page") return updateEditorialPage({ projectId, documentId, pageId: targetId, changes: fields, user });
  if (target === "section") return updateEditorialSection({ projectId, documentId, sectionId: targetId, changes: fields, user });
  if (target !== "document") throw new Error("Contexto académico no compatible.");

  const batch = writeBatch(db);
  batch.update(getEditorialDocumentRef(projectId, documentId), { ...fields, updatedAt: serverTimestamp(), updatedByUid: uid });
  batch.update(doc(db, EDITORIAL_COLLECTIONS.projects, projectId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export function getRelatedEditorialMaterials(projects = [], currentProject = {}, metadata = {}) {
  const source = { ...(currentProject.academicMetadata || {}), ...currentProject, ...metadata };
  return projects.filter((project) => {
    if (project.id === currentProject.id || project.archived) return false;
    const candidate = { ...(project.academicMetadata || {}), ...project };
    if (source.lessonNumber && candidate.lessonNumber && String(source.lessonNumber) === String(candidate.lessonNumber) && source.bookId === candidate.bookId) return true;
    if (source.unitNumber && candidate.unitNumber && String(source.unitNumber) === String(candidate.unitNumber) && source.bookId === candidate.bookId) return true;
    return Boolean(source.bookId && candidate.bookId === source.bookId);
  });
}
