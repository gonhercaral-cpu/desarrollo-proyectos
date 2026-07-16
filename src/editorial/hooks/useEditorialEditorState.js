import { useCallback, useMemo, useRef, useState } from "react";
import {
  cloneElement,
  createImageElement,
  createShapeElement,
  createTextElement,
  normalizeElementOrder,
  normalizeEditorialElement,
} from "../models/editorialElements";
import { uploadEditorialImage } from "../services/editorialElementsService";
import { useEditorialAutosave } from "./useEditorialAutosave";
import { useEditorialHistory } from "./useEditorialHistory";

export function useEditorialEditorState({ context, user }) {
  const history = useEditorialHistory(50);
  const [selectedId, setSelectedId] = useState("");
  const clipboardRef = useRef(null);

  const handleLoadElements = useCallback((elements) => {
    history.reset(elements);
    setSelectedId("");
  }, [history]);

  const autosave = useEditorialAutosave({
    context,
    user,
    elementsRef: history.elementsRef,
    onLoadElements: handleLoadElements,
  });

  const commit = useCallback((updater) => {
    const before = history.elementsRef.current.present;
    const next = history.commit((elements) => normalizeElementOrder(updater(elements)));
    if (next !== before) autosave.markDirty(next);
    return next;
  }, [autosave, history]);

  const select = useCallback((elementId) => setSelectedId(elementId || ""), []);

  const addText = useCallback(() => {
    const element = createTextElement(history.elementsRef.current.present.length);
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
  }, [commit, history.elementsRef]);

  const addShape = useCallback(() => {
    const element = createShapeElement(history.elementsRef.current.present.length);
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
  }, [commit, history.elementsRef]);

  const addImageFile = useCallback(async (file) => {
    autosave.reportExternalStatus("saving");
    try {
      const asset = await uploadEditorialImage({ projectId: context.projectId, file, user });
      const element = createImageElement(history.elementsRef.current.present.length, asset);
      commit((elements) => [...elements, element]);
      setSelectedId(element.id);
      return element;
    } catch (error) {
      autosave.reportExternalStatus("error", error.message || "No fue posible subir la imagen.");
      throw error;
    }
  }, [autosave, commit, context.projectId, history.elementsRef, user]);

  const replaceImage = useCallback(async (elementId, file) => {
    autosave.reportExternalStatus("saving");
    try {
      const asset = await uploadEditorialImage({ projectId: context.projectId, file, user });
      commit((elements) => elements.map((element) => element.id === elementId ? {
        ...element,
        name: asset.name,
        assetId: asset.id,
        assetUrl: asset.url,
        storagePath: asset.storagePath,
        naturalWidth: asset.width,
        naturalHeight: asset.height,
      } : element));
    } catch (error) {
      autosave.reportExternalStatus("error", error.message || "No fue posible reemplazar la imagen.");
      throw error;
    }
  }, [autosave, commit, context.projectId, user]);

  const updateElement = useCallback((elementId, changes) => {
    commit((elements) => elements.map((element) => {
      if (element.id !== elementId) return element;
      const nextChanges = typeof changes === "function" ? changes(element) : changes;
      return normalizeEditorialElement({
        ...element,
        ...nextChanges,
        style: nextChanges.style ? { ...element.style, ...nextChanges.style } : element.style,
      }, element.zIndex);
    }));
  }, [commit]);

  const remove = useCallback(() => {
    if (!selectedId) return;
    commit((elements) => elements.filter((element) => element.id !== selectedId));
    setSelectedId("");
  }, [commit, selectedId]);

  const copy = useCallback(() => {
    const element = history.elementsRef.current.present.find((item) => item.id === selectedId);
    clipboardRef.current = element ? JSON.parse(JSON.stringify(element)) : null;
  }, [history.elementsRef, selectedId]);

  const paste = useCallback(() => {
    if (!clipboardRef.current) return;
    const element = cloneElement(
      clipboardRef.current,
      history.elementsRef.current.present.length
    );
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
  }, [commit, history.elementsRef]);

  const duplicate = useCallback(() => {
    const element = history.elementsRef.current.present.find((item) => item.id === selectedId);
    if (!element) return;
    const duplicateElement = cloneElement(element, history.elementsRef.current.present.length);
    commit((elements) => [...elements, duplicateElement]);
    setSelectedId(duplicateElement.id);
  }, [commit, history.elementsRef, selectedId]);

  const reorderLayer = useCallback((elementId, direction) => {
    commit((elements) => {
      const ordered = normalizeElementOrder(elements);
      const currentIndex = ordered.findIndex((element) => element.id === elementId);
      const targetIndex = direction === "front"
        ? ordered.length - 1
        : direction === "back"
          ? 0
          : direction === "up"
            ? Math.min(ordered.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
      if (currentIndex < 0 || currentIndex === targetIndex) return ordered;
      const next = [...ordered];
      const [element] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, element);
      return next.map((item, index) => ({ ...item, zIndex: index }));
    });
  }, [commit]);

  const nudge = useCallback((key, increment) => {
    const selected = history.elementsRef.current.present.find((element) => element.id === selectedId);
    if (!selected || selected.locked) return;
    const delta = {
      ArrowUp: { x: 0, y: -increment },
      ArrowDown: { x: 0, y: increment },
      ArrowLeft: { x: -increment, y: 0 },
      ArrowRight: { x: increment, y: 0 },
    }[key];
    updateElement(selectedId, { x: selected.x + delta.x, y: selected.y + delta.y });
  }, [history.elementsRef, selectedId, updateElement]);

  const undo = useCallback(() => {
    const elements = history.undo();
    if (elements) autosave.markDirty(elements);
  }, [autosave, history]);

  const redo = useCallback(() => {
    const elements = history.redo();
    if (elements) autosave.markDirty(elements);
  }, [autosave, history]);

  const selectedElement = useMemo(
    () => history.elements.find((element) => element.id === selectedId) || null,
    [history.elements, selectedId]
  );

  const actions = useMemo(() => ({
    addText,
    addShape,
    addImageFile,
    replaceImage,
    updateElement,
    remove,
    copy,
    paste,
    duplicate,
    reorderLayer,
    nudge,
    undo,
    redo,
    deselect: () => select(""),
    hasSelection: Boolean(selectedElement),
  }), [
    addImageFile,
    addShape,
    addText,
    copy,
    duplicate,
    nudge,
    paste,
    redo,
    remove,
    reorderLayer,
    replaceImage,
    select,
    selectedElement,
    undo,
    updateElement,
  ]);

  return {
    elements: history.elements,
    selectedId,
    selectedElement,
    select,
    actions,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    saveStatus: autosave.status,
    saveError: autosave.error,
    flush: autosave.flush,
    reportStatus: autosave.reportExternalStatus,
  };
}
