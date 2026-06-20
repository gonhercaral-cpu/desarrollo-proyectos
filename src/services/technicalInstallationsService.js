import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  where,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { consumeTechnicalSparePartsForInstallation } from "./technicalSparePartsService";
import { updateTechnicalAssetsLocationFromInstallation } from "./technicalAssetsService";

const TECHNICAL_INSTALLATIONS_COLLECTION = "technicalInstallations";

const INSTALLATION_SECTIONS = [
  "physicalItems",
  "softwareItems",
  "configurationItems",
  "testItems",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeChecklistSections(checklistSections = {}) {
  return INSTALLATION_SECTIONS.reduce((result, sectionKey) => {
    const items = Array.isArray(checklistSections?.[sectionKey])
      ? checklistSections[sectionKey]
      : [];

    result[sectionKey] = items
      .map((item, index) => ({
        id:
          normalizeText(item?.id) ||
          `${sectionKey}-${Date.now()}-${index}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        templateItemId: normalizeText(item?.templateItemId),
        sectionKey,
        label: normalizeText(item?.label),
        required: item?.required !== false,
        completed: item?.completed === true,
        notes: normalizeText(item?.notes),
        completedAt: normalizeText(item?.completedAt),
        completedBy: normalizeText(item?.completedBy),
      }))
      .filter((item) => item.label);

    return result;
  }, {});
}

function calculateChecklistProgress(checklistSections = {}) {
  const normalizedSections = normalizeChecklistSections(checklistSections);
  const allItems = INSTALLATION_SECTIONS.flatMap(
    (sectionKey) => normalizedSections[sectionKey] || []
  );
  const totalSteps = allItems.length;
  const completedSteps = allItems.filter((item) => item.completed).length;
  const requiredSteps = allItems.filter((item) => item.required).length;
  const requiredCompletedSteps = allItems.filter(
    (item) => item.required && item.completed
  ).length;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    checklistSections: normalizedSections,
    totalSteps,
    completedSteps,
    requiredSteps,
    requiredCompletedSteps,
    requiredPendingSteps: Math.max(requiredSteps - requiredCompletedSteps, 0),
    progress,
  };
}

function normalizeInstallationStatus(value) {
  const status = normalizeText(value) || "in_progress";

  if (["draft", "in_progress", "paused", "completed", "cancelled"].includes(status)) {
    return status;
  }

  return "in_progress";
}

function normalizeInstalledEquipment(items = []) {
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
        serialNumber: normalizeText(item?.serialNumber),
        campus: normalizeText(item?.campus),
        area: normalizeText(item?.area),
        status: normalizeText(item?.status),
        condition: normalizeText(item?.condition),
        previousLocationId: normalizeText(
          item?.previousLocationId || item?.technicalLocationId
        ),
        previousLocationName: normalizeText(
          item?.previousLocationName || item?.technicalLocationName
        ),
        previousLocationType: normalizeText(
          item?.previousLocationType || item?.technicalLocationType
        ),
        assignedLocationId: normalizeText(item?.assignedLocationId),
        assignedLocationName: normalizeText(item?.assignedLocationName),
        assignedLocationType: normalizeText(item?.assignedLocationType),
        addedAt: normalizeText(item?.addedAt),
        addedBy: normalizeText(item?.addedBy),
        notes: normalizeText(item?.notes),
      };
    })
    .filter(Boolean);
}


function normalizeUsedSparePartsForInstallation(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenParts = new Map();

  items.forEach((item) => {
    const partId = normalizeText(item?.partId || item?.id);
    const quantity = Math.max(Number(item?.quantity || 0), 0);

    if (!partId || quantity <= 0) {
      return;
    }

    const existing = seenParts.get(partId);

    if (existing) {
      existing.quantity += quantity;
      return;
    }

    seenParts.set(partId, {
      partId,
      partName: normalizeText(item?.partName || item?.name),
      barcode: normalizeText(item?.barcode),
      internalCode: normalizeText(item?.internalCode),
      category: normalizeText(item?.category),
      partType: normalizeText(item?.partType),
      unit: normalizeText(item?.unit) || "pieza",
      quantity,
      availableAtSelection: Math.max(Number(item?.availableAtSelection || 0), 0),
      notes: normalizeText(item?.notes),
      addedAt: normalizeText(item?.addedAt),
      addedBy: normalizeText(item?.addedBy),
    });
  });

  return Array.from(seenParts.values());
}


function buildInstallationPayload(installationData, currentUserProfile, mode = "create") {
  const title = normalizeText(installationData?.title);

  if (!title) {
    throw new Error("El título de la instalación es obligatorio.");
  }

  const templateId = normalizeText(installationData?.templateId);

  if (!templateId) {
    throw new Error("Selecciona una plantilla para crear la instalación.");
  }

  const progressSummary = calculateChecklistProgress(
    installationData?.checklistSections
  );

  if (progressSummary.totalSteps <= 0) {
    throw new Error("La instalación debe tener al menos un paso en su checklist.");
  }

  const status = normalizeInstallationStatus(installationData?.status);
  const installedEquipment = normalizeInstalledEquipment(
    installationData?.installedEquipment
  );
  const usedSpareParts = normalizeUsedSparePartsForInstallation(
    installationData?.usedSpareParts
  );
  const usedSparePartsTotalQuantity = usedSpareParts.reduce(
    (total, part) => total + Number(part.quantity || 0),
    0
  );

  const basePayload = {
    title,
    templateId,
    templateName: normalizeText(installationData?.templateName),
    targetLocationType: normalizeText(installationData?.targetLocationType),
    equipmentCategory: normalizeText(installationData?.equipmentCategory),
    campus: normalizeText(installationData?.campus),
    locationId: normalizeText(installationData?.locationId),
    locationName: normalizeText(installationData?.locationName),
    locationType: normalizeText(installationData?.locationType),
    responsibleId: normalizeText(installationData?.responsibleId),
    responsibleName: normalizeText(installationData?.responsibleName),
    status,
    active: !["completed", "cancelled"].includes(status),
    deleted: false,
    notes: normalizeText(installationData?.notes),
    installedEquipment,
    installedEquipmentIds: installedEquipment.map((item) => item.equipmentId),
    installedEquipmentCount: installedEquipment.length,
    usedSpareParts,
    usedSparePartIds: usedSpareParts.map((item) => item.partId),
    usedSparePartsCount: usedSpareParts.length,
    usedSparePartsTotalQuantity,
    sparePartsConsumed: installationData?.sparePartsConsumed === true,
    equipmentLocationsUpdated: installationData?.equipmentLocationsUpdated === true,
    checklistSections: progressSummary.checklistSections,
    totalSteps: progressSummary.totalSteps,
    completedSteps: progressSummary.completedSteps,
    requiredSteps: progressSummary.requiredSteps,
    requiredCompletedSteps: progressSummary.requiredCompletedSteps,
    requiredPendingSteps: progressSummary.requiredPendingSteps,
    progress: progressSummary.progress,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserProfile?.name || "",
    updatedByEmail: currentUserProfile?.email || "",
    updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
  };

  if (mode === "create") {
    return {
      ...basePayload,
      startedAt: serverTimestamp(),
      completedAt: status === "completed" ? serverTimestamp() : null,
      cancelledAt: status === "cancelled" ? serverTimestamp() : null,
      createdAt: serverTimestamp(),
      createdBy: currentUserProfile?.name || "",
      createdByEmail: currentUserProfile?.email || "",
      createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    };
  }

  return basePayload;
}

export async function getTechnicalInstallations() {
  const installationsRef = collection(db, TECHNICAL_INSTALLATIONS_COLLECTION);
  const q = query(installationsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}



export async function getTechnicalInstallationsByEquipment(assetId) {
  const normalizedAssetId = String(assetId || "").trim();

  if (!normalizedAssetId) {
    throw new Error("Falta el ID del equipo.");
  }

  const installationsRef = collection(db, TECHNICAL_INSTALLATIONS_COLLECTION);
  const q = query(
    installationsRef,
    where("installedEquipmentIds", "array-contains", normalizedAssetId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getTechnicalInstallationsByLocation(locationId) {
  const normalizedLocationId = String(locationId || "").trim();

  if (!normalizedLocationId) {
    throw new Error("Falta el ID de la ubicación técnica.");
  }

  const installationsRef = collection(db, TECHNICAL_INSTALLATIONS_COLLECTION);
  const q = query(
    installationsRef,
    where("locationId", "==", normalizedLocationId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createTechnicalInstallation(
  installationData,
  currentUserProfile
) {
  const installationsRef = collection(db, TECHNICAL_INSTALLATIONS_COLLECTION);
  const newInstallation = buildInstallationPayload(
    installationData,
    currentUserProfile,
    "create"
  );

  const documentRef = await addDoc(installationsRef, newInstallation);

  return {
    id: documentRef.id,
    ...newInstallation,
  };
}

export async function updateTechnicalInstallation(
  installationId,
  installationData,
  currentUserProfile
) {
  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  const installationRef = doc(
    db,
    TECHNICAL_INSTALLATIONS_COLLECTION,
    installationId
  );
  const updatedInstallation = buildInstallationPayload(
    installationData,
    currentUserProfile,
    "update"
  );

  await updateDoc(installationRef, updatedInstallation);

  return {
    id: installationId,
    ...updatedInstallation,
  };
}

export async function completeTechnicalInstallation(
  installationId,
  installationData,
  currentUserProfile
) {
  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  const updatedInstallation = buildInstallationPayload(
    {
      ...installationData,
      status: "completed",
    },
    currentUserProfile,
    "update"
  );

  if (updatedInstallation.requiredPendingSteps > 0) {
    throw new Error(
      `Aún faltan ${updatedInstallation.requiredPendingSteps} paso(s) obligatorio(s).`
    );
  }

  const installationRef = doc(
    db,
    TECHNICAL_INSTALLATIONS_COLLECTION,
    installationId
  );

  const shouldConsumeSpareParts =
    updatedInstallation.sparePartsConsumed !== true &&
    Array.isArray(updatedInstallation.usedSpareParts) &&
    updatedInstallation.usedSpareParts.length > 0;

  const consumedMovements = shouldConsumeSpareParts
    ? await consumeTechnicalSparePartsForInstallation(
        {
          id: installationId,
          ...updatedInstallation,
        },
        currentUserProfile
      )
    : [];

  const shouldUpdateEquipmentLocations =
    updatedInstallation.equipmentLocationsUpdated !== true &&
    Boolean(updatedInstallation.locationId) &&
    Array.isArray(updatedInstallation.installedEquipment) &&
    updatedInstallation.installedEquipment.length > 0;

  const equipmentLocationUpdates = shouldUpdateEquipmentLocations
    ? await updateTechnicalAssetsLocationFromInstallation(
        {
          id: installationId,
          ...updatedInstallation,
        },
        currentUserProfile
      )
    : [];

  const completionUpdate = {
    ...updatedInstallation,
    active: false,
    sparePartsConsumed:
      updatedInstallation.sparePartsConsumed === true || consumedMovements.length > 0,
    equipmentLocationsUpdated:
      updatedInstallation.equipmentLocationsUpdated === true ||
      equipmentLocationUpdates.length > 0,
    completedAt: serverTimestamp(),
    completedBy: currentUserProfile?.name || "",
    completedByEmail: currentUserProfile?.email || "",
    completedById: currentUserProfile?.uid || currentUserProfile?.id || "",
  };

  if (consumedMovements.length > 0) {
    completionUpdate.sparePartsConsumedAt = serverTimestamp();
    completionUpdate.sparePartsConsumedBy = currentUserProfile?.name || "";
    completionUpdate.sparePartsConsumedByEmail = currentUserProfile?.email || "";
    completionUpdate.sparePartsConsumedById =
      currentUserProfile?.uid || currentUserProfile?.id || "";
    completionUpdate.sparePartMovementIds = consumedMovements.map(
      (movement) => movement.id
    );
  }

  if (equipmentLocationUpdates.length > 0) {
    completionUpdate.equipmentLocationsUpdatedAt = serverTimestamp();
    completionUpdate.equipmentLocationsUpdatedBy =
      currentUserProfile?.name || "";
    completionUpdate.equipmentLocationsUpdatedByEmail =
      currentUserProfile?.email || "";
    completionUpdate.equipmentLocationsUpdatedById =
      currentUserProfile?.uid || currentUserProfile?.id || "";
    completionUpdate.equipmentLocationUpdatedCount =
      equipmentLocationUpdates.length;
    completionUpdate.equipmentLocationLogIds = equipmentLocationUpdates.map(
      (movement) => movement.id
    );
  }

  await updateDoc(installationRef, completionUpdate);

  return {
    id: installationId,
    ...updatedInstallation,
    active: false,
    sparePartsConsumed:
      updatedInstallation.sparePartsConsumed === true || consumedMovements.length > 0,
    equipmentLocationsUpdated:
      updatedInstallation.equipmentLocationsUpdated === true ||
      equipmentLocationUpdates.length > 0,
    sparePartMovementIds: consumedMovements.map((movement) => movement.id),
    equipmentLocationLogIds: equipmentLocationUpdates.map(
      (movement) => movement.id
    ),
    equipmentLocationUpdatedCount: equipmentLocationUpdates.length,
  };
}

export async function cancelTechnicalInstallation(
  installationId,
  installationData,
  currentUserProfile
) {
  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  const updatedInstallation = buildInstallationPayload(
    {
      ...installationData,
      status: "cancelled",
    },
    currentUserProfile,
    "update"
  );

  const installationRef = doc(
    db,
    TECHNICAL_INSTALLATIONS_COLLECTION,
    installationId
  );

  await updateDoc(installationRef, {
    ...updatedInstallation,
    active: false,
    cancelledAt: serverTimestamp(),
    cancelledBy: currentUserProfile?.name || "",
    cancelledByEmail: currentUserProfile?.email || "",
    cancelledById: currentUserProfile?.uid || currentUserProfile?.id || "",
  });

  return {
    id: installationId,
    ...updatedInstallation,
    active: false,
  };
}


export async function updateTechnicalInstallationEquipment(
  installationId,
  installationData,
  installedEquipment,
  currentUserProfile
) {
  if (!installationId) {
    throw new Error("Falta el ID de la instalación.");
  }

  const installationRef = doc(
    db,
    TECHNICAL_INSTALLATIONS_COLLECTION,
    installationId
  );
  const updatedInstallation = buildInstallationPayload(
    {
      ...installationData,
      installedEquipment,
    },
    currentUserProfile,
    "update"
  );

  await updateDoc(installationRef, updatedInstallation);

  return {
    id: installationId,
    ...updatedInstallation,
  };
}
