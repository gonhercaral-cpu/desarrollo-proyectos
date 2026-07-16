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

export const EDITORIAL_COLLECTIONS = {
  projects: "editorialProjects",
  documents: "documents",
  pages: "pages",
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
  const name = safeConfig.name.trim();

  if (!name) {
    throw new Error("Escribe un nombre para el proyecto.");
  }

  const projectRef = doc(collection(db, EDITORIAL_COLLECTIONS.projects));
  const documentRef = doc(collection(projectRef, EDITORIAL_COLLECTIONS.documents));
  const pageRef = doc(collection(documentRef, EDITORIAL_COLLECTIONS.pages));
  const dimensions = getOrientedDimensions(safeConfig.size, safeConfig.orientation);
  const audit = getAuditData(user);
  const batch = writeBatch(db);

  batch.set(projectRef, {
    ...safeConfig,
    ...dimensions,
    name,
    ownerUid: uid,
    collaboratorUids: [],
    status: "active",
    archived: false,
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
  batch.set(pageRef, {
    name: "Página 1",
    number: 1,
    position: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
      const pagesSnapshot = await getDocs(
        collection(documentSnapshot.ref, EDITORIAL_COLLECTIONS.pages)
      );

      return {
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
        pages: mapSnapshot(pagesSnapshot).sort((a, b) => a.position - b.position),
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

export async function renameEditorialProject(projectId, name, user) {
  const nextName = String(name || "").trim();

  if (!nextName) {
    throw new Error("El nombre no puede quedar vacío.");
  }

  return updateEditorialProject(projectId, { name: nextName }, user);
}

export async function updateEditorialProjectConfig(projectId, config, user) {
  const safeConfig = getEditorialProjectConfig(config);
  const dimensions = getOrientedDimensions(safeConfig.size, safeConfig.orientation);
  return updateEditorialProject(projectId, { ...safeConfig, ...dimensions }, user);
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

    refs.push(documentSnapshot.ref);
  }

  const assetsSnapshot = await getDocs(
    query(
      collection(db, EDITORIAL_COLLECTIONS.assets),
      where("projectId", "==", projectId)
    )
  );
  assetsSnapshot.docs.forEach((assetSnapshot) => refs.push(assetSnapshot.ref));
  refs.push(projectRef);
  return refs;
}

async function deleteStorageFolder(folderRef) {
  const contents = await listAll(folderRef);
  await Promise.all(contents.items.map((itemRef) => deleteObject(itemRef)));
  await Promise.all(contents.prefixes.map((prefixRef) => deleteStorageFolder(prefixRef)));
}

export async function deleteEditorialProject(projectId, user) {
  requireUser(user);
  await deleteStorageFolder(ref(storage, `editorial/${projectId}`));
  const refs = await collectProjectDocumentRefs(projectId);

  for (let index = 0; index < refs.length; index += 450) {
    const batch = writeBatch(db);
    refs.slice(index, index + 450).forEach((documentRef) => batch.delete(documentRef));
    await batch.commit();
  }
}
