import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const TECHNICAL_SPARE_PARTS_COLLECTION = "technicalSpareParts";
const TECHNICAL_SPARE_PART_MOVEMENTS_COLLECTION =
  "technicalSparePartMovements";


const INTERNAL_CODE_PREFIX = "REC";

function parseTechnicalSparePartInternalCode(value) {
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .match(/^REC-(\d+)$/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) || 0;
}

function formatTechnicalSparePartInternalCode(numberValue) {
  return `${INTERNAL_CODE_PREFIX}-${String(numberValue).padStart(4, "0")}`;
}

export function generateTechnicalSparePartInternalCodeFromParts(parts = []) {
  const highestCode = parts.reduce((highest, part) => {
    const numericCode = parseTechnicalSparePartInternalCode(part?.internalCode);
    return Math.max(highest, numericCode);
  }, 0);

  return formatTechnicalSparePartInternalCode(highestCode + 1);
}

export async function getNextTechnicalSparePartInternalCode() {
  const parts = await getTechnicalSpareParts();
  return generateTechnicalSparePartInternalCodeFromParts(parts);
}

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
  const normalizedSelected = selected.toLowerCase();

  if (
    ["other", "otro"].includes(normalizedSelected) ||
    selected === "Otro"
  ) {
    return custom || "Otro";
  }

  return selected || fallback;
}

