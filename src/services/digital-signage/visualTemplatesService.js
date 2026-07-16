import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  db,
  VISUAL_TEMPLATES_COLLECTION,
  assertAdminUser,
  cleanText,
  getUserName,
  getUserId,
  normalizeVisualTemplateDocument,
  cleanVisualTemplateCategory,
  normalizeVisualAdData,
  isValidVisualAdData,
  getOrderedCollection
} from "./shared";
import { logSignageAudit } from "./auditService";

export async function createVisualTemplate(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const category = cleanVisualTemplateCategory(data?.category);
  const visualAdData = normalizeVisualAdData(data?.visualAdData);

  if (!name) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }

  if (!isValidVisualAdData(visualAdData)) {
    throw new Error("La plantilla necesita un diseño válido.");
  }

  const templateRef = doc(collection(db, VISUAL_TEMPLATES_COLLECTION));
  const payload = {
    name,
    category,
    description: cleanText(data?.description),
    visualAdData,
    thumbnailHint: cleanText(data?.thumbnailHint),
    active: data?.active !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(templateRef, payload);
  await logSignageAudit("crear plantilla visual", "visual_template", templateRef.id, name, {
    category,
    active: payload.active,
  }, user);

  return {
    id: templateRef.id,
    ...payload,
  };
}

export async function getVisualTemplates() {
  const docs = await getOrderedCollection(VISUAL_TEMPLATES_COLLECTION);
  return docs.map(normalizeVisualTemplateDocument);
}

export async function updateVisualTemplate(id, data) {
  if (!id) throw new Error("Falta el ID de la plantilla.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    category:
      data?.category !== undefined ? cleanVisualTemplateCategory(data.category) : data?.category,
    description:
      data?.description !== undefined ? cleanText(data.description) : data?.description,
    visualAdData:
      data?.visualAdData !== undefined ? normalizeVisualAdData(data.visualAdData) : data?.visualAdData,
    thumbnailHint:
      data?.thumbnailHint !== undefined ? cleanText(data.thumbnailHint) : data?.thumbnailHint,
    updatedAt: serverTimestamp(),
  };

  if (payload.name !== undefined && !payload.name) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }

  if (payload.visualAdData !== undefined && !isValidVisualAdData(payload.visualAdData)) {
    throw new Error("La plantilla necesita un diseño válido.");
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, VISUAL_TEMPLATES_COLLECTION, id), payload);
}

export async function deleteVisualTemplate(id) {
  if (!id) throw new Error("Falta el ID de la plantilla.");
  await deleteDoc(doc(db, VISUAL_TEMPLATES_COLLECTION, id));
}
