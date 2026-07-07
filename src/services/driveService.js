import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

const DRIVE_SETTINGS_REF = doc(db, "systemSettings", "drive");
const DRIVE_DEPARTMENT_FOLDERS_COLLECTION = "driveDepartmentFolders";

const driveListFolderCallable = httpsCallable(functions, "driveListFolder");
const driveCreateFolderCallable = httpsCallable(functions, "driveCreateFolder");
const driveUploadFileCallable = httpsCallable(functions, "driveUploadFile");
const driveRenameItemCallable = httpsCallable(functions, "driveRenameItem");
const driveMoveItemCallable = httpsCallable(functions, "driveMoveItem");
const driveDeleteItemCallable = httpsCallable(functions, "driveDeleteItem");
const driveEnsureDepartmentFoldersCallable = httpsCallable(
  functions,
  "driveEnsureDepartmentFolders"
);
const driveListAllowedDepartmentFoldersCallable = httpsCallable(
  functions,
  "driveListAllowedDepartmentFolders"
);

export async function listDriveFolder(folderId) {
  const response = await driveListFolderCallable({ folderId });
  return response.data;
}

export async function createDriveFolder(parentId, name) {
  const response = await driveCreateFolderCallable({ parentId, name });
  return response.data;
}

export async function uploadDriveFile({ folderId, name, mimeType, base64 }) {
  const response = await driveUploadFileCallable({
    folderId,
    name,
    mimeType,
    base64,
  });
  return response.data;
}

export async function renameDriveItem(fileId, name) {
  const response = await driveRenameItemCallable({ fileId, name });
  return response.data;
}

export async function moveDriveItem(fileId, targetFolderId) {
  const response = await driveMoveItemCallable({ fileId, targetFolderId });
  return response.data;
}

export async function deleteDriveItem(fileId) {
  const response = await driveDeleteItemCallable({ fileId });
  return response.data;
}

export async function ensureDriveDepartmentFolders() {
  const response = await driveEnsureDepartmentFoldersCallable();
  return response.data;
}

export async function listAllowedDriveDepartmentFolders() {
  const response = await driveListAllowedDepartmentFoldersCallable();
  return response.data;
}

export async function getDriveRootSettings() {
  const snapshot = await getDoc(DRIVE_SETTINGS_REF);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function saveDriveRootFolderId(rootFolderId) {
  const cleanRootFolderId = String(rootFolderId || "").trim();

  await setDoc(
    DRIVE_SETTINGS_REF,
    {
      rootFolderId: cleanRootFolderId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return cleanRootFolderId;
}

export async function getDriveDepartmentFolders() {
  const foldersQuery = query(
    collection(db, DRIVE_DEPARTMENT_FOLDERS_COLLECTION),
    orderBy("departmentName", "asc")
  );
  const snapshot = await getDocs(foldersQuery);

  return snapshot.docs.map((folderDoc) => ({
    id: folderDoc.id,
    ...folderDoc.data(),
  }));
}

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
