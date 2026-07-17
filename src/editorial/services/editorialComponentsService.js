import { collection, doc, getDocs, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { cloneDesignElements, normalizeDesignComponent } from "../models/editorialDesign";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";
import { cleanupUnusedEditorialAssets } from "./editorialAssetUsageService";
import { normalizeAcademicMetadata } from "../models/editorialAcademic";

export const EDITORIAL_COMPONENTS_COLLECTION = "components";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar componentes.");
  return uid;
}

function projectRef(projectId) {
  return doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
}

function componentsCollection(projectId) {
  return collection(projectRef(projectId), EDITORIAL_COMPONENTS_COLLECTION);
}

function getComponentThumbnail(elements) {
  const bounds = elements.reduce((result, element) => ({
    minX: Math.min(result.minX, Number(element.x || 0)),
    minY: Math.min(result.minY, Number(element.y || 0)),
    maxX: Math.max(result.maxX, Number(element.x || 0) + Number(element.width || 0)),
    maxY: Math.max(result.maxY, Number(element.y || 0) + Number(element.height || 0)),
  }), { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 });
  return {
    elementCount: elements.length,
    types: [...new Set(elements.map((element) => element.type))],
    width: Number.isFinite(bounds.minX) ? Math.max(1, bounds.maxX - bounds.minX) : 1,
    height: Number.isFinite(bounds.minY) ? Math.max(1, bounds.maxY - bounds.minY) : 1,
    background: elements.find((element) => element.type === "shape")?.style?.fill || "#ffffff",
  };
}

export function getEditorialComponentRef(projectId, componentId) {
  return doc(componentsCollection(projectId), componentId);
}

export function subscribeEditorialComponents({ projectId, onChange, onError }) {
  return onSnapshot(componentsCollection(projectId), (snapshot) => {
    onChange(snapshot.docs.map((item, index) => normalizeDesignComponent({ id: item.id, ...item.data() }, index)).sort((a, b) => a.order - b.order));
  }, onError);
}

