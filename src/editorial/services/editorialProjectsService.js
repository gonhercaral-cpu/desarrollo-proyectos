import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, listAll, ref } from "firebase/storage";
import { db, storage } from "../../services/firebase";
import {
  DEFAULT_EDITORIAL_CONFIG,
  getEditorialProjectConfig,
  getOrientedDimensions,
} from "../models/editorialModels";
import {
  BOOK_INITIAL_STRUCTURE,
  normalizeEditorialPages,
  normalizeEditorialSections,
} from "../models/editorialStructure";
import { normalizeAcademicMetadata } from "../models/editorialAcademic";
import { physicalSizeChanged, resizeEditorialElements } from "../utils/editorialDocumentSizing";

export const EDITORIAL_COLLECTIONS = {
  projects: "editorialProjects",
  documents: "documents",
  pages: "pages",
  sections: "sections",
  elements: "elements",
  templates: "editorialTemplates",
  assets: "editorialAssets",
};

function requireUser(user) {
  const uid = user?.uid || user?.id;

  if (!uid || user?.active !== true) {
    throw new Error("Necesitas un perfil activo para usar Editor Editorial.");
  }

  return uid;
}

function getAuditData(user) {
  return {
    uid: user?.uid || user?.id || "",
    name: user?.name || "",
    email: user?.email || "",
  };
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const bMillis = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    const aMillis = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    return bMillis - aMillis;
  });
}

export function subscribeEditorialProjects({ user, isAdmin, onChange, onError }) {
  const uid = requireUser(user);
  const projectsRef = collection(db, EDITORIAL_COLLECTIONS.projects);

  if (isAdmin) {
    return onSnapshot(
      projectsRef,
      (snapshot) => onChange(sortProjects(mapSnapshot(snapshot))),
      onError
    );
  }

  let ownedProjects = [];
  let sharedProjects = [];

  function emitProjects() {
    const merged = new Map();
    [...ownedProjects, ...sharedProjects].forEach((project) => merged.set(project.id, project));
    onChange(sortProjects([...merged.values()]));
  }

  const unsubscribeOwned = onSnapshot(
    query(projectsRef, where("ownerUid", "==", uid)),
    (snapshot) => {
      ownedProjects = mapSnapshot(snapshot);
      emitProjects();
    },
    onError
  );
  const unsubscribeShared = onSnapshot(
    query(projectsRef, where("collaboratorUids", "array-contains", uid)),
    (snapshot) => {
      sharedProjects = mapSnapshot(snapshot);
      emitProjects();
    },
    onError
  );

  return () => {
    unsubscribeOwned();
    unsubscribeShared();
  };
}

