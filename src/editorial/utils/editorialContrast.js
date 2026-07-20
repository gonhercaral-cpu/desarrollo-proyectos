// Fase 8 — Contraste de color (para advertencia de preflight). Puro.

function parseHex(color) {
  const value = String(color || "").trim().replace(/^#/, "");
  if (![3, 6].includes(value.length)) return null;
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Razón de contraste WCAG (1..21). Devuelve null si algún color no es válido.
export function contrastRatio(foreground, background) {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return null;
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

// ¿Contraste extremadamente bajo? (< 2:1 = advertencia).
export function isLowContrast(foreground, background, threshold = 2) {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio < threshold;
}
