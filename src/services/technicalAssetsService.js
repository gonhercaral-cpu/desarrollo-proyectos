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
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

const TECHNICAL_ASSETS_COLLECTION = "technicalAssets";
const TECHNICAL_ASSET_LOGS_COLLECTION = "technicalAssetLogs";

export async function getTechnicalAssets() {
  const assetsRef = collection(db, TECHNICAL_ASSETS_COLLECTION);

  const q = query(assetsRef, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getTechnicalAssetLogs(assetId) {
  if (!assetId) {
    throw new Error("Falta el ID del equipo.");
  }

  const logsRef = collection(db, TECHNICAL_ASSET_LOGS_COLLECTION);

  const q = query(
    logsRef,
    where("assetId", "==", assetId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

function normalizeChecklist(checklist) {
  if (!Array.isArray(checklist)) {
    return [];
  }

  return checklist
    .map((item) => ({
      label: String(item?.label || "").trim(),
      checked: Boolean(item?.checked),
      note: String(item?.note || "").trim(),
    }))
    .filter((item) => item.label);
}

export async function createTechnicalAssetLog(logData, currentUserProfile) {
  if (!logData?.assetId) {
    throw new Error("Falta el ID del equipo para registrar el movimiento.");
  }

  const logsRef = collection(db, TECHNICAL_ASSET_LOGS_COLLECTION);

  const newLog = {
    assetId: logData.assetId || "",
    assetTag: logData.assetTag || "",
    type: logData.type || "ASSET_LOG",
    title: logData.title || "Movimiento registrado",
    description: logData.description || "",

    previousStatus: logData.previousStatus || "",
    newStatus: logData.newStatus || "",
    previousCondition: logData.previousCondition || "",
    newCondition: logData.newCondition || "",

    checklist: normalizeChecklist(logData.checklist),

    createdBy: currentUserProfile?.name || "",
    createdByEmail: currentUserProfile?.email || "",
    createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    createdAt: serverTimestamp(),
  };

  await addDoc(logsRef, newLog);

  return newLog;
}

export async function createTechnicalAsset(assetData, currentUserProfile) {
  if (!assetData) {
    throw new Error("No se recibió la información del equipo.");
  }

  if (!assetData.assetTag?.trim()) {
    throw new Error("El código interno del equipo es obligatorio.");
  }

  if (!assetData.name?.trim()) {
    throw new Error("El nombre del equipo es obligatorio.");
  }

  if (!assetData.campus?.trim()) {
    throw new Error("El plantel del equipo es obligatorio.");
  }

  if (!assetData.area?.trim()) {
    throw new Error("El área del equipo es obligatoria.");
  }

  const assetsRef = collection(db, TECHNICAL_ASSETS_COLLECTION);

  const newAsset = {
    assetTag: assetData.assetTag.trim(),
    name: assetData.name.trim(),
    category: assetData.category || "Otro",
    brand: assetData.brand?.trim() || "",
    model: assetData.model?.trim() || "",
    serialNumber: assetData.serialNumber?.trim() || "",
    campus: assetData.campus.trim(),
    area: assetData.area.trim(),
    assignedTo: assetData.assignedTo?.trim() || "",
    technicalLocationId: assetData.technicalLocationId || "",
    technicalLocationName: assetData.technicalLocationName || "",
    technicalLocationType: assetData.technicalLocationType || "",
    maintenanceChecklistTemplate: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    checklistTemplate: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    checklistBase: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    status: assetData.status || "Activo",
    active: true,
    deleted: false,
    condition: assetData.condition || "Bueno",
    notes: assetData.notes?.trim() || "",
    createdBy: currentUserProfile?.name || "",
    createdByEmail: currentUserProfile?.email || "",
    createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const documentRef = await addDoc(assetsRef, newAsset);

  await createTechnicalAssetLog(
    {
      assetId: documentRef.id,
      assetTag: newAsset.assetTag,
      type: "ASSET_CREATED",
      title: "Equipo registrado",
      description: `Se registró el equipo ${newAsset.name} en el inventario técnico.`,
      previousStatus: "",
      newStatus: newAsset.status,
      previousCondition: "",
      newCondition: newAsset.condition,
    },
    currentUserProfile
  );

  return {
    id: documentRef.id,
    ...newAsset,
  };
}

export async function updateTechnicalAsset(
  assetId,
  assetData,
  currentUserProfile
) {
  if (!assetId) {
    throw new Error("Falta el ID del equipo.");
  }

  if (!assetData) {
    throw new Error("No se recibió la información actualizada del equipo.");
  }

  const assetRef = doc(db, TECHNICAL_ASSETS_COLLECTION, assetId);

  const updatedAsset = {
    assetTag: assetData.assetTag?.trim() || "",
    name: assetData.name?.trim() || "",
    category: assetData.category || "Otro",
    brand: assetData.brand?.trim() || "",
    model: assetData.model?.trim() || "",
    serialNumber: assetData.serialNumber?.trim() || "",
    campus: assetData.campus?.trim() || "",
    area: assetData.area?.trim() || "",
    assignedTo: assetData.assignedTo?.trim() || "",
    technicalLocationId: assetData.technicalLocationId || "",
    technicalLocationName: assetData.technicalLocationName || "",
    technicalLocationType: assetData.technicalLocationType || "",
    maintenanceChecklistTemplate: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    checklistTemplate: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    checklistBase: normalizeChecklist(assetData.maintenanceChecklistTemplate),
    status: assetData.status || "Activo",
    active: assetData.active !== false,
    deleted: assetData.deleted === true ? true : false,
    condition: assetData.condition || "Bueno",
    notes: assetData.notes?.trim() || "",
    updatedAt: serverTimestamp(),
  };

  await updateDoc(assetRef, updatedAsset);

  await createTechnicalAssetLog(
    {
      assetId,
      assetTag: updatedAsset.assetTag,
      type: "ASSET_UPDATED",
      title: "Equipo actualizado",
      description: `Se actualizó la información del equipo ${updatedAsset.name}.`,
    },
    currentUserProfile
  );

  return {
    id: assetId,
    ...updatedAsset,
  };
}

export async function deleteTechnicalAsset(assetId, currentUserProfile) {
  if (!assetId) {
    throw new Error("Falta el ID del equipo.");
  }

  const assetRef = doc(db, TECHNICAL_ASSETS_COLLECTION, assetId);

  await updateDoc(assetRef, {
    deleted: true,
    active: false,
    status: "Eliminado",
    deletedAt: serverTimestamp(),
    deletedBy: currentUserProfile?.name || "",
    deletedByEmail: currentUserProfile?.email || "",
    deletedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  await createTechnicalAssetLog(
    {
      assetId,
      assetTag: "",
      type: "ASSET_DELETED",
      title: "Equipo eliminado del inventario activo",
      description:
        "El equipo se ocultó de las vistas activas de soporte técnico. Sus mantenimientos relacionados ya no deben mostrarse como pendientes.",
      previousStatus: "",
      newStatus: "Eliminado",
    },
    currentUserProfile
  );

  return { id: assetId, deleted: true };
}


export async function restoreTechnicalAsset(assetId, currentUserProfile) {
  if (!assetId) {
    throw new Error("Falta el ID del equipo.");
  }

  const assetRef = doc(db, TECHNICAL_ASSETS_COLLECTION, assetId);

  await updateDoc(assetRef, {
    deleted: false,
    active: true,
    status: "Activo",
    restoredAt: serverTimestamp(),
    restoredBy: currentUserProfile?.name || "",
    restoredByEmail: currentUserProfile?.email || "",
    restoredById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  await createTechnicalAssetLog(
    {
      assetId,
      assetTag: "",
      type: "ASSET_RESTORED",
      title: "Equipo restaurado al inventario activo",
      description:
        "El equipo volvió a aparecer en las vistas activas de soporte técnico.",
      previousStatus: "Eliminado",
      newStatus: "Activo",
    },
    currentUserProfile
  );

  return { id: assetId, deleted: false, active: true, status: "Activo" };
}


function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeInstalledEquipmentForLocationUpdate(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenEquipmentIds = new Set();

  return items
    .map((item) => {
      const equipmentId = normalizeText(
        item?.equipmentId || item?.assetId || item?.id
      );

      if (!equipmentId || seenEquipmentIds.has(equipmentId)) {
        return null;
      }

      seenEquipmentIds.add(equipmentId);

      return {
        equipmentId,
        equipmentCode: normalizeText(
          item?.equipmentCode || item?.assetTag || item?.code
        ),
        equipmentName: normalizeText(
          item?.equipmentName || item?.name || item?.assetName
        ),
        category: normalizeText(item?.category),
        brand: normalizeText(item?.brand),
        model: normalizeText(item?.model),
        previousLocationId: normalizeText(
          item?.previousLocationId || item?.technicalLocationId
        ),
        previousLocationName: normalizeText(
          item?.previousLocationName || item?.technicalLocationName
        ),
        previousLocationType: normalizeText(
          item?.previousLocationType || item?.technicalLocationType
        ),
      };
    })
    .filter(Boolean);
}

export async function updateTechnicalAssetsLocationFromInstallation(
  installation,
  currentUserProfile
) {
  if (!installation?.id) {
    throw new Error("Falta el ID de la instalación.");
  }

  const locationId = normalizeText(installation.locationId);
  const locationName = normalizeText(installation.locationName);
  const locationType = normalizeText(installation.locationType);
  const campus = normalizeText(installation.campus);
  const installedEquipment = normalizeInstalledEquipmentForLocationUpdate(
    installation.installedEquipment
  );

  if (!locationId || installedEquipment.length === 0) {
    return [];
  }

  const batch = writeBatch(db);
  const logsRef = collection(db, TECHNICAL_ASSET_LOGS_COLLECTION);
  const updatedAt = serverTimestamp();
  const actorName = currentUserProfile?.name || "";
  const actorEmail = currentUserProfile?.email || "";
  const actorId = currentUserProfile?.uid || currentUserProfile?.id || "";

  const createdLogs = installedEquipment.map((equipment) => {
    const assetRef = doc(db, TECHNICAL_ASSETS_COLLECTION, equipment.equipmentId);
    const logRef = doc(logsRef);
    const previousLocationName =
      equipment.previousLocationName || "Sin ubicación previa";
    const nextLocationName = locationName || "Sin ubicación técnica";

    batch.update(assetRef, {
      technicalLocationId: locationId,
      technicalLocationName: locationName,
      technicalLocationType: locationType,
      campus: campus || "",
      area: locationName || "",
      updatedAt,
      updatedBy: actorName,
      updatedByEmail: actorEmail,
      updatedById: actorId,
    });

    const logPayload = {
      assetId: equipment.equipmentId,
      assetTag: equipment.equipmentCode || "",
      type: "INSTALLATION_LOCATION_UPDATED",
      title: "Equipo asignado por instalación técnica",
      description: `El equipo fue asignado a ${nextLocationName} mediante la instalación "${
        installation.title || "Instalación técnica"
      }". Ubicación anterior: ${previousLocationName}.`,
      previousStatus: "",
      newStatus: "",
      previousCondition: "",
      newCondition: "",
      previousLocationId: equipment.previousLocationId || "",
      previousLocationName: equipment.previousLocationName || "",
      previousLocationType: equipment.previousLocationType || "",
      newLocationId: locationId,
      newLocationName: locationName,
      newLocationType: locationType,
      installationId: installation.id,
      installationTitle: installation.title || "",
      checklist: [],
      createdBy: actorName,
      createdByEmail: actorEmail,
      createdById: actorId,
      createdAt: serverTimestamp(),
    };

    batch.set(logRef, logPayload);

    return {
      id: logRef.id,
      assetId: equipment.equipmentId,
      assetTag: equipment.equipmentCode || "",
      previousLocationName: equipment.previousLocationName || "",
      newLocationName: locationName,
    };
  });

  await batch.commit();

  return createdLogs;
}

export async function createTechnicalAssetMovement(
  asset,
  movementData,
  currentUserProfile
) {
  if (!asset?.id) {
    throw new Error("Falta el ID del equipo.");
  }

  if (!movementData) {
    throw new Error("No se recibió la información del movimiento.");
  }

  if (!movementData.title?.trim()) {
    throw new Error("El título del movimiento es obligatorio.");
  }

  const newStatus = movementData.status || "";
  const newCondition = movementData.condition || "";

  const shouldUpdateAsset = Boolean(newStatus) || Boolean(newCondition);

  if (shouldUpdateAsset) {
    const assetRef = doc(db, TECHNICAL_ASSETS_COLLECTION, asset.id);

    const updateData = {
      updatedAt: serverTimestamp(),
    };

    if (newStatus) {
      updateData.status = newStatus;
    }

    if (newCondition) {
      updateData.condition = newCondition;
    }

    await updateDoc(assetRef, updateData);
  }

  await createTechnicalAssetLog(
    {
      assetId: asset.id,
      assetTag: asset.assetTag || "",
      type: movementData.type || "TECHNICAL_MOVEMENT",
      title: movementData.title.trim(),
      description: movementData.description?.trim() || "",

      previousStatus: newStatus ? asset.status || "" : "",
      newStatus,
      previousCondition: newCondition ? asset.condition || "" : "",
      newCondition,
      checklist: movementData.checklist || [],
    },
    currentUserProfile
  );
}
