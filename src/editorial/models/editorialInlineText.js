import { estimateTextHeight, normalizeTextStyle, textContentBox } from "./editorialTypography.js";

export function resolveInlineTextCommand(event = {}) {
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) return "commit";
  return "input";
}

export function resolveInlineTextGeometry({ rect, element, zoom = 1, value = "" }) {
  if (!rect) return null;
  const style = normalizeTextStyle(element?.style);
  const box = textContentBox({ ...element, style });
  const contentHeight = estimateTextHeight({ text: value, width: box.width, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing }) * zoom;
  const availableHeight = box.height * zoom;
  const verticalOffset = style.boxMode === "fixed_box" && style.verticalAlign !== "top"
    ? Math.max(0, availableHeight - contentHeight) * (style.verticalAlign === "middle" ? 0.5 : 1)
    : 0;
  const radians = Number(element?.rotation || 0) * Math.PI / 180;
  const insetX = box.x * zoom; const insetY = box.y * zoom + verticalOffset;
  return {
    left: rect.left + insetX * Math.cos(radians) - insetY * Math.sin(radians),
    top: rect.top + insetX * Math.sin(radians) + insetY * Math.cos(radians),
    width: box.width * zoom,
    height: style.boxMode === "fixed_box" ? Math.max(24, availableHeight - verticalOffset) : Math.max(24, contentHeight),
  };
}
