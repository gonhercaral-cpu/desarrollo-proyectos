import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeElementOrder } from "../models/editorialElements";
import {
  saveEditorialPageElements,
  subscribeEditorialPageElements,
} from "../services/editorialElementsService";

const AUTOSAVE_DELAY_MS = 650;

function getDraftKey(context) {
  return `dp.editorial.draft.${context.projectId}.${context.documentId}.${context.pageId}`;
}

function readDraft(context) {
  try {
    const value = window.localStorage.getItem(getDraftKey(context));
    return value ? normalizeElementOrder(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export function useEditorialAutosave({ context, user, elementsRef, onLoadElements }) {
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const persistedIdsRef = useRef(new Set());
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const savingPromiseRef = useRef(null);
  const onLoadRef = useRef(onLoadElements);

  useEffect(() => {
    onLoadRef.current = onLoadElements;
  }, [onLoadElements]);

  const markDirty = useCallback((elements) => {
    const orderedElements = normalizeElementOrder(elements);
    dirtyRef.current = true;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setStatus("idle");
    setError("");
    window.localStorage.setItem(getDraftKey(context), JSON.stringify(orderedElements));
  }, [context]);

  const flush = useCallback(async () => {
    if (savingPromiseRef.current) {
      await savingPromiseRef.current;
      if (!dirtyRef.current) return;
    }
    if (!dirtyRef.current) return;

    const capturedRevision = revisionRef.current;
    const elements = elementsRef.current.present;
    setStatus("saving");
    setError("");

    const savePromise = saveEditorialPageElements({
      context,
      elements,
      persistedIds: persistedIdsRef.current,
      user,
    });
    savingPromiseRef.current = savePromise;

    try {
      persistedIdsRef.current = await savePromise;
      if (revisionRef.current === capturedRevision) {
        dirtyRef.current = false;
        window.localStorage.removeItem(getDraftKey(context));
        setStatus("saved");
      } else {
        setStatus("idle");
      }
    } catch (saveError) {
      setStatus("error");
      setError(saveError.message || "No fue posible guardar los elementos.");
      throw saveError;
    } finally {
      savingPromiseRef.current = null;
    }
  }, [context, elementsRef, user]);

  useEffect(() => {
    dirtyRef.current = false;
    revisionRef.current = 0;
    persistedIdsRef.current = new Set();

    return subscribeEditorialPageElements(
      context,
      (remoteElements) => {
        persistedIdsRef.current = new Set(remoteElements.map((element) => element.id));
        if (dirtyRef.current) return;

        const draft = readDraft(context);
        if (draft) {
          onLoadRef.current(draft);
          markDirty(draft);
          return;
        }

        onLoadRef.current(remoteElements);
        setStatus("saved");
        setError("");
      },
      (loadError) => {
        setStatus("error");
        setError(loadError.message || "No fue posible cargar los elementos.");
      }
    );
  }, [context, markDirty]);

  useEffect(() => {
    if (!dirtyRef.current || revision === 0) return undefined;
    const timeoutId = window.setTimeout(() => {
      flush().catch(() => {});
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [revision, flush]);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const reportExternalStatus = useCallback((nextStatus, nextError = "") => {
    setStatus(nextStatus);
    setError(nextError);
  }, []);

  return { status, error, markDirty, flush, reportExternalStatus };
}
