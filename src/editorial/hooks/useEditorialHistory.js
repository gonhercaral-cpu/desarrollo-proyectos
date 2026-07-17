import { useCallback, useEffect, useRef, useState } from "react";

function sameElements(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createEmptyHistory() {
  return { loaded: false, past: [], present: [], future: [] };
}

export function useEditorialHistory(limit = 50, historyKey = "default") {
  const [history, setHistory] = useState(createEmptyHistory);
  const historyRef = useRef(history);
  const historiesRef = useRef(new Map());
  const activeKeyRef = useRef(historyKey);

  const applyHistory = useCallback((nextHistory) => {
    historyRef.current = nextHistory;
    historiesRef.current.set(activeKeyRef.current, nextHistory);
    setHistory(nextHistory);
  }, []);

  useEffect(() => {
    activeKeyRef.current = historyKey;
    const nextHistory = historiesRef.current.get(historyKey) || createEmptyHistory();
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }, [historyKey]);

  const load = useCallback((elements) => {
    const current = historiesRef.current.get(activeKeyRef.current);
    if (!current?.loaded) {
      applyHistory({ loaded: true, past: [], present: elements, future: [] });
      return;
    }
    if (sameElements(current.present, elements)) {
      applyHistory(current);
      return;
    }
    applyHistory({
      loaded: true,
      past: [...current.past, current.present].slice(-limit),
      present: elements,
      future: [],
    });
  }, [applyHistory, limit]);

  const commit = useCallback((updater) => {
    const current = historyRef.current;
    const nextElements = typeof updater === "function" ? updater(current.present) : updater;
    if (sameElements(current.present, nextElements)) return current.present;

    applyHistory({
      loaded: true,
      past: [...current.past, current.present].slice(-limit),
      present: nextElements,
      future: [],
    });
    return nextElements;
  }, [applyHistory, limit]);

  const undo = useCallback(() => {
    const current = historyRef.current;
    if (current.past.length === 0) return null;
    const previous = current.past[current.past.length - 1];
    applyHistory({
      loaded: true,
      past: current.past.slice(0, -1),
      present: previous,
      future: [current.present, ...current.future].slice(0, limit),
    });
    return previous;
  }, [applyHistory, limit]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    if (current.future.length === 0) return null;
    const next = current.future[0];
    applyHistory({
      loaded: true,
      past: [...current.past, current.present].slice(-limit),
      present: next,
      future: current.future.slice(1),
    });
    return next;
  }, [applyHistory, limit]);

  return {
    elements: history.present,
    elementsRef: historyRef,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    load,
    commit,
    undo,
    redo,
  };
}
