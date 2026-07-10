import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  subscribeDeviceByToken,
  subscribePlaylist,
  updateDeviceHeartbeat,
} from "../services/digitalSignageService";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const FALLBACK_DURATION_SECONDS = 10;
const VIDEO_SAFETY_BUFFER_MS = 1500;

export default function SignagePlayer() {
  const { deviceToken = "" } = useParams();
  const [deviceState, setDeviceState] = useState({ token: "", value: undefined });
  const [playlistState, setPlaylistState] = useState({
    playlistId: "",
    value: null,
    error: "",
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackNonce, setPlaybackNonce] = useState(0);
  const [failedItemKeys, setFailedItemKeys] = useState(() => new Set());
  const [playerError, setPlayerError] = useState("");
  const heartbeatTokenRef = useRef(deviceToken);
  const device = deviceState.token === deviceToken ? deviceState.value : undefined;
  const assignedPlaylistId = device?.assignedPlaylistId || "";
  const playlist =
    playlistState.playlistId === assignedPlaylistId ? playlistState.value : null;
  const playlistError =
    playlistState.playlistId === assignedPlaylistId ? playlistState.error : "";

  const baseItems = useMemo(() => normalizePlayableItems(playlist?.items), [playlist]);
  const items = useMemo(() => {
    const availableItems = baseItems.filter((item) => !failedItemKeys.has(item.key));
    return availableItems.length > 0 ? availableItems : baseItems;
  }, [baseItems, failedItemKeys]);
  const allItemsFailed = baseItems.length > 0 && failedItemKeys.size >= baseItems.length;
  const safeCurrentIndex = items.length ? currentIndex % items.length : 0;
  const currentItem = items[safeCurrentIndex] || null;

  useEffect(() => {
    heartbeatTokenRef.current = deviceToken;

    return subscribeDeviceByToken(
      deviceToken,
      (nextDevice) => {
        setPlayerError("");
        setDeviceState({ token: deviceToken, value: nextDevice });
      },
      () => {
        setPlayerError("Error al cargar contenido");
      }
    );
  }, [deviceToken]);

  useEffect(() => {
    if (!device?.assignedPlaylistId || device.active === false) {
      return undefined;
    }

    return subscribePlaylist(
      device.assignedPlaylistId,
      (nextPlaylist) => {
        setPlaylistState({
          playlistId: device.assignedPlaylistId,
          value: nextPlaylist?.active === false ? null : nextPlaylist,
          error: "",
        });
        setPlayerError("");
        setCurrentIndex(0);
        setPlaybackNonce(0);
        setFailedItemKeys(new Set());
      },
      () => {
        setPlayerError("Error al cargar contenido");
        setPlaylistState({
          playlistId: device.assignedPlaylistId,
          value: null,
          error: "Sin contenido asignado",
        });
        setPlaybackNonce(0);
        setFailedItemKeys(new Set());
      }
    );
  }, [device?.assignedPlaylistId, device?.active]);

  useEffect(() => {
    if (!device?.id || device.active === false) return undefined;

    updateDeviceHeartbeat(device.id).catch(() => {});

    const intervalId = window.setInterval(() => {
      updateDeviceHeartbeat(heartbeatTokenRef.current || device.id).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [device?.id, device?.active]);

  const advanceToNext = useCallback(() => {
    if (items.length <= 1) {
      setPlaybackNonce((current) => current + 1);
      setCurrentIndex(0);
      return;
    }

    goNext(items.length, setCurrentIndex);
  }, [items.length]);

  useEffect(() => {
    if (!currentItem) return undefined;

    const timeoutId = window.setTimeout(() => {
      advanceToNext();
    }, getItemTimeoutMillis(currentItem));

    return () => window.clearTimeout(timeoutId);
  }, [advanceToNext, currentItem]);

  if (playerError) {
    return <PlayerMessage message={playerError} />;
  }

  if (device === undefined) {
    return <PlayerMessage message="Cargando contenido..." />;
  }

  if (!device) {
    return <PlayerMessage message="Dispositivo no registrado" />;
  }

  if (device.active === false) {
    return <PlayerMessage message="Dispositivo inactivo" />;
  }

  if (allItemsFailed) {
    return <PlayerMessage message="Error al cargar contenido" />;
  }

  if (!device.assignedPlaylistId || playlistError || !playlist || items.length === 0 || !currentItem) {
    return <PlayerMessage message="Sin contenido asignado" />;
  }

  return (
    <main className="signage-player-screen">
      <div className="signage-player-stage">
        {currentItem.type === "image" && (
          <img
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            src={currentItem.url}
            alt={currentItem.title || "Contenido"}
            onError={() => handleItemFailure(currentItem, advanceToNext, setFailedItemKeys)}
          />
        )}

        {currentItem.type === "video" && (
          <video
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            src={currentItem.url}
            autoPlay
            muted
            playsInline
            controls={false}
            onEnded={advanceToNext}
            onError={() => handleItemFailure(currentItem, advanceToNext, setFailedItemKeys)}
          />
        )}

        {currentItem.type === "web" && (
          <iframe
            key={`${currentItem.assetId}-${safeCurrentIndex}-${playbackNonce}`}
            src={currentItem.url}
            title={currentItem.title || "Contenido web"}
            allow="autoplay; fullscreen"
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

      return {
        assetId: String(item?.assetId || `item-${index}`),
        key: `${String(item?.assetId || `item-${index}`)}-${type}-${url}`,
        title: String(item?.title || "Contenido"),
        type,
        url,
        durationSeconds,
      };
    })
    .filter(
      (item) =>
        item.url &&
        ["image", "video", "web"].includes(item.type) &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds > 0
    );
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
