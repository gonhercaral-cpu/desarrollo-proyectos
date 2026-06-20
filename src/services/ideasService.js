import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const db = getFirestore();
const storage = getStorage();

const IDEAS_COLLECTION = "ideas";

export const IDEA_STATUSES = [
  { value: "nueva", label: "Nueva", tone: "blue" },
  { value: "en_revision", label: "En revisión", tone: "gold" },
  { value: "necesita_mas_informacion", label: "Necesita más información", tone: "orange" },
  { value: "aprobada", label: "Aprobada", tone: "green" },
  { value: "en_pausa", label: "En pausa", tone: "purple" },
  { value: "descartada", label: "Descartada", tone: "red" },
  { value: "convertida_en_proyecto", label: "Convertida en proyecto", tone: "teal" },
];

export const IDEA_PRIORITIES = [
  { value: "baja", label: "Baja", tone: "gray" },
  { value: "media", label: "Media", tone: "blue" },
  { value: "alta", label: "Alta", tone: "orange" },
  { value: "urgente", label: "Urgente", tone: "red" },
];

export const IDEA_IMPACTS = [
  { value: "bajo", label: "Bajo", tone: "gray" },
  { value: "medio", label: "Medio", tone: "blue" },
  { value: "alto", label: "Alto", tone: "green" },
  { value: "muy_alto", label: "Muy alto", tone: "purple" },
];

export const IDEA_AREAS = [
  "Administración",
  "Recepción",
  "Dirección Académica",
  "Material para clases",
  "Soporte Técnico",
  "Producción audiovisual",
  "Programación",
  "Imprenta",
  "Coffee Beans Factory",
  "Agenda del equipo",
  "Solicitudes de compra",
  "General",
  "Otro",
];

function getProfileName(profile, firebaseUser) {
  return (
    profile?.name ||
    profile?.displayName ||
    firebaseUser?.displayName ||
    firebaseUser?.email ||
    "Usuario"
  );
}

function getProfileEmail(profile, firebaseUser) {
  return profile?.email || firebaseUser?.email || "";
}

function cleanFileName(fileName = "archivo") {
  return String(fileName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "archivo";
}

function normalizeIdea(docSnapshot) {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    title: data.title || "",
    area: data.area || "General",
    currentProblem: data.currentProblem || "",
    proposedIdea: data.proposedIdea || "",
    implementationSuggestion: data.implementationSuggestion || "",
    expectedBenefit: data.expectedBenefit || "",
    priority: data.priority || "media",
    impact: data.impact || "medio",
    status: data.status || "nueva",
    evidenceFiles: Array.isArray(data.evidenceFiles) ? data.evidenceFiles : [],
    evidenceCount: Number(data.evidenceCount || 0),
    createdByUid: data.createdByUid || "",
    createdByName: data.createdByName || "",
    createdByEmail: data.createdByEmail || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    reviewedAt: data.reviewedAt || null,
    reviewedByUid: data.reviewedByUid || "",
    reviewedByName: data.reviewedByName || "",
    reviewedByEmail: data.reviewedByEmail || "",
    convertedProjectId: data.convertedProjectId || null,
    ...data,
  };
}

function sortByCreatedAtDesc(a, b) {
  const aTime = a.createdAt?.toMillis?.() || 0;
  const bTime = b.createdAt?.toMillis?.() || 0;

  return bTime - aTime;
}

export function getIdeaStatusConfig(status) {
  return IDEA_STATUSES.find((item) => item.value === status) || IDEA_STATUSES[0];
}

export function getIdeaPriorityConfig(priority) {
  return IDEA_PRIORITIES.find((item) => item.value === priority) || IDEA_PRIORITIES[1];
}

export function getIdeaImpactConfig(impact) {
  return IDEA_IMPACTS.find((item) => item.value === impact) || IDEA_IMPACTS[1];
}

export function subscribeIdeas({ firebaseUser, profile, isAdmin, onChange, onError }) {
  if (!firebaseUser?.uid || !profile) {
    return () => {};
  }

  const ideasRef = collection(db, IDEAS_COLLECTION);
  const ideasQuery = isAdmin
    ? query(ideasRef)
    : query(ideasRef, where("createdByUid", "==", firebaseUser.uid));

  return onSnapshot(
    ideasQuery,
    (snapshot) => {
      const rows = snapshot.docs.map(normalizeIdea).sort(sortByCreatedAtDesc);
      onChange(rows);
    },
    onError
  );
}

export function subscribeIdeaComments(ideaId, onChange, onError) {
  if (!ideaId) {
    return () => {};
  }

  return onSnapshot(
    collection(db, IDEAS_COLLECTION, ideaId, "comments"),
    (snapshot) => {
      const rows = snapshot.docs
        .map((commentDoc) => ({ id: commentDoc.id, ...commentDoc.data() }))
        .sort(sortByCreatedAtDesc);

      onChange(rows);
    },
    onError
  );
}

