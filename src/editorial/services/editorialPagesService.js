import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { normalizeEditorialPages } from "../models/editorialStructure";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";
import { cleanupUnusedEditorialAssets } from "./editorialAssetUsageService";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar páginas.");
  return uid;
}

export function getEditorialDocumentRef(projectId, documentId) {
  return doc(
    db,
    EDITORIAL_COLLECTIONS.projects,
    projectId,
    EDITORIAL_COLLECTIONS.documents,
    documentId
  );
}

export function getEditorialPageRef(projectId, documentId, pageId) {
  return doc(getEditorialDocumentRef(projectId, documentId), EDITORIAL_COLLECTIONS.pages, pageId);
}

function getPagesCollection(projectId, documentId) {
  return collection(getEditorialDocumentRef(projectId, documentId), EDITORIAL_COLLECTIONS.pages);
}

async function readPages(projectId, documentId, project) {
  const snapshot = await getDocs(getPagesCollection(projectId, documentId));
  return normalizeEditorialPages(
    snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    project
  );
}

export function subscribeEditorialPages({ projectId, documentId, project, onChange, onError }) {
  return onSnapshot(
    getPagesCollection(projectId, documentId),
    (snapshot) => onChange(normalizeEditorialPages(
      snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      project
    )),
    onError
  );
}

function getPageData({ name, order, sectionId, pageType, project, isBlank, numberingEnabled }) {
  return {
    name: String(name || `Página ${order + 1}`).trim() || `Página ${order + 1}`,
    order,
    sectionId: sectionId || "",
    pageType: pageType || "content",
    width: Number(project.widthIn || 8),
    height: Number(project.heightIn || 10),
    orientation: project.orientation || "portrait",
    background: "#ffffff",
    isBlank: isBlank === true,
    numberingEnabled: numberingEnabled !== false,
    masterPageId: "",
    masterOverrides: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function createEditorialPage({
  projectId,
  documentId,
  project,
  user,
  name,
  sectionId = "",
  pageType = "content",
  isBlank = false,
  numberingEnabled = true,
  referencePageId = "",
  placement = "after",
}) {
  const uid = requireUser(user);
  const pages = await readPages(projectId, documentId, project);
  const referenceIndex = pages.findIndex((page) => page.id === referencePageId);
  const insertionIndex = referenceIndex < 0
    ? pages.length
    : Math.max(0, referenceIndex + (placement === "before" ? 0 : 1));
  const pageRef = doc(getPagesCollection(projectId, documentId));
  const nextPages = [...pages];
  nextPages.splice(insertionIndex, 0, { id: pageRef.id });
  const batch = writeBatch(db);

  batch.set(pageRef, {
    ...getPageData({ name, order: insertionIndex, sectionId, pageType, project, isBlank, numberingEnabled }),
    updatedByUid: uid,
  });
  nextPages.forEach((page, index) => {
    if (page.id !== pageRef.id && page.order !== index) {
      batch.update(getEditorialPageRef(projectId, documentId, page.id), {
        order: index,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    }
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
  return pageRef.id;
}

export async function updateEditorialPage({ projectId, documentId, pageId, changes, user }) {
  const uid = requireUser(user);
  const allowed = ["name", "sectionId", "pageType", "width", "height", "orientation", "background", "isBlank", "numberingEnabled", "masterPageId", "masterOverrides"];
  const safeChanges = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key))
  );
  const batch = writeBatch(db);
  batch.update(getEditorialPageRef(projectId, documentId, pageId), {
    ...safeChanges,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function reorderEditorialPages({ projectId, documentId, pageIds, sectionChanges = {}, user }) {
  const uid = requireUser(user);
  const batch = writeBatch(db);
  pageIds.forEach((pageId, order) => {
    batch.update(getEditorialPageRef(projectId, documentId, pageId), {
      order,
      ...(Object.hasOwn(sectionChanges, pageId) ? { sectionId: sectionChanges[pageId] } : {}),
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function duplicateEditorialPage({ projectId, documentId, pageId, project, user }) {
  const uid = requireUser(user);
  const pages = await readPages(projectId, documentId, project);
  const sourceIndex = pages.findIndex((page) => page.id === pageId);
  if (sourceIndex < 0) throw new Error("No se encontró la página para duplicar.");
  const sourceRef = getEditorialPageRef(projectId, documentId, pageId);
  const [sourceSnapshot, elementsSnapshot] = await Promise.all([
    getDoc(sourceRef),
    getDocs(collection(sourceRef, EDITORIAL_COLLECTIONS.elements)),
  ]);
  if (!sourceSnapshot.exists()) throw new Error("La página ya no existe.");

  const targetRef = doc(getPagesCollection(projectId, documentId));
  const insertionIndex = sourceIndex + 1;
  const operations = [];
  operations.push((batch) => batch.set(targetRef, {
    ...sourceSnapshot.data(),
    name: `${sourceSnapshot.data().name || "Página"} · Copia`,
    order: insertionIndex,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  }));
  elementsSnapshot.docs.forEach((elementSnapshot) => {
    operations.push((batch) => batch.set(
      doc(targetRef, EDITORIAL_COLLECTIONS.elements, elementSnapshot.id),
      { ...elementSnapshot.data(), updatedAt: serverTimestamp(), updatedByUid: uid }
    ));
  });
  pages.slice(insertionIndex).forEach((page, offset) => {
    operations.push((batch) => batch.update(getEditorialPageRef(projectId, documentId, page.id), {
      order: insertionIndex + offset + 1,
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    }));
  });
  operations.push((batch) => batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() }));

  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  return targetRef.id;
}

async function cleanExclusiveAssets(projectId, candidateAssetIds) {
  await cleanupUnusedEditorialAssets(projectId, candidateAssetIds);
}

export async function deleteEditorialPages({ projectId, documentId, pageIds, project, user }) {
  const uid = requireUser(user);
  const deletedIds = new Set(pageIds);
  const pages = await readPages(projectId, documentId, project);
  const remainingPages = pages.filter((page) => !deletedIds.has(page.id));
  if (remainingPages.length === 0) throw new Error("El documento debe conservar al menos una página.");

  const deleteOperations = [];
  const candidateAssetIds = new Set();
  for (const pageId of deletedIds) {
    const pageRef = getEditorialPageRef(projectId, documentId, pageId);
    const elementsSnapshot = await getDocs(collection(pageRef, EDITORIAL_COLLECTIONS.elements));
    elementsSnapshot.docs.forEach((element) => {
      if (element.data().assetId) candidateAssetIds.add(element.data().assetId);
      deleteOperations.push((batch) => batch.delete(element.ref));
    });
    deleteOperations.push((batch) => batch.delete(pageRef));
  }
  remainingPages.forEach((page, order) => {
    if (page.order !== order) {
      deleteOperations.push((batch) => batch.update(getEditorialPageRef(projectId, documentId, page.id), {
        order,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      }));
    }
  });
  deleteOperations.push((batch) => batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() }));

  for (let index = 0; index < deleteOperations.length; index += 440) {
    const batch = writeBatch(db);
    deleteOperations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  await cleanExclusiveAssets(projectId, candidateAssetIds);
  return remainingPages[0]?.id || "";
}

export async function deleteEditorialPage(args) {
  return deleteEditorialPages({ ...args, pageIds: [args.pageId] });
}
