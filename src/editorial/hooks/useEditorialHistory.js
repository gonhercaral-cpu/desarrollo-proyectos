import { useCallback, useRef, useState } from "react";

function sameElements(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useEditorialHistory(limit = 50) {
  const [history, setHistory] = useState({ past: [], present: [], future: [] });
  const historyRef = useRef(history);

  const applyHistory = useCallback((nextHistory) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }, []);

  const reset = useCallback((elements) => {
    applyHistory({ past: [], present: elements, future: [] });
  }, [applyHistory]);

  const commit = useCallback((updater) => {
    const current = historyRef.current;
    const nextElements = typeof updater === "function" ? updater(current.present) : updater;
    if (sameElements(current.present, nextElements)) return current.present;

    applyHistory({
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
    reset,
    commit,
    undo,
    redo,
  };
}
