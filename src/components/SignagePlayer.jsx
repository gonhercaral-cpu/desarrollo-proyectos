import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  subscribeSignageCampaigns,
  subscribeDeviceByToken,
  subscribePlaylist,
  logPlaybackEvent,
  updateDeviceHeartbeat,
} from "../services/digitalSignageService";
import {
  cacheSignageAssets,
  clearOldSignageCache,
  getCachedAssetUrl,
} from "../utils/signageCache";
import {
  getCampaignPriorityWeight,
  isPublished,
  normalizePublishStatus,
} from "../utils/digitalSignage";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const FALLBACK_DURATION_SECONDS = 10;
const VIDEO_SAFETY_BUFFER_MS = 1500;
const MANIFEST_STORAGE_PREFIX = "signage:lastGoodManifest:";
const CAMPAIGN_RECHECK_MS = 60 * 1000;
const NO_CONTENT_LOG_INTERVAL_MS = 5 * 60 * 1000;
const PLAY_START_THROTTLE_MS = 5 * 1000;

export default function SignagePlayer() {
  const { deviceToken = "" } = useParams();
  const [deviceState, setDeviceState] = useState({ token: "", value: undefined });
  const [playlistState, setPlaylistState] = useState({
    playlistId: "",
    value: null,
    error: "",
  });
  const [campaignState, setCampaignState] = useState({
    value: [],
    error: "",
  });
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackNonce, setPlaybackNonce] = useState(0);
  const [failedItemKeys, setFailedItemKeys] = useState(() => new Set());
  const [playerError, setPlayerError] = useState("");
  const [storedManifestState, setStoredManifestState] = useState(() => ({
    token: deviceToken,
    manifest: readLastGoodManifest(deviceToken),
  }));
  const [isOffline, setIsOffline] = useState(() => isNavigatorOffline());
  const [assetSource, setAssetSource] = useState({
    key: "",
    url: "",
    cached: false,
  });
  const heartbeatTokenRef = useRef(deviceToken);
  const resolvedLogRef = useRef("");
  const noContentLogRef = useRef({ key: "", at: 0 });
  const offlineLogRef = useRef("");
  const playStartLogRef = useRef(new Map());
  const currentPlayRef = useRef({ key: "", nonce: -1, startedAt: 0, ended: false });
  const device = deviceState.token === deviceToken ? deviceState.value : undefined;
  const canSubscribeCampaigns =
    deviceState.token === deviceToken &&
    deviceState.value !== undefined &&
    deviceState.value?.active !== false;
  const assignedPlaylistId = device?.assignedPlaylistId || "";
  const activeCampaign = useMemo(
    () => resolveActiveCampaign(campaignState.value, device, scheduleNow),
    [campaignState.value, device, scheduleNow]
  );
  const campaignPlaylistUnavailable =
    activeCampaign?.playlistId &&
    playlistState.playlistId === activeCampaign.playlistId &&
    (!playlistState.value || playlistState.error);
  const effectivePlaylistId =
    activeCampaign && !campaignPlaylistUnavailable
      ? activeCampaign.playlistId
      : assignedPlaylistId;
  const playlist =
    playlistState.playlistId === effectivePlaylistId ? playlistState.value : null;
  const playlistError =
    playlistState.playlistId === effectivePlaylistId ? playlistState.error : "";

  const liveItems = useMemo(() => normalizePlayableItems(playlist?.items), [playlist]);
  const storedManifest =
    storedManifestState.token === deviceToken ? storedManifestState.manifest : null;
  const canUseStoredManifest =
    device?.active !== false &&
    storedManifest?.items?.length > 0 &&
    liveItems.length === 0 &&
    Boolean(playerError || playlistError);
  const baseItems = canUseStoredManifest ? storedManifest.items : liveItems;
  const items = useMemo(() => {
    const availableItems = baseItems.filter((item) => !failedItemKeys.has(item.key));
    return availableItems.length > 0 ? availableItems : baseItems;
  }, [baseItems, failedItemKeys]);
  const allItemsFailed = baseItems.length > 0 && failedItemKeys.size >= baseItems.length;
  const safeCurrentIndex = items.length ? currentIndex % items.length : 0;
  const currentItem = items[safeCurrentIndex] || null;
  const currentAssetUrl =
    assetSource.key === currentItem?.key && assetSource.url
      ? assetSource.url
      : currentItem?.url;
  const isUsingCachedAsset =
    assetSource.key === currentItem?.key && assetSource.cached;
  const playerNotice = getPlayerNotice({
    canUseStoredManifest,
    isOffline,
    isUsingCachedAsset,
  });
  const playbackSource = canUseStoredManifest
    ? "lastGoodManifest"
    : activeCampaign && !campaignPlaylistUnavailable
      ? "campaign"
      : "devicePlaylist";
  const playbackPlaylistId = canUseStoredManifest
    ? storedManifest?.playlistId || ""
    : effectivePlaylistId || "";
  const playbackCampaignId = canUseStoredManifest
    ? storedManifest?.campaignId || ""
    : activeCampaign?.id || "";
  const playbackCampaignName = canUseStoredManifest ? "" : activeCampaign?.name || "";
  const playbackPlaylistName = canUseStoredManifest ? "" : playlist?.name || "";

  const logPlayerEvent = useCallback(
    (eventType, item = null, extra = {}) => {
      const fallbackDeviceId = device?.id || device?.deviceToken || deviceToken;

      if (!fallbackDeviceId) return;

      logPlaybackEvent({
        deviceId: fallbackDeviceId,
        deviceName: device?.name || "",
        plantel: device?.plantel || "",
        location: device?.location || "",
        eventType,
        assetId: item?.assetId || "",
        assetTitle: item?.title || "",
        assetType: item?.type || "",
        playlistId: extra.playlistId ?? playbackPlaylistId,
        playlistName: extra.playlistName ?? playbackPlaylistName,
        campaignId: extra.campaignId ?? playbackCampaignId,
        campaignName: extra.campaignName ?? playbackCampaignName,
        source: extra.source ?? playbackSource,
        durationSeconds: extra.durationSeconds ?? item?.durationSeconds ?? null,
        errorMessage: extra.errorMessage || "",
        localTimestamp: new Date().toISOString(),
        playerVersion: "web-player-v1",
      });
    },
    [
      device?.deviceToken,
      device?.id,
      device?.location,
      device?.name,
      device?.plantel,
      deviceToken,
      playbackCampaignId,
      playbackCampaignName,
      playbackPlaylistId,
      playbackPlaylistName,
      playbackSource,
    ]
  );

  useEffect(() => {
    heartbeatTokenRef.current = deviceToken;

    return subscribeDeviceByToken(
      deviceToken,
      (nextDevice) => {
        setPlayerError("");
        setStoredManifestState({
          token: deviceToken,
          manifest: readLastGoodManifest(deviceToken),
        });
        setDeviceState({ token: deviceToken, value: nextDevice });
      },
      () => {
        setPlayerError("Error al cargar contenido");
        setStoredManifestState({
          token: deviceToken,
          manifest: readLastGoodManifest(deviceToken),
        });
        setCurrentIndex(0);
        setPlaybackNonce(0);
        setFailedItemKeys(new Set());
      }
    );
  }, [deviceToken]);

  useEffect(() => {
    if (
      !deviceToken ||
      !effectivePlaylistId ||
      device.active === false ||
      !playlist ||
      liveItems.length === 0
    ) {
      return;
    }

    const campaignId = playlist.campaignId || device.campaignId || "";
    const resolvedCampaignId = activeCampaign?.id || campaignId;
    const manifest = {
      deviceToken,
      playlistId: effectivePlaylistId,
      campaignId: resolvedCampaignId,
      schedule: activeCampaign?.schedule || null,
      resolvedAt: new Date().toISOString(),
      source: resolvedCampaignId ? "campaign" : "devicePlaylist",
      items: liveItems,
    };

    writeLastGoodManifest(deviceToken, manifest);

    cacheSignageAssets(getCacheablePlaybackItems(liveItems)).catch((error) => {
      console.warn("No se pudo precargar cache de Digital Signage.", error);
    });
    clearOldSignageCache(getCacheablePlaybackItems(liveItems).map((item) => item.url)).catch((error) => {
      console.warn("No se pudo limpiar cache de Digital Signage.", error);
    });
  }, [
    deviceToken,
    effectivePlaylistId,
    device?.active,
    device?.campaignId,
    activeCampaign,
    playlist,
    liveItems,
  ]);

  useEffect(() => {
    if (!device || device.active === false || !effectivePlaylistId || liveItems.length === 0) return;

    const signature = [
      device.id || deviceToken,
      effectivePlaylistId,
      activeCampaign?.id || "",
      playbackSource,
      liveItems.map((item) => item.key).join("|"),
    ].join("::");

    if (resolvedLogRef.current === signature) return;
    resolvedLogRef.current = signature;

    logPlayerEvent("playlist_resolved", null, {
      playlistId: effectivePlaylistId,
      playlistName: playlist?.name || "",
      campaignId: activeCampaign?.id || "",
      campaignName: activeCampaign?.name || "",
      source: playbackSource,
      durationSeconds: liveItems.reduce((total, item) => total + Number(item.durationSeconds || 0), 0),
    });
  }, [
    activeCampaign?.id,
    activeCampaign?.name,
    device,
    deviceToken,
    effectivePlaylistId,
    liveItems,
    logPlayerEvent,
    playbackSource,
    playlist?.name,
  ]);

  useEffect(() => {
    if (!canSubscribeCampaigns) {
      return undefined;
    }

    return subscribeSignageCampaigns(
      (nextCampaigns) => {
        setCampaignState({ value: nextCampaigns, error: "" });
        setScheduleNow(Date.now());
      },
      () => {
        setCampaignState({ value: [], error: "No se pudieron cargar campañas." });
      }
    );
  }, [canSubscribeCampaigns]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setScheduleNow(Date.now());
    }, CAMPAIGN_RECHECK_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!effectivePlaylistId || device.active === false) {
      return undefined;
    }

    return subscribePlaylist(
      effectivePlaylistId,
      (nextPlaylist) => {
        setPlaylistState({
          playlistId: effectivePlaylistId,
          value:
            nextPlaylist?.active === false || !isPublished(nextPlaylist?.publishStatus)
              ? null
              : nextPlaylist,
          error: "",
        });
        setPlayerError("");
        setCurrentIndex(0);
        setPlaybackNonce(0);
        setFailedItemKeys(new Set());
      },
      () => {
        setPlayerError("Error al cargar contenido");
        setStoredManifestState({
          token: deviceToken,
          manifest: readLastGoodManifest(deviceToken),
        });
        setPlaylistState({
          playlistId: effectivePlaylistId,
          value: null,
          error: "Sin contenido asignado",
        });
        setPlaybackNonce(0);
        setFailedItemKeys(new Set());
      }
    );
  }, [effectivePlaylistId, device?.active, deviceToken]);

  useEffect(() => {
    if (!device?.id || device.active === false) return undefined;

    updateDeviceHeartbeat(device.id).catch(() => {});

    const intervalId = window.setInterval(() => {
      updateDeviceHeartbeat(heartbeatTokenRef.current || device.id).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [device?.id, device?.active]);

  useEffect(() => {
    function handleOnlineStatusChange() {
      setIsOffline(isNavigatorOffline());
    }

    window.addEventListener("online", handleOnlineStatusChange);
    window.addEventListener("offline", handleOnlineStatusChange);

    return () => {
      window.removeEventListener("online", handleOnlineStatusChange);
      window.removeEventListener("offline", handleOnlineStatusChange);
    };
  }, []);

  const advanceToNext = useCallback(() => {
    if (items.length <= 1) {
      setPlaybackNonce((current) => current + 1);
      setCurrentIndex(0);
      return;
    }

    goNext(items.length, setCurrentIndex);
  }, [items.length]);

  const finishCurrentItem = useCallback(() => {
    const currentPlay = currentPlayRef.current;

    if (currentItem && currentPlay.key === currentItem.key && !currentPlay.ended) {
      currentPlayRef.current = { ...currentPlay, ended: true };
      const elapsedSeconds = currentPlay.startedAt
        ? Math.max(0, Math.round((Date.now() - currentPlay.startedAt) / 1000))
        : Number(currentItem.durationSeconds || 0);

      logPlayerEvent("play_end", currentItem, { durationSeconds: elapsedSeconds });
    }

    advanceToNext();
  }, [advanceToNext, currentItem, logPlayerEvent]);

  const failCurrentItem = useCallback(
    (item, errorMessage = "Error al cargar contenido") => {
      if (item) {
        logPlayerEvent("play_error", item, { errorMessage });
        currentPlayRef.current = {
          ...currentPlayRef.current,
          ended: true,
        };
      }

      handleItemFailure(item, advanceToNext, setFailedItemKeys);
    },
    [advanceToNext, logPlayerEvent]
  );

  useEffect(() => {
    if (!currentItem) return undefined;

    const timeoutId = window.setTimeout(() => {
      finishCurrentItem();
    }, getItemTimeoutMillis(currentItem));

    return () => window.clearTimeout(timeoutId);
  }, [currentItem, finishCurrentItem]);

  useEffect(() => {
    let cancelled = false;
    let localObjectUrl = "";

    if (!currentItem || !["image", "video", "visual_ad"].includes(currentItem.type)) {
      return undefined;
    }

    const sourceUrl = getItemAssetUrl(currentItem);

    if (!sourceUrl) {
      return undefined;
    }

    getCachedAssetUrl(sourceUrl).then((cachedUrl) => {
      if (cancelled) {
        revokeObjectUrl(cachedUrl);
        return;
      }

      if (cachedUrl) {
        localObjectUrl = cachedUrl;
        setAssetSource({
          key: currentItem.key,
          url: cachedUrl,
          cached: true,
        });
        return;
      }

      if (isOffline) {
        if (currentItem.type === "visual_ad") {
          setAssetSource({ key: currentItem.key, url: "", cached: false });
          return;
        }

        failCurrentItem(currentItem, "Asset no disponible en cache offline");
        return;
      }

      setAssetSource({
        key: currentItem.key,
        url: sourceUrl,
        cached: false,
      });
    });

    return () => {
      cancelled = true;
      revokeObjectUrl(localObjectUrl);
    };
  }, [currentItem, failCurrentItem, isOffline]);

  useEffect(() => {
    if (isOffline && currentItem?.type === "web") {
      failCurrentItem(currentItem, "Web no disponible sin conexion");
    }
  }, [currentItem, failCurrentItem, isOffline]);

  useEffect(() => {
    if (!currentItem || !device || device.active === false) return;

    const now = Date.now();
    const lastStartedAt = playStartLogRef.current.get(currentItem.key) || 0;

    currentPlayRef.current = {
      key: currentItem.key,
      nonce: playbackNonce,
      startedAt: now,
      ended: false,
    };

    if (now - lastStartedAt < PLAY_START_THROTTLE_MS) return;

    playStartLogRef.current.set(currentItem.key, now);
    logPlayerEvent("play_start", currentItem);
  }, [currentItem, device, logPlayerEvent, playbackNonce]);

  useEffect(() => {
    const source = canUseStoredManifest
      ? "lastGoodManifest"
      : isUsingCachedAsset
        ? "offlineCache"
        : "";

    if (!source || !device || device.active === false) return;

    const signature = `${device.id || deviceToken}:${source}:${currentItem?.key || storedManifest?.resolvedAt || ""}`;
    if (offlineLogRef.current === signature) return;

    offlineLogRef.current = signature;
    logPlayerEvent("offline_cache", currentItem, { source });
  }, [
    canUseStoredManifest,
    currentItem,
    device,
    deviceToken,
    isUsingCachedAsset,
    logPlayerEvent,
    storedManifest?.resolvedAt,
  ]);

  useEffect(() => {
    const hasNoContent =
      device &&
      device.active !== false &&
      !canUseStoredManifest &&
      (!effectivePlaylistId || playlistError || !playlist || items.length === 0 || !currentItem);

    if (!hasNoContent) return;

    const key = `${device.id || deviceToken}:${effectivePlaylistId || "none"}:${playlistError || "no-content"}`;
    const now = Date.now();

    if (noContentLogRef.current.key === key && now - noContentLogRef.current.at < NO_CONTENT_LOG_INTERVAL_MS) {
      return;
    }

    noContentLogRef.current = { key, at: now };
    logPlayerEvent("no_content", null, {
      errorMessage: playlistError || "Sin contenido asignado",
    });
  }, [
    canUseStoredManifest,
    currentItem,
    device,
    deviceToken,
    effectivePlaylistId,
    items.length,
    logPlayerEvent,
    playlist,
    playlistError,
  ]);

  if (playerError && !canUseStoredManifest) {
    return <PlayerMessage message={playerError} />;
  }

  if (device === undefined && !canUseStoredManifest) {
    return <PlayerMessage message="Cargando contenido..." />;
  }

  if (!device && !canUseStoredManifest) {
    return <PlayerMessage message="Dispositivo no registrado" />;
  }

  if (device?.active === false) {
    return <PlayerMessage message="Dispositivo inactivo" />;
  }

  if (allItemsFailed) {
    return <PlayerMessage message="Error al cargar contenido" />;
  }

  if (
    !canUseStoredManifest &&
    (!effectivePlaylistId || playlistError || !playlist || items.length === 0 || !currentItem)
  ) {
    return <PlayerMessage message="Sin contenido asignado" />;
  }

  return (
    <main className="signage-player-screen">
      {playerNotice && (
        <div className="signage-player-offline-badge">
          {playerNotice}
        </div>
      )}
      <div className="signage-player-stage">
        {currentItem.type === "image" && (
          <img
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            src={currentAssetUrl}
            alt={currentItem.title || "Contenido"}
            onError={() => failCurrentItem(currentItem, "No se pudo cargar imagen")}
          />
        )}

        {currentItem.type === "video" && (
          <video
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            src={currentAssetUrl}
            autoPlay
            muted
            playsInline
            controls={false}
            onEnded={finishCurrentItem}
            onError={() => failCurrentItem(currentItem, "No se pudo reproducir video")}
          />
        )}

        {currentItem.type === "web" && (
          <WebContentFrame
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            item={currentItem}
            onFailure={() => failCurrentItem(currentItem, "No se pudo cargar web")}
          />
        )}

        {currentItem.type === "template" && (
          <TemplateSlide
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            item={currentItem}
          />
        )}

        {currentItem.type === "visual_ad" && (
          <VisualAdSlide
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            item={currentItem}
            backgroundUrl={assetSource.key === currentItem.key ? assetSource.url : ""}
          />
        )}
      </div>
    </main>
  );
}

function PlayerMessage({ message }) {
  return (
    <main className="signage-player-screen">
      <div className="signage-player-message">
        <span>Active English School</span>
        <small>Digital Signage</small>
        <strong>{message}</strong>
      </div>
    </main>
  );
}

function WebContentFrame({ item, onFailure }) {
  const settings = normalizeWebSettings(item?.webSettings);
  const [reloadNonce, setReloadNonce] = useState(0);
  const commandSignature = getWebCommandSignature(settings.lastCommand);
  const commandSignatureRef = useRef(commandSignature);
  const iframeUrl = buildWebPlaybackUrl(item?.url, settings, reloadNonce);
  const zoom = Math.min(Math.max(Number(settings.zoom) || 100, 50), 150);
  const zoomScale = zoom / 100;
  const frameStyle = {
    width: `${100 / zoomScale}%`,
    height: `${100 / zoomScale}%`,
    transform: `scale(${zoomScale})`,
    pointerEvents: settings.allowInteraction ? "auto" : "none",
  };

  useEffect(() => {
    if (!commandSignature || commandSignatureRef.current === commandSignature) return;
    commandSignatureRef.current = commandSignature;
    setReloadNonce((current) => current + 1);
  }, [commandSignature]);

  useEffect(() => {
    const seconds = Number(settings.reloadIntervalSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

    const intervalId = window.setInterval(() => {
      setReloadNonce((current) => current + 1);
    }, Math.max(seconds, 5) * 1000);

    return () => window.clearInterval(intervalId);
  }, [settings.reloadIntervalSeconds]);

  return (
    <div className={`signage-player-web-frame ${settings.mode}`}>
      {settings.showStatusOverlay && (
        <div className="signage-player-web-overlay">
          {settings.mode === "redirect"
            ? "Modo pagina completa solicitado. Mostrando contenedor seguro."
            : `Web ${zoom}%`}
        </div>
      )}
      <iframe
        key={`${item.assetId}-${reloadNonce}`}
        src={iframeUrl}
        title={item.title || "Contenido web"}
        allow="autoplay; fullscreen"
        referrerPolicy="no-referrer-when-downgrade"
        onError={onFailure}
        style={frameStyle}
      />
    </div>
  );
}

function goNext(length, setCurrentIndex) {
  if (!length) return;
  setCurrentIndex((current) => (current + 1) % length);
}

function normalizePlayableItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      const type = String(item?.type || "").trim();
      const url = String(item?.url || "").trim();
      const durationSeconds = Number(item?.durationSeconds);
      const templateData = normalizeTemplateData(item?.templateData);
      const assetId = String(item?.assetId || `item-${index}`);
      const templateKey = normalizeTemplateKey(item?.templateKey);
      const templateTheme = normalizeTemplateTheme(item?.templateTheme);
      const visualAdData = normalizeVisualAdData(item?.visualAdData);
      const webSettings = normalizeWebSettings(item?.webSettings);

      return {
        assetId,
        key: `${assetId}-${type}-${url || templateKey || visualAdData.canvas.backgroundUrl}-${templateData.title || item?.title || index}`,
        title: String(item?.title || templateData.title || "Contenido"),
        type,
        url,
        durationSeconds,
        publishStatus: normalizePublishStatus(item?.publishStatus),
        templateKey,
        templateData,
        templateTheme,
        visualAdData,
        webSettings,
      };
    })
    .filter(
      (item) =>
        ["image", "video", "web", "template", "visual_ad"].includes(item.type) &&
        isPublished(item.publishStatus) &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds > 0 &&
        (item.type === "template"
          ? Boolean(item.templateData.title || item.title)
          : item.type === "visual_ad"
            ? isValidVisualAdData(item.visualAdData)
            : Boolean(item.url))
    );
}

