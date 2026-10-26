export const ANIMATION_FALLBACK_NOTICE = "Animación no disponible; se muestra imagen estática.";
export const PROCESSING_ELSEWHERE_NOTICE = "sigue procesándose en otro proceso. No se inició otra conversión; espera y vuelve a comprobar.";

const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

// Only stages the backend really distinguishes. Unknown values yield no label.
export function processingStageLabel(resource) {
  const processing = resource?.processing;
  if (processing?.state !== "processing") return "";
  const slides = resource.mimeType === GOOGLE_SLIDES;
  const pptx = /presentationml\.presentation|ms-powerpoint/.test(resource.mimeType || "") || /\.pptx?$/i.test(resource.sourceName || resource.name || "");
  switch (processing.stage) {
    case "planning": return pptx ? "Descargando y analizando la presentación" : "Preparando el archivo";
    case "converting": return slides ? "Descargando, convirtiendo y almacenando diapositivas" : "Convirtiendo y guardando en el servicio";
    case "verifying": return "Verificando archivos";
    default: return "";
  }
}

export function processingProgressMessage(resource) {
  const stage = processingStageLabel(resource);
  return `Procesando ${resource?.name || "archivo"}…${stage ? ` · ${stage}` : ""}`;
}

// progress.completed counts finished files, not transfer percentage.
export function importProgressLabel(progress, converting = "") {
  if (converting) return converting;
  if (!progress) return "";
  const current = Math.min(progress.total, (progress.completed || 0) + 1);
  return `Importando archivo ${current} de ${progress.total}: ${progress.file?.name || ""}`;
}

export function pageWarningNotices(warnings) {
  const notices = new Set();
  for (const warning of warnings || []) {
    const text = typeof warning === "string" ? warning : `${warning?.code || ""} ${warning?.message || ""}`;
    if (/gif/i.test(text)) notices.add(/unsupported|no.?compatible|no.?soport/i.test(text) ? "El GIF de esta diapositiva no es compatible; se muestra una imagen estática." : "El GIF de esta diapositiva usa imagen estática de respaldo; la animación no está garantizada en todos los dispositivos.");
    else notices.add("Animación no compatible. Diapositiva estática; puedes crear revelados manuales.");
  }
  return [...notices];
}

// Synchronous re-entrancy guard: React state does not update within the same render.
export function createSingleFlightGuard() {
  let held = false;
  return {
    tryAcquire() { if (held) return false; held = true; return true; },
    release() { held = false; },
    get held() { return held; },
  };
}

// Accepts only a resource document that belongs to the unit being edited.
export function processingResourceFromSnapshot(unitId, resourceId, snapshot) {
  if (!snapshot?.exists?.()) return null;
  const data = snapshot.data();
  if (!data || data.folderId !== unitId) return null;
  return { id: resourceId, ...data };
}

// Wraps a subscribe function so that callbacks after unsubscribe are ignored.
export function guardedSubscription(subscribe, onChange, onError) {
  let closed = false;
  const unsubscribe = subscribe(value => { if (!closed) onChange(value); }, error => { if (!closed) onError?.(error); });
  return () => { closed = true; unsubscribe?.(); };
}

// Accept only a valid animation descriptor; anything else falls back to the full PNG.
export function usableAnimation(animation) {
  const background = animation?.background;
  if (!background?.url || background.mimeType !== "image/png") return null;
  const images = animation.images;
  if (!Array.isArray(images) || !images.length) return null;
  const valid = images.every(image => image?.url && image.mimeType === "image/gif" && [image.x, image.y, image.width, image.height].every(Number.isFinite)
    && image.x >= 0 && image.y >= 0 && image.width > 0 && image.height > 0 && image.x + image.width <= 100.001 && image.y + image.height <= 100.001);
  return valid ? { background, images } : null;
}
