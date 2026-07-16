export function cleanVisualText(value = "") {
  return String(value || "").trim();
}

export function normalizeColor(value, fallback = "#0f4fc4") {
  const color = cleanVisualText(value);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

export function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function normalizeVisualElement(element = {}, index = 0) {
  const type = element.type === "image" ? "image" : "text";
  const baseElement = {
    id: cleanVisualText(element.id) || `${type}-${Date.now()}-${index}`,
    type,
    x: clampNumber(element.x, 0, 100, 10),
    y: clampNumber(element.y, 0, 100, 10),
    width: clampNumber(element.width, 5, 100, type === "image" ? 30 : 50),
    locked: element.locked === true,
    rotation: clampNumber(element.rotation, -180, 180, 0),
    zIndex: clampNumber(element.zIndex, 0, 999, index + 1),
  };

  if (element.height !== undefined) {
    baseElement.height = clampNumber(element.height, 5, 100, 20);
  }

  if (type === "image") {
    return {
      ...baseElement,
      url: cleanVisualText(element.url),
      storagePath: cleanVisualText(element.storagePath),
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: clampNumber(element.borderRadius, 0, 100, 0),
    };
  }

  return {
    ...baseElement,
    text: cleanVisualText(element.text),
    fontSize: clampNumber(element.fontSize, 12, 160, 48),
    fontWeight: element.fontWeight === "bold" ? "bold" : "normal",
    color: normalizeColor(element.color, "#ffffff"),
    align: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

export function normalizeVisualAdData(data = {}) {
  const canvas = data?.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";
  const elements = Array.isArray(data?.elements)
    ? data.elements
        .map(normalizeVisualElement)
        .filter((element) => element.type === "image" ? Boolean(element.url) : Boolean(element.text))
    : [];

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: cleanVisualText(canvas.backgroundUrl),
      backgroundStoragePath: cleanVisualText(canvas.backgroundStoragePath),
      backgroundColor: normalizeColor(canvas.backgroundColor, "#0f4fc4"),
    },
    elements,
  };
}

export function isValidVisualAdData(visualAdData) {
  const canvas = visualAdData?.canvas || {};
  const hasBackground =
    canvas.backgroundType === "solid" ||
    (canvas.backgroundType === "image" && Boolean(canvas.backgroundUrl));
  const hasElements = Array.isArray(visualAdData?.elements) && visualAdData.elements.length > 0;
  return hasBackground || hasElements;
}

export function getVisualElementStyle(element) {
  const baseStyle = {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, element.type === "image" ? 30 : 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };

  if (element.type === "image") {
    return {
      ...baseStyle,
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
    };
  }

  const fontSize = clampNumber(element.fontSize, 12, 160, 48);

  return {
    ...baseStyle,
    color: element.color || "#ffffff",
    fontSize: `clamp(7px, ${fontSize / 18}cqw, ${fontSize}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

export function compareVisualAdElements(first, second) {
  return (Number(first.zIndex) || 0) - (Number(second.zIndex) || 0);
}
