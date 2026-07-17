import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../services/firebase";
import { normalizeElementOrder, normalizeEditorialElement } from "../models/editorialElements";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

function requireEditorContext(context) {
  if (!context?.projectId) {
    throw new Error("Falta contexto de proyecto editorial.");
  }
  if (context.kind === "master" && (!context.documentId || !context.masterPageId)) {
    throw new Error("Falta contexto de página maestra.");
  }
  if (context.kind === "component" && !context.componentId) {
    throw new Error("Falta contexto de componente.");
  }
  if ((!context.kind || context.kind === "page") && (!context.documentId || !context.pageId)) {
    throw new Error("Falta contexto de página.");
  }
}

export function getEditorialEditableRef(context) {
  requireEditorContext(context);
  if (context.kind === "master") {
    return doc(db, EDITORIAL_COLLECTIONS.projects, context.projectId, EDITORIAL_COLLECTIONS.documents, context.documentId, "masterPages", context.masterPageId);
  }
  if (context.kind === "component") {
    return doc(db, EDITORIAL_COLLECTIONS.projects, context.projectId, "components", context.componentId);
  }
  return doc(
    db,
    EDITORIAL_COLLECTIONS.projects,
    context.projectId,
    EDITORIAL_COLLECTIONS.documents,
    context.documentId,
    EDITORIAL_COLLECTIONS.pages,
    context.pageId
  );
}

function getElementsCollection(context) {
  return collection(getEditorialEditableRef(context), EDITORIAL_COLLECTIONS.elements);
}

export function subscribeEditorialPageElements(context, onChange, onError) {
  requireEditorContext(context);
  return onSnapshot(
    getElementsCollection(context),
    (snapshot) => {
      const elements = snapshot.docs.map((snapshotDocument, index) =>
        normalizeEditorialElement({ id: snapshotDocument.id, ...snapshotDocument.data() }, index)
      );
      onChange(normalizeElementOrder(elements));
    },
    onError
  );
}

export async function saveEditorialPageElements({ context, elements, persistedIds, user }) {
  requireEditorContext(context);
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para guardar.");

  const orderedElements = normalizeElementOrder(elements);
  const currentIds = new Set(orderedElements.map((element) => element.id));
  const deletedIds = [...persistedIds].filter((id) => !currentIds.has(id));
  const operations = [
    ...orderedElements.map((element) => ({ type: "set", element })),
    ...deletedIds.map((id) => ({ type: "delete", id })),
  ];
  const elementsCollection = getElementsCollection(context);

  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => {
      const elementRef = doc(elementsCollection, operation.id || operation.element.id);
      if (operation.type === "delete") {
        batch.delete(elementRef);
        return;
      }

      batch.set(elementRef, {
        ...operation.element,
        updatedByUid: uid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  const metadataBatch = writeBatch(db);
  metadataBatch.update(getEditorialEditableRef(context), {
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  metadataBatch.update(doc(db, EDITORIAL_COLLECTIONS.projects, context.projectId), {
    updatedAt: serverTimestamp(),
    updatedBy: {
      uid,
      name: user?.name || "",
      email: user?.email || "",
    },
  });
  await metadataBatch.commit();

  return new Set(currentIds);
}

function safeFileName(fileName) {
  return String(fileName || "imagen")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imagen";
}

export async function readImageDimensions(file) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export async function uploadEditorialImage({ context, file, user }) {
  const uid = user?.uid || user?.id;
  const { projectId, documentId, pageId, masterPageId, componentId, kind = "page" } = context || {};
  if (!projectId || !uid || !file) throw new Error("No se pudo preparar la imagen.");
  if (!file.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen válido.");

  const dimensions = await readImageDimensions(file);
  const assetRef = doc(collection(db, EDITORIAL_COLLECTIONS.assets));
  const storagePath = `editorial/${projectId}/images/${uid}/${assetRef.id}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  const asset = {
    id: assetRef.id,
    projectId,
    documentId,
    pageId,
    masterPageId,
    componentId,
    contextKind: kind,
    ownerUid: uid,
    name: file.name || "Imagen",
    type: "image",
    mimeType: file.type,
    size: file.size,
    width: dimensions.width,
    height: dimensions.height,
    storagePath,
    url,
  };

  await setDoc(assetRef, {
    ...asset,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return asset;
}
