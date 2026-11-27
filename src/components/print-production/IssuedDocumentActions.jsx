import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { openPrintProductionSource, preparePrintDocument } from "../../services/printDocuments";

export function RequestProductionStatus({ requestId }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!requestId) return undefined;
    return onSnapshot(query(collection(db, "printJobs"), where("requestId", "==", requestId), limit(25)),
      (snapshot) => {
        setJobs(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
        setError(false);
      }, () => setError(true));
  }, [requestId]);
  if (error) return <p role="status">No se pudo consultar la producción física.</p>;
  if (!jobs?.length) return null;
  const states = { draft: "Borrador", queued: "En cola", printing: "En impresión", paused: "Pausado",
    cancelled: "Cancelado", completed: "Finalizado", partial: "Producción parcial", error: "Incidencia",
    submitted: "Enviado a la cola de la impresora", confirmation: "Pendiente de confirmación", quality: "En revisión de calidad" };
  return <details className="request-detail-note">
    <summary>Producción física de esta solicitud</summary>
    <ul>{jobs.map((job) => <li key={job.id}><strong>{job.folio || job.title || job.id}</strong>
      {" · "}{states[job.status] || job.status || "Estado pendiente"}</li>)}</ul>
  </details>;
}

export function IssuedDocumentAction({ certificateId, credentialId, captureOriginal, newlyIssued = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsOriginal, setNeedsOriginal] = useState(false);
  async function open(file) {
    setBusy(true);
    setMessage("");
    try {
      let snapshot;
      try {
        snapshot = await preparePrintDocument({ certificateId, credentialId, file });
      } catch (error) {
        if (!credentialId || file || error.code !== "functions/not-found") throw error;
        if (!newlyIssued || !captureOriginal) {
          setNeedsOriginal(true);
          setMessage("Vincula el PDF original descargado al emitir esta credencial.");
          return;
        }
        const original = await captureOriginal();
        snapshot = await preparePrintDocument({ credentialId, file: original });
      }
      openPrintProductionSource(snapshot);
    } catch (error) {
      setMessage(error.message || "No se pudo preparar el documento.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    <button className="visual-outline-button" type="button" disabled={busy}
      onClick={() => open()}>{busy ? "Preparando PDF…" : "Preparar en Gestor"}</button>
    {needsOriginal && <label>PDF original de la credencial
      <input type="file" accept=".pdf,application/pdf" disabled={busy}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) open(file); }} />
    </label>}
    {message && <span role="status">{message}</span>}
  </>;
}
