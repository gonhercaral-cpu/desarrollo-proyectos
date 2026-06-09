import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const DEPARTMENTS_COLLECTION = "departments";

function normalizeDepartment(docSnap) {
  const data = docSnap.data();

  return {
    id: docSnap.id,
    name: data.name || "",
    description: data.description || "",
    active: data.active !== false,
    deleted: data.deleted === true,
    order: Number(data.order || 999),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    deletedAt: data.deletedAt || null,
    ...data,
  };
}

async function getNextDepartmentOrder() {
  const departmentsRef = collection(db, DEPARTMENTS_COLLECTION);
  const snapshot = await getDocs(departmentsRef);

  const orders = snapshot.docs
    .map((docSnap) => Number(docSnap.data().order || 0))
    .filter((order) => Number.isFinite(order) && order > 0);

  if (orders.length === 0) {
    return 1;
  }

  return Math.max(...orders) + 1;
}

export async function getDepartments() {
  const departmentsRef = collection(db, DEPARTMENTS_COLLECTION);

  const q = query(departmentsRef, orderBy("order", "asc"));

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map(normalizeDepartment)
    .filter((department) => department.deleted !== true)
    .sort((a, b) => {
      const orderA = Number(a.order || 999);
      const orderB = Number(b.order || 999);

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    });
}

export async function getActiveDepartments() {
  const departmentsRef = collection(db, DEPARTMENTS_COLLECTION);

  const q = query(
    departmentsRef,
    where("active", "==", true),
    orderBy("order", "asc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map(normalizeDepartment)
    .filter(
      (department) =>
        department.active === true && department.deleted !== true
    )
    .sort((a, b) => {
      const orderA = Number(a.order || 999);
      const orderB = Number(b.order || 999);

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    });
}

export async function createDepartment(departmentData) {
  const departmentsRef = collection(db, DEPARTMENTS_COLLECTION);

  const cleanName = departmentData.name?.trim();

  if (!cleanName) {
    throw new Error("El nombre del departamento es obligatorio.");
  }

  const nextOrder =
    Number(departmentData.order) > 0
      ? Number(departmentData.order)
      : await getNextDepartmentOrder();

  await addDoc(departmentsRef, {
    name: cleanName,
    description: departmentData.description?.trim() || "",
    active: departmentData.active ?? true,
    deleted: false,
    order: nextOrder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
  });
}

export async function updateDepartment(departmentId, departmentData) {
  if (!departmentId) {
    throw new Error("Falta el ID del departamento.");
  }

  const cleanName = departmentData.name?.trim();

  if (!cleanName) {
    throw new Error("El nombre del departamento es obligatorio.");
  }

  const departmentRef = doc(db, DEPARTMENTS_COLLECTION, departmentId);

  const updateData = {
    name: cleanName,
    description: departmentData.description?.trim() || "",
    active: departmentData.active ?? true,
    updatedAt: serverTimestamp(),
  };

  if (Number(departmentData.order) > 0) {
    updateData.order = Number(departmentData.order);
  }

  await updateDoc(departmentRef, updateData);
}

export async function toggleDepartmentStatus(departmentId, currentStatus) {
  if (!departmentId) {
    throw new Error("Falta el ID del departamento.");
  }

  const departmentRef = doc(db, DEPARTMENTS_COLLECTION, departmentId);

  await updateDoc(departmentRef, {
    active: !currentStatus,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteDepartment(departmentId) {
  if (!departmentId) {
    throw new Error("Falta el ID del departamento.");
  }

  const departmentRef = doc(db, DEPARTMENTS_COLLECTION, departmentId);

  await updateDoc(departmentRef, {
    active: false,
    deleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}