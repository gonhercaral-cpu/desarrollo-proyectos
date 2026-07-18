// Estabilización — resolución de la fuente de imagen de un elemento editorial.
// Pura y testeable. El elemento `image` guarda la URL en `assetUrl`; se acepta
// `src`/`url` como respaldo por compatibilidad. Sin fuente devuelve "".
export function resolveImageUrl(element) {
  if (!element) return "";
  return String(element.assetUrl || element.src || element.url || "");
}

// ¿El elemento imagen tiene fuente para renderizar?
export function hasImageSource(element) {
  return resolveImageUrl(element).length > 0;
}
