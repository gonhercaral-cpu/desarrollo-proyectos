import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const TECHNICAL_LOCATIONS_COLLECTION = "technicalLocations";
const TECHNICAL_LOCATION_REVIEWS_COLLECTION = "technicalLocationReviews";

const CHECKLIST_LIBRARY = {
  Cabina: [
    "Computadora",
    "Monitor 1",
    "Monitor 2",
    "Teclado",
    "Mouse",
    "Bocinas",
    "No-break",
    "Lámpara 1",
    "Lámpara 2",
    "Internet",
    "Cableado ordenado",
  ],
  Salón: [
    "Computadora",
    "Pantalla o monitor",
    "Teclado",
    "Pilas del teclado",
    "Mouse",
    "Pilas del mouse",
    "Control de audio",
    "Amplificador",
    "Bocinas",
    "Internet",
    "Cableado ordenado",
  ],
  Recepción: [
    "Computadora principal",
    "Monitor",
    "Teclado",
    "Mouse",
    "Impresora",
    "Teléfono",
    "No-break",
    "Internet",
    "Cableado ordenado",
  ],
  "Coffee Beans": [
    "Computadora o punto de venta",
    "Monitor o pantalla",
    "Teclado",
    "Mouse",
    "Impresora / ticketera",
    "No-break",
    "Internet",
    "Cableado ordenado",
  ],
  Oficina: [
    "Computadora",
    "Monitor",
    "Teclado",
    "Mouse",
    "Impresora si aplica",
    "No-break",
    "Internet",
    "Cableado ordenado",
  ],
  "Área común": [
    "Equipo técnico asignado",
    "Cableado ordenado",
    "Conexiones eléctricas",
    "Internet si aplica",
    "Observaciones registradas",
  ],
  Otro: [
    "Equipo técnico asignado",
    "Funcionamiento general revisado",
    "Cableado o conexiones revisadas",
    "Observaciones registradas",
  ],
};

const LOCATION_REVIEW_CADENCE_BY_TYPE = {
  Cabina: { frequency: "Cada 15 días", days: 15 },
  Salón: { frequency: "Cada mes", days: 30 },
  Recepción: { frequency: "Cada mes", days: 30 },
  "Coffee Beans": { frequency: "Cada mes", days: 30 },
  Oficina: { frequency: "Cada 2 meses", days: 60 },
  "Área común": { frequency: "Cada 2 meses", days: 60 },
  Otro: { frequency: "Cada 2 meses", days: 60 },
};

function getReviewCadenceForType(type = "Otro") {
  return LOCATION_REVIEW_CADENCE_BY_TYPE[type] || LOCATION_REVIEW_CADENCE_BY_TYPE.Otro;
}

function normalizeChecklist(checklist) {
  if (!Array.isArray(checklist)) {
    return [];
  }

  return checklist
    .map((item) => ({
      label: String(item?.label || "").trim(),
      required: item?.required !== false,
      present:
        typeof item?.present === "boolean"
          ? item.present
          : typeof item?.checked === "boolean"
          ? item.checked
          : true,
      status: item?.status || "Pendiente",
      note: String(item?.note || "").trim(),
    }))
    .filter((item) => item.label);
}

function normalizeChecklistTemplate(checklist) {
  if (!Array.isArray(checklist)) {
    return [];
  }

  return checklist
    .map((item) => ({
      label: String(item?.label || "").trim(),
      required: item?.required !== false,
    }))
    .filter((item) => item.label);
}

function toChecklist(items) {
  return items.map((label) => ({
    label,
    required: true,
  }));
}

export function getDefaultTechnicalLocationChecklist(type = "Otro") {
  return toChecklist(CHECKLIST_LIBRARY[type] || CHECKLIST_LIBRARY.Otro);
}

