import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

const USERS_COLLECTION = "users";

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUser(docSnapshot) {
  const data = docSnapshot.data();

  const departmentIds = normalizeStringArray(data.departmentIds);
  const departmentNames = normalizeStringArray(data.departmentNames);

  return {
    id: docSnapshot.id,
    uid: docSnapshot.id,
    name: data.name || "",
    email: data.email || "",
    area: data.area || departmentNames[0] || "",
    departmentIds,
    departmentNames,
    primaryDepartmentId: data.primaryDepartmentId || departmentIds[0] || "",
    role: data.role || "collaborator",
    privilege: data.privilege || data.role || "collaborator",
    active: data.active !== false,
    deleted: data.deleted === true,
    notes: data.notes || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastLoginAt: data.lastLoginAt || null,
    ...data,
  };
}

export async function getAllUsers() {
  const usersRef = collection(db, USERS_COLLECTION);
  const snapshot = await getDocs(usersRef);

  return snapshot.docs
    .map(normalizeUser)
    .sort((a, b) => {
      const nameA = (a.name || a.email || "").toLowerCase();
      const nameB = (b.name || b.email || "").toLowerCase();

      return nameA.localeCompare(nameB, "es");
    });
}

export async function getActiveUsers() {
  const users = await getAllUsers();

  return users.filter((user) => user.active === true && user.deleted !== true);
}

export async function getCollaborators() {
  const users = await getActiveUsers();

  return users.filter((user) => user.role === "collaborator");
}

export async function createUserByAdmin(userData) {
  const createUserFunction = httpsCallable(functions, "createUserByAdmin");
  const result = await createUserFunction(userData);

  return result.data;
}

export async function updateUserProfile(userId, data, currentUserProfile) {
  if (!userId) {
    throw new Error("Falta el ID del usuario.");
  }

  const userRef = doc(db, USERS_COLLECTION, userId);

  await updateDoc(userRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedByUid: currentUserProfile?.uid || currentUserProfile?.id || null,
    updatedByName: currentUserProfile?.name || "",
    updatedByEmail: currentUserProfile?.email || "",
  });
}

export async function deactivateUserProfile(userId, currentUserProfile) {
  await updateUserProfile(
    userId,
    {
      active: false,
    },
    currentUserProfile
  );
}

export async function restoreUserProfile(userId, currentUserProfile) {
  await updateUserProfile(
    userId,
    {
      active: true,
      deleted: false,
    },
    currentUserProfile
  );
}

export async function softDeleteUserProfile(userId, currentUserProfile) {
  await updateUserProfile(
    userId,
    {
      active: false,
      deleted: true,
    },
    currentUserProfile
  );
}

export async function sendUserPasswordReset(email) {
  if (!email) {
    throw new Error("El usuario no tiene correo registrado.");
  }

  return sendPasswordResetEmail(auth, email);
}