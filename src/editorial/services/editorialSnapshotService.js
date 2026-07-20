import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { normalizeEditorialElement, normalizeElementOrder } from "../models/editorialElements";
import { normalizeReviewState } from "../models/editorialProduction";
import { normalizeEditorialPages, normalizeEditorialSections } from "../models/editorialStructure";
import { calculateEditorialNumbering } from "../utils/editorialNumbering";
import { prepareEditorialRestoreDocument } from "../utils/editorialVersioning";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

function mapDocs(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function readElements(parentRef) {
  const snapshot = await getDocs(collection(parentRef, EDITORIAL_COLLECTIONS.elements));
  return normalizeElementOrder(snapshot.docs.map((item, index) => normalizeEditorialElement({ id: item.id, ...item.data() }, index)));
}

async function mapWithElements(items, parentRef, childCollection) {
  const output = [];
  for (let index = 0; index < items.length; index += 8) {
    const chunk = items.slice(index, index + 8);
    output.push(...await Promise.all(chunk.map(async (item) => ({
      ...item,
      elements: await readElements(doc(parentRef, childCollection, item.id)),
    }))));
  }
  return output;
}

export async function loadEditorialDocumentSnapshot({ projectId, documentId }) {
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const documentRef = doc(projectRef, EDITORIAL_COLLECTIONS.documents, documentId);
  const [projectSnapshot, documentSnapshot, pagesSnapshot, sectionsSnapshot, mastersSnapshot, componentsSnapshot, stylesSnapshot, variablesSnapshot, fontsSnapshot] = await Promise.all([
    getDoc(projectRef), getDoc(documentRef), getDocs(collection(documentRef, EDITORIAL_COLLECTIONS.pages)),
    getDocs(collection(documentRef, EDITORIAL_COLLECTIONS.sections)), getDocs(collection(documentRef, "masterPages")),
    getDocs(collection(projectRef, "components")), getDocs(collection(projectRef, "styles")), getDocs(collection(projectRef, "variables")),
    getDocs(query(collection(db, EDITORIAL_COLLECTIONS.assets), where("projectId", "==", projectId), where("type", "==", "font"))),
  ]);
  if (!projectSnapshot.exists() || !documentSnapshot.exists()) throw new Error("Documento editorial no disponible.");
  const project = { id: projectSnapshot.id, ...projectSnapshot.data() };
  const documentData = { id: documentSnapshot.id, ...documentSnapshot.data() };
  const pages = normalizeEditorialPages(mapDocs(pagesSnapshot), project);
  const sections = normalizeEditorialSections(mapDocs(sectionsSnapshot));
  const [pagesWithElements, masters, components] = await Promise.all([
    mapWithElements(pages, documentRef, EDITORIAL_COLLECTIONS.pages),
    mapWithElements(mapDocs(mastersSnapshot), documentRef, "masterPages"),
    mapWithElements(mapDocs(componentsSnapshot), projectRef, "components"),
  ]);
  return {
    project, document: documentData, academicMetadata: { ...(documentData.academicMetadata || {}) },
    pages: pagesWithElements, sections, masters, components, styles: mapDocs(stylesSnapshot), variables: mapDocs(variablesSnapshot), fonts: mapDocs(fontsSnapshot),
    numbering: calculateEditorialNumbering(pages, sections), reviewState: normalizeReviewState(documentData.reviewState),
  };
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += 420) {
    const batch = writeBatch(db);
    operations.slice(index, index + 420).forEach(({ type, reference, data }) => {
      if (type === "delete") batch.delete(reference);
      else batch.set(reference, { ...prepareEditorialRestoreDocument(data), updatedAt: serverTimestamp() }, { merge: false });
    });
    await batch.commit();
  }
}

async function replaceCollection(parentRef, collectionName, items, includeElements = false) {
  const existing = await getDocs(collection(parentRef, collectionName));
  const nextIds = new Set((items || []).map((item) => item.id));
  const deleteOperations = existing.docs.filter((item) => !nextIds.has(item.id)).map((item) => ({ type: "delete", reference: item.ref }));
  if (includeElements) {
    for (const item of existing.docs) {
      const elements = await getDocs(collection(item.ref, EDITORIAL_COLLECTIONS.elements));
      deleteOperations.unshift(...elements.docs.map((element) => ({ type: "delete", reference: element.ref })));
    }
  }
  await commitOperations(deleteOperations);
  const setOperations = [];
  (items || []).forEach((item) => {
    const itemRef = doc(parentRef, collectionName, item.id);
    setOperations.push({ type: "set", reference: itemRef, data: item });
    if (includeElements) (item.elements || []).forEach((element) => setOperations.push({ type: "set", reference: doc(itemRef, EDITORIAL_COLLECTIONS.elements, element.id), data: element }));
  });
  await commitOperations(setOperations);
}

export async function restoreEditorialDocumentSnapshot({ projectId, documentId, snapshot }) {
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const documentRef = doc(projectRef, EDITORIAL_COLLECTIONS.documents, documentId);
  await replaceCollection(documentRef, EDITORIAL_COLLECTIONS.pages, snapshot.pages, true);
  await replaceCollection(documentRef, EDITORIAL_COLLECTIONS.sections, snapshot.sections, false);
  await replaceCollection(documentRef, "masterPages", snapshot.masters, true);
  await replaceCollection(projectRef, "components", snapshot.components, true);
  await replaceCollection(projectRef, "styles", snapshot.styles, false);
  await replaceCollection(projectRef, "variables", snapshot.variables, false);
  const batch = writeBatch(db);
  batch.set(documentRef, { ...prepareEditorialRestoreDocument(snapshot.document), restoredAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  batch.set(projectRef, { ...prepareEditorialRestoreDocument(snapshot.project), updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