export async function getTechnicalLocations() {
  const locationsRef = collection(db, TECHNICAL_LOCATIONS_COLLECTION);
  const q = query(locationsRef, orderBy("name", "asc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createTechnicalLocation(locationData, currentUserProfile) {
  if (!locationData) {
    throw new Error("No se recibió la información de la ubicación técnica.");
  }

  if (!locationData.name?.trim()) {
    throw new Error("El nombre de la ubicación técnica es obligatorio.");
  }

  if (!locationData.campus?.trim()) {
    throw new Error("El plantel de la ubicación técnica es obligatorio.");
  }

  if (!locationData.area?.trim()) {
    throw new Error("El área de la ubicación técnica es obligatoria.");
  }

  const locationsRef = collection(db, TECHNICAL_LOCATIONS_COLLECTION);
  const type = locationData.type || "Otro";
  const normalizedTemplate = normalizeChecklistTemplate(
    locationData.checklistTemplate
  );

  const newLocation = {
    name: locationData.name.trim(),
    campus: locationData.campus.trim(),
    area: locationData.area.trim(),
    type,
    status: locationData.status || "Correcto",
    reviewFrequency: getReviewCadenceForType(type).frequency,
    reviewIntervalDays: getReviewCadenceForType(type).days,
    notes: locationData.notes?.trim() || "",
    checklistTemplate:
      normalizedTemplate.length > 0
        ? normalizedTemplate
        : getDefaultTechnicalLocationChecklist(type),
    lastReviewAt: null,
    lastReviewStatus: "",
    createdBy: currentUserProfile?.name || "",
    createdByEmail: currentUserProfile?.email || "",
    createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const documentRef = await addDoc(locationsRef, newLocation);

  return {
    id: documentRef.id,
    ...newLocation,
  };
}

export async function updateTechnicalLocation(
  locationId,
  locationData,
  currentUserProfile
) {
  if (!locationId) {
    throw new Error("Falta el ID de la ubicación técnica.");
  }

  if (!locationData) {
    throw new Error("No se recibió la información actualizada de la ubicación.");
  }

  const locationRef = doc(db, TECHNICAL_LOCATIONS_COLLECTION, locationId);
  const type = locationData.type || "Otro";
  const normalizedTemplate = normalizeChecklistTemplate(
    locationData.checklistTemplate
  );

  const updatedLocation = {
    name: locationData.name?.trim() || "",
    campus: locationData.campus?.trim() || "",
    area: locationData.area?.trim() || "",
    type,
    status: locationData.status || "Correcto",
    reviewFrequency: getReviewCadenceForType(type).frequency,
    reviewIntervalDays: getReviewCadenceForType(type).days,
    notes: locationData.notes?.trim() || "",
    checklistTemplate:
      normalizedTemplate.length > 0
        ? normalizedTemplate
        : getDefaultTechnicalLocationChecklist(type),
    updatedBy: currentUserProfile?.name || "",
    updatedByEmail: currentUserProfile?.email || "",
    updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  };

  await updateDoc(locationRef, updatedLocation);

  return {
    id: locationId,
    ...updatedLocation,
  };
}

export async function deleteTechnicalLocation(locationId) {
  if (!locationId) {
    throw new Error("Falta el ID de la ubicacion tecnica.");
  }

  await deleteDoc(doc(db, TECHNICAL_LOCATIONS_COLLECTION, locationId));

  return { id: locationId, deleted: true };
}

export async function updateTechnicalLocationChecklist(
  locationId,
  checklistTemplate,
  currentUserProfile
) {
  if (!locationId) {
    throw new Error("Falta el ID de la ubicación técnica.");
  }

  const normalizedTemplate = normalizeChecklistTemplate(checklistTemplate);

  if (normalizedTemplate.length === 0) {
    throw new Error("El checklist debe tener al menos un elemento.");
  }

  const locationRef = doc(db, TECHNICAL_LOCATIONS_COLLECTION, locationId);

  const updateData = {
    checklistTemplate: normalizedTemplate,
    updatedBy: currentUserProfile?.name || "",
    updatedByEmail: currentUserProfile?.email || "",
    updatedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  };

  await updateDoc(locationRef, updateData);

  return updateData;
}

export async function getTechnicalLocationReviews(locationId) {
  if (!locationId) {
    throw new Error("Falta el ID de la ubicación técnica.");
  }

  const reviewsRef = collection(db, TECHNICAL_LOCATION_REVIEWS_COLLECTION);
  const q = query(
    reviewsRef,
    where("locationId", "==", locationId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function createTechnicalLocationReview(
  location,
  reviewData,
  currentUserProfile
) {
  if (!location?.id) {
    throw new Error("Falta la ubicación técnica relacionada.");
  }

  if (!reviewData) {
    throw new Error("No se recibió la información de la revisión técnica.");
  }

  const checklist = normalizeChecklist(reviewData.checklist);

  if (checklist.length === 0) {
    throw new Error("La revisión debe incluir al menos un elemento.");
  }

  const reviewsRef = collection(db, TECHNICAL_LOCATION_REVIEWS_COLLECTION);

  const newReview = {
    locationId: location.id,
    locationName: location.name || "",
    locationType: location.type || "",
    campus: location.campus || "",
    area: location.area || "",
    source: reviewData.source || "location",
    assetId: reviewData.assetId || "",
    assetName: reviewData.assetName || "",
    maintenanceId: reviewData.maintenanceId || "",
    generalStatus: reviewData.generalStatus || "Correcto",
    observations: reviewData.observations?.trim() || "",
    pendingActions: reviewData.pendingActions?.trim() || "",
    checklist,
    reviewedBy: currentUserProfile?.name || "",
    reviewedByEmail: currentUserProfile?.email || "",
    reviewedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    createdAt: serverTimestamp(),
  };

  const documentRef = await addDoc(reviewsRef, newReview);

  const locationRef = doc(db, TECHNICAL_LOCATIONS_COLLECTION, location.id);

  const cadence = getReviewCadenceForType(location.type || "Otro");
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + cadence.days);

  await updateDoc(locationRef, {
    status: newReview.generalStatus,
    reviewFrequency: cadence.frequency,
    reviewIntervalDays: cadence.days,
    lastReviewAt: serverTimestamp(),
    lastReviewStatus: newReview.generalStatus,
    nextReviewDate: nextReviewDate.toISOString().slice(0, 10),
    updatedAt: serverTimestamp(),
  });

  return {
    id: documentRef.id,
    ...newReview,
  };
}