function getCacheablePlaybackItems(items = []) {
  return items.flatMap((item) => {
    if (["image", "video"].includes(item.type)) return [item];
    if (item.type === "visual_ad") {
      return getVisualAdImageUrls(item.visualAdData).map((url) => ({ type: "image", url }));
    }
    return [];
  });
}

function getItemAssetUrl(item) {
  if (["image", "video"].includes(item?.type)) return item.url || "";
  if (item?.type === "visual_ad") return item.visualAdData?.canvas?.backgroundUrl || "";
  return "";
}

function getVisualAdImageUrls(visualAdData = {}) {
  const urls = [];
  const backgroundUrl = visualAdData?.canvas?.backgroundUrl;
  if (backgroundUrl) urls.push(backgroundUrl);

  const elements = Array.isArray(visualAdData?.elements) ? visualAdData.elements : [];
  elements.forEach((element) => {
    if (element?.type === "image" && element.url) urls.push(element.url);
  });

  return Array.from(new Set(urls));
}

function normalizeTemplateData(data = {}) {
  return {
    title: String(data?.title || "").trim(),
    subtitle: String(data?.subtitle || "").trim(),
    body: String(data?.body || "").trim(),
    footer: String(data?.footer || "").trim(),
    cta: String(data?.cta || "").trim(),
  };
}