export async function createEditorialComponent({ projectId, values, elements, user }) {
  const uid = requireUser(user);
  if (!elements?.length) throw new Error("Selecciona al menos un elemento.");
  const snapshot = await getDocs(componentsCollection(projectId));
  const componentRef = doc(componentsCollection(projectId));
  const cloned = cloneDesignElements(elements, { preserveStyleLinks: true });
  const academicMetadata = normalizeAcademicMetadata(values);
  const componentData = {
    name: String(values.name || "Nuevo componente").trim() || "Nuevo componente",
    description: String(values.description || ""),
    category: String(values.category || "General"),
    ...(Object.keys(academicMetadata).length ? { ...academicMetadata, academicMetadata } : {}),
    order: snapshot.size,
    usageCount: 0,
    elementCount: cloned.length,
    thumbnail: getComponentThumbnail(cloned),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  };
  if (cloned.length <= 438) {
    const batch = writeBatch(db);
    batch.set(componentRef, componentData);
    cloned.forEach((element) => batch.set(doc(componentRef, EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    batch.update(projectRef(projectId), { updatedAt: serverTimestamp() });
    await batch.commit();
  } else {
    const metadataBatch = writeBatch(db);
    metadataBatch.set(componentRef, componentData);
    metadataBatch.update(projectRef(projectId), { updatedAt: serverTimestamp() });
    await metadataBatch.commit();
    for (let index = 0; index < cloned.length; index += 440) {
      const batch = writeBatch(db);
      cloned.slice(index, index + 440).forEach((element) => batch.set(doc(componentRef, EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      await batch.commit();
    }
  }
  return componentRef.id;
}

export async function updateEditorialComponent({ projectId, componentId, changes, user }) {
  const uid = requireUser(user);
  const allowed = ["name", "description", "category", "order", "academicMetadata", "seriesId", "seriesName", "levelId", "levelName", "bookId", "bookName", "unitNumber", "unitTitle", "lessonNumber", "lessonTitle", "academicType", "activityNumber"];
  const safe = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  const batch = writeBatch(db);
  batch.update(getEditorialComponentRef(projectId, componentId), { ...safe, updatedAt: serverTimestamp(), updatedByUid: uid });
  batch.update(projectRef(projectId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function duplicateEditorialComponent({ projectId, component, elements, user }) {
  return createEditorialComponent({ projectId, values: { ...component, name: `${component.name} · Copia` }, elements, user });
}

async function findComponentInstances(projectId, componentId) {
  const matches = [];
  const documents = await getDocs(collection(projectRef(projectId), EDITORIAL_COLLECTIONS.documents));
  for (const documentSnapshot of documents.docs) {
    const pages = await getDocs(collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.pages));
    for (const pageSnapshot of pages.docs) {
      const elements = await getDocs(collection(pageSnapshot.ref, EDITORIAL_COLLECTIONS.elements));
      elements.docs.forEach((element) => {
        if (element.data().componentId === componentId) matches.push(element);
      });
    }
  }
  return matches;
}

export async function deleteEditorialComponent({ projectId, componentId, detachInstances = false, user }) {
  const uid = requireUser(user);
  const componentRef = getEditorialComponentRef(projectId, componentId);
  const [instances, elementsSnapshot] = await Promise.all([
    findComponentInstances(projectId, componentId),
    getDocs(collection(componentRef, EDITORIAL_COLLECTIONS.elements)),
  ]);
  if (instances.length && !detachInstances) throw new Error(`Componente usado en ${instances.length} elemento(s). Desvincula instancias antes de eliminar.`);
  const masterElements = new Map(elementsSnapshot.docs.map((element) => [element.id, element.data()]));
  const candidateAssetIds = new Set(elementsSnapshot.docs.map((element) => element.data().assetId).filter(Boolean));
  const operations = [];
  instances.forEach((instance) => operations.push((batch) => {
    const instanceData = instance.data();
    const master = masterElements.get(instanceData.componentElementId) || {};
    const override = instanceData.componentOverrides || {};
    const base = instanceData.componentBase;
    const data = {
      ...master,
      ...instanceData,
      ...(base ? {
        x: Number(master.x || 0) + (Number(instanceData.x || 0) - Number(base.x || 0)),
        y: Number(master.y || 0) + (Number(instanceData.y || 0) - Number(base.y || 0)),
        width: Number(master.width || 1) * (Number(instanceData.width || 1) / Math.max(1, Number(base.width || 1))),
        height: Number(master.height || 1) * (Number(instanceData.height || 1) / Math.max(1, Number(base.height || 1))),
        rotation: Number(master.rotation || 0) + (Number(instanceData.rotation || 0) - Number(base.rotation || 0)),
      } : {}),
      content: Object.hasOwn(override, "content") ? override.content : master.content ?? instanceData.content,
      style: { ...(master.style || instanceData.style || {}), ...(override.style || {}) },
      visibilityMode: override.visibilityMode || master.visibilityMode || instanceData.visibilityMode || "both",
      ...(master.answerData || override.answerData ? { answerData: Object.hasOwn(override, "answerData") ? override.answerData : master.answerData } : {}),
      ...(master.studentContent || override.studentContent ? { studentContent: override.studentContent ?? master.studentContent } : {}),
      ...(master.teacherContent || override.teacherContent ? { teacherContent: override.teacherContent ?? master.teacherContent } : {}),
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    };
    delete data.componentId;
    delete data.componentInstanceId;
    delete data.componentElementId;
    delete data.componentOverrides;
    delete data.componentBase;
    batch.set(instance.ref, data);
  }));
  elementsSnapshot.docs.forEach((element) => operations.push((batch) => batch.delete(element.ref)));
  operations.push((batch) => batch.delete(componentRef));
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  await cleanupUnusedEditorialAssets(projectId, candidateAssetIds);
}
