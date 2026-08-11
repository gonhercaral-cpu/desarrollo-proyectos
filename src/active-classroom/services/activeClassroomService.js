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
  writeBatch,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, storage } from "../../services/firebase";
import { ACTIVE_CLASSROOM_MAX_FILE_BYTES } from "../constants";
import { detectResourceKind } from "../utils/resourceTypes";

export const ACTIVE_CLASSROOM_FOLDERS_COLLECTION = "activeClassroomFolders";
export const ACTIVE_CLASSROOM_RESOURCES_COLLECTION = "activeClassroomResources";
export const ACTIVE_CLASSROOM_STORAGE_ROOT = "active-classroom/resources";
const structureInitializationByUser = new Map();

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

  const initialization = initializeActiveClassroomStructure(user)
    .finally(() => {
      if (structureInitializationByUser.get(user.uid) === initialization) {
        structureInitializationByUser.delete(user.uid);
      }
    });

  structureInitializationByUser.set(user.uid, initialization);
  return initialization;
}

async function initializeActiveClassroomStructure(user) {
  const folderCollection = collection(db, ACTIVE_CLASSROOM_FOLDERS_COLLECTION);
  const snapshot = await getDocs(folderCollection);
  const existingFolderIds = new Set(snapshot.docs.map((folderDoc) => folderDoc.id));
  let createdCount = 0;
  const levelBatch = writeBatch(db);

  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    const levelId = `level-${levelNumber}`;
    if (existingFolderIds.has(levelId)) continue;

    const createdAt = serverTimestamp();
    levelBatch.set(doc(folderCollection, levelId), {
      name: `Nivel ${levelNumber}`,
      parentId: null,
      kind: "level",
      position: levelNumber,
      active: true,
      createdAt,
      createdByUid: user.uid,
      updatedAt: createdAt,
      updatedByUid: user.uid,
    });
    createdCount += 1;
  }

  if (createdCount > 0) {
    await levelBatch.commit();
  }

  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    const levelId = `level-${levelNumber}`;
    const unitBatch = writeBatch(db);
    let unitCount = 0;

    for (let unitNumber = 1; unitNumber <= 16; unitNumber += 1) {
      const unitSuffix = String(unitNumber).padStart(2, "0");
      const unitId = `${levelId}-unit-${unitSuffix}`;
      if (existingFolderIds.has(unitId)) continue;

      const createdAt = serverTimestamp();
      unitBatch.set(doc(folderCollection, unitId), {
        name: `Unit ${unitSuffix}`,
        parentId: levelId,
        kind: "unit",
        position: unitNumber,
        active: true,
        createdAt,
        createdByUid: user.uid,
        updatedAt: createdAt,
        updatedByUid: user.uid,
      });
      unitCount += 1;
      createdCount += 1;
    }

    // Cada lote usa como máximo 16 lecturas de padre en reglas; Firestore
    // permite 20 accesos de documentos por solicitud de varias escrituras.
    if (unitCount > 0) {
      await unitBatch.commit();
    }
  }

  return createdCount > 0;
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

export async function setActiveClassroomResourcePublished(resourceId, published, user) {
  assertAdmin(user);
  await updateDoc(doc(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION, resourceId), {
    published: published === true,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
    updatedByName: getUserName(user),
  });
}

export async function deleteActiveClassroomResource(resource, user) {
  assertAdmin(user);

  if (resource?.storagePath) {
    await deleteObject(ref(storage, resource.storagePath)).catch((error) => {
      if (error?.code !== "storage/object-not-found") throw error;
    });
  }

  await deleteDoc(doc(db, ACTIVE_CLASSROOM_RESOURCES_COLLECTION, resource.id));
}
