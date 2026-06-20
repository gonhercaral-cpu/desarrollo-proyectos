import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

const TECHNICAL_SPARE_PARTS_COLLECTION = "technicalSpareParts";

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return fallback;
  }

  return numberValue;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCustomValue(selectedValue, customValue, fallback) {
  const selected = String(selectedValue || "").trim();
  const custom = String(customValue || "").trim();

  if ((selected === "other" || selected === "otro") && custom) {
    return custom;
  }

  return selected || fallback;
}

function buildSparePartPayload(partData, currentUserProfile, mode = "create") {
  const name = String(partData?.name || "").trim();

  if (!name) {
    throw new Error("El nombre del recambio es obligatorio.");
  }

  const quantity = toNumber(partData?.quantity, 0);
  const minQuantity = toNumber(partData?.minQuantity, 0);

  const basePayload = {
    name,
    category: resolveCustomValue(partData?.category, partData?.categoryOther, "other"),
    partType: resolveCustomValue(partData?.partType, partData?.partTypeOther, "other"),
    brand: String(partData?.brand || "").trim(),
    model: String(partData?.model || "").trim(),
    compatibleModels: normalizeTextList(partData?.compatibleModels),
    compatibleEquipmentIds: Array.isArray(partData?.compatibleEquipmentIds)
      ? partData.compatibleEquipmentIds
      : [],
    quantity,
    minQuantity,
    unit: resolveCustomValue(partData?.unit, partData?.unitOther, "pieza"),
    storageLocation: String(partData?.storageLocation || "").trim(),
    status: partData?.status || "active",
    active: partData?.active === false ? false : partData?.status !== "inactive",
    deleted: false,
    notes: String(partData?.notes || "").trim(),
    updatedAt: serverTimestamp(),
    updatedBy: currentUserProfile?.name || "",
    updatedByEmail: currentUserProfile?.email || "",
    updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
  };

  if (mode === "create") {
    return {
      ...basePayload,
      createdAt: serverTimestamp(),
      createdBy: currentUserProfile?.name || "",
      createdByEmail: currentUserProfile?.email || "",
      createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    };
  }

  return basePayload;
}

export async function getTechnicalSpareParts() {
  const sparePartsRef = collection(db, TECHNICAL_SPARE_PARTS_COLLECTION);
  const q = query(sparePartsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createTechnicalSparePart(partData, currentUserProfile) {
  const sparePartsRef = collection(db, TECHNICAL_SPARE_PARTS_COLLECTION);
  const newSparePart = buildSparePartPayload(
    partData,
    currentUserProfile,
    "create"
  );

  const documentRef = await addDoc(sparePartsRef, newSparePart);

  return {
    id: documentRef.id,
    ...newSparePart,
  };
}

export async function updateTechnicalSparePart(
  sparePartId,
  partData,
  currentUserProfile
) {
  if (!sparePartId) {
    throw new Error("Falta el ID del recambio.");
  }

  const sparePartRef = doc(db, TECHNICAL_SPARE_PARTS_COLLECTION, sparePartId);
  const updatedSparePart = buildSparePartPayload(
    partData,
    currentUserProfile,
    "update"
  );

  await updateDoc(sparePartRef, updatedSparePart);

  return {
    id: sparePartId,
    ...updatedSparePart,
  };
}

export async function deactivateTechnicalSparePart(
  sparePartId,
  currentUserProfile
) {
  if (!sparePartId) {
    throw new Error("Falta el ID del recambio.");
  }

  const sparePartRef = doc(db, TECHNICAL_SPARE_PARTS_COLLECTION, sparePartId);

  await updateDoc(sparePartRef, {
    active: false,
    status: "inactive",
    deactivatedAt: serverTimestamp(),
    deactivatedBy: currentUserProfile?.name || "",
    deactivatedByEmail: currentUserProfile?.email || "",
    deactivatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  return { id: sparePartId, active: false, status: "inactive" };
}

export async function restoreTechnicalSparePart(
  sparePartId,
  currentUserProfile
) {
  if (!sparePartId) {
    throw new Error("Falta el ID del recambio.");
  }

  const sparePartRef = doc(db, TECHNICAL_SPARE_PARTS_COLLECTION, sparePartId);

  await updateDoc(sparePartRef, {
    active: true,
    status: "active",
    restoredAt: serverTimestamp(),
    restoredBy: currentUserProfile?.name || "",
    restoredByEmail: currentUserProfile?.email || "",
    restoredById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  return { id: sparePartId, active: true, status: "active" };
}