function normalizeTemplateKey(value) {
  const key = String(value || "").trim();
  return ["aviso", "promocion", "evento", "coffee", "bienvenida"].includes(key)
    ? key
    : "aviso";
}

function normalizeTemplateTheme(value) {
  const theme = String(value || "").trim();
  return ["azul", "verde", "dorado", "rojo", "cafe"].includes(theme)
    ? theme
    : "azul";
}

function normalizeWebSettings(settings = {}) {
  const reloadIntervalSeconds = Number(settings?.reloadIntervalSeconds);
  const zoom = Number(settings?.zoom);

  return {
    mode: settings?.mode === "redirect" ? "redirect" : "iframe",
    reloadIntervalSeconds:
      Number.isFinite(reloadIntervalSeconds) && reloadIntervalSeconds > 0
        ? Math.min(Math.round(reloadIntervalSeconds), 86400)
        : 0,
    zoom: Number.isFinite(zoom) ? Math.min(Math.max(Math.round(zoom), 50), 150) : 100,
    showStatusOverlay: settings?.showStatusOverlay === true,
    allowInteraction: settings?.allowInteraction === true,
    cacheBustOnReload: settings?.cacheBustOnReload === true,
    lastCommand: settings?.lastCommand || null,
  };
}

function buildWebPlaybackUrl(url = "", settings = {}, reloadNonce = 0) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !settings.cacheBustOnReload) return cleanUrl;

  try {
    const nextUrl = new URL(cleanUrl);
    nextUrl.searchParams.set("_signageTs", String(reloadNonce));
    return nextUrl.toString();
  } catch {
    const separator = cleanUrl.includes("?") ? "&" : "?";
    return `${cleanUrl}${separator}_signageTs=${reloadNonce}`;
  }
}

