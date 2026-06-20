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

const TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION =
  "technicalInstallationTemplates";

const TEMPLATE_SECTIONS = [
  "physicalItems",
  "softwareItems",
  "configurationItems",
  "testItems",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveCustomValue(selectedValue, customValue, fallback = "Otro") {
  const selected = normalizeText(selectedValue);
  const custom = normalizeText(customValue);

  if (selected.toLowerCase() === "otro" && custom) {
    return custom;
  }

  return selected || fallback;
}

function normalizeChecklistItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => ({
      id:
        normalizeText(item?.id) ||
        `step-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      label: normalizeText(item?.label),
      required: item?.required !== false,
    }))
    .filter((item) => item.label);
}

function getTotalSteps(payload) {
  return TEMPLATE_SECTIONS.reduce(
    (total, sectionKey) => total + normalizeChecklistItems(payload[sectionKey]).length,
    0
  );
}

function buildInstallationTemplatePayload(
  templateData,
  currentUserProfile,
  mode = "create"
) {
  const name = normalizeText(templateData?.name);

  if (!name) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }

  const normalizedSections = TEMPLATE_SECTIONS.reduce((result, sectionKey) => {
    result[sectionKey] = normalizeChecklistItems(templateData?.[sectionKey]);
    return result;
  }, {});

  const totalSteps = getTotalSteps(normalizedSections);

  if (totalSteps <= 0) {
    throw new Error("La plantilla debe tener al menos un paso en su checklist.");
  }

  const active = templateData?.active !== false;

  const basePayload = {
    name,
    description: normalizeText(templateData?.description),
    targetLocationType: resolveCustomValue(
      templateData?.targetLocationType,
      templateData?.targetLocationTypeOther,
      "Otro"
    ),
    equipmentCategory: resolveCustomValue(
      templateData?.equipmentCategory,
      templateData?.equipmentCategoryOther,
      "Otro"
    ),
    active,
    status: active ? "active" : "inactive",
    totalSteps,
    requiredSteps: TEMPLATE_SECTIONS.reduce(
      (total, sectionKey) =>
        total + normalizedSections[sectionKey].filter((item) => item.required).length,
      0
    ),
    ...normalizedSections,
    deleted: false,
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

export async function getTechnicalInstallationTemplates() {
  const templatesRef = collection(
    db,
    TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION
  );
  const q = query(templatesRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createTechnicalInstallationTemplate(
  templateData,
  currentUserProfile
) {
  const templatesRef = collection(
    db,
    TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION
  );
  const newTemplate = buildInstallationTemplatePayload(
    templateData,
    currentUserProfile,
    "create"
  );

  const documentRef = await addDoc(templatesRef, newTemplate);

  return {
    id: documentRef.id,
    ...newTemplate,
  };
}

export async function updateTechnicalInstallationTemplate(
  templateId,
  templateData,
  currentUserProfile
) {
  if (!templateId) {
    throw new Error("Falta el ID de la plantilla de instalación.");
  }

  const templateRef = doc(
    db,
    TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION,
    templateId
  );
  const updatedTemplate = buildInstallationTemplatePayload(
    templateData,
    currentUserProfile,
    "update"
  );

  await updateDoc(templateRef, updatedTemplate);

  return {
    id: templateId,
    ...updatedTemplate,
  };
}

export async function deactivateTechnicalInstallationTemplate(
  templateId,
  currentUserProfile
) {
  if (!templateId) {
    throw new Error("Falta el ID de la plantilla de instalación.");
  }

  const templateRef = doc(
    db,
    TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION,
    templateId
  );

  await updateDoc(templateRef, {
    active: false,
    status: "inactive",
    deactivatedAt: serverTimestamp(),
    deactivatedBy: currentUserProfile?.name || "",
    deactivatedByEmail: currentUserProfile?.email || "",
    deactivatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  return { id: templateId, active: false, status: "inactive" };
}

export async function restoreTechnicalInstallationTemplate(
  templateId,
  currentUserProfile
) {
  if (!templateId) {
    throw new Error("Falta el ID de la plantilla de instalación.");
  }

  const templateRef = doc(
    db,
    TECHNICAL_INSTALLATION_TEMPLATES_COLLECTION,
    templateId
  );

  await updateDoc(templateRef, {
    active: true,
    status: "active",
    restoredAt: serverTimestamp(),
    restoredBy: currentUserProfile?.name || "",
    restoredByEmail: currentUserProfile?.email || "",
    restoredById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  });

  return { id: templateId, active: true, status: "active" };
}
