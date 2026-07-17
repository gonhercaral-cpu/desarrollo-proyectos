import { createEditorialElementId, normalizeEditorialElement } from "../models/editorialElements.js";
import { resolveEditorialVariables } from "./editorialVariables.js";

function mergeOverride(base, override = {}) {
  return {
    ...base,
    ...(Object.hasOwn(override, "content") ? { content: override.content } : {}),
    style: { ...(base.style || {}), ...(override.style || {}) },
  };
}

export function resolveStyledElement(element, stylesById = new Map()) {
  const globalStyle = element.styleId ? stylesById.get(element.styleId) : null;
  if (!globalStyle) return { ...element, style: { ...(element.style || {}) } };
  const properties = globalStyle.properties || {};
  const overrides = element.styleOverrides || {};
  return {
    ...element,
    opacity: Number(overrides.opacity ?? properties.opacity ?? element.opacity ?? 1),
    style: { ...properties, ...overrides },
    _linkedStyle: globalStyle,
  };
}

export function resolveComponentElement(instance, componentsById = new Map()) {
  if (!instance.componentId || !instance.componentElementId) return instance;
  const component = componentsById.get(instance.componentId);
  const masterElement = component?.elements?.find((element) => element.id === instance.componentElementId);
  if (!masterElement) return { ...instance, _missingComponent: true };
  const overridden = mergeOverride(masterElement, instance.componentOverrides);
  const base = instance.componentBase;
  const inheritedGeometry = base ? {
    x: Number(masterElement.x || 0) + (Number(instance.x || 0) - Number(base.x || 0)),
    y: Number(masterElement.y || 0) + (Number(instance.y || 0) - Number(base.y || 0)),
    width: Number(masterElement.width || 1) * (Number(instance.width || 1) / Math.max(1, Number(base.width || 1))),
    height: Number(masterElement.height || 1) * (Number(instance.height || 1) / Math.max(1, Number(base.height || 1))),
    rotation: Number(masterElement.rotation || 0) + (Number(instance.rotation || 0) - Number(base.rotation || 0)),
    opacity: Number(masterElement.opacity ?? 1) * (Number(instance.opacity ?? 1) / Math.max(0.01, Number(base.opacity ?? 1))),
  } : {};
  return {
    ...overridden,
    ...instance,
    ...inheritedGeometry,
    content: overridden.content,
    style: overridden.style,
    type: masterElement.type,
    name: masterElement.name,
    visibilityMode: instance.componentOverrides?.visibilityMode || masterElement.visibilityMode || "both",
    answerData: Object.hasOwn(instance.componentOverrides || {}, "answerData") ? instance.componentOverrides.answerData : masterElement.answerData,
    studentContent: instance.componentOverrides?.studentContent ?? masterElement.studentContent,
    teacherContent: instance.componentOverrides?.teacherContent ?? masterElement.teacherContent,
    exerciseData: masterElement.exerciseData,
    academicBlockType: masterElement.academicBlockType || instance.academicBlockType,
    ...(masterElement.type === "image" ? {
      assetId: masterElement.assetId || "",
      assetUrl: masterElement.assetUrl || "",
      storagePath: masterElement.storagePath || "",
      naturalWidth: masterElement.naturalWidth,
      naturalHeight: masterElement.naturalHeight,
    } : {}),
    _componentMaster: masterElement,
  };
}

export function resolveLocalElements(elements, { stylesById, componentsById, variables } = {}) {
  return elements.map((element, index) => {
    const componentResolved = resolveComponentElement(element, componentsById);
    const styleResolved = resolveStyledElement(componentResolved, stylesById);
    return normalizeEditorialElement({
      ...styleResolved,
      resolvedContent: styleResolved.type === "text"
        ? resolveEditorialVariables(styleResolved.content, variables)
        : styleResolved.content,
    }, index);
  });
}

export function resolveMasterElements(masterElements, masterOverrides = {}, options = {}) {
  return masterElements.flatMap((element, index) => {
    const override = masterOverrides[element.id] || {};
    if (override.hidden || override.detachedElementId) return [];
    const inherited = mergeOverride(element, override);
    const styled = resolveStyledElement(inherited, options.stylesById);
    const resolved = { ...styled, style: { ...(styled.style || {}), ...(override.style || {}) } };
    return [normalizeEditorialElement({
      ...resolved,
      id: `master-${element.id}`,
      sourceElementId: element.id,
      locked: true,
      resolvedContent: resolved.type === "text"
        ? resolveEditorialVariables(resolved.content, options.variables)
        : resolved.content,
      _inheritance: "master",
    }, index)];
  });
}

export function detachMasterElement(masterElement, override = {}, zIndex = 0) {
  const merged = mergeOverride(masterElement, override);
  return normalizeEditorialElement({
    ...merged,
    id: createEditorialElementId(),
    name: `${masterElement.name || "Elemento"} desvinculado`,
    locked: false,
    zIndex,
  }, zIndex);
}

export function createMasterOverride(current = {}, changes = {}) {
  const next = { ...current };
  if (Object.hasOwn(changes, "hidden")) next.hidden = Boolean(changes.hidden);
  if (Object.hasOwn(changes, "content")) next.content = changes.content;
  if (changes.style) next.style = { ...(next.style || {}), ...changes.style };
  if (Object.hasOwn(changes, "detachedElementId")) next.detachedElementId = changes.detachedElementId;
  return next;
}
