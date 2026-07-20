import { createEditorialElementId, normalizeEditorialElement } from "./editorialElements.js";

export const MASTER_SIDES = ["any", "left", "right"];
export const TEMPLATE_TYPES = ["page", "unit", "section", "document"];
export const DESIGN_STYLE_TYPES = ["text", "shape", "image"];

export function createDesignId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeMasterPage(master = {}, index = 0, project = {}) {
  return {
    ...master,
    id: master.id || "",
    name: String(master.name || `Maestra ${index + 1}`),
    side: MASTER_SIDES.includes(master.side) ? master.side : "any",
    width: Number(master.width || project.widthIn || 8),
    height: Number(master.height || project.heightIn || 10),
    background: master.background ?? "#ffffff",
    order: Number(master.order ?? index),
  };
}

export function normalizeDesignComponent(component = {}, index = 0) {
  return {
    ...component,
    id: component.id || "",
    name: String(component.name || `Componente ${index + 1}`),
    category: String(component.category || "General"),
    description: String(component.description || ""),
    order: Number(component.order ?? index),
    usageCount: Number(component.usageCount || 0),
  };
}

export function normalizeDesignStyle(style = {}, index = 0) {
  return {
    ...style,
    id: style.id || "",
    name: String(style.name || `Estilo ${index + 1}`),
    type: DESIGN_STYLE_TYPES.includes(style.type) ? style.type : "text",
    category: String(style.category || "General"),
    properties: { ...(style.properties || {}) },
    order: Number(style.order ?? index),
  };
}

export function normalizeEditorialTemplate(template = {}, index = 0) {
  return {
    ...template,
    id: template.id || "",
    name: String(template.name || `Plantilla ${index + 1}`),
    description: String(template.description || ""),
    category: String(template.category || "General"),
    type: TEMPLATE_TYPES.includes(template.type) ? template.type : "page",
    visibility: template.visibility === "institutional" ? "institutional" : "project",
    thumbnail: template.thumbnail || null,
  };
}

export function cloneDesignElements(elements, { offsetX = 0, offsetY = 0, stripLinks = true, preserveStyleLinks = false } = {}) {
  return elements.map((element, index) => {
    const clone = {
      ...element,
      id: createEditorialElementId(),
      x: Number(element.x || 0) + offsetX,
      y: Number(element.y || 0) + offsetY,
      zIndex: index,
      style: { ...(element.style || {}) },
    };
    if (stripLinks) {
      delete clone.componentId;
      delete clone.componentInstanceId;
      delete clone.componentElementId;
      delete clone.componentOverrides;
      delete clone.componentBase;
      if (!preserveStyleLinks) {
        delete clone.styleId;
        delete clone.styleOverrides;
      }
      delete clone._inheritance;
      delete clone.resolvedContent;
    }
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.updatedByUid;
    delete clone._linkedStyle;
    delete clone._componentMaster;
    delete clone._missingComponent;
    return normalizeEditorialElement(clone, index);
  });
}
