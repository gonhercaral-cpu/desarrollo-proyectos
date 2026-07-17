import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveUsers } from "../../services/usersService";
import { normalizeReviewState, reviewProgress } from "../models/editorialProduction";
import { hasBlockingPreflight, runEditorialPreflight, summarizePreflight } from "../utils/editorialPreflight";
import { deleteEditorialExport, runEditorialExport, subscribeEditorialExports } from "../services/editorialExportsService";
import { createEditorialComment, setEditorialCommentStatus, subscribeEditorialReview, updateEditorialPageReview, updateEditorialReviewState } from "../services/editorialReviewService";
import { loadEditorialDocumentSnapshot } from "../services/editorialSnapshotService";
import { compareEditorialVersion, createEditorialVersion, deleteEditorialVersion, restoreEditorialVersion, subscribeEditorialVersions } from "../services/editorialVersionsService";

export function useEditorialProduction({ projectId, documentId, pages, user }) {
  const [reviewState, setReviewState] = useState(normalizeReviewState());
  const [comments, setComments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [exports, setExports] = useState([]);
  const [users, setUsers] = useState([]);
  const [preflight, setPreflight] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  useEffect(() => {
    if (!projectId || !documentId) return undefined;
    const fail = (nextError) => setError(nextError.message || "No fue posible cargar revisión editorial.");
    const unsubscribeReview = subscribeEditorialReview({ projectId, documentId, onState: setReviewState, onComments: setComments, onError: fail });
    const unsubscribeVersions = subscribeEditorialVersions({ projectId, documentId, onChange: setVersions, onError: fail });
    const unsubscribeExports = subscribeEditorialExports({ projectId, documentId, onChange: setExports, onError: fail });
    getActiveUsers().then(setUsers).catch(fail);
    return () => { unsubscribeReview(); unsubscribeVersions(); unsubscribeExports(); abortRef.current?.abort(); };
  }, [documentId, projectId]);

  const run = useCallback(async (operation) => {
    setBusy(true); setError("");
    try { return await operation(); }
    catch (nextError) { setError(nextError.message || "Operación editorial fallida."); throw nextError; }
    finally { setBusy(false); }
  }, []);

  const saveReview = useCallback((changes) => run(() => updateEditorialReviewState({ projectId, documentId, changes: { ...reviewState, ...changes }, user })), [documentId, projectId, reviewState, run, user]);
  const loadPreflight = useCallback(async () => {
    const snapshot = await loadEditorialDocumentSnapshot({ projectId, documentId });
    const results = runEditorialPreflight(snapshot);
    setPreflight(results); return { snapshot, results };
  }, [documentId, projectId]);
  const executePreflight = useCallback(() => run(loadPreflight), [loadPreflight, run]);
  const ignorePreflight = useCallback((item, reason) => {
    if (!String(reason || "").trim()) return Promise.reject(new Error("Justificación obligatoria."));
    return saveReview({ ignoredPreflight: { ...reviewState.ignoredPreflight, [item.id]: { reason: String(reason).trim(), ignoredByUid: user?.uid || user?.id || "", ignoredAt: new Date().toISOString() } } });
  }, [reviewState.ignoredPreflight, saveReview, user]);
  const createVersion = useCallback((values) => run(() => createEditorialVersion({ projectId, documentId, ...values, user })), [documentId, projectId, run, user]);
  const compareVersion = useCallback((versionId) => run(() => compareEditorialVersion({ projectId, documentId, versionId })), [documentId, projectId, run]);
  const restoreVersion = useCallback((versionId) => run(() => restoreEditorialVersion({ projectId, documentId, versionId, user })), [documentId, projectId, run, user]);
  const removeVersion = useCallback((version) => run(() => deleteEditorialVersion({ projectId, documentId, version })), [documentId, projectId, run]);
  const exportDocument = useCallback((settings) => run(async () => {
    const { snapshot, results } = await loadPreflight();
    if (settings.type === "print" && hasBlockingPreflight(results)) throw new Error("Preflight contiene errores críticos. PDF de imprenta bloqueado.");
    abortRef.current = new AbortController(); setProgress({ percent: 0, variant: settings.variant });
    try {
      return await runEditorialExport({ projectId, documentId, settings, preflightSummary: summarizePreflight(results), user, snapshot, signal: abortRef.current.signal, onProgress: setProgress });
    } finally { abortRef.current = null; setProgress(null); }
  }), [documentId, loadPreflight, projectId, run, user]);

  return {
    reviewState, comments, versions, exports, users, preflight, preflightSummary: summarizePreflight(preflight),
    progress, busy, error, progressPercent: reviewProgress(reviewState, pages), clearError: () => setError(""),
    actions: {
      saveReview, executePreflight, ignorePreflight,
      updatePageReview: (pageId, status, assigneeUid) => run(() => updateEditorialPageReview({ projectId, documentId, pageId, status, assigneeUid, user })),
      createComment: (pageId, elementId, message) => run(() => createEditorialComment({ projectId, documentId, pageId, elementId, message, user })),
      setCommentStatus: (commentId, status) => run(() => setEditorialCommentStatus({ projectId, documentId, commentId, status, user })),
      createVersion, compareVersion, restoreVersion, removeVersion, exportDocument,
      removeExport: (item) => run(() => deleteEditorialExport({ projectId, documentId, item })),
      cancelExport: () => abortRef.current?.abort(),
    },
  };
}
