import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, storage, functions } from "../../services/firebase";
import { runDriveImportBatch } from "../../utils/driveImport";
import { isDriveResource } from "../utils/driveResources";
import { ACTIVE_CLASSROOM_MAX_FILE_BYTES } from "../constants";
import { detectResourceKind } from "../utils/resourceTypes";

export const ACTIVE_CLASSROOM_FOLDERS_COLLECTION = "activeClassroomFolders";
export const ACTIVE_CLASSROOM_RESOURCES_COLLECTION = "activeClassroomResources";
export const ACTIVE_CLASSROOM_STORAGE_ROOT = "active-classroom/resources";
const structureInitializationByUser = new Map();
const importDriveReference = httpsCallable(functions, "importDriveFileToActiveClassroom");

export function importActiveClassroomDriveResources(files, folderId, user, onProgress) {
  assertAdmin(user);
  return runDriveImportBatch({
    files,
    onProgress,
    importFile: async (file) => {
      const response = await importDriveReference({ driveFileId: file.id, folderId });
      return response.data;
    },
  });
}

function assertAdmin(user) {
  const normalizedRole = String(user?.role || "").trim().toLowerCase();

  if (!user?.uid || normalizedRole !== "admin" || user?.active !== true) {
    throw new Error("Solo administradores activos pueden modificar Active Classroom.");
  }
}

function getUserName(user) {
  return String(user?.name || user?.email || "Administrador").trim();
}

function cleanName(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 160);
}

function cleanFileName(value) {
  const name = cleanName(value, "archivo");

  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "archivo";
}

function normalizeSnapshot(snapshot) {
  return snapshot.docs.map((snapshotDoc) => ({
    id: snapshotDoc.id,
    ...snapshotDoc.data(),
  }));
}

export function subscribeActiveClassroomFolders(onData, onError) {
  return onSnapshot(
    collection(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION),
    (snapshot) => onData(normalizeSnapshot(snapshot)),
    onError
  );
}

export function subscribeActiveClassroomResources(onData, onError) {
  return onSnapshot(
    collection(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION),
    (snapshot) => onData(normalizeSnapshot(snapshot)),
    onError
  );
}

export function getActiveClassroomResourceUrl(resource) {
  if (!resource?.storagePath) return Promise.resolve("");
  return getDownloadURL(ref(storage, resource.storagePath));
}

export function ensureActiveClassroomStructure(user) {
  assertAdmin(user);

  const pendingInitialization = structureInitializationByUser.get(user.uid);
  if (pendingInitialization) return pendingInitialization;

  const initialization = initializeActiveClassroomStructure()
    .finally(() => {
      if (structureInitializationByUser.get(user.uid) === initialization) {
        structureInitializationByUser.delete(user.uid);
      }
    });

  structureInitializationByUser.set(user.uid, initialization);
  return initialization;
}

async function initializeActiveClassroomStructure() {
  // Existing IDs and Units remain untouched. Levels are managed explicitly.
  await getDocs(collection(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION));
  return false;
}

const manageLevel = httpsCallable(functions, "manageActiveClassroomLevel");
export async function manageActiveClassroomLevel(data, user) {
  assertAdmin(user);
  return (await manageLevel(data)).data;
}

export async function createActiveClassroomUnit({ parentId, name, position }, user) {
  assertAdmin(user);
  const unitRef = doc(collection(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION));
  const timestamp = serverTimestamp();
  const payload = {
    name: cleanName(name).slice(0, 56),
    parentId,
    kind: "unit",
    position: Number.isFinite(position) ? position : 999,
    active: true,
    createdAt: timestamp,
    createdByUid: user.uid,
    updatedAt: timestamp,
    updatedByUid: user.uid,
  };

  if (!payload.name || !payload.parentId) {
    throw new Error("Nombre y Nivel son obligatorios.");
  }

  await setDoc(unitRef, payload);
  return { id: unitRef.id, ...payload };
}

export async function renameActiveClassroomUnit(folderId, name, user) {
  assertAdmin(user);
  const cleanFolderName = cleanName(name).slice(0, 56);

  if (!cleanFolderName) throw new Error("Escribe un nombre para la Unit.");

  await updateDoc(doc(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION, folderId), {
    name: cleanFolderName,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  });
}

export async function deleteActiveClassroomUnit(folderId, user) {
  assertAdmin(user);
  const resourcesSnapshot = await getDocs(query(
    collection(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION),
    where("folderId", "==", folderId),
    limit(1)
  ));

  if (!resourcesSnapshot.empty) {
    throw new Error("La Unit contiene archivos. Elimínalos antes de borrar la carpeta.");
  }

  await deleteDoc(doc(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION, folderId));
}

export async function uploadActiveClassroomResources(files, folderId, user) {
  assertAdmin(user);
  const fileList = Array.from(files || []);

  if (!folderId || fileList.length === 0) return [];

  return Promise.all(fileList.map(async (file) => {
    if (file.size >= ACTIVE_CLASSROOM_MAX_FILE_BYTES) {
      throw new Error(`${file.name} supera el límite de 250 MB.`);
    }

    const resourceRef = doc(collection(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION));
    const storagePath = `${ACTIVE_CLASSROOM_STORAGE_ROOT}/${resourceRef.id}/${cleanFileName(file.name)}`;
    const storageReference = ref(storage, storagePath);

    await uploadBytes(storageReference, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        folderId,
        originalName: file.name,
      },
    });

    try {
      const timestamp = serverTimestamp();
      const payload = {
        folderId,
        name: cleanName(file.name, "Archivo"),
        kind: detectResourceKind(file),
        mimeType: cleanName(file.type, "application/octet-stream"),
        sizeBytes: file.size,
        storagePath,
        published: false,
        archived: false,
        createdAt: timestamp,
        createdByUid: user.uid,
        createdByName: getUserName(user),
        updatedAt: timestamp,
        updatedByUid: user.uid,
        updatedByName: getUserName(user),
      };

      await setDoc(resourceRef, payload);
      return { id: resourceRef.id, ...payload };
    } catch (error) {
      await deleteObject(storageReference).catch(() => {});
      throw error;
    }
  }));
}

export async function setActiveClassroomResourcePublished(resource, published, user) {
  assertAdmin(user);
  await updateDoc(doc(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION, resource.id), {
    published: published === true,
    ...(isDriveResource(resource) ? {
      publishedVersion: published ? resource.version : null,
      publishedAt: published ? serverTimestamp() : null,
    } : {}),
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
    updatedByName: getUserName(user),
  });
}

export async function deleteActiveClassroomResource(resource, user) {
  assertAdmin(user);
  if (resource?.retainedByPublication) throw new Error("Este recurso se conserva porque pertenece a una publicación de Unit.");

  if (!isDriveResource(resource) && resource?.storagePath) {
    await deleteObject(ref(storage, resource.storagePath)).catch((error) => {
      if (error?.code !== "storage/object-not-found") throw error;
    });
  }

  await deleteDoc(doc(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION, resource.id));
}
