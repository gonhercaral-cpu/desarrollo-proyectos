import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../services/firebase";
import { editorialUserId } from "../models/editorialProduction";
import { selectEditorialPages } from "../utils/editorialPageSelection";
import { getEditorialDocumentRef } from "./editorialPagesService";
import { loadEditorialDocumentSnapshot } from "./editorialSnapshotService";

function exportsRef(projectId, documentId) { return collection(getEditorialDocumentRef(projectId, documentId), "exports"); }

// Resuelve una URL descargable: usa downloadUrl si existe; si no, la deriva del
// storagePath vía getDownloadURL. Lanza si no hay ninguno.
export async function resolveEditorialDownloadUrl({ downloadUrl, downloadURL, storagePath } = {}) {
  const direct = downloadUrl || downloadURL;
  if (direct) return direct;
  if (storagePath) return getDownloadURL(ref(storage, storagePath));
  throw new Error("La exportación no tiene archivo descargable.");
}
function safeName(value) { return String(value || "documento").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "documento"; }

export function subscribeEditorialExports({ projectId, documentId, onChange, onError }) {
  return onSnapshot(query(exportsRef(projectId, documentId), orderBy("createdAt", "desc")), (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError);
}

async function createRecord({ projectId, documentId, type, variant, selection, settings, preflightSummary, user }) {
  return addDoc(exportsRef(projectId, documentId), {
    type, variant, versionId: settings.versionId || "", pageSelection: selection, settings,
    preflightSummary, status: "processing", progress: 0, storagePath: "", sizeBytes: 0,
    createdBy: { uid: editorialUserId(user), name: user?.name || "", email: user?.email || "" }, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

export async function runEditorialExport({ projectId, documentId, settings, preflightSummary = {}, user, onProgress, signal, snapshot: suppliedSnapshot }) {
  const { renderEditorialImages, renderEditorialPdf } = await import("../utils/editorialPdfRenderer");
  const snapshot = suppliedSnapshot || await loadEditorialDocumentSnapshot({ projectId, documentId });
  const pages = selectEditorialPages({ pages: snapshot.pages, sections: snapshot.sections, ...settings.selection });
  if (!pages.length) throw new Error("Selección de páginas vacía.");
  const variants = settings.variant === "both" ? ["student", "teacher"] : [settings.variant || "student"];
  const groups = settings.type === "print" && settings.splitMode === "separate"
    ? [
        { suffix: "portada", pages: pages.filter((page) => ["cover", "back_cover"].includes(page.pageType)) },
        { suffix: "interior", pages: pages.filter((page) => !["cover", "back_cover"].includes(page.pageType)) },
      ].filter((group) => group.pages.length)
    : [{ suffix: "", pages }];
  const results = [];
  for (const variant of variants) {
    const variantName = variant === "student" ? "alumno" : "maestro";
    for (const group of groups) {
      const recordRef = await createRecord({ projectId, documentId, type: settings.type, variant, selection: { ...settings.selection, pageIds: group.pages.map((page) => page.id), outputGroup: group.suffix }, settings, preflightSummary, user });
      let storagePath = "";
      try {
        const report = (progress) => { updateDoc(recordRef, { progress: progress.percent, updatedAt: serverTimestamp() }).catch(() => {}); onProgress?.({ ...progress, variant }); };
        let file;
        if (settings.type === "images") file = await renderEditorialImages({ snapshot, pages: group.pages, variant, settings, onProgress: report, signal });
        else {
          const blob = await renderEditorialPdf({ snapshot, pages: group.pages, variant, settings, onProgress: report, signal });
          file = { name: `${safeName(snapshot.project.name)}-${variantName}${group.suffix ? `-${group.suffix}` : ""}.pdf`, blob };
        }
        const extension = file.name.split(".").pop();
        storagePath = `editorial/${projectId}/exports/${editorialUserId(user)}/${recordRef.id}-${safeName(file.name)}`;
        await uploadBytes(ref(storage, storagePath), file.blob, { contentType: file.blob.type || (extension === "zip" ? "application/zip" : "application/octet-stream") });
        const downloadUrl = await getDownloadURL(ref(storage, storagePath));
        await updateDoc(recordRef, { status: "completed", progress: 100, storagePath, sizeBytes: file.blob.size, downloadUrl, completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        results.push({ id: recordRef.id, variant, name: file.name, blob: file.blob, downloadUrl, storagePath });
      } catch (error) {
        if (storagePath) await deleteObject(ref(storage, storagePath)).catch(() => {});
        await updateDoc(recordRef, { status: error?.name === "AbortError" ? "cancelled" : "failed", error: error.message || "Error de exportación", updatedAt: serverTimestamp() });
        throw error;
      }
    }
  }
  return results;
}

export async function deleteEditorialExport({ projectId, documentId, item }) {
  if (item.storagePath) await deleteObject(ref(storage, item.storagePath)).catch(() => {});
  await deleteDoc(doc(exportsRef(projectId, documentId), item.id));
}

export function downloadEditorialBlob(blob, name) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
