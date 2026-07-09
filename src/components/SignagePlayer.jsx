import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  subscribeDeviceByToken,
  subscribePlaylist,
  updateDeviceHeartbeat,
} from "../services/digitalSignageService";

const HEARTBEAT_INTERVAL_MS = 45 * 1000;

export default function SignagePlayer() {
  const { deviceToken = "" } = useParams();
  const [deviceState, setDeviceState] = useState({ token: "", value: undefined });
  const [playlistState, setPlaylistState] = useState({
    playlistId: "",
    value: null,
    error: "",
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const heartbeatTokenRef = useRef(deviceToken);
  const device = deviceState.token === deviceToken ? deviceState.value : undefined;
  const assignedPlaylistId = device?.assignedPlaylistId || "";
  const playlist =
    playlistState.playlistId === assignedPlaylistId ? playlistState.value : null;
  const playlistError =
    playlistState.playlistId === assignedPlaylistId ? playlistState.error : "";

  const items = useMemo(
    () =>
      (playlist?.items || []).filter(
        (item) => item?.url && ["image", "video", "web"].includes(item.type)
      ),
    [playlist]
  );
  const safeCurrentIndex = items.length ? currentIndex % items.length : 0;
  const currentItem = items[safeCurrentIndex] || null;

  useEffect(() => {
    heartbeatTokenRef.current = deviceToken;

    return subscribeDeviceByToken(
      deviceToken,
      (nextDevice) => {
        setDeviceState({ token: deviceToken, value: nextDevice });
      },
      () => {
        setDeviceState({ token: deviceToken, value: null });
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
        setCurrentIndex(0);
      },
      () => {
        setPlaylistState({
          playlistId: device.assignedPlaylistId,
          value: null,
          error: "Sin contenido asignado",
        });
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

  useEffect(() => {
    if (!currentItem || currentItem.type === "video") return undefined;

    const timeoutId = window.setTimeout(() => {
      goNext(items.length, setCurrentIndex);
    }, Math.max(Number(currentItem.durationSeconds || 10), 1) * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [currentItem, items.length]);

  if (device === undefined) {
    return <PlayerMessage>Cargando contenido...</PlayerMessage>;
  }

  if (!device) {
    return <PlayerMessage>Dispositivo no registrado</PlayerMessage>;
  }

  if (device.active === false) {
    return <PlayerMessage>Dispositivo inactivo</PlayerMessage>;
  }

  if (!device.assignedPlaylistId || playlistError || !playlist || items.length === 0 || !currentItem) {
    return <PlayerMessage>Sin contenido asignado</PlayerMessage>;
  }

  return (
    <main className="signage-player-screen">
      <div className="signage-player-stage">
        {currentItem.type === "image" && (
          <img src={currentItem.url} alt={currentItem.title || "Contenido"} />
        )}

        {currentItem.type === "video" && (
          <video
            key={`${currentItem.assetId}-${safeCurrentIndex}`}
            src={currentItem.url}
            autoPlay
            muted
            playsInline
            controls={false}
            onEnded={() => goNext(items.length, setCurrentIndex)}
            onError={() => goNext(items.length, setCurrentIndex)}
          />
        )}

        {currentItem.type === "web" && (
          <iframe
            key={`${currentItem.assetId}-${safeCurrentIndex}`}
            src={currentItem.url}
            title={currentItem.title || "Contenido web"}
            allow="autoplay; fullscreen"
          />
        )}
      </div>
    </main>
  );
}

function PlayerMessage({ children }) {
  return (
    <main className="signage-player-screen">
      <div className="signage-player-message">
        <strong>{children}</strong>
      </div>
    </main>
  );
}

function goNext(length, setCurrentIndex) {
  if (!length) return;
  setCurrentIndex((current) => (current + 1) % length);
}
