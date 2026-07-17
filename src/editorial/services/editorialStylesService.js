import { collection, doc, getDocs, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { normalizeDesignStyle } from "../models/editorialDesign";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

export const EDITORIAL_STYLES_COLLECTION = "styles";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar estilos.");
  return uid;
}

function projectRef(projectId) {
  return doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
}

function stylesCollection(projectId) {
  return collection(projectRef(projectId), EDITORIAL_STYLES_COLLECTION);
}

export function getEditorialStyleRef(projectId, styleId) {
  return doc(stylesCollection(projectId), styleId);
}

export function subscribeEditorialStyles({ projectId, onChange, onError }) {
  return onSnapshot(stylesCollection(projectId), (snapshot) => {
    onChange(snapshot.docs.map((item, index) => normalizeDesignStyle({ id: item.id, ...item.data() }, index)).sort((a, b) => a.order - b.order));
  }, onError);
}

export async function createEditorialStyle({ projectId, values, element, user }) {
  const uid = requireUser(user);
  if (!element) throw new Error("Selecciona un elemento para crear el estilo.");
  const snapshot = await getDocs(stylesCollection(projectId));
  const styleRef = doc(stylesCollection(projectId));
  const batch = writeBatch(db);
  batch.set(styleRef, {
    name: String(values.name || `Estilo ${element.type}`).trim(),
    type: element.type,
    category: String(values.category || "General"),
    properties: { ...(element.style || {}) },
    order: snapshot.size,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  batch.update(projectRef(projectId), { updatedAt: serverTimestamp() });
  await batch.commit();
  return styleRef.id;
}

export async function updateEditorialStyle({ projectId, styleId, changes, user }) {
  const uid = requireUser(user);
  const allowed = ["name", "category", "properties", "order"];
  const safe = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  const batch = writeBatch(db);
  batch.update(getEditorialStyleRef(projectId, styleId), { ...safe, updatedAt: serverTimestamp(), updatedByUid: uid });
  batch.update(projectRef(projectId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function duplicateEditorialStyle({ projectId, style, user }) {
  return createEditorialStyle({ projectId, values: { ...style, name: `${style.name} · Copia` }, element: { type: style.type, style: style.properties }, user });
}

async function collectElementCollections(projectId) {
  const collections = [];
  const project = projectRef(projectId);
  const components = await getDocs(collection(project, "components"));
  components.docs.forEach((component) => collections.push(collection(component.ref, EDITORIAL_COLLECTIONS.elements)));
  const documents = await getDocs(collection(project, EDITORIAL_COLLECTIONS.documents));
  for (const documentSnapshot of documents.docs) {
    const pages = await getDocs(collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.pages));
    pages.docs.forEach((page) => collections.push(collection(page.ref, EDITORIAL_COLLECTIONS.elements)));
    const masters = await getDocs(collection(documentSnapshot.ref, "masterPages"));
    masters.docs.forEach((master) => collections.push(collection(master.ref, EDITORIAL_COLLECTIONS.elements)));
  }
  return collections;
}

export async function deleteEditorialStyle({ projectId, style, unlinkElements = false, user }) {
  const uid = requireUser(user);
  const collections = await collectElementCollections(projectId);
  const linked = [];
  for (const elementsCollection of collections) {
    const snapshot = await getDocs(elementsCollection);
    snapshot.docs.forEach((element) => {
      if (element.data().styleId === style.id) linked.push(element);
    });
  }
  if (linked.length && !unlinkElements) throw new Error(`Estilo usado en ${linked.length} elemento(s). Desvincula antes de eliminar.`);
  const operations = [];
  linked.forEach((element) => operations.push((batch) => {
    const data = element.data();
    batch.update(element.ref, {
      styleId: "",
      styleOverrides: {},
      style: { ...(style.properties || {}), ...(data.styleOverrides || {}) },
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  }));
  operations.push((batch) => batch.delete(getEditorialStyleRef(projectId, style.id)));
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
}