function getWebCommandSignature(command = null) {
  if (!command?.type) return "";
  const createdAt =
    command.createdAt?.toMillis?.() ||
    command.createdAt?.seconds ||
    command.createdAt ||
    "";
  return `${command.type}-${createdAt}-${command.createdBy || ""}`;
}

function normalizeVisualAdData(data = {}) {
  const canvas = data?.canvas || {};
  const elements = Array.isArray(data?.elements)
    ? data.elements
        .map(normalizeVisualElement)
        .filter((element) => element.type === "image" ? Boolean(element.url) : Boolean(element.text))
    : [];

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType: canvas.backgroundType === "image" ? "image" : "solid",
      backgroundUrl: String(canvas.backgroundUrl || "").trim(),
      backgroundStoragePath: String(canvas.backgroundStoragePath || "").trim(),
      backgroundColor: normalizeColor(canvas.backgroundColor, "#0f4fc4"),
    },
    elements,
  };
}

function normalizeVisualElement(element = {}) {
  const type = element.type === "image" ? "image" : "text";
  const baseElement = {
    id: String(element.id || ""),
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
      url: String(element.url || "").trim(),
      storagePath: String(element.storagePath || "").trim(),
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: clampNumber(element.borderRadius, 0, 100, 0),
    };
  }

  return {
    ...baseElement,
    text: String(element.text || "").trim(),
    fontSize: clampNumber(element.fontSize, 12, 160, 48),
    fontWeight: element.fontWeight === "bold" ? "bold" : "normal",
    color: normalizeColor(element.color, "#ffffff"),
    align: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

function isValidVisualAdData(visualAdData) {
  const canvas = visualAdData?.canvas || {};
  const hasBackground =
    canvas.backgroundType === "solid" ||
    (canvas.backgroundType === "image" && Boolean(canvas.backgroundUrl));
  const hasElements = Array.isArray(visualAdData?.elements) && visualAdData.elements.length > 0;
  return hasBackground || hasElements;
}

function normalizeColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function getVisualElementStyle(element) {
  if (element.type === "image") {
    return {
      left: `${clampNumber(element.x, 0, 100, 10)}%`,
      top: `${clampNumber(element.y, 0, 100, 10)}%`,
      width: `${clampNumber(element.width, 5, 100, 30)}%`,
      height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
      transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
      zIndex: clampNumber(element.zIndex, 0, 999, 1),
    };
  }

  const fontSize = clampNumber(element.fontSize, 12, 160, 48);

  return {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    color: element.color || "#ffffff",
    fontSize: `clamp(18px, ${fontSize / 18}vw, ${fontSize}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };
}

function compareVisualAdElements(first, second) {
  return (Number(first.zIndex) || 0) - (Number(second.zIndex) || 0);
}

function TemplateSlide({ item }) {
  const data = item?.templateData || {};
  const title = data.title || item?.title || "Contenido";
  const templateLabel = getTemplateLabel(item?.templateKey);

  return (
    <section className={`signage-template-slide ${item?.templateTheme || "azul"}`}>
      <div className="signage-template-content">
        <span className="signage-template-kicker">{templateLabel}</span>
        <h1>{title}</h1>
        {data.subtitle && <h2>{data.subtitle}</h2>}
        {data.body && <p>{data.body}</p>}
        {data.cta && <strong>{data.cta}</strong>}
        {data.footer && <small>{data.footer}</small>}
      </div>
    </section>
  );
}

function VisualAdSlide({ item, backgroundUrl = "" }) {
  const visualAdData = item?.visualAdData || {};
  const canvas = visualAdData.canvas || {};
  const elements = Array.isArray(visualAdData.elements) ? visualAdData.elements : [];
  const style = {
    backgroundColor: canvas.backgroundColor || "#0f4fc4",
    backgroundImage:
      canvas.backgroundType === "image" && backgroundUrl
        ? `url("${backgroundUrl}")`
        : "none",
  };

  return (
    <section className="signage-player-visual-ad" style={style}>
      {[...elements].sort(compareVisualAdElements).map((element, index) => (
        <div
          className={`signage-player-visual-element ${element.type === "image" ? "image" : "text"}`}
          key={element.id || `${item.assetId}-${index}`}
          style={getVisualElementStyle(element)}
        >
          {element.type === "image" ? (
            <img src={element.url} alt="" />
          ) : (
            element.text
          )}
        </div>
      ))}
    </section>
  );
}

function getTemplateLabel(templateKey) {
  const labels = {
    aviso: "Aviso",
    promocion: "Promoción",
    evento: "Evento",
    coffee: "Coffee Beans",
    bienvenida: "Bienvenida",
  };

  return labels[templateKey] || "Plantilla";
}

function resolveActiveCampaign(campaigns = [], device, nowMillis = Date.now()) {
  if (!device || device.active === false || !Array.isArray(campaigns)) return null;

  const applicableCampaigns = campaigns
    .filter((campaign) => isCampaignApplicable(campaign, device, nowMillis))
    .sort(compareCampaigns);

  return applicableCampaigns[0] || null;
}

function isCampaignApplicable(campaign, device, nowMillis) {
  if (!campaign || campaign.active === false || !campaign.playlistId) return false;
  if (!isPublished(campaign.publishStatus)) return false;
  if (!campaignMatchesDevice(campaign, device)) return false;
  if (!isCampaignWithinDateRange(campaign, nowMillis)) return false;
  return isCampaignWithinSchedule(campaign.schedule, nowMillis);
}

function campaignMatchesDevice(campaign, device) {
  const deviceIds = Array.isArray(campaign.deviceIds) ? campaign.deviceIds : [];
  const deviceId = device?.id || "";
  const deviceToken = device?.deviceToken || "";

  if (deviceIds.length > 0) {
    return deviceIds.includes(deviceId) || deviceIds.includes(deviceToken);
  }

  if (!campaign.plantel) return true;
  return String(campaign.plantel || "").trim() === String(device?.plantel || "").trim();
}

function isCampaignWithinDateRange(campaign, nowMillis) {
  const today = getDateKeyInTimezone(
    nowMillis,
    campaign?.schedule?.timezone || "America/Tijuana"
  );
  const startDate = String(campaign?.startDate || "").slice(0, 10);
  const endDate = String(campaign?.endDate || "").slice(0, 10);

  if (startDate && today < startDate) return false;
  if (endDate && today > endDate) return false;
  return true;
}

function isCampaignWithinSchedule(schedule, nowMillis) {
  if (schedule?.enabled !== true) return true;

  const daysOfWeek = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
  const timezone = schedule.timezone || "America/Tijuana";
  const localParts = getLocalTimeParts(nowMillis, timezone);
  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);

  if (!daysOfWeek.includes(localParts.dayOfWeek)) return false;
  if (startMinutes < 0 || endMinutes <= startMinutes) return false;
  return localParts.minutes >= startMinutes && localParts.minutes < endMinutes;
}

function compareCampaigns(first, second) {
  const priorityDiff = getCampaignPriorityWeight(second.priority) - getCampaignPriorityWeight(first.priority);
  if (priorityDiff !== 0) return priorityDiff;
  return getDateMillis(second.updatedAt) - getDateMillis(first.updatedAt);
}

function getDateMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.parse(value) || Number(value) || 0;
}

function getDateKeyInTimezone(nowMillis, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(nowMillis));
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}

function getLocalTimeParts(nowMillis, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(nowMillis));
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dayOfWeek: weekdayMap[valueByType.weekday] ?? new Date(nowMillis).getDay(),
    minutes:
      (Number(valueByType.hour || 0) % 24) * 60 +
      Number(valueByType.minute || 0),
  };
}

function timeToMinutes(value = "") {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

function getItemTimeoutMillis(item) {
  const durationSeconds = Number(item?.durationSeconds);
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : FALLBACK_DURATION_SECONDS;

  if (item?.type === "video") {
    return safeDuration * 1000 + VIDEO_SAFETY_BUFFER_MS;
  }

  return safeDuration * 1000;
}

function handleItemFailure(item, advanceToNext, setFailedItemKeys) {
  if (item?.key) {
    setFailedItemKeys((current) => {
      const next = new Set(current);
      next.add(item.key);
      return next;
    });
  }

  advanceToNext();
}

function isNavigatorOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function revokeObjectUrl(url) {
  if (!url || typeof window === "undefined" || !url.startsWith("blob:")) return;
  window.URL.revokeObjectURL(url);
}

function getPlayerNotice({ canUseStoredManifest, isOffline, isUsingCachedAsset }) {
  if (isOffline) return "Modo sin conexión";
  if (isUsingCachedAsset) return "Reproduciendo copia local";
  if (canUseStoredManifest) return "Reproduciendo última versión guardada";
  return "";
}

function getManifestStorageKey(deviceToken) {
  return `${MANIFEST_STORAGE_PREFIX}${String(deviceToken || "").trim()}`;
}

function readLastGoodManifest(deviceToken) {
  if (typeof window === "undefined" || !deviceToken) return null;

  try {
    const rawManifest = window.localStorage.getItem(getManifestStorageKey(deviceToken));
    if (!rawManifest) return null;

    const parsedManifest = JSON.parse(rawManifest);
    const items = normalizePlayableItems(parsedManifest?.items);

    if (!items.length || parsedManifest?.deviceToken !== deviceToken) {
      return null;
    }

    return {
      deviceToken,
      playlistId: String(parsedManifest?.playlistId || ""),
      campaignId: String(parsedManifest?.campaignId || ""),
      schedule: parsedManifest?.schedule || null,
      resolvedAt: String(parsedManifest?.resolvedAt || ""),
      source: parsedManifest?.source === "campaign" ? "campaign" : "devicePlaylist",
      items,
    };
  } catch {
    return null;
  }
}

function writeLastGoodManifest(deviceToken, manifest) {
  if (typeof window === "undefined" || !deviceToken) return;

  try {
    const items = normalizePlayableItems(manifest?.items);
    if (!items.length) return;

    window.localStorage.setItem(
      getManifestStorageKey(deviceToken),
      JSON.stringify({
        deviceToken,
        playlistId: String(manifest?.playlistId || ""),
        campaignId: String(manifest?.campaignId || ""),
        schedule: manifest?.schedule || null,
        resolvedAt: manifest?.resolvedAt || new Date().toISOString(),
        source: manifest?.source === "campaign" ? "campaign" : "devicePlaylist",
        items,
      })
    );
  } catch {
    // Reproductor debe seguir aunque localStorage este bloqueado o lleno.
  }
}
