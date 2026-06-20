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

  await updateDoc(installationRef, {
    ...updatedInstallation,
    active: false,
    completedAt: serverTimestamp(),
    completedBy: currentUserProfile?.name || "",
    completedByEmail: currentUserProfile?.email || "",
    completedById: currentUserProfile?.uid || currentUserProfile?.id || "",
  });

  return {
    id: installationId,
    ...updatedInstallation,
    active: false,
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
