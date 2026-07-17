import { collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { deleteObject, getBytes, getDownloadURL, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../services/firebase";
import { cloneDesignElements, normalizeEditorialTemplate } from "../models/editorialDesign";
import { resolveLocalElements, resolveMasterElements } from "../utils/editorialInheritance";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";
import { getEditorialDocumentRef, getEditorialPageRef } from "./editorialPagesService";
import { getMasterPageRef } from "./editorialMasterPagesService";

function requireUser(user) {
  const uid = user?.uid || user?.id;
  if (!uid) throw new Error("No se encontró usuario para modificar plantillas.");
  return uid;
}

function templateRef(templateId) {
  return doc(db, EDITORIAL_COLLECTIONS.templates, templateId);
}

function templatePages(templateId) {
  return collection(templateRef(templateId), EDITORIAL_COLLECTIONS.pages);
}

function safeAssetName(element) {
  return String(element.name || element.storagePath?.split("/").pop() || "imagen")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function copyStoredFile(sourcePath, targetPath) {
  const sourceRef = ref(storage, sourcePath);
  const [bytes, metadata] = await Promise.all([getBytes(sourceRef), getMetadata(sourceRef)]);
  const targetRef = ref(storage, targetPath);
  await uploadBytes(targetRef, bytes, { contentType: metadata.contentType || "image/png" });
  return getDownloadURL(targetRef);
}

async function copyImagesToTemplate(templateId, uid, elements) {
  return Promise.all(elements.map(async (element) => {
    if (element.type !== "image" || !element.storagePath) return element;
    const storagePath = `editorialTemplates/${templateId}/${uid}/${element.id}-${safeAssetName(element)}`;
    const assetUrl = await copyStoredFile(element.storagePath, storagePath);
    return { ...element, assetId: "", assetUrl, storagePath, templateAsset: true };
  }));
}

async function copyTemplateImagesToProject({ projectId, documentId, pageId, uid, elements }) {
  const copied = [];
  const assets = [];
  for (const element of elements) {
    if (element.type !== "image" || !element.storagePath?.startsWith("editorialTemplates/")) {
      copied.push(element);
      continue;
    }
    const assetRef = doc(collection(db, EDITORIAL_COLLECTIONS.assets));
    const storagePath = `editorial/${projectId}/images/${uid}/${element.id}-${safeAssetName(element)}`;
    const assetUrl = await copyStoredFile(element.storagePath, storagePath);
    copied.push({ ...element, assetId: assetRef.id, assetUrl, storagePath, templateAsset: false });
    assets.push({ ref: assetRef, data: {
      projectId, documentId, pageId, ownerUid: uid, name: element.name || "Imagen", type: "image",
      url: assetUrl, storagePath, width: Number(element.naturalWidth || element.width || 0),
      height: Number(element.naturalHeight || element.height || 0), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    } });
  }
  return { elements: copied, assets };
}

async function deleteStorageTree(folderRef) {
  const contents = await listAll(folderRef);
  await Promise.all(contents.items.map((item) => deleteObject(item)));
  await Promise.all(contents.prefixes.map((prefix) => deleteStorageTree(prefix)));
}

export function subscribeEditorialTemplates({ projectId, onChange, onError }) {
  const values = { project: [], institutional: [] };
  const emit = () => {
    const merged = new Map([...values.project, ...values.institutional].map((item) => [item.id, item]));
    onChange([...merged.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))));
  };
  const map = (snapshot) => snapshot.docs.map((item, index) => normalizeEditorialTemplate({ id: item.id, ...item.data() }, index));
  const unsubscribeProject = onSnapshot(query(collection(db, EDITORIAL_COLLECTIONS.templates), where("projectId", "==", projectId)), (snapshot) => { values.project = map(snapshot); emit(); }, onError);
  const unsubscribeInstitutional = onSnapshot(query(collection(db, EDITORIAL_COLLECTIONS.templates), where("visibility", "==", "institutional")), (snapshot) => { values.institutional = map(snapshot); emit(); }, onError);
  return () => { unsubscribeProject(); unsubscribeInstitutional(); };
}

async function readPageElements(pageRef) {
  const snapshot = await getDocs(collection(pageRef, EDITORIAL_COLLECTIONS.elements));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function readTemplateDesign(projectId) {
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const [stylesSnapshot, componentsSnapshot] = await Promise.all([
    getDocs(collection(projectRef, "styles")),
    getDocs(collection(projectRef, "components")),
  ]);
  const stylesById = new Map(stylesSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
  const components = [];
  for (const component of componentsSnapshot.docs) {
    components.push({ id: component.id, ...component.data(), elements: await readPageElements(component.ref) });
  }
  return { stylesById, componentsById: new Map(components.map((component) => [component.id, component])) };
}

async function readFlattenedPageElements({ projectId, documentId, page, design }) {
  const local = resolveLocalElements(await readPageElements(getEditorialPageRef(projectId, documentId, page.id)), design);
  if (!page.masterPageId) return local;
  const masterElements = await readPageElements(getMasterPageRef(projectId, documentId, page.masterPageId));
  return [...resolveMasterElements(masterElements, page.masterOverrides, design), ...local];
}

export async function createEditorialTemplate({ projectId, documentId, pages, section, values, user }) {
  const uid = requireUser(user);
  if (!pages?.length) throw new Error("Selecciona página o unidad para guardar.");
  if (values.visibility === "institutional" && String(user?.role || "").toLowerCase() !== "admin") throw new Error("Solo administración puede crear plantillas institucionales.");
  const nextTemplateRef = doc(collection(db, EDITORIAL_COLLECTIONS.templates));
  const metadata = {
    name: String(values.name || "Nueva plantilla").trim(),
    description: String(values.description || ""),
    category: String(values.category || "General"),
    type: values.type || (pages.length > 1 ? "unit" : "page"),
    visibility: values.visibility === "institutional" ? "institutional" : "project",
    projectId,
    ownerUid: uid,
    pageCount: pages.length,
    elementCount: 0,
    thumbnail: { background: pages[0].background || "#ffffff", pageCount: pages.length, elementCount: 0 },
    section: section ? { name: section.name, type: section.type, numberingStyle: section.numberingStyle, numberingMode: section.numberingMode, numberingStart: section.numberingStart, startOnRight: section.startOnRight } : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const metadataBatch = writeBatch(db);
  metadataBatch.set(nextTemplateRef, metadata);
  await metadataBatch.commit();
  try {
    const pagePayloads = [];
    let elementCount = 0;
    const design = await readTemplateDesign(projectId);
    for (const page of pages) {
      const flattened = await readFlattenedPageElements({ projectId, documentId, page, design });
      const elements = await copyImagesToTemplate(nextTemplateRef.id, uid, cloneDesignElements(flattened));
      elementCount += elements.length;
      pagePayloads.push({ page, elements });
    }
    const operations = [];
    pagePayloads.forEach(({ page, elements }, pageIndex) => {
    const nextPageRef = doc(templatePages(nextTemplateRef.id));
    operations.push((batch) => batch.set(nextPageRef, {
      name: page.name,
      order: pageIndex,
      pageType: page.pageType,
      width: page.width,
      height: page.height,
      orientation: page.orientation,
      background: page.background,
      isBlank: page.isBlank,
      numberingEnabled: page.numberingEnabled,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    elements.forEach((element) => operations.push((batch) => batch.set(doc(nextPageRef, EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
    });
    operations.push((batch) => batch.update(nextTemplateRef, { elementCount, thumbnail: { ...metadata.thumbnail, elementCount }, updatedAt: serverTimestamp() }));
    for (let index = 0; index < operations.length; index += 440) {
      const batch = writeBatch(db);
      operations.slice(index, index + 440).forEach((operation) => operation(batch));
      await batch.commit();
    }
    return nextTemplateRef.id;
  } catch (error) {
    await deleteStorageTree(ref(storage, `editorialTemplates/${nextTemplateRef.id}`)).catch(() => {});
    await deleteDoc(nextTemplateRef).catch(() => {});
    throw error;
  }
}

export async function applyEditorialTemplate({ projectId, documentId, template, project, user }) {
  const uid = requireUser(user);
  const [existingPages, existingSections, templatePagesSnapshot] = await Promise.all([
    getDocs(collection(getEditorialDocumentRef(projectId, documentId), EDITORIAL_COLLECTIONS.pages)),
    getDocs(collection(getEditorialDocumentRef(projectId, documentId), "sections")),
    getDocs(templatePages(template.id)),
  ]);
  const orderedTemplatePages = templatePagesSnapshot.docs.sort((a, b) => Number(a.data().order || 0) - Number(b.data().order || 0));
  if (!orderedTemplatePages.length) throw new Error("Plantilla sin páginas disponibles.");
  const sectionRef = template.type === "unit" || template.type === "section"
    ? doc(collection(getEditorialDocumentRef(projectId, documentId), "sections"))
    : null;
  const operations = [];
  if (sectionRef) operations.push((batch) => batch.set(sectionRef, {
    name: template.section?.name || template.name,
    type: template.section?.type || (template.type === "unit" ? "unit" : "custom"),
    order: existingSections.size,
    numberingStyle: template.section?.numberingStyle || "arabic",
    numberingMode: template.section?.numberingMode || "continue",
    numberingStart: template.section?.numberingStart || 1,
    startOnRight: template.section?.startOnRight === true,
    collapsed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  }));
  const createdPageIds = [];
  for (let pageIndex = 0; pageIndex < orderedTemplatePages.length; pageIndex += 1) {
    const source = orderedTemplatePages[pageIndex];
    const target = doc(collection(getEditorialDocumentRef(projectId, documentId), EDITORIAL_COLLECTIONS.pages));
    createdPageIds.push(target.id);
    operations.push((batch) => batch.set(target, {
      ...source.data(),
      order: existingPages.size + pageIndex,
      sectionId: sectionRef?.id || "",
      width: Number(source.data().width || project.widthIn || 8),
      height: Number(source.data().height || project.heightIn || 10),
      masterPageId: "",
      masterOverrides: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    }));
    const elements = await getDocs(collection(source.ref, EDITORIAL_COLLECTIONS.elements));
    const copied = await copyTemplateImagesToProject({
      projectId, documentId, pageId: target.id, uid,
      elements: cloneDesignElements(elements.docs.map((item) => ({ id: item.id, ...item.data() }))),
    });
    copied.assets.forEach((asset) => operations.push((batch) => batch.set(asset.ref, asset.data)));
    copied.elements.forEach((element) => operations.push((batch) => batch.set(doc(target, EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
  }
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  return createdPageIds;
}

export async function updateEditorialTemplate({ templateId, changes, user }) {
  const uid = requireUser(user);
  const allowed = ["name", "description", "category", "visibility"];
  const safe = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  const batch = writeBatch(db);
  batch.update(templateRef(templateId), { ...safe, updatedAt: serverTimestamp(), updatedByUid: uid });
  await batch.commit();
}

export async function replaceEditorialTemplateContent({ template, projectId, documentId, pages, section, user }) {
  const uid = requireUser(user);
  if (!pages?.length) throw new Error("No hay páginas para actualizar la plantilla.");
  await deleteStorageTree(ref(storage, `editorialTemplates/${template.id}`));
  const existingPages = await getDocs(templatePages(template.id));
  const deleteOperations = [];
  for (const page of existingPages.docs) {
    const elements = await getDocs(collection(page.ref, EDITORIAL_COLLECTIONS.elements));
    elements.docs.forEach((element) => deleteOperations.push((batch) => batch.delete(element.ref)));
    deleteOperations.push((batch) => batch.delete(page.ref));
  }
  for (let index = 0; index < deleteOperations.length; index += 440) {
    const batch = writeBatch(db);
    deleteOperations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  const operations = [];
  let elementCount = 0;
  const design = await readTemplateDesign(projectId);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const elements = await copyImagesToTemplate(template.id, uid, cloneDesignElements(await readFlattenedPageElements({ projectId, documentId, page, design })));
    elementCount += elements.length;
    const nextPageRef = doc(templatePages(template.id));
    operations.push((batch) => batch.set(nextPageRef, {
      name: page.name, order: pageIndex, pageType: page.pageType, width: page.width, height: page.height,
      orientation: page.orientation, background: page.background, isBlank: page.isBlank,
      numberingEnabled: page.numberingEnabled, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    elements.forEach((element) => operations.push((batch) => batch.set(doc(nextPageRef, EDITORIAL_COLLECTIONS.elements, element.id), { ...element, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
  }
  operations.push((batch) => batch.update(templateRef(template.id), {
    pageCount: pages.length,
    elementCount,
    thumbnail: { background: pages[0].background || "#ffffff", pageCount: pages.length, elementCount },
    section: section ? { name: section.name, type: section.type, numberingStyle: section.numberingStyle, numberingMode: section.numberingMode, numberingStart: section.numberingStart, startOnRight: section.startOnRight } : null,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  }));
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function deleteEditorialTemplate({ templateId }) {
  await deleteStorageTree(ref(storage, `editorialTemplates/${templateId}`));
  const pagesSnapshot = await getDocs(templatePages(templateId));
  const operations = [];
  for (const page of pagesSnapshot.docs) {
    const elements = await getDocs(collection(page.ref, EDITORIAL_COLLECTIONS.elements));
    elements.docs.forEach((element) => operations.push((batch) => batch.delete(element.ref)));
    operations.push((batch) => batch.delete(page.ref));
  }
  for (let index = 0; index < operations.length; index += 440) {
    const batch = writeBatch(db);
    operations.slice(index, index + 440).forEach((operation) => operation(batch));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(templateRef(templateId));
  await batch.commit();
}