export async function createIdea({ form, files = [], firebaseUser, profile }) {
  if (!firebaseUser?.uid) {
    throw new Error("No se encontró el usuario autenticado.");
  }

  const userName = getProfileName(profile, firebaseUser);
  const userEmail = getProfileEmail(profile, firebaseUser);

  const cleanTitle = form.title?.trim();
  const cleanProblem = form.currentProblem?.trim();
  const cleanProposal = form.proposedIdea?.trim();
  const cleanBenefit = form.expectedBenefit?.trim();

  if (!cleanTitle || !cleanProblem || !cleanProposal || !cleanBenefit) {
    throw new Error("Completa título, problema actual, propuesta y beneficio esperado.");
  }

  const ideaRef = await addDoc(collection(db, IDEAS_COLLECTION), {
    title: cleanTitle,
    area: form.area || profile?.area || "General",
    currentProblem: cleanProblem,
    proposedIdea: cleanProposal,
    implementationSuggestion: form.implementationSuggestion?.trim() || "",
    expectedBenefit: cleanBenefit,
    priority: form.priority || "media",
    impact: form.impact || "medio",
    status: "nueva",
    evidenceFiles: [],
    evidenceCount: 0,
    createdByUid: firebaseUser.uid,
    createdByName: userName,
    createdByEmail: userEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid: firebaseUser.uid,
    updatedByName: userName,
    updatedByEmail: userEmail,
    reviewedAt: null,
    reviewedByUid: "",
    reviewedByName: "",
    reviewedByEmail: "",
    convertedProjectId: null,
  });

  if (files.length > 0) {
    await uploadIdeaEvidence({ ideaId: ideaRef.id, files, firebaseUser, profile });
  }

  return ideaRef.id;
}

export async function uploadIdeaEvidence({ ideaId, files = [], firebaseUser, profile }) {
  if (!ideaId) {
    throw new Error("Falta el ID de la idea.");
  }

  if (!firebaseUser?.uid) {
    throw new Error("No se encontró el usuario autenticado.");
  }

  const validFiles = Array.from(files).filter(Boolean);

  if (validFiles.length === 0) {
    return [];
  }

  const userName = getProfileName(profile, firebaseUser);
  const userEmail = getProfileEmail(profile, firebaseUser);
  const uploadedItems = [];

  for (const file of validFiles) {
    const safeName = cleanFileName(file.name);
    const filePath = `ideas/${firebaseUser.uid}/${ideaId}/evidence/${Date.now()}-${safeName}`;
    const fileRef = ref(storage, filePath);

    await uploadBytes(fileRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        ideaId,
        uploadedByUid: firebaseUser.uid,
      },
    });

    const url = await getDownloadURL(fileRef);

    uploadedItems.push({
      name: file.name,
      url,
      path: filePath,
      type: file.type || "",
      size: file.size || 0,
      uploadedByUid: firebaseUser.uid,
      uploadedByName: userName,
      uploadedByEmail: userEmail,
      uploadedAt: new Date().toISOString(),
    });
  }

  await updateDoc(doc(db, IDEAS_COLLECTION, ideaId), {
    evidenceFiles: arrayUnion(...uploadedItems),
    evidenceCount: increment(uploadedItems.length),
    updatedAt: serverTimestamp(),
    updatedByUid: firebaseUser.uid,
    updatedByName: userName,
    updatedByEmail: userEmail,
  });

  return uploadedItems;
}

export async function updateIdeaStatus({ ideaId, status, firebaseUser, profile }) {
  if (!ideaId) {
    throw new Error("Falta el ID de la idea.");
  }

  const userName = getProfileName(profile, firebaseUser);
  const userEmail = getProfileEmail(profile, firebaseUser);

  await updateDoc(doc(db, IDEAS_COLLECTION, ideaId), {
    status,
    reviewedAt: serverTimestamp(),
    reviewedByUid: firebaseUser.uid,
    reviewedByName: userName,
    reviewedByEmail: userEmail,
    updatedAt: serverTimestamp(),
    updatedByUid: firebaseUser.uid,
    updatedByName: userName,
    updatedByEmail: userEmail,
  });
}

export async function addIdeaAdminComment({ ideaId, comment, firebaseUser, profile }) {
  if (!ideaId) {
    throw new Error("Falta el ID de la idea.");
  }

  const cleanComment = comment?.trim();

  if (!cleanComment) {
    return null;
  }

  const userName = getProfileName(profile, firebaseUser);
  const userEmail = getProfileEmail(profile, firebaseUser);

  const commentRef = await addDoc(collection(db, IDEAS_COLLECTION, ideaId, "comments"), {
    ideaId,
    comment: cleanComment,
    createdByUid: firebaseUser.uid,
    createdByName: userName,
    createdByEmail: userEmail,
    createdAt: serverTimestamp(),
  });

  return commentRef.id;
}

export async function deleteIdea(ideaId) {
  if (!ideaId) {
    throw new Error("Falta el ID de la idea.");
  }

  await deleteDoc(doc(db, IDEAS_COLLECTION, ideaId));
}
