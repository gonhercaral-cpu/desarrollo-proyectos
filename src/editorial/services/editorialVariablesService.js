import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

export const EDITORIAL_VARIABLES_COLLECTION = "variables";

function collectionRef(projectId) {
  return collection(doc(db, EDITORIAL_COLLECTIONS.projects, projectId), EDITORIAL_VARIABLES_COLLECTION);
}

export function subscribeEditorialVariables({ projectId, onChange, onError }) {
  return onSnapshot(collectionRef(projectId), (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.key).localeCompare(String(b.key)))), onError);
}

export async function saveEditorialVariable({ projectId, variable, user }) {
  const uid = user?.uid || user?.id;
  const key = String(variable.key || "").trim();
  if (!uid || !key) throw new Error("Escribe clave válida para variable.");
  const variableRef = variable.id ? doc(collectionRef(projectId), variable.id) : doc(collectionRef(projectId));
  await setDoc(variableRef, {
    key,
    value: String(variable.value ?? ""),
    scope: "project",
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
    ...(!variable.id ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
  return variableRef.id;
}

export async function deleteEditorialVariable({ projectId, variableId }) {
  await deleteDoc(doc(collectionRef(projectId), variableId));
}