export async function createEditorialProject(config, user) {
  const uid = requireUser(user);
  const safeConfig = { ...DEFAULT_EDITORIAL_CONFIG, ...getEditorialProjectConfig(config) };
  const persistedConfig = { ...safeConfig };
  delete persistedConfig.resizeMode;
  const name = safeConfig.name.trim();

  if (!name) {
    throw new Error("Escribe un nombre para el proyecto.");
  }

  const projectRef = doc(collection(db, EDITORIAL_COLLECTIONS.projects));
  const documentRef = doc(collection(projectRef, EDITORIAL_COLLECTIONS.documents));
  const dimensions = getOrientedDimensions(safeConfig);
  const audit = getAuditData(user);
  const academicMetadata = normalizeAcademicMetadata(config);
  const batch = writeBatch(db);

  batch.set(projectRef, {
    ...persistedConfig,
    ...dimensions,
    name,
    ownerUid: uid,
    collaboratorUids: [],
    status: "active",
    archived: false,
    ...(config.sourceFileId ? {
      sourceFileId: String(config.sourceFileId),
      sourceFileName: String(config.sourceFileName || ""),
      sourceMimeType: String(config.sourceMimeType || ""),
      sourceDeliveredName: String(config.sourceDeliveredName || config.sourceFileName || ""),
      sourceDeliveredMimeType: String(config.sourceDeliveredMimeType || config.sourceMimeType || ""),
      sourceExported: config.sourceExported === true,
      sourceProvider: String(config.sourceProvider || "nube_aes"),
      sourcePreserved: true,
    } : {}),
    ...(Object.keys(academicMetadata).length ? { ...academicMetadata, academicMetadata } : {}),
    createdBy: audit,
    updatedBy: audit,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(documentRef, {
    name: "Documento principal",
    position: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const initialStructure = safeConfig.type === "book"
    ? BOOK_INITIAL_STRUCTURE
    : [{ name: "Página 1", type: "custom", numberingStyle: "arabic", pageType: "content" }];
  initialStructure.forEach((item, order) => {
    const sectionRef = safeConfig.type === "book"
      ? doc(collection(documentRef, EDITORIAL_COLLECTIONS.sections))
      : null;
    const pageRef = doc(collection(documentRef, EDITORIAL_COLLECTIONS.pages));
    if (sectionRef) {
      batch.set(sectionRef, {
        name: item.name,
        type: item.type,
        order,
        numberingStyle: item.numberingStyle || "arabic",
        numberingMode: item.numberingMode || "continue",
        numberingStart: item.numberingStart || 1,
        startOnRight: item.startOnRight === true,
        collapsed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(pageRef, {
      name: item.name,
      order,
      sectionId: sectionRef?.id || "",
      pageType: item.pageType || "content",
      width: dimensions.widthIn,
      height: dimensions.heightIn,
      orientation: safeConfig.orientation,
      background: "#ffffff",
      isBlank: false,
      numberingEnabled: !["cover", "back_cover"].includes(item.pageType),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return projectRef.id;
}

export async function getEditorialProject(projectId) {
  const snapshot = await getDoc(doc(db, EDITORIAL_COLLECTIONS.projects, projectId));

  if (!snapshot.exists()) {
    throw new Error("El proyecto editorial no existe o ya fue eliminado.");
  }

  return { id: snapshot.id, ...snapshot.data() };
}

export function subscribeEditorialProject(projectId, onChange, onError) {
  return onSnapshot(
    doc(db, EDITORIAL_COLLECTIONS.projects, projectId),
    (snapshot) => onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError
  );
}

export async function getEditorialProjectStructure(projectId) {
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const documentsSnapshot = await getDocs(collection(projectRef, EDITORIAL_COLLECTIONS.documents));
  const documents = await Promise.all(
    documentsSnapshot.docs.map(async (documentSnapshot) => {
      const [pagesSnapshot, sectionsSnapshot] = await Promise.all([
        getDocs(collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.pages)),
        getDocs(collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.sections)),
      ]);

      return {
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
        pages: normalizeEditorialPages(mapSnapshot(pagesSnapshot)),
        sections: normalizeEditorialSections(mapSnapshot(sectionsSnapshot)),
      };
    })
  );

  return documents.sort((a, b) => a.position - b.position);
}

export async function updateEditorialProject(projectId, changes, user) {
  requireUser(user);
  await updateDoc(doc(db, EDITORIAL_COLLECTIONS.projects, projectId), {
    ...changes,
    updatedBy: getAuditData(user),
    updatedAt: serverTimestamp(),
  });
}

// Fase 7 — Permisos editoriales por usuario y departamento. Escritura sólo por
// propietario o admin (Firestore Rules). No modifica roles globales. Notifica el
// cambio (actividad: permission_changed).
export async function updateEditorialPermissions({ projectId, project, permissions, user }) {
  const safe = {
    users: { ...(permissions?.users || {}) },
    departments: { ...(permissions?.departments || {}) },
  };
  await updateEditorialProject(projectId, { editorialPermissions: safe }, user);
  try {
    const mod = await import("../../services/notificationsService");
    await mod.createEditorialEventNotifications({
      project: { ...(project || {}), id: projectId, editorialPermissions: safe },
      type: "EDITORIAL_PERMISSIONS_CHANGED",
      title: "Permisos editoriales actualizados",
      message: "Se actualizaron los permisos del documento editorial.",
      actorUid: String(user?.uid || user?.id || ""),
      actorName: String(user?.name || user?.email || "Usuario"),
      actorIsAdmin: String(user?.role || "").toLowerCase() === "admin",
      dedupeKey: `EDITORIAL_PERMISSIONS_CHANGED:${projectId}:${Date.now()}`,
      link: `/editorial/${projectId}`,
    });
  } catch (error) {
    console.warn("No se pudo notificar el cambio de permisos:", error);
  }
  return safe;
}

export async function renameEditorialProject(projectId, name, user) {
  const nextName = String(name || "").trim();

  if (!nextName) {
    throw new Error("El nombre no puede quedar vacío.");
  }

  return updateEditorialProject(projectId, { name: nextName }, user);
}

export async function updateEditorialProjectConfig(projectId, config, user) {
  const uid = requireUser(user);
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const previousSnapshot = await getDoc(projectRef);
  if (!previousSnapshot.exists()) throw new Error("El proyecto editorial no existe.");
  const previous = getEditorialProjectConfig(previousSnapshot.data());
  const safeConfig = getEditorialProjectConfig(config);
  const dimensions = getOrientedDimensions(safeConfig);
  const next = { ...safeConfig, ...dimensions };
  const resizeMode = ["preserve", "scale", "center"].includes(config.resizeMode) ? config.resizeMode : "preserve";

  if (physicalSizeChanged(previous, next)) {
    const operations = [];
    const documentsSnapshot = await getDocs(collection(projectRef, EDITORIAL_COLLECTIONS.documents));
    for (const documentSnapshot of documentsSnapshot.docs) {
      for (const collectionName of [EDITORIAL_COLLECTIONS.pages, "masterPages"]) {
        const surfaces = await getDocs(collection(documentSnapshot.ref, collectionName));
        for (const surface of surfaces.docs) {
          const data = surface.data();
          const width = Number(data.width || previous.widthIn);
          const height = Number(data.height || previous.heightIn);
          const followsDocumentSize = Math.abs(width - previous.widthIn) < 0.001 && Math.abs(height - previous.heightIn) < 0.001;
          if (!followsDocumentSize) continue;
          operations.push((batch) => batch.update(surface.ref, { width: dimensions.widthIn, height: dimensions.heightIn, orientation: next.orientation, updatedAt: serverTimestamp(), updatedByUid: uid }));
          if (resizeMode === "preserve") continue;
          const elementsSnapshot = await getDocs(collection(surface.ref, EDITORIAL_COLLECTIONS.elements));
          const resized = resizeEditorialElements(elementsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })), { widthIn: width, heightIn: height }, dimensions, resizeMode);
          resized.forEach((element) => operations.push((batch) => batch.update(doc(surface.ref, EDITORIAL_COLLECTIONS.elements, element.id), {
            x: element.x, y: element.y, width: element.width, height: element.height, style: element.style,
            ...(element.shadow ? { shadow: element.shadow } : {}),
            ...(element.imageBorder ? { imageBorder: element.imageBorder } : {}),
            updatedAt: serverTimestamp(),
          })));
        }
      }
    }
    for (let index = 0; index < operations.length; index += 400) {
      const batch = writeBatch(db);
      operations.slice(index, index + 400).forEach((operation) => operation(batch));
      await batch.commit();
    }
  }

  const persisted = { ...next };
  delete persisted.resizeMode;
  return updateEditorialProject(projectId, persisted, user);
}

export async function duplicateEditorialProject(project, user) {
  const config = getEditorialProjectConfig(project);
  return createEditorialProject({ ...config, name: `${project.name} · Copia` }, user);
}

export async function setEditorialProjectArchived(projectId, archived, user) {
  return updateEditorialProject(
    projectId,
    {
      archived,
      status: archived ? "archived" : "active",
      archivedAt: archived ? serverTimestamp() : null,
    },
    user
  );
}

async function collectProjectDocumentRefs(projectId) {
  const refs = [];
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const documentsSnapshot = await getDocs(collection(projectRef, EDITORIAL_COLLECTIONS.documents));

  for (const documentSnapshot of documentsSnapshot.docs) {
    const pagesSnapshot = await getDocs(
      collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.pages)
    );

    for (const pageSnapshot of pagesSnapshot.docs) {
      const elementsSnapshot = await getDocs(
        collection(pageSnapshot.ref, EDITORIAL_COLLECTIONS.elements)
      );
      elementsSnapshot.docs.forEach((elementSnapshot) => refs.push(elementSnapshot.ref));
      refs.push(pageSnapshot.ref);
    }

    const sectionsSnapshot = await getDocs(
      collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.sections)
    );
    sectionsSnapshot.docs.forEach((sectionSnapshot) => refs.push(sectionSnapshot.ref));

    const mastersSnapshot = await getDocs(collection(documentSnapshot.ref, "masterPages"));
    for (const masterSnapshot of mastersSnapshot.docs) {
      const elementsSnapshot = await getDocs(collection(masterSnapshot.ref, EDITORIAL_COLLECTIONS.elements));
      elementsSnapshot.docs.forEach((elementSnapshot) => refs.push(elementSnapshot.ref));
      refs.push(masterSnapshot.ref);
    }

    for (const childCollection of ["comments", "versions", "exports"]) {
      const snapshot = await getDocs(collection(documentSnapshot.ref, childCollection));
      snapshot.docs.forEach((item) => refs.push(item.ref));
    }

    refs.push(documentSnapshot.ref);
  }

  const componentsSnapshot = await getDocs(collection(projectRef, "components"));
  for (const componentSnapshot of componentsSnapshot.docs) {
    const elementsSnapshot = await getDocs(collection(componentSnapshot.ref, EDITORIAL_COLLECTIONS.elements));
    elementsSnapshot.docs.forEach((elementSnapshot) => refs.push(elementSnapshot.ref));
    refs.push(componentSnapshot.ref);
  }
  for (const childCollection of ["styles", "variables"]) {
    const snapshot = await getDocs(collection(projectRef, childCollection));
    snapshot.docs.forEach((item) => refs.push(item.ref));
  }

  const assetsSnapshot = await getDocs(
    query(
      collection(db, EDITORIAL_COLLECTIONS.assets),
      where("projectId", "==", projectId)
    )
  );
  assetsSnapshot.docs.forEach((assetSnapshot) => refs.push(assetSnapshot.ref));
  return refs;
}

async function deleteStorageFolder(folderRef) {
  const contents = await listAll(folderRef);
  await Promise.all(contents.items.map((itemRef) => deleteObject(itemRef)));
  await Promise.all(contents.prefixes.map((prefixRef) => deleteStorageFolder(prefixRef)));
}

async function deleteProjectTemplates(projectId) {
  const templatesSnapshot = await getDocs(query(collection(db, EDITORIAL_COLLECTIONS.templates), where("projectId", "==", projectId)));
  for (const templateSnapshot of templatesSnapshot.docs) {
    await deleteStorageFolder(ref(storage, `editorialTemplates/${templateSnapshot.id}`));
    const childRefs = [];
    const pagesSnapshot = await getDocs(collection(templateSnapshot.ref, EDITORIAL_COLLECTIONS.pages));
    for (const pageSnapshot of pagesSnapshot.docs) {
      const elementsSnapshot = await getDocs(collection(pageSnapshot.ref, EDITORIAL_COLLECTIONS.elements));
      elementsSnapshot.docs.forEach((elementSnapshot) => childRefs.push(elementSnapshot.ref));
      childRefs.push(pageSnapshot.ref);
    }
    for (let index = 0; index < childRefs.length; index += 450) {
      const batch = writeBatch(db);
      childRefs.slice(index, index + 450).forEach((childRef) => batch.delete(childRef));
      await batch.commit();
    }
    const batch = writeBatch(db);
    batch.delete(templateSnapshot.ref);
    await batch.commit();
  }
}

export async function deleteEditorialProject(projectId, user) {
  requireUser(user);
  await deleteStorageFolder(ref(storage, `editorial/${projectId}`));
  await deleteProjectTemplates(projectId);
  const refs = await collectProjectDocumentRefs(projectId);

  for (let index = 0; index < refs.length; index += 450) {
    const batch = writeBatch(db);
    refs.slice(index, index + 450).forEach((documentRef) => batch.delete(documentRef));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, EDITORIAL_COLLECTIONS.projects, projectId));
  await batch.commit();
}
