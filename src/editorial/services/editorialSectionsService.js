import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { normalizeEditorialSections } from "../models/editorialStructure";
import { deleteEditorialPages, getEditorialDocumentRef, getEditorialPageRef } from "./editorialPagesService";

export const EDITORIAL_SECTIONS_COLLECTION = "sections";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar secciones.");
  return uid;
}

function getSectionsCollection(projectId, documentId) {
  return collection(getEditorialDocumentRef(projectId, documentId), EDITORIAL_SECTIONS_COLLECTION);
}

function getSectionRef(projectId, documentId, sectionId) {
  return doc(getSectionsCollection(projectId, documentId), sectionId);
}

async function readSections(projectId, documentId) {
  const snapshot = await getDocs(getSectionsCollection(projectId, documentId));
  return normalizeEditorialSections(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
}

export function subscribeEditorialSections({ projectId, documentId, onChange, onError }) {
  return onSnapshot(
    getSectionsCollection(projectId, documentId),
    (snapshot) => onChange(normalizeEditorialSections(
      snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    )),
    onError
  );
}

export async function createEditorialSection({ projectId, documentId, values, user }) {
  const uid = requireUser(user);
  const sections = await readSections(projectId, documentId);
  const sectionRef = doc(getSectionsCollection(projectId, documentId));
  const batch = writeBatch(db);
  batch.set(sectionRef, {
    name: String(values.name || "Nueva sección").trim() || "Nueva sección",
    type: values.type || "custom",
    order: sections.length,
    numberingStyle: values.numberingStyle || "arabic",
    numberingMode: values.numberingMode || "continue",
    numberingStart: Math.max(1, Number(values.numberingStart || 1)),
    startOnRight: values.startOnRight === true,
    collapsed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
  return sectionRef.id;
}

export async function updateEditorialSection({ projectId, documentId, sectionId, changes, user }) {
  const uid = requireUser(user);
  const allowed = [
    "name", "type", "numberingStyle", "numberingMode", "numberingStart", "startOnRight",
    "collapsed", "academicMetadata", "seriesId", "seriesName", "levelId", "levelName",
    "bookId", "bookName", "unitNumber", "unitTitle", "lessonNumber", "lessonTitle",
    "academicType", "activityNumber",
  ];
  const safeChanges = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key))
  );
  const batch = writeBatch(db);
  batch.update(getSectionRef(projectId, documentId, sectionId), {
    ...safeChanges,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function reorderEditorialSections({ projectId, documentId, sectionIds, user }) {
  const uid = requireUser(user);
  const batch = writeBatch(db);
  sectionIds.forEach((sectionId, order) => {
    batch.update(getSectionRef(projectId, documentId, sectionId), {
      order,
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function deleteEditorialSection({
  projectId,
  documentId,
  sectionId,
  pages,
  project,
  mode,
  targetSectionId,
  user,
}) {
  const uid = requireUser(user);
  const sectionPages = pages.filter((page) => page.sectionId === sectionId);
  if (sectionPages.length > 0 && mode === "delete") {
    await deleteEditorialPages({
      projectId,
      documentId,
      pageIds: sectionPages.map((page) => page.id),
      project,
      user,
    });
  } else if (sectionPages.length > 0) {
    if (targetSectionId === sectionId) throw new Error("Selecciona otra sección de destino.");
    const moveBatch = writeBatch(db);
    sectionPages.forEach((page) => {
      moveBatch.update(getEditorialPageRef(projectId, documentId, page.id), {
        sectionId: targetSectionId || "",
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });
    await moveBatch.commit();
  }

  const sections = await readSections(projectId, documentId);
  const remaining = sections.filter((section) => section.id !== sectionId);
  const batch = writeBatch(db);
  batch.delete(getSectionRef(projectId, documentId, sectionId));
  remaining.forEach((section, order) => {
    if (section.order !== order) {
      batch.update(getSectionRef(projectId, documentId, section.id), {
        order,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    }
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}