function buildSearchText(partData = {}) {
  return [
    partData.name,
    partData.barcode,
    partData.internalCode,
    partData.category,
    partData.partType,
    partData.brand,
    partData.model,
    Array.isArray(partData.compatibleModels)
      ? partData.compatibleModels.join(" ")
      : partData.compatibleModels,
    partData.storageLocation,
    partData.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildSparePartPayload(partData, currentUserProfile, mode = "create") {
  const name = String(partData?.name || "").trim();

  if (!name) {
    throw new Error("El nombre del recambio es obligatorio.");
  }

  const barcode = String(partData?.barcode || "").trim();
  const internalCode = String(partData?.internalCode || "").trim();
  const quantity = toNumber(partData?.quantity, 0);
  const minQuantity = toNumber(partData?.minQuantity, 0);

  const category = resolveCustomValue(
    partData?.category,
    partData?.categoryOther,
    "Otro"
  );
  const partType = resolveCustomValue(
    partData?.partType,
    partData?.partTypeOther,
    "Otro"
  );
  const unit = resolveCustomValue(partData?.unit, partData?.unitOther, "pieza");
  const compatibleModels = normalizeTextList(partData?.compatibleModels);

  const basePayload = {
    name,
    barcode,
    internalCode,
    internalCodeNumber: parseTechnicalSparePartInternalCode(internalCode),
    category,
    partType,
    brand: String(partData?.brand || "").trim(),
    model: String(partData?.model || "").trim(),
    compatibleModels,
    compatibleEquipmentIds: Array.isArray(partData?.compatibleEquipmentIds)
      ? partData.compatibleEquipmentIds
      : [],
    quantity,
    minQuantity,
    unit,
    storageLocation: String(partData?.storageLocation || "").trim(),
    status: partData?.status || "active",
    active: partData?.active === false ? false : partData?.status !== "inactive",
    deleted: false,
    notes: String(partData?.notes || "").trim(),
    searchText: buildSearchText({
      name,
      barcode,
      internalCode,
      category,
      partType,
      brand: partData?.brand,
      model: partData?.model,
      compatibleModels,
      storageLocation: partData?.storageLocation,
      notes: partData?.notes,
    }),
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
  const internalCode =
    String(partData?.internalCode || "").trim() ||
    (await getNextTechnicalSparePartInternalCode());
  const newSparePart = buildSparePartPayload(
    {
      ...partData,
      internalCode,
    },
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

export async function getTechnicalSparePartMovements(sparePartId) {
  if (!sparePartId) {
    throw new Error("Falta el ID del recambio.");
  }

  const movementsRef = collection(
    db,
    TECHNICAL_SPARE_PART_MOVEMENTS_COLLECTION
  );

  const q = query(movementsRef, where("partId", "==", sparePartId));
  const snapshot = await getDocs(q);

  return snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate?.() || new Date(0);
      const bDate = b.createdAt?.toDate?.() || new Date(0);

      return bDate - aDate;
    });
}

export async function createTechnicalSparePartMovement(
  sparePart,
  movementData,
  currentUserProfile
) {
  if (!sparePart?.id) {
    throw new Error("Falta el ID del recambio.");
  }

  const movementType = movementData?.type || "entry";

  if (!["entry", "exit", "adjustment", "used_in_installation"].includes(movementType)) {
    throw new Error("Tipo de movimiento no válido.");
  }

  const requestedQuantity = toNumber(movementData?.quantity, 0);
  const requestedFinalQuantity = toNumber(movementData?.finalQuantity, 0);

  if (movementType !== "adjustment" && requestedQuantity <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.");
  }

  const sparePartRef = doc(
    db,
    TECHNICAL_SPARE_PARTS_COLLECTION,
    sparePart.id
  );
  const movementsRef = collection(
    db,
    TECHNICAL_SPARE_PART_MOVEMENTS_COLLECTION
  );
  const movementRef = doc(movementsRef);

  return runTransaction(db, async (transaction) => {
    const sparePartSnapshot = await transaction.get(sparePartRef);

    if (!sparePartSnapshot.exists()) {
      throw new Error("El recambio ya no existe.");
    }

    const currentPart = {
      id: sparePartSnapshot.id,
      ...sparePartSnapshot.data(),
    };

    if (currentPart.active === false || currentPart.status === "inactive") {
      throw new Error("Este recambio está inactivo.");
    }

    const previousQuantity = toNumber(currentPart.quantity, 0);
    let newQuantity = previousQuantity;
    let movementQuantity = requestedQuantity;

    if (movementType === "entry") {
      newQuantity = previousQuantity + requestedQuantity;
    }

    if (["exit", "used_in_installation"].includes(movementType)) {
      if (requestedQuantity > previousQuantity) {
        throw new Error(
          `No hay suficiente inventario. Disponible: ${previousQuantity}.`
        );
      }

      newQuantity = previousQuantity - requestedQuantity;
    }

    if (movementType === "adjustment") {
      newQuantity = requestedFinalQuantity;
      movementQuantity = Math.abs(newQuantity - previousQuantity);
    }

    const movement = {
      partId: currentPart.id,
      partName: currentPart.name || sparePart.name || "",
      barcode: currentPart.barcode || "",
      internalCode: currentPart.internalCode || "",
      category: currentPart.category || "",
      partType: currentPart.partType || "",
      unit: currentPart.unit || "pieza",
      type: movementType,
      quantity: movementQuantity,
      previousQuantity,
      newQuantity,
      reason: String(movementData?.reason || "").trim(),
      notes: String(movementData?.notes || "").trim(),
      scannedCode: String(movementData?.scannedCode || "").trim(),
      createdBy: currentUserProfile?.name || "",
      createdByEmail: currentUserProfile?.email || "",
      createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
      createdAt: serverTimestamp(),
    };

    transaction.update(sparePartRef, {
      quantity: newQuantity,
      lastMovementAt: serverTimestamp(),
      lastMovementType: movementType,
      lastMovementBy: currentUserProfile?.name || "",
      updatedAt: serverTimestamp(),
      updatedBy: currentUserProfile?.name || "",
      updatedByEmail: currentUserProfile?.email || "",
      updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    });

    transaction.set(movementRef, movement);

    return {
      id: movementRef.id,
      ...movement,
    };
  });
}



function normalizeInstallationUsedSpareParts(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const groupedParts = new Map();

  items.forEach((item) => {
    const partId = String(item?.partId || item?.id || "").trim();
    const quantity = toNumber(item?.quantity, 0);

    if (!partId || quantity <= 0) {
      return;
    }

    const existing = groupedParts.get(partId);

    if (existing) {
      existing.quantity += quantity;
      return;
    }

    groupedParts.set(partId, {
      partId,
      partName: String(item?.partName || item?.name || "").trim(),
      barcode: String(item?.barcode || "").trim(),
      internalCode: String(item?.internalCode || "").trim(),
      category: String(item?.category || "").trim(),
      partType: String(item?.partType || "").trim(),
      unit: String(item?.unit || "pieza").trim() || "pieza",
      quantity,
      availableAtSelection: toNumber(item?.availableAtSelection, 0),
      notes: String(item?.notes || "").trim(),
    });
  });

  return Array.from(groupedParts.values());
}

export async function consumeTechnicalSparePartsForInstallation(
  installationData,
  currentUserProfile
) {
  const installationId = String(installationData?.id || "").trim();
  const installationTitle = String(
    installationData?.title || "Instalación técnica"
  ).trim();
  const usedSpareParts = normalizeInstallationUsedSpareParts(
    installationData?.usedSpareParts
  );

  if (!installationId) {
    throw new Error("Falta el ID de la instalación para descontar recambios.");
  }

  if (installationData?.sparePartsConsumed === true || usedSpareParts.length === 0) {
    return [];
  }

  const movementsRef = collection(
    db,
    TECHNICAL_SPARE_PART_MOVEMENTS_COLLECTION
  );

  return runTransaction(db, async (transaction) => {
    const partSnapshots = [];

    for (const usedPart of usedSpareParts) {
      const partRef = doc(db, TECHNICAL_SPARE_PARTS_COLLECTION, usedPart.partId);
      const partSnapshot = await transaction.get(partRef);

      if (!partSnapshot.exists()) {
        throw new Error(
          `El recambio "${usedPart.partName || usedPart.partId}" ya no existe.`
        );
      }

      const currentPart = {
        id: partSnapshot.id,
        ref: partRef,
        ...partSnapshot.data(),
      };

      if (currentPart.active === false || currentPart.status === "inactive") {
        throw new Error(
          `El recambio "${currentPart.name || usedPart.partName}" está inactivo.`
        );
      }

      const previousQuantity = toNumber(currentPart.quantity, 0);
      const requestedQuantity = toNumber(usedPart.quantity, 0);

      if (requestedQuantity <= 0) {
        throw new Error(
          `La cantidad del recambio "${currentPart.name || usedPart.partName}" debe ser mayor a cero.`
        );
      }

      if (requestedQuantity > previousQuantity) {
        throw new Error(
          `No hay suficiente inventario de "${currentPart.name || usedPart.partName}". Disponible: ${previousQuantity}, requerido: ${requestedQuantity}.`
        );
      }

      partSnapshots.push({
        usedPart,
        currentPart,
        previousQuantity,
        requestedQuantity,
        newQuantity: previousQuantity - requestedQuantity,
      });
    }

    const createdMovements = [];

    for (const item of partSnapshots) {
      const movementRef = doc(movementsRef);
      const movement = {
        partId: item.currentPart.id,
        partName: item.currentPart.name || item.usedPart.partName || "",
        barcode: item.currentPart.barcode || item.usedPart.barcode || "",
        internalCode: item.currentPart.internalCode || item.usedPart.internalCode || "",
        category: item.currentPart.category || item.usedPart.category || "",
        partType: item.currentPart.partType || item.usedPart.partType || "",
        unit: item.currentPart.unit || item.usedPart.unit || "pieza",
        type: "used_in_installation",
        quantity: item.requestedQuantity,
        previousQuantity: item.previousQuantity,
        newQuantity: item.newQuantity,
        reason: `Usado en instalación: ${installationTitle}`,
        notes: item.usedPart.notes || "",
        installationId,
        installationTitle,
        createdBy: currentUserProfile?.name || "",
        createdByEmail: currentUserProfile?.email || "",
        createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
        createdAt: serverTimestamp(),
      };

      transaction.update(item.currentPart.ref, {
        quantity: item.newQuantity,
        lastMovementAt: serverTimestamp(),
        lastMovementType: "used_in_installation",
        lastMovementBy: currentUserProfile?.name || "",
        updatedAt: serverTimestamp(),
        updatedBy: currentUserProfile?.name || "",
        updatedByEmail: currentUserProfile?.email || "",
        updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
      });

      transaction.set(movementRef, movement);
      createdMovements.push({ id: movementRef.id, ...movement });
    }

    return createdMovements;
  });
}

export async function findTechnicalSparePartByCode(code) {
  const normalizedCode = String(code || "").trim();

  if (!normalizedCode) {
    return null;
  }

  const sparePartsRef = collection(db, TECHNICAL_SPARE_PARTS_COLLECTION);

  const barcodeQuery = query(
    sparePartsRef,
    where("barcode", "==", normalizedCode)
  );
  const barcodeSnapshot = await getDocs(barcodeQuery);

  if (!barcodeSnapshot.empty) {
    const document = barcodeSnapshot.docs[0];

    return {
      id: document.id,
      ...document.data(),
    };
  }

  const internalCodeQuery = query(
    sparePartsRef,
    where("internalCode", "==", normalizedCode)
  );
  const internalCodeSnapshot = await getDocs(internalCodeQuery);

  if (!internalCodeSnapshot.empty) {
    const document = internalCodeSnapshot.docs[0];

    return {
      id: document.id,
      ...document.data(),
    };
  }

  const documentRef = doc(db, TECHNICAL_SPARE_PARTS_COLLECTION, normalizedCode);
  const documentSnapshot = await getDoc(documentRef);

  if (documentSnapshot.exists()) {
    return {
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    };
  }

  return null;
}
