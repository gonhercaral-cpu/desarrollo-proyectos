import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../services/firebase";
import { editorialUserId } from "../models/editorialProduction";
import { compareEditorialSnapshots, normalizeVersionSummary } from "../utils/editorialVersioning";
import { getEditorialDocumentRef } from "./editorialPagesService";
import { loadEditorialDocumentSnapshot, restoreEditorialDocumentSnapshot } from "./editorialSnapshotService";

function versionsRef(projectId, documentId) { return collection(getEditorialDocumentRef(projectId, documentId), "versions"); }

export function subscribeEditorialVersions({ projectId, documentId, onChange, onError }) {
  return onSnapshot(query(versionsRef(projectId, documentId), orderBy("versionNumber", "desc")), (snapshot) => onChange(snapshot.docs.map((item) => normalizeVersionSummary({ id: item.id, ...item.data() }))), onError);
}

async function nextVersionNumber(projectId, documentId) {
  const snapshot = await getDocs(versionsRef(projectId, documentId));
  return Math.max(0, ...snapshot.docs.map((item) => Number(item.data().versionNumber || 0))) + 1;
}

export async function createEditorialVersion({ projectId, documentId, name, description = "", user, snapshot: suppliedSnapshot }) {
  const snapshot = suppliedSnapshot || await loadEditorialDocumentSnapshot({ projectId, documentId });
  const versionNumber = await nextVersionNumber(projectId, documentId);
  const versionRef = await addDoc(versionsRef(projectId, documentId), {
    name: String(name || `Versión ${versionNumber}`), description: String(description || ""), versionNumber,
    createdBy: { uid: editorialUserId(user), name: user?.name || "", email: user?.email || "" }, createdAt: serverTimestamp(),
    pageCount: snapshot.pages.length, status: "uploading", storagePath: "",
  });
  const storagePath = `editorial/${projectId}/versions/${editorialUserId(user)}/${documentId}-${versionRef.id}.json`;
  try {
    await uploadBytes(ref(storage, storagePath), new Blob([JSON.stringify(snapshot)], { type: "application/json" }), { contentType: "application/json" });
    await updateDoc(versionRef, { storagePath, status: "ready" });
    return versionRef.id;
  } catch (error) {
    await deleteDoc(versionRef).catch(() => {});
    throw error;
  }
}

export async function readEditorialVersionSnapshot({ projectId, documentId, versionId }) {
  const versionSnapshot = await getDoc(doc(versionsRef(projectId, documentId), versionId));
  if (!versionSnapshot.exists() || !versionSnapshot.data().storagePath) throw new Error("Snapshot de versión no disponible.");
  const bytes = await getBytes(ref(storage, versionSnapshot.data().storagePath));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function compareEditorialVersion({ projectId, documentId, versionId }) {
  const [previous, current] = await Promise.all([
    readEditorialVersionSnapshot({ projectId, documentId, versionId }), loadEditorialDocumentSnapshot({ projectId, documentId }),
  ]);
  return compareEditorialSnapshots(previous, current);
}

export async function restoreEditorialVersion({ projectId, documentId, versionId, user }) {
  const target = await readEditorialVersionSnapshot({ projectId, documentId, versionId });
  await createEditorialVersion({ projectId, documentId, name: "Respaldo antes de restaurar", description: `Respaldo automático previo a restaurar ${versionId}.`, user });
  await restoreEditorialDocumentSnapshot({ projectId, documentId, snapshot: target });
}

export async function deleteEditorialVersion({ projectId, documentId, version }) {
  if (version.storagePath) await deleteObject(ref(storage, version.storagePath)).catch(() => {});
  await deleteDoc(doc(versionsRef(projectId, documentId), version.id));
}
