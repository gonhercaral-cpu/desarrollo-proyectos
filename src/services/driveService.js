import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

const DRIVE_SETTINGS_REF = doc(db, "systemSettings", "drive");

const driveListFolderCallable = httpsCallable(functions, "driveListFolder");
const driveCreateFolderCallable = httpsCallable(functions, "driveCreateFolder");

export async function listDriveFolder(folderId) {
  const response = await driveListFolderCallable({ folderId });
  return response.data;
}

export async function createDriveFolder(parentId, name) {
  const response = await driveCreateFolderCallable({ parentId, name });
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

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
