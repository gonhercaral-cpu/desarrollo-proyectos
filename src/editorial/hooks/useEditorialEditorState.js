import { useCallback, useMemo, useRef, useState } from "react";
import {
  cloneElement,
  createImageElement,
  createShapeElement,
  createTextElement,
  createEditorialElementId,
  normalizeElementOrder,
  normalizeEditorialElement,
} from "../models/editorialElements";
import { uploadEditorialImage } from "../services/editorialElementsService";
import { useEditorialAutosave } from "./useEditorialAutosave";
import { useEditorialHistory } from "./useEditorialHistory";

export function useEditorialEditorState({ context, user }) {
  const resourceId = context.kind === "master" ? context.masterPageId : context.kind === "component" ? context.componentId : context.pageId;
  const history = useEditorialHistory(50, `${context.kind || "page"}.${context.documentId || "project"}.${resourceId}`);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const clipboardRef = useRef(null);

  const handleLoadElements = useCallback((elements) => {
    history.load(elements);
    setSelectedId("");
    setSelectedIds([]);
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

  const select = useCallback((elementId, options = {}) => {
    if (!elementId) {
      setSelectedId("");
      setSelectedIds([]);
      return;
    }
    setSelectedId(elementId);
    setSelectedIds((current) => options.additive ? [...new Set([...current, elementId])] : [elementId]);
  }, []);

  const addText = useCallback(() => {
    const element = createTextElement(history.elementsRef.current.present.length);
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
    setSelectedIds([element.id]);
  }, [commit, history.elementsRef]);

  const addShape = useCallback(() => {
    const element = createShapeElement(history.elementsRef.current.present.length);
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
    setSelectedIds([element.id]);
  }, [commit, history.elementsRef]);

  const addImageFile = useCallback(async (file) => {
    autosave.reportExternalStatus("saving");
    try {
      const asset = await uploadEditorialImage({ context, file, user });
      const element = createImageElement(history.elementsRef.current.present.length, asset);
      commit((elements) => [...elements, element]);
      setSelectedId(element.id);
      setSelectedIds([element.id]);
      return element;
    } catch (error) {
      autosave.reportExternalStatus("error", error.message || "No fue posible subir la imagen.");
      throw error;
    }
  }, [autosave, commit, context, history.elementsRef, user]);

  const replaceImage = useCallback(async (elementId, file) => {
    autosave.reportExternalStatus("saving");
    try {
      const asset = await uploadEditorialImage({ context, file, user });
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
  }, [autosave, commit, context, user]);

  const updateElement = useCallback((elementId, changes) => {
    commit((elements) => {
      const target = elements.find((element) => element.id === elementId);
      if (!target) return elements;
      const nextChanges = typeof changes === "function" ? changes(target) : changes;
      const deltaX = Object.hasOwn(nextChanges, "x") ? Number(nextChanges.x) - target.x : 0;
      const deltaY = Object.hasOwn(nextChanges, "y") ? Number(nextChanges.y) - target.y : 0;
      return elements.map((element) => {
      if (element.id !== elementId) {
        if (target.componentInstanceId && element.componentInstanceId === target.componentInstanceId && (deltaX || deltaY)) {
          return normalizeEditorialElement({ ...element, x: element.x + deltaX, y: element.y + deltaY }, element.zIndex);
        }
        return element;
      }
      const directChanges = { ...nextChanges };
      let componentOverrides = element.componentOverrides;
      let styleOverrides = element.styleOverrides;

      if (element.componentId && Object.hasOwn(directChanges, "content")) {
        componentOverrides = { ...(componentOverrides || {}), content: directChanges.content };
        delete directChanges.content;
      }
      if (Object.hasOwn(directChanges, "style")) {
        if (element.styleId) {
          styleOverrides = { ...(styleOverrides || {}), ...directChanges.style };
          delete directChanges.style;
        } else if (element.componentId) {
          componentOverrides = {
            ...(componentOverrides || {}),
            style: { ...(componentOverrides?.style || {}), ...directChanges.style },
          };
          delete directChanges.style;
        }
      }
      return normalizeEditorialElement({
        ...element,
        ...directChanges,
        style: directChanges.style ? { ...element.style, ...directChanges.style } : element.style,
        ...(componentOverrides ? { componentOverrides } : {}),
        ...(styleOverrides ? { styleOverrides } : {}),
      }, element.zIndex);
      });
    });
  }, [commit]);

  const addElements = useCallback((sourceElements, options = {}) => {
    const existing = history.elementsRef.current.present;
    const instanceId = options.componentId ? createEditorialElementId() : "";
    const created = sourceElements.map((source, index) => {
      const next = {
      ...source,
      id: createEditorialElementId(),
      name: source.name || `Elemento ${index + 1}`,
      x: Number(source.x || 0) + Number(options.offsetX ?? 24),
      y: Number(source.y || 0) + Number(options.offsetY ?? 24),
      zIndex: existing.length + index,
      ...(options.componentId ? {
        componentId: options.componentId,
        componentInstanceId: instanceId,
        componentElementId: source.id,
        componentOverrides: {},
        componentBase: {
          x: Number(source.x || 0), y: Number(source.y || 0), width: Number(source.width || 1), height: Number(source.height || 1),
          rotation: Number(source.rotation || 0), opacity: Number(source.opacity ?? 1),
        },
      } : {}),
      };
      delete next.createdAt;
      delete next.updatedAt;
      delete next.updatedByUid;
      delete next._linkedStyle;
      delete next._componentMaster;
      delete next.resolvedContent;
      return normalizeEditorialElement(next, existing.length + index);
    });
    commit((elements) => [...elements, ...created]);
    setSelectedId(created[0]?.id || "");
    setSelectedIds(created.map((element) => element.id));
    return created;
  }, [commit, history.elementsRef]);

  const insertComponent = useCallback((component) => (
    addElements(component?.elements || [], { componentId: component?.id })
  ), [addElements]);

  const detachComponentInstance = useCallback((instanceId, resolvedById = new Map()) => {
    commit((elements) => elements.map((element) => {
      if (element.componentInstanceId !== instanceId) return element;
      const resolved = resolvedById.get(element.id) || element;
      const next = { ...resolved, id: element.id };
      delete next.componentId;
      delete next.componentInstanceId;
      delete next.componentElementId;
      delete next.componentOverrides;
      delete next.componentBase;
      delete next.resolvedContent;
      return normalizeEditorialElement(next, element.zIndex);
    }));
  }, [commit]);

  const applyStyle = useCallback((elementId, designStyle) => {
    updateElement(elementId, {
      styleId: designStyle.id,
      styleOverrides: {},
    });
  }, [updateElement]);

  const restoreStyle = useCallback((elementId) => {
    updateElement(elementId, { styleOverrides: {} });
  }, [updateElement]);

  const unlinkStyle = useCallback((elementId, resolvedStyle) => {
    commit((elements) => elements.map((element) => {
      if (element.id !== elementId) return element;
      const next = { ...element, style: { ...(resolvedStyle || element.style) } };
      delete next.styleId;
      delete next.styleOverrides;
      return normalizeEditorialElement(next, element.zIndex);
    }));
  }, [commit]);

  const removeElement = useCallback((elementId) => {
    if (!elementId) return;
    commit((elements) => elements.filter((element) => element.id !== elementId));
    setSelectedId((current) => current === elementId ? "" : current);
    setSelectedIds((current) => current.filter((id) => id !== elementId));
  }, [commit]);

  const remove = useCallback(() => {
    if (!selectedIds.length) return;
    commit((elements) => elements.filter((element) => !selectedIds.includes(element.id)));
    setSelectedId("");
    setSelectedIds([]);
  }, [commit, selectedIds]);

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
    setSelectedIds([element.id]);
  }, [commit, history.elementsRef]);

  const duplicate = useCallback(() => {
    const element = history.elementsRef.current.present.find((item) => item.id === selectedId);
    if (!element) return;
    const duplicateElement = cloneElement(element, history.elementsRef.current.present.length);
    commit((elements) => [...elements, duplicateElement]);
    setSelectedId(duplicateElement.id);
    setSelectedIds([duplicateElement.id]);
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
  const selectedElements = useMemo(
    () => history.elements.filter((element) => selectedIds.includes(element.id)),
    [history.elements, selectedIds]
  );

  const actions = useMemo(() => ({
    addText,
    addShape,
    addImageFile,
    replaceImage,
    addElements,
    insertComponent,
    detachComponentInstance,
    applyStyle,
    restoreStyle,
    unlinkStyle,
    updateElement,
    removeElement,
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
    addElements,
    addShape,
    addText,
    applyStyle,
    copy,
    detachComponentInstance,
    duplicate,
    insertComponent,
    nudge,
    paste,
    redo,
    remove,
    removeElement,
    reorderLayer,
    replaceImage,
    restoreStyle,
    select,
    selectedElement,
    undo,
    unlinkStyle,
    updateElement,
  ]);

  return {
    elements: history.elements,
    selectedId,
    selectedIds,
    selectedElement,
    selectedElements,
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
