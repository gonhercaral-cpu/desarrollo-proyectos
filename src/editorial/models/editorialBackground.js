// Fase 8 — Imagen de fondo de página / maestra. NO duplica el asset: guarda una
// referencia (assetId/url/storagePath). Se renderiza detrás de maestras y
// elementos, respeta sangrado y aparece en exportación.

export const BACKGROUND_FITS = ["cover", "contain", "stretch", "tile"];
export const BACKGROUND_TYPES = ["none", "color", "image"];

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value ?? 1)));
}

// Construye la referencia de fondo desde un asset existente (sin duplicar).
export function buildBackgroundFromAsset(asset = {}, overrides = {}) {
  return normalizeBackgroundImage({
    assetId: asset.id || asset.assetId || "",
    url: asset.url || asset.assetUrl || "",
    storagePath: asset.storagePath || "",
    ...overrides,
  });
}

export function normalizeBackgroundImage(background) {
  if (!background || !(background.url || background.storagePath || background.assetId)) return null;
  return {
    assetId: String(background.assetId || ""),
    url: String(background.url || ""),
    storagePath: String(background.storagePath || ""),
    fit: BACKGROUND_FITS.includes(background.fit) ? background.fit : "cover",
    positionX: Number(background.positionX || 0),
    positionY: Number(background.positionY || 0),
    scale: Math.max(0.01, Number(background.scale || 1) || 1),
    rotation: Number(background.rotation || 0),
    opacity: clamp01(background.opacity ?? 1),
    locked: background.locked !== false, // por defecto bloqueado: no se selecciona por accidente
  };
}

export function normalizeEditorialBackground(value, legacyImage = null) {
  const source = value && typeof value === "object" && BACKGROUND_TYPES.includes(value.type)
    ? value
    : null;
  const image = normalizeBackgroundImage(source?.image || legacyImage);
  const legacyColor = typeof value === "string" ? value : "#ffffff";
  const type = source?.type || (image ? "image" : legacyColor === "transparent" || legacyColor === "none" ? "none" : "color");
  return {
    type,
    color: String(source?.color || (legacyColor === "none" ? "transparent" : legacyColor) || "#ffffff"),
    opacity: clamp01(source?.opacity ?? 1),
    image,
  };
}

export function backgroundPersistenceFields(background) {
  const normalized = normalizeEditorialBackground(background);
  return {
    background: normalized,
    backgroundImage: normalized.type === "image" ? normalized.image : null,
  };
}

export function backgroundCssColor(background) {
  const normalized = normalizeEditorialBackground(background);
  return normalized.type === "none" ? "transparent" : normalized.color;
}

export function getBackgroundTileOrigins(layout, box) {
  const width = Math.max(0.01, Number(layout?.width) || 1);
  const height = Math.max(0.01, Number(layout?.height) || 1);
  const boxWidth = Math.max(1, Number(box?.width) || 1);
  const boxHeight = Math.max(1, Number(box?.height) || 1);
  const startX = ((Number(layout?.x || 0) % width) + width) % width - width;
  const startY = ((Number(layout?.y || 0) % height) + height) % height - height;
  const points = [];
  for (let y = startY; y < boxHeight; y += height) {
    for (let x = startX; x < boxWidth; x += width) points.push({ x, y });
  }
  return points;
}

export function hasBackgroundImage(surface) {
  return Boolean(normalizeBackgroundImage(surface?.backgroundImage));
}

// Geometría de dibujo del fondo dentro de una caja (px), según fit. Devuelve
// { mode, tiles?, x, y, width, height } para render Konva/PDF. `natural` = tamaño
// intrínseco de la imagen.
export function computeBackgroundLayout({ background, box, natural }) {
  const fit = background?.fit || "cover";
  const boxW = Math.max(1, Number(box?.width) || 1);
  const boxH = Math.max(1, Number(box?.height) || 1);
  const imgW = Math.max(1, Number(natural?.width) || boxW);
  const imgH = Math.max(1, Number(natural?.height) || boxH);
  const scale = Number(background?.scale || 1) || 1;
  const offsetX = Number(background?.positionX || 0);
  const offsetY = Number(background?.positionY || 0);

  if (fit === "stretch") {
    return { mode: "stretch", x: offsetX, y: offsetY, width: boxW * scale, height: boxH * scale };
  }
  if (fit === "tile") {
    return { mode: "tile", x: offsetX, y: offsetY, width: imgW * scale, height: imgH * scale, boxW, boxH };
  }
  const ratio = fit === "contain"
    ? Math.min(boxW / imgW, boxH / imgH)
    : Math.max(boxW / imgW, boxH / imgH);
  const width = imgW * ratio * scale;
  const height = imgH * ratio * scale;
  return {
    mode: fit,
    x: (boxW - width) / 2 + offsetX,
    y: (boxH - height) / 2 + offsetY,
    width,
    height,
  };
}
