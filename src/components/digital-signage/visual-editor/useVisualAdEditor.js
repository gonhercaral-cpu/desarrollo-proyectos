import { useRef, useState } from "react";
import { clampDecimal, clampNumber } from "../../../utils/digitalSignage";

export const MIN_VISUAL_AD_ZOOM = 0.5;
export const MAX_VISUAL_AD_ZOOM = 2;

const DEFAULT_VISUAL_AD_ELEMENT = {
  id: "text-1",
  type: "text",
  text: "Nuevo texto",
  x: 10,
  y: 12,
  width: 60,
  fontSize: 46,
  fontWeight: "bold",
  color: "#ffffff",
  align: "left",
};

const DEFAULT_VISUAL_AD_FORM = {
  title: "",
  plantel: "",
  durationSeconds: 12,
  active: true,
  publishStatus: "draft",
  visualAdData: {
    canvas: {
      aspectRatio: "16:9",
      backgroundType: "solid",
      backgroundColor: "#0f4fc4",
      backgroundUrl: "",
      backgroundStoragePath: "",
    },
    elements: [DEFAULT_VISUAL_AD_ELEMENT],
  },
};

export default function useVisualAdEditor({
  form: inputForm,
  saving,
  dirty,
  draftStatus,
  backgroundPreview,
  selectedElementId,
  visualTemplates,
  zoom,
}) {
  const previewRef = useRef(null);
  const [controlTab, setControlTab] = useState("general");
  const form = normalizeVisualAdEditorForm(inputForm);
  const visualTemplatesList = Array.isArray(visualTemplates) ? visualTemplates : [];
  const selectedElement = getSelectedVisualElement(form, selectedElementId);
  const visualAdData = getVisualAdDataForSave(form.visualAdData, backgroundPreview);
  const safeZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;

  function openFullscreenPreview() {
    previewRef.current?.requestFullscreen?.();
  }

  return {
    previewRef,
    controlTab,
    setControlTab,
    form,
    visualTemplatesList,
    selectedElement,
    visualAdData,
    zoom: safeZoom,
    zoomPercent: Math.round(safeZoom * 100),
    canZoomOut: safeZoom > MIN_VISUAL_AD_ZOOM,
    canZoomIn: safeZoom < MAX_VISUAL_AD_ZOOM,
    statusLabel: getVisualAdEditorStatusLabel(saving, dirty, draftStatus),
    openFullscreenPreview,
  };
}

export function getVisualAdEditorStatusLabel(saving, dirty, draftStatus) {
  if (saving) return "Guardando...";
  if (draftStatus === "saved") return "Borrador guardado";
  if (dirty) return "Cambios sin guardar";
  return "Guardado";
}

export function normalizeVisualAdEditorForm(form = {}) {
  const visualAdData = normalizeVisualAdDataForEditor(
    form.visualAdData || DEFAULT_VISUAL_AD_FORM.visualAdData
  );

  return {
    ...DEFAULT_VISUAL_AD_FORM,
    ...form,
    visualAdData,
  };
}

export function normalizeVisualAdDataForEditor(visualAdData = {}) {
  const canvas = visualAdData.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";
  const elements = Array.isArray(visualAdData.elements)
    ? visualAdData.elements.map(normalizeVisualAdElement)
    : [DEFAULT_VISUAL_AD_ELEMENT];

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: backgroundType === "image" ? canvas.backgroundUrl || "" : "",
      backgroundStoragePath: backgroundType === "image" ? canvas.backgroundStoragePath || "" : "",
      backgroundColor: /^#[0-9a-fA-F]{6}$/.test(canvas.backgroundColor || "")
        ? canvas.backgroundColor
        : "#0f4fc4",
    },
    elements,
  };
}

function normalizeVisualAdElement(element = {}) {
  const type = element.type === "image" ? "image" : "text";
  const baseElement = {
    id: element.id || `${type}-${Date.now()}`,
    type,
    x: clampNumber(element.x, 0, 100, 10),
    y: clampNumber(element.y, 0, 100, 10),
    width: clampNumber(element.width, 5, 100, type === "image" ? 30 : 50),
    locked: element.locked === true,
    rotation: clampNumber(element.rotation, -180, 180, 0),
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };

  if (element.height !== undefined) {
    baseElement.height = clampNumber(element.height, 5, 100, 20);
  }

  if (type === "image") {
    return {
      ...baseElement,
      url: String(element.url || ""),
      storagePath: String(element.storagePath || ""),
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: clampNumber(element.borderRadius, 0, 100, 0),
    };
  }

  return {
    ...baseElement,
    text: String(element.text || ""),
    fontSize: clampNumber(element.fontSize, 12, 160, 48),
    fontWeight: element.fontWeight === "bold" ? "bold" : "normal",
    color: /^#[0-9a-fA-F]{6}$/.test(element.color || "") ? element.color : "#ffffff",
    align: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

function getVisualAdDataForSave(visualAdData = {}, previewUrl = "") {
  const canvas = visualAdData.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: backgroundType === "image" ? previewUrl || canvas.backgroundUrl || "" : "",
      backgroundStoragePath: backgroundType === "image" ? canvas.backgroundStoragePath || "" : "",
      backgroundColor: /^#[0-9a-fA-F]{6}$/.test(canvas.backgroundColor || "")
        ? canvas.backgroundColor
        : "#0f4fc4",
    },
    elements: Array.isArray(visualAdData.elements)
      ? visualAdData.elements
          .map(normalizeVisualAdElement)
          .filter((element) => element.type === "image" ? Boolean(element.url) : element.text.trim())
      : [],
  };
}

function getSelectedVisualElement(form, selectedId) {
  return form.visualAdData.elements.find((element) => element.id === selectedId) || null;
}
