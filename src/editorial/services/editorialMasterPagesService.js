import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { cloneDesignElements, normalizeMasterPage } from "../models/editorialDesign";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";
import { getEditorialDocumentRef, getEditorialPageRef } from "./editorialPagesService";
import { cleanupUnusedEditorialAssets } from "./editorialAssetUsageService";

export const MASTER_PAGES_COLLECTION = "masterPages";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar páginas maestras.");
  return uid;
}

function collectionRef(projectId, documentId) {
  return collection(getEditorialDocumentRef(projectId, documentId), MASTER_PAGES_COLLECTION);
}

export function getMasterPageRef(projectId, documentId, masterPageId) {
  return doc(collectionRef(projectId, documentId), masterPageId);
}

export function subscribeEditorialMasterPages({ projectId, documentId, project, onChange, onError }) {
  return onSnapshot(collectionRef(projectId, documentId), (snapshot) => {
    const masters = snapshot.docs.map((item, index) => normalizeMasterPage({ id: item.id, ...item.data() }, index, project));
    onChange(masters.sort((left, right) => left.order - right.order));
  }, onError);
}

export async function createEditorialMasterPage({ projectId, documentId, project, values, user }) {
  const uid = requireUser(user);
  const snapshot = await getDocs(collectionRef(projectId, documentId));
  const masterRef = doc(collectionRef(projectId, documentId));
  const batch = writeBatch(db);
  batch.set(masterRef, {
    name: String(values.name || "Nueva maestra").trim() || "Nueva maestra",
    side: ["any", "left", "right"].includes(values.side) ? values.side : "any",
    width: Number(values.width || project.widthIn || 8),
    height: Number(values.height || project.heightIn || 10),
    background: values.background || "#ffffff",
    ...(values.backgroundImage ? { backgroundImage: values.backgroundImage } : {}),
    order: snapshot.size,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
  return masterRef.id;
}

export async function updateEditorialMasterPage({ projectId, documentId, masterPageId, changes, user }) {
  const uid = requireUser(user);
  const allowed = ["name", "side", "width", "height", "background", "backgroundImage", "order"];
  const safe = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  const batch = writeBatch(db);
  batch.update(getMasterPageRef(projectId, documentId, masterPageId), { ...safe, updatedAt: serverTimestamp(), updatedByUid: uid });
  batch.update(getEditorialDocumentRef(projectId, documentId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function duplicateEditorialMasterPage({ projectId, documentId, master, elements, user }) {
  const masterPageId = await createEditorialMasterPage({ projectId, documentId, project: master, values: { ...master, name: `${master.name} · Copia` }, user });
  const cloned = cloneDesignElements(elements);
  for (let index = 0; index < cloned.length; index += 440) {
    const batch = writeBatch(db);
    cloned.slice(index, index + 440).forEach((element) => batch.set(doc(getMasterPageRef(projectId, documentId, masterPageId), EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await batch.commit();
  }
  return masterPageId;
}

export async function assignMasterPage({ projectId, documentId, pageIds, masterPageId, user }) {
  const uid = requireUser(user);
  if (!pageIds.length) throw new Error("Selecciona al menos una página.");
  if (masterPageId) {
    const masterSnapshot = await getDoc(getMasterPageRef(projectId, documentId, masterPageId));
    const side = masterSnapshot.data()?.side || "any";
    if (side !== "any") {
      const pages = await Promise.all(pageIds.map((pageId) => getDoc(getEditorialPageRef(projectId, documentId, pageId))));
      const invalid = pages.find((page) => {
        const pageSide = Number(page.data()?.order || 0) % 2 === 0 ? "right" : "left";
        return pageSide !== side;
      });
      if (invalid) throw new Error(`La maestra ${side === "left" ? "izquierda" : "derecha"} solo puede asignarse a páginas de ese lado.`);
    }
  }
  const batch = writeBatch(db);
  pageIds.forEach((pageId) => batch.update(getEditorialPageRef(projectId, documentId, pageId), {
    masterPageId: masterPageId || "",
    masterOverrides: {},
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  }));
  await batch.commit();
}

export async function deleteEditorialMasterPage({ projectId, documentId, masterPageId, replacementMasterPageId, unlink = false, user }) {
  const uid = requireUser(user);
  const pagesSnapshot = await getDocs(collection(getEditorialDocumentRef(projectId, documentId), EDITORIAL_COLLECTIONS.pages));
  const assignedPages = pagesSnapshot.docs.filter((page) => page.data().masterPageId === masterPageId);
  if (assignedPages.length && !replacementMasterPageId && !unlink) {
    throw new Error(`Maestra asignada a ${assignedPages.length} página(s). Reasigna o desvincula antes de eliminar.`);
  }
  const masterRef = getMasterPageRef(projectId, documentId, masterPageId);
  const masterSnapshot = await getDoc(masterRef);
  const elementsSnapshot = await getDocs(collection(masterRef, EDITORIAL_COLLECTIONS.elements));
  const candidateAssetIds = new Set(elementsSnapshot.docs.map((element) => element.data().assetId).filter(Boolean));
  if (masterSnapshot.data()?.backgroundImage?.assetId) candidateAssetIds.add(masterSnapshot.data().backgroundImage.assetId);
  const operations = [];
  assignedPages.forEach((page) => operations.push((batch) => batch.update(page.ref, {
    masterPageId: replacementMasterPageId || "",
    masterOverrides: {},
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  })));
  elementsSnapshot.docs.forEach((element) => operations.push((batch) => batch.delete(element.ref)));
  operations.push((batch) => batch.delete(masterRef));
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  await cleanupUnusedEditorialAssets(projectId, candidateAssetIds);
}
