import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeRoomDisplay } from "../services/digital-signage/roomLayoutsService";
import { cacheSignageAssets, getCachedAssetUrl } from "../utils/signageCache";
import { resolveRoomLayout } from "../utils/digitalSignage/roomLayouts.js";
import {
  computeClockOffset,
  getRoomManifestImageUrls,
  normalizeRoomManifest,
} from "../utils/digitalSignage/roomPublication.js";

const MANIFEST_PREFIX = "signage:roomManifest:";
const CLOCK_PREFIX = "signage:clockOffset:";
const RESOLVE_INTERVAL_MS = 1000;
const CLOCK_RESYNC_MS = 15 * 60 * 1000;
const CLOCK_SKEW_WARNING_MS = 2 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 5000, 15000];

// ---------- reloj corregido ----------

function readCachedOffset(deviceToken) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${CLOCK_PREFIX}${deviceToken}`) || "null");
    return Number.isFinite(parsed?.offset) ? parsed.offset : null;
  } catch {
    return null;
  }
}

function writeCachedOffset(deviceToken, offset) {
  try {
    window.localStorage.setItem(`${CLOCK_PREFIX}${deviceToken}`, JSON.stringify({ offset, savedAt: Date.now() }));
  } catch {
    // localStorage bloqueado: el reloj sigue funcionando en memoria.
  }
}

async function fetchServerOffset() {
  const localStartMillis = Date.now();
  const response = await window.fetch(`${window.location.origin}/`, {
    method: "HEAD",
    cache: "no-store",
  });
  const localEndMillis = Date.now();
  if (!response.ok) return null;
  return computeClockOffset({
    dateHeader: response.headers.get("date"),
    ageHeader: response.headers.get("age") || "",
    localStartMillis,
    localEndMillis,
  });
}

function useCorrectedClock(deviceToken) {
  // Inicialización perezosa: el ancla no se vuelve a medir durante renders posteriores.
  const [initialClock] = useState(() => {
    const cached = typeof window !== "undefined" ? readCachedOffset(deviceToken) : null;
    return {
      anchor: { wall: Date.now(), perf: performance.now(), offset: cached ?? 0 },
      status: { verified: cached !== null, skewMillis: cached ?? 0 },
    };
  });
  const anchorRef = useRef(initialClock.anchor);
  const [status, setStatus] = useState(initialClock.status);

  // Monótono entre sincronizaciones: wall + delta(performance.now) + offset.
  const getNow = useCallback(() => {
    const anchor = anchorRef.current;
    return anchor.wall + (performance.now() - anchor.perf) + anchor.offset;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const offset = await fetchServerOffset();
        if (cancelled || offset === null) return;
        anchorRef.current = { wall: Date.now(), perf: performance.now(), offset };
        writeCachedOffset(deviceToken, offset);
        setStatus({ verified: true, skewMillis: offset });
      } catch {
        // Sin red: se conserva el último offset (cacheado o 0).
      }
    }

    sync();
    const intervalId = window.setInterval(sync, CLOCK_RESYNC_MS);
    window.addEventListener("online", sync);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("online", sync);
    };
  }, [deviceToken]);

  let notice = "";
  if (Math.abs(status.skewMillis) > CLOCK_SKEW_WARNING_MS) {
    notice = `Reloj del equipo desfasado ${Math.round(Math.abs(status.skewMillis) / 60000)} min; usando hora corregida`;
  } else if (!status.verified) {
    notice = "Hora local sin verificar";
  }

  return { getNow, clockNotice: notice };
}

// ---------- caché de manifiesto ----------

function readStoredManifest(deviceToken, plantel = null) {
  if (typeof window === "undefined" || !deviceToken) return null;
  try {
    const raw = window.localStorage.getItem(`${MANIFEST_PREFIX}${deviceToken}`);
    const stored = raw ? normalizeRoomManifest(JSON.parse(raw), { deviceToken }) : null;
    return stored && plantel !== null && stored.plantel !== plantel ? null : stored;
  } catch {
    return null;
  }
}

function writeStoredManifest(deviceToken, manifest) {
  try {
    if (manifest) window.localStorage.setItem(`${MANIFEST_PREFIX}${deviceToken}`, JSON.stringify(manifest));
    else window.localStorage.removeItem(`${MANIFEST_PREFIX}${deviceToken}`);
  } catch {
    // Caché opcional.
  }
}

// Mismo manifiesto aplicado (por revisión/updatedAt): evita churn de estado en cada poll idéntico.
// Un manifiesto null (acomodo despublicado) también se considera ya aplicado si lo estaba.
function isSameManifest(applied, stateKey, next, revision) {
  if (!applied || applied.key !== stateKey || applied.revision !== revision) return false;
  const previous = applied.manifest;
  if (!previous || !next) return previous === next;
  return (
    previous.updatedAt === next.updatedAt &&
    previous.plantel === next.plantel &&
    previous.active === next.active &&
    previous.layouts?.length === next.layouts?.length
  );
}

function applyUrlMap(template, urlMap) {
  if (!template || urlMap.size === 0) return template;
  return {
    ...template,
    backgroundUrl: urlMap.get(template.backgroundUrl) || template.backgroundUrl,
    elements: (template.elements || []).map((element) =>
      element.url && urlMap.has(element.url) ? { ...element, url: urlMap.get(element.url) } : element
    ),
  };
}

// ---------- hook ----------

// Devuelve el acomodo vigente (o null). Solo lee su manifiesto por token: no escucha
// colecciones admin. `allowCachedDevice` permite mostrar el acomodo cacheado cuando el
// documento del dispositivo no pudo cargarse (sin red / error), sin inventar dispositivos
// distintos al token ni a su manifiesto.
export default function useRoomLayoutPlayback({
  deviceToken,
  device,
  allowCachedDevice = false,
  playbackMode = "cache",
  cacheScope = "",
}) {
  const devicePlantel = typeof device?.plantel === "string" ? device.plantel.trim() : null;
  // La identidad del manifiesto incluye el plantel: al cambiarlo nunca se muestra el anterior.
  const stateKey = `${deviceToken || ""}|${devicePlantel ?? ""}`;
  const streamMode = playbackMode === "stream";
  const [manifestState, setManifestState] = useState(() => ({
    key: stateKey,
    manifest: readStoredManifest(deviceToken, devicePlantel),
    revision: undefined,
  }));
  const [retryNonce, setRetryNonce] = useState(0);
  const [urlState, setUrlState] = useState({ key: "", map: new Map() });
  const [resolved, setResolved] = useState({ key: "", stateKey: "", value: null });
  const { getNow, clockNotice } = useCorrectedClock(deviceToken);
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  const retryRef = useRef({ key: "", attempts: 0 });
  const appliedRef = useRef(null);

  const deviceInvalid = device === null || (Boolean(device) && device.active === false);
  const manifestRaw = manifestState.key === stateKey && !deviceInvalid ? manifestState.manifest : null;
  // Un manifiesto de otro plantel (carrera entre device y recomposición) no se muestra.
  const manifest =
    manifestRaw && devicePlantel !== null && manifestRaw.plantel !== devicePlantel ? null : manifestRaw;
  const effectiveDevice = useMemo(() => {
    // The resolver checks the local manifest identity, while targeting rules keep
    // using the stable administrative id. This alias never goes to a public doc.
    if (device) return { ...device, deviceToken };
    if (device === undefined && allowCachedDevice && manifest?.plantel) {
      return { id: deviceToken, deviceToken, plantel: manifest.plantel, active: true };
    }
    return null;
  }, [allowCachedDevice, device, deviceToken, manifest]);

  const deviceActive = Boolean(effectiveDevice) && effectiveDevice.active !== false;
  const subscribed = Boolean(deviceToken) && (device === undefined ? allowCachedDevice : device?.active !== false);

  useEffect(() => {
    let cancelled = false;
    // La caché es una fuente externa: no pisa una respuesta más reciente del listener.
    const cached = readStoredManifest(deviceToken, devicePlantel);
    queueMicrotask(() => {
      if (!cancelled) {
        setManifestState((current) => current.key === stateKey ? current : { key: stateKey, manifest: cached });
      }
    });
    return () => { cancelled = true; };
  }, [stateKey, deviceToken, devicePlantel]);

  // Dispositivo inexistente/inactivo: se borra la copia local para no conservar contenido revocado.
  useEffect(() => {
    if (deviceToken && deviceInvalid) writeStoredManifest(deviceToken, null);
  }, [deviceInvalid, deviceToken]);

  useEffect(() => {
    if (!deviceToken || !subscribed) return undefined;
    if (retryRef.current.key !== stateKey) retryRef.current = { key: stateKey, attempts: 0 };
    // Nueva suscripción: la primera respuesta siempre se aplica (el estado pudo venir de localStorage).
    appliedRef.current = null;
    let retryTimerId = 0;

    function scheduleRetry() {
      const state = retryRef.current;
      if (state.attempts >= MAX_RETRIES) return;
      state.attempts += 1;
      retryTimerId = window.setTimeout(() => setRetryNonce((value) => value + 1), RETRY_DELAYS_MS[state.attempts - 1]);
    }
    function retryOnline() {
      retryRef.current = { key: stateKey, attempts: 0 };
      setRetryNonce((value) => value + 1);
    }

    const unsubscribe = subscribeRoomDisplay(
      deviceToken,
      (nextManifest, meta = {}) => {
        // Un null desde caché local no prueba despublicación; solo el servidor lo hace.
        if (!nextManifest && meta.fromCache) return;
        if (nextManifest && devicePlantel !== null && nextManifest.plantel !== devicePlantel) {
          // Manifiesto previo al cambio de plantel: no se usa ni se guarda; llegará la recomposición.
          appliedRef.current = null;
          writeStoredManifest(deviceToken, null);
          setManifestState({ key: stateKey, manifest: null });
          return;
        }
        retryRef.current = { key: stateKey, attempts: 0 };
        // Una respuesta idéntica (poll cada 10 s) no escribe ni re-renderiza.
        const revision = meta.revision;
        if (isSameManifest(appliedRef.current, stateKey, nextManifest, revision)) return;
        appliedRef.current = { key: stateKey, manifest: nextManifest, revision };
        writeStoredManifest(deviceToken, nextManifest);
        setManifestState({ key: stateKey, manifest: nextManifest, revision });
      },
      (error) => {
        if (error?.code === "permission-denied") {
          // El contenido pudo ser revocado: no se conserva; se reintenta de forma limitada.
          appliedRef.current = null;
          writeStoredManifest(deviceToken, null);
          setManifestState({ key: stateKey, manifest: null });
          scheduleRetry();
          return;
        }
        console.warn("No se pudo leer el acomodo publicado; se conserva la copia local.", error);
      }
    );
    window.addEventListener("online", retryOnline);
    return () => {
      window.clearTimeout(retryTimerId);
      window.removeEventListener("online", retryOnline);
      unsubscribe();
    };
  }, [deviceToken, subscribed, stateKey, devicePlantel, retryNonce]);

  // Precarga de fondos/logos una sola vez por conjunto de URLs; blobs locales para offline.
  const roomAssetUrls = useMemo(() => getRoomManifestImageUrls(manifest), [manifest]);
  const urlsKey = roomAssetUrls.join("\n");
  // La identidad del mapa incluye modo y scope: stream/otro scope nunca reutiliza un blob anterior.
  const mapKey = `${streamMode ? "stream" : "cache"}|${cacheScope || ""}|${urlsKey}`;
  const roomAssetUrlsRef = useRef(roomAssetUrls);
  useEffect(() => {
    roomAssetUrlsRef.current = roomAssetUrls;
  }, [roomAssetUrls]);

  useEffect(() => {
    let cancelled = false;
    const created = [];

    // Stream (o sin imágenes): sin cache ni blobs; se suelta el mapa anterior (se revoca al reemplazarse).
    if (streamMode || roomAssetUrls.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) {
          setUrlState((current) => (current.map.size === 0 && !current.key ? current : { key: "", map: new Map() }));
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    const options = { ...(cacheScope ? { scope: cacheScope } : {}), signal: controller.signal };

    (async () => {
      await cacheSignageAssets(roomAssetUrls.map((url) => ({ type: "image", url })), options).catch(() => {});
      const map = new Map();
      for (const url of roomAssetUrls) {
        if (cancelled) break;
        const blobUrl = await getCachedAssetUrl(url, options).catch(() => "");
        if (blobUrl) {
          created.push(blobUrl);
          map.set(url, blobUrl);
        }
      }
      if (cancelled) {
        created.forEach((blobUrl) => window.URL.revokeObjectURL(blobUrl));
        return;
      }
      setUrlState({ key: mapKey, map });
    })();

    return () => {
      cancelled = true;
      controller.abort();
      // Los blobs del mapa vigente se revocan al reemplazarse (ver efecto siguiente).
    };
    // roomAssetUrls/modo/scope están contenidos en mapKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  useEffect(() => {
    const map = urlState.map;
    return () => {
      map.forEach((blobUrl) => window.URL.revokeObjectURL(blobUrl));
    };
  }, [urlState.map]);

  // Revisión ≥ 1/s contra el reloj corregido; solo se re-renderiza si cambia el resultado.
  useEffect(() => {
    function check() {
      const now = getNow();
      const match = deviceActive ? resolveRoomLayout(manifest, effectiveDevice, now) : null;
      const key = match ? `${match.layout.id}|${match.rule.id}|${match.layout.publishedAtMillis}` : "";
      setResolved((current) =>
        current.key === key && current.stateKey === stateKey ? current : { key, stateKey, value: match }
      );
      if (match) setNowMillis(now);
    }

    check();
    const intervalId = window.setInterval(check, RESOLVE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [deviceActive, effectiveDevice, getNow, manifest, stateKey]);

  const activeRoomLayout = useMemo(() => {
    // Sin manifiesto vigente para este token+plantel no se reutiliza un resultado anterior.
    if (!resolved.value || resolved.stateKey !== stateKey || !manifest || !deviceActive) return null;
    const { layout, rule } = resolved.value;
    const urlMap = !streamMode && urlState.key === mapKey ? urlState.map : new Map();
    return {
      // La ventana elige el bloque de columnas; las horas de clase siguen
      // siendo datos del acomodo y nunca determinan su aparición.
      layout: layout.schedule ? { ...layout, selectedViewId: rule.viewId || "" } : layout,
      rule,
      template: applyUrlMap(layout.template, urlMap),
    };
  }, [resolved.value, resolved.stateKey, stateKey, manifest, deviceActive, urlState.map, urlState.key, mapKey, streamMode]);

  const getRoomAssetUrls = useCallback(() => roomAssetUrlsRef.current, []);

  return { activeRoomLayout, nowMillis, getNow, clockNotice, getRoomAssetUrls };
}
