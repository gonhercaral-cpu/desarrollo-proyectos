export const DEFAULT_ASSET_DURATION_SECONDS = 10;
export const MIN_ASSET_DURATION_SECONDS = 1;
export const MAX_ASSET_DURATION_SECONDS = 86400;
export const VIDEO_METADATA_TIMEOUT_MS = 8000;

export function normalizeDurationSeconds(value, fallback = DEFAULT_ASSET_DURATION_SECONDS) {
  const duration = Number(value);

  if (value === null || value === "" || !Number.isFinite(duration) || duration <= 0) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(duration), MIN_ASSET_DURATION_SECONDS), MAX_ASSET_DURATION_SECONDS);
}

export function isValidDurationSeconds(value) {
  const duration = Number(value);
  return (
    value !== null &&
    value !== "" &&
    Number.isFinite(duration) &&
    duration >= MIN_ASSET_DURATION_SECONDS &&
    duration <= MAX_ASSET_DURATION_SECONDS
  );
}

// Duración por defecto: videos usan la duración real medida; todo lo demás 10 s.
export function getDefaultDurationSeconds(type, metadataDurationSeconds) {
  if (type === "video" && Number(metadataDurationSeconds) > 0) {
    return normalizeDurationSeconds(metadataDurationSeconds);
  }

  return DEFAULT_ASSET_DURATION_SECONDS;
}

// Acepta "90", "MM:SS" o "HH:MM:SS". Devuelve segundos enteros o null si es inválido.
export function parseDurationInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parts = text.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part.trim()))) return null;

  const numbers = parts.map((part) => Number(part.trim()));
  let seconds;

  if (numbers.length === 1) {
    seconds = numbers[0];
  } else {
    const rest = numbers.slice(1);
    if (rest.some((part) => part > 59)) return null;
    seconds = numbers.reduce((total, part) => total * 60 + part, 0);
  }

  return isValidDurationSeconds(seconds) ? seconds : null;
}

// Drive entrega videoMediaMetadata.durationMillis como string o número.
export function getDriveVideoDurationSeconds(file) {
  const millis = Number(file?.videoMediaMetadata?.durationMillis);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return normalizeDurationSeconds(millis / 1000);
}

// Mide la duración real de un File/Blob o URL en el navegador. Nunca rechaza:
// devuelve null si no hay entorno de navegador, falla o vence el timeout.
export function measureMediaDuration(source, options = {}) {
  const {
    timeoutMs = VIDEO_METADATA_TIMEOUT_MS,
    documentRef = typeof document !== "undefined" ? document : null,
    urlApi = typeof URL !== "undefined" ? URL : null,
  } = options;

  if (!source || !documentRef || typeof documentRef.createElement !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let objectUrl = "";
    let video = null;
    let timeoutId = 0;
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      if (video) {
        video.onloadedmetadata = null;
        video.onerror = null;
        try {
          video.removeAttribute("src");
          video.load?.();
        } catch {
          // Limpieza best-effort.
        }
      }

      if (objectUrl && urlApi?.revokeObjectURL) urlApi.revokeObjectURL(objectUrl);
      resolve(result);
    }

    try {
      let src = source;

      if (typeof source !== "string") {
        if (!urlApi?.createObjectURL) {
          resolve(null);
          return;
        }
        objectUrl = urlApi.createObjectURL(source);
        src = objectUrl;
      }

      video = documentRef.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        const duration = Number(video.duration);
        finish(Number.isFinite(duration) && duration > 0 ? normalizeDurationSeconds(duration) : null);
      };
      video.onerror = () => finish(null);
      timeoutId = setTimeout(() => finish(null), timeoutMs);
      video.src = src;
    } catch {
      finish(null);
    }
  });
}

// Identidad estable de items de playlist. Conserva itemId existente; si falta (o se
// repite) genera uno legacy determinista por assetId + ocurrencia, sin colisiones.
export function assignPlaylistItemIds(items = []) {
  const used = new Set();
  const withIds = items.map((item) => {
    const itemId = String(item?.itemId || "").trim();
    if (itemId && !used.has(itemId)) {
      used.add(itemId);
      return { ...item, itemId };
    }
    return { ...item, itemId: "" };
  });
  const occurrences = new Map();

  return withIds.map((item) => {
    if (item.itemId) return item;

    const assetId = String(item.assetId || "");
    let occurrence = occurrences.get(assetId) || 0;
    let candidate;

    do {
      occurrence += 1;
      candidate = `legacy-${assetId}-${occurrence}`;
    } while (used.has(candidate));

    occurrences.set(assetId, occurrence);
    used.add(candidate);
    return { ...item, itemId: candidate };
  });
}
