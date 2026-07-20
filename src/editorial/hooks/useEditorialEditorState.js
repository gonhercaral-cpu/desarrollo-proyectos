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

  const addShape = useCallback((shapeType = "rectangle") => {
    const element = createShapeElement(history.elementsRef.current.present.length, typeof shapeType === "string" ? shapeType : "rectangle");
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
    setSelectedIds([element.id]);
  }, [commit, history.elementsRef]);

  const uploadImageAsset = useCallback(async (file) => {
    autosave.reportExternalStatus("saving");
    try {
      return await uploadEditorialImage({ context, file, user });
    } catch (error) {
      autosave.reportExternalStatus("error", error.message || "No fue posible subir la imagen.");
      throw error;
    }
  }, [autosave, context, user]);

  const addImageFile = useCallback(async (file) => {
    const asset = await uploadImageAsset(file);
    const element = createImageElement(history.elementsRef.current.present.length, asset);
    commit((elements) => [...elements, element]);
    setSelectedId(element.id);
    setSelectedIds([element.id]);
    return element;
  }, [commit, history.elementsRef, uploadImageAsset]);

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
      const calculatedChanges = typeof changes === "function" ? changes(target) : changes;
      const nextChanges = { ...calculatedChanges };
      if (target.type === "shape" && ["square", "circle"].includes(target.shapeType)) {
        if (Object.hasOwn(nextChanges, "height") && !Object.hasOwn(nextChanges, "width")) nextChanges.width = nextChanges.height;
        if (Object.hasOwn(nextChanges, "width") && !Object.hasOwn(nextChanges, "height")) nextChanges.height = nextChanges.width;
      }
      const deltaX = Object.hasOwn(nextChanges, "x") ? Number(nextChanges.x) - target.x : 0;
      const deltaY = Object.hasOwn(nextChanges, "y") ? Number(nextChanges.y) - target.y : 0;
      return elements.map((element) => {
      if (element.id !== elementId) {
        if (target.componentInstanceId && element.componentInstanceId === target.componentInstanceId && (deltaX || deltaY)) {
          return normalizeEditorialElement({ ...element, x: element.x + deltaX, y: element.y + deltaY }, element.zIndex);
        }
        if (target.academicGroupId && element.academicGroupId === target.academicGroupId && (deltaX || deltaY)) {
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
      if (element.componentId && Object.hasOwn(directChanges, "visibilityMode")) {
        componentOverrides = { ...(componentOverrides || {}), visibilityMode: directChanges.visibilityMode };
        delete directChanges.visibilityMode;
      }
      if (element.componentId && Object.hasOwn(directChanges, "answerData")) {
        componentOverrides = { ...(componentOverrides || {}), answerData: directChanges.answerData };
        delete directChanges.answerData;
      }
      ["studentContent", "teacherContent"].forEach((field) => {
        if (!element.componentId || !Object.hasOwn(directChanges, field)) return;
        componentOverrides = { ...(componentOverrides || {}), [field]: directChanges[field] };
        delete directChanges[field];
      });
      ["shapeType", "points", "shadow", "imageBorder"].forEach((field) => {
        if (!element.componentId || !Object.hasOwn(directChanges, field)) return;
        componentOverrides = { ...(componentOverrides || {}), [field]: directChanges[field] };
        delete directChanges[field];
      });
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

  // Fase 8 — Cambio en vivo (arrastre de slider): actualiza sin empujar
  // historial. Cerrar con commitLive para producir UNA entrada al terminar.
  const updateElementLive = useCallback((elementId, changes) => {
    history.replacePresent((elements) => elements.map((element) => {
      if (element.id !== elementId) return element;
      return normalizeEditorialElement({
        ...element,
        ...changes,
        style: changes.style ? { ...element.style, ...changes.style } : element.style,
      }, element.zIndex);
    }));
    autosave.markDirty(history.elementsRef.current.present);
  }, [autosave, history]);

  const commitLive = useCallback(() => {
    history.commitTransient();
    autosave.markDirty(history.elementsRef.current.present);
  }, [autosave, history]);

  const addElements = useCallback((sourceElements, options = {}) => {
    const existing = history.elementsRef.current.present;
    const instanceId = options.componentId ? createEditorialElementId() : "";
    const academicGroupIds = new Map();
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
          visibilityMode: source.visibilityMode || "both",
        },
      } : {}),
      };
      if (options.componentId && source.academicGroupId) {
        if (!academicGroupIds.has(source.academicGroupId)) academicGroupIds.set(source.academicGroupId, createEditorialElementId());
        next.academicGroupId = academicGroupIds.get(source.academicGroupId);
      }
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

  const replaceAcademicGroup = useCallback((academicGroupId, sourceElements) => {
    if (!academicGroupId || !sourceElements?.length) return [];
    const existing = history.elementsRef.current.present;
    const removed = existing.filter((element) => element.academicGroupId === academicGroupId);
    const anchor = removed[0] || { x: 64, y: 64 };
    const sourceAnchor = sourceElements[0] || { x: 0, y: 0 };
    const nextGroupId = sourceElements[0]?.academicGroupId || academicGroupId;
    const created = sourceElements.map((source, index) => normalizeEditorialElement({
      ...source,
      id: createEditorialElementId(),
      academicGroupId: nextGroupId,
      x: Number(source.x || 0) + Number(anchor.x || 0) - Number(sourceAnchor.x || 0),
      y: Number(source.y || 0) + Number(anchor.y || 0) - Number(sourceAnchor.y || 0),
      zIndex: existing.length - removed.length + index,
    }, existing.length - removed.length + index));
    commit((elements) => [...elements.filter((element) => element.academicGroupId !== academicGroupId), ...created]);
    setSelectedId(created[0]?.id || "");
    setSelectedIds(created.map((element) => element.id));
    return created;
  }, [commit, history.elementsRef]);

  const updateAcademicGroup = useCallback((academicGroupId, changes) => {
    if (!academicGroupId) return;
    commit((elements) => elements.map((element) => {
      if (element.academicGroupId !== academicGroupId) return element;
      if (element.componentId && Object.hasOwn(changes, "visibilityMode")) {
        return normalizeEditorialElement({
          ...element,
          componentOverrides: { ...(element.componentOverrides || {}), visibilityMode: changes.visibilityMode },
        }, element.zIndex);
      }
      return normalizeEditorialElement({ ...element, ...changes }, element.zIndex);
    }));
  }, [commit]);

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
    const source = element?.academicGroupId
      ? history.elementsRef.current.present.filter((item) => item.academicGroupId === element.academicGroupId)
      : element ? [element] : [];
    clipboardRef.current = source.length ? JSON.parse(JSON.stringify(source)) : null;
  }, [history.elementsRef, selectedId]);

  const paste = useCallback(() => {
    if (!clipboardRef.current) return;
    const source = Array.isArray(clipboardRef.current) ? clipboardRef.current : [clipboardRef.current];
    const sourceGroupId = source[0]?.academicGroupId;
    const nextGroupId = sourceGroupId ? createEditorialElementId() : "";
    const created = source.map((item, index) => {
      const element = cloneElement(item, history.elementsRef.current.present.length + index);
      return sourceGroupId ? { ...element, academicGroupId: nextGroupId } : element;
    });
    commit((elements) => [...elements, ...created]);
    setSelectedId(created[0]?.id || "");
    setSelectedIds(created.map((element) => element.id));
  }, [commit, history.elementsRef]);

  const duplicate = useCallback(() => {
    const element = history.elementsRef.current.present.find((item) => item.id === selectedId);
    if (!element) return;
    const source = element.academicGroupId
      ? history.elementsRef.current.present.filter((item) => item.academicGroupId === element.academicGroupId)
      : [element];
    const nextGroupId = element.academicGroupId ? createEditorialElementId() : "";
    const duplicates = source.map((item, index) => {
      const duplicateElement = cloneElement(item, history.elementsRef.current.present.length + index);
      return nextGroupId ? { ...duplicateElement, academicGroupId: nextGroupId } : duplicateElement;
    });
    commit((elements) => [...elements, ...duplicates]);
    setSelectedId(duplicates[0].id);
    setSelectedIds(duplicates.map((item) => item.id));
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
    uploadImageAsset,
    replaceImage,
    addElements,
    insertComponent,
    replaceAcademicGroup,
    updateAcademicGroup,
    detachComponentInstance,
    applyStyle,
    restoreStyle,
    unlinkStyle,
    updateElement,
    updateElementLive,
    commitLive,
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
    replaceAcademicGroup,
    restoreStyle,
    select,
    selectedElement,
    undo,
    unlinkStyle,
    updateAcademicGroup,
    updateElement,
    updateElementLive,
    commitLive,
    uploadImageAsset,
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
