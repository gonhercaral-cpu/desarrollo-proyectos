import { useEffect, useState } from "react";
import { collection, doc, getDocsFromServer, limit, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, getBlob } from "firebase/storage";
import { auth, db, functions, storage } from "./firebase";

const freeze = httpsCallable(functions, "freezePrintDocument", { timeout: 180000 });
export const MAX_PRINT_PDF_BYTES = 32 * 1024 * 1024;

export async function preparePrintDocument({
  file, driveFile, certificateId, credentialId, operationId = crypto.randomUUID(), onProgress,
}) {
  if (!auth.currentUser) throw new Error("Inicia sesión para preparar la impresión.");
  const origin = certificateId ? "certificate" : credentialId ? "credential" : driveFile ? "drive" : "local";
  const args = { operationId, origin };
  if (certificateId) args.certificateId = certificateId;
  if (credentialId) args.credentialId = credentialId;
  if (driveFile) args.driveFileId = driveFile.id;
  if (file) {
    if (!(file instanceof Blob) || !file.size || file.size > MAX_PRINT_PDF_BYTES
      || await file.slice(0, 5).text() !== "%PDF-") {
      throw new Error("Selecciona un PDF válido de hasta 32 MB.");
    }
    args.name = file.name || "Documento.pdf";
    args.uploadId = operationId;
    const target = ref(storage, `printStaging/${auth.currentUser.uid}/${operationId}.pdf`);
    const upload = uploadBytesResumable(target, file, { contentType: "application/pdf" });
    upload.on("state_changed", (snapshot) => onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes));
    try { await upload; } catch (error) {
      // A retry may encounter the create-only staging object from the same operation.
      // The callable checks its owner and returns the server's committed version.
      if (error.code !== "storage/unauthorized") throw error;
    }
  } else if (origin === "local") {
    throw new Error("Selecciona el documento que se va a imprimir.");
  }
  const { data } = await freeze(args);
  return data;
}

export async function getPrintDocumentBlob(snapshot) {
  if (!snapshot?.path) throw new Error("El documento de impresión no está disponible.");
  return getBlob(ref(storage, snapshot.path), MAX_PRINT_PDF_BYTES);
}

export function openPrintProductionSource(source) {
  window.dispatchEvent(new CustomEvent("print-production-source", {
    detail: { source, type: source.origin, title: source.name },
  }));
}

export function useIssuedPrintOptions() {
  const { user, isAdmin } = useAuth();
  const [settings, setSettings] = useState({});
  useEffect(() => onSnapshot(doc(db, "printSettings", "production"), (snap) => {
    const options = snap.data() || {};
    const rule = options.permissions?.create || {};
    const uid = user?.uid;
    const canPrepare = isAdmin || (!!uid && !rule.denyUids?.includes(uid)
      && (rule.allowUids?.includes(uid) || rule.operator !== false));
    setSettings({ canPrepare, certificate: options.certificateEnabled === true, credential: options.credentialEnabled === true });
  }, () => setSettings({})), [user?.uid, isAdmin]);
  return settings;
}


export async function confirmLegacyCertificatePrint({ certificateId, requestId }) {
  const field = certificateId ? "source.certificateId" : "requestId";
  if (!certificateId && !requestId) return true;
  let message;
  try {
    const jobs = await getDocsFromServer(query(collection(db, "printJobs"),
      where(field, "==", certificateId || requestId), limit(26)));
    const unresolved = jobs.docs.some((item) => !["draft", "cancelled", "completed"].includes(item.data().status));
    if (!unresolved && jobs.size < 26) return true;
    message = "Hay producción asociada a este documento que requiere comprobar el resultado físico.";
  } catch {
    message = "No se pudo comprobar si el Gestor ya envió este documento.";
  }
  return window.confirm(message + " Verifica la cola y las hojas producidas. ¿Confirmas que revisaste el resultado y deseas usar la impresión anterior?");
}
