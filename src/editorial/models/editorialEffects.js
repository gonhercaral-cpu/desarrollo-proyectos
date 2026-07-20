// Fase 8 — Efectos de elemento (sombra) y efectos de texto (sombra + resaltado).
// Sin filtros destructivos (no blur de imagen, no corrección de color). Puro.

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value ?? 1)));
}

// Sombra genérica para figuras/imágenes/texto.
export function normalizeShadow(shadow) {
  if (!shadow || !shadow.enabled) return { enabled: false };
  return {
    enabled: true,
    color: shadow.color || "#0f172a",
    blur: Math.max(0, Number(shadow.blur ?? 8)),
    offsetX: Number(shadow.offsetX ?? 3),
    offsetY: Number(shadow.offsetY ?? 4),
    opacity: clamp01(shadow.opacity ?? 0.35),
  };
}

// Props de sombra para un nodo Konva (o {} si deshabilitada).
export function konvaShadowProps(shadow) {
  const normalized = normalizeShadow(shadow);
  if (!normalized.enabled) return {};
  return {
    shadowEnabled: true,
    shadowColor: normalized.color,
    shadowBlur: normalized.blur,
    shadowOffsetX: normalized.offsetX,
    shadowOffsetY: normalized.offsetY,
    shadowOpacity: normalized.opacity,
  };
}

// Sombra de texto (mismo esquema; se aplica al nodo Text).
export function normalizeTextShadow(shadow) {
  return normalizeShadow(shadow);
}

// Borde de imagen opcional.
export function normalizeImageBorder(border) {
  if (!border) return { enabled: false, color: "#1f2937", width: 0, radius: 0 };
  return {
    enabled: Boolean(border.enabled),
    color: border.color || "#1f2937",
    width: Math.max(0, Number(border.width ?? 1)),
    radius: Math.max(0, Number(border.radius ?? 0)),
  };
}
