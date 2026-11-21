import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminSignageControl,
  rebindSignageDevice,
} from "../../services/digital-signage/controlService";
import { toEpochMillis } from "../../utils/signageCapture";

const STATUS_POLL_MS = 10 * 1000;
const MONITOR_STATUS_POLL_MS = 5 * 1000;
const MONITOR_RENEW_MS = 15 * 1000;
const FRAME_MAX_AGE_MS = 20 * 1000;
const TELEMETRY_MAX_AGE_MS = 75 * 1000;

const STATE_LABELS = {
  playing: "Reproduciendo",
  loading: "Cargando",
  paused: "En pausa",
  error: "Error",
  unavailable: "No disponible",
};
const TYPE_LABELS = {
  image: "Imagen",
  video: "Video",
  web: "Web",
  template: "Plantilla",
  visual_ad: "Anuncio visual",
  room_layout: "Acomodo de salones",
};
const ORIGIN_LABELS = {
  cache: "Copia local (cache)",
  stream: "Red (stream)",
  mixed: "Mixto",
  unknown: "No confirmado",
};
const COMMAND_TYPE_LABELS = {
  refresh: "Recargar pantalla",
  web_reload: "Recargar web",
  web_scroll: "Desplazar web",
  web_navigate: "Navegar web",
};
const COMMAND_STATUS_LABELS = {
  pending: "Pendiente (la pantalla aun no lo reclama)",
  received: "Recibido por la pantalla, en ejecucion",
  executed: "Ejecutado",
  failed: "Fallo",
  expired: "Expirado",
};

const rowStyle = { display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, margin: 0 };
const actionsStyle = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 };
const errorStyle = { color: "#b42318", margin: "8px 0 0" };
const noticeStyle = { color: "#067647", margin: "8px 0 0" };
const mutedStyle = { color: "#667085", fontSize: 13, margin: "8px 0 0" };

function getErrorMessage(error) {
  return error?.message || "Ocurrio un error inesperado.";
}

function formatTime(millis) {
  return millis ? new Date(millis).toLocaleTimeString("es-MX") : "—";
}

function formatResult(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  return result.message || result.error || JSON.stringify(result);
}

function isJpegDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,");
}

function useIsVisible(ref) {
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden"
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  useEffect(() => {
    const handleVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return inView && pageVisible;
}

export default function SignageDeviceControl({ device, playlists = [] }) {
  const deviceId = device?.id || "";
  const rootRef = useRef(null);
  const mountedRef = useRef(true);
  const statusRequestRef = useRef(0);
  const visible = useIsVisible(rootRef);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [monitorSession, setMonitorSession] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [rebindCode, setRebindCode] = useState("");
  const [webPath, setWebPath] = useState("/");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!deviceId) return;
    statusRequestRef.current += 1;
    const requestId = statusRequestRef.current;

    try {
      const payload = await adminSignageControl({ action: "status", deviceId });
      if (!mountedRef.current || requestId !== statusRequestRef.current) return;
      setStatus(payload || null);
      setStatusError("");
    } catch (error) {
      if (!mountedRef.current || requestId !== statusRequestRef.current) return;
      setStatus(null);
      setStatusError(getErrorMessage(error));
    } finally {
      if (mountedRef.current && requestId === statusRequestRef.current) {
        setLoaded(true);
        setNow(Date.now());
      }
    }
  }, [deviceId]);

  const monitorOpen = Boolean(monitorSession);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Poll secuencial: 10s en reposo, 5s con monitor abierto, solo mientras el componente es visible.
  useEffect(() => {
    if (!visible || !deviceId) return undefined;

    let cancelled = false;
    let timerId = 0;
    const intervalMs = monitorOpen ? MONITOR_STATUS_POLL_MS : STATUS_POLL_MS;

    async function loop() {
      await fetchStatus();
      if (!cancelled) timerId = window.setTimeout(loop, intervalMs);
    }

    loop();

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [visible, deviceId, monitorOpen, fetchStatus]);

  // Lease del monitor: start/renew cada 15s y stop al cerrar, ocultar, desmontar o cambiar de dispositivo.
  useEffect(() => {
    if (!monitorSession || !visible || !deviceId) return undefined;

    let cancelled = false;
    let chain = Promise.resolve();
    const control = { deviceId, sessionId: monitorSession };

    const renew = () => {
      chain = chain
        .then(async () => {
          if (cancelled) return;
          try {
            await adminSignageControl({ action: "monitor_start", ...control });
            if (!cancelled) setMonitorError("");
          } catch (error) {
            if (!cancelled) setMonitorError(getErrorMessage(error));
          }
        })
        .catch(() => {});
    };

    renew();
    const renewId = window.setInterval(renew, MONITOR_RENEW_MS);

    return () => {
      cancelled = true;
      window.clearInterval(renewId);
      chain = chain
        .then(() => adminSignageControl({ action: "monitor_stop", ...control }))
        .catch(() => {});
    };
  }, [monitorSession, visible, deviceId]);

  async function runAction(key, task, successMessage) {
    setBusy(key);
    setActionError("");
    setNotice("");

    try {
      await task();
      if (mountedRef.current && successMessage) setNotice(successMessage);
    } catch (error) {
      if (mountedRef.current) setActionError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }

  function sendCommand(type, payload) {
    return runAction(
      `command-${type}`,
      async () => {
        await adminSignageControl({
          action: "command",
          deviceId,
          type,
          requestId: crypto.randomUUID(),
          ...(type.startsWith("web_") ? { sessionId: monitorSession } : {}),
          ...(payload ? { payload } : {}),
        });
        await fetchStatus();
      },
      "Comando enviado. El estado se confirma cuando la pantalla responda."
    );
  }

  function handleRefresh() {
    if (
      !window.confirm(
        "¿Recargar la pantalla? Volvera a obtener su configuracion y playlist sin reiniciar el navegador."
      )
    ) {
      return;
    }
    sendCommand("refresh");
  }

  function handleModeChange(event) {
    const nextMode = event.target.value;
    if (nextMode === (status?.mode || "cache")) return;

    const label = nextMode === "stream" ? "stream (sin copia local)" : "cache (copia local)";
    if (!window.confirm(`¿Cambiar el modo de la pantalla a ${label}? No se borran datos ya guardados.`)) {
      return;
    }

    runAction(
      "mode",
      async () => {
        await adminSignageControl({ action: "mode", deviceId, mode: nextMode });
        await fetchStatus();
      },
      "Modo configurado. Se confirma como aplicado cuando la telemetria de la pantalla lo reporte."
    );
  }

  function handleRebind(event) {
    event.preventDefault();
    const code = rebindCode.trim();
    if (!code) {
      setActionError("Ingresa el codigo que muestra la pantalla.");
      return;
    }
    if (
      !window.confirm(
        "¿Revincular este dispositivo con el codigo indicado? Se conserva su configuracion y playlist."
      )
    ) {
      return;
    }

    runAction(
      "rebind",
      async () => {
        await rebindSignageDevice(deviceId, code);
        if (mountedRef.current) setRebindCode("");
        await fetchStatus();
      },
      "Dispositivo revinculado."
    );
  }

  function handleToggleMonitor() {
    setMonitorError("");
    setMonitorSession(monitorSession ? "" : crypto.randomUUID());
  }

  function handleWebNavigate(event) {
    event.preventDefault();
    sendCommand("web_navigate", { path: webPath.trim() });
  }

  const enabled = status?.enabled === true;
  const lastSeenAt = toEpochMillis(status?.lastSeenAt || status?.telemetry?.updatedAt);
  const online = status?.online === true && lastSeenAt > now - TELEMETRY_MAX_AGE_MS;
  const telemetry = status?.telemetry || null;
  const telemetryAt = toEpochMillis(telemetry?.updatedAt);
  const telemetryFresh = Boolean(telemetry && telemetryAt && now - telemetryAt <= TELEMETRY_MAX_AGE_MS);
  const configuredMode = status?.mode || "cache";
  const appliedMode = telemetryFresh ? telemetry.appliedMode : "";
  const playlistName =
    telemetry?.playlistName ||
    playlists.find((playlist) => playlist.id === telemetry?.playlistId)?.name ||
    "";
  const monitor = status?.monitor || null;
  const sameSession = Boolean(monitorSession) && monitor?.sessionId === monitorSession;
  const capturedAt = toEpochMillis(monitor?.frame?.capturedAt);
  const frameFresh =
    capturedAt > 0 && now - capturedAt <= FRAME_MAX_AGE_MS && capturedAt - now <= FRAME_MAX_AGE_MS;
  const showFrame =
    monitorOpen && online && sameSession && monitor.expiresAt > now && isJpegDataUrl(monitor?.frame?.dataUrl) && frameFresh;
  const command = status?.command || null;
  const commandExpiresAt = toEpochMillis(command?.expiresAt);
  const commandOpen = command?.status === "pending" || command?.status === "received";
  const canControl = loaded && enabled && online && !busy;
  const canControlWeb =
    canControl && monitorOpen && sameSession && monitor.expiresAt > now && telemetryFresh && telemetry?.type === "web" && !commandOpen;

  return (
    <section className="signage-panel" ref={rootRef} aria-label="Control de la pantalla">
      <div className="signage-panel-heading">
        <div>
          <h2>Control de pantalla</h2>
          <p>{device?.name || "Dispositivo"}</p>
        </div>
      </div>

      {!loaded && <p style={mutedStyle}>Consultando estado...</p>}
      {statusError && (
        <p role="alert" style={errorStyle}>
          No se pudo consultar el estado: {statusError}
        </p>
      )}
      {loaded && status && !enabled && (
        <p style={mutedStyle}>
          Dispositivo legacy: el control remoto no esta habilitado. Revincula el dispositivo para activarlo.
        </p>
      )}
      {loaded && status && enabled && !online && (
        <p style={mutedStyle}>La pantalla está fuera de línea. Las órdenes de recarga pendientes caducan a los 120 segundos; no se muestra captura.</p>
      )}

      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <p style={rowStyle}>
          <strong>Conexion</strong>
          <span>{status ? (online ? "En linea" : "Fuera de linea") : "—"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Ultima comunicacion</strong>
          <span>{lastSeenAt ? new Date(lastSeenAt).toLocaleString("es-MX") : "—"}</span>
        </p>
        {telemetry && !telemetryFresh && (
          <p style={mutedStyle}>
            La ultima telemetria tiene mas de 75 s; no se muestra como estado actual.
          </p>
        )}
        <p style={rowStyle}>
          <strong>Estado</strong>
          <span>{telemetryFresh ? STATE_LABELS[telemetry.state] || telemetry.state || "—" : "—"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Contenido</strong>
          <span>{telemetryFresh ? telemetry.title || "—" : "—"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Tipo</strong>
          <span>{telemetryFresh ? TYPE_LABELS[telemetry.type] || telemetry.type || "—" : "—"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Playlist</strong>
          <span>{telemetryFresh ? playlistName || "—" : "—"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Posicion</strong>
          <span>
            {telemetryFresh && Number.isFinite(Number(telemetry.positionSeconds))
              ? `${Math.round(Number(telemetry.positionSeconds))} s`
              : "—"}
          </span>
        </p>
        <p style={rowStyle}>
          <strong>Modo configurado</strong>
          <span>{configuredMode === "stream" ? "Stream" : "Cache"}</span>
        </p>
        <p style={rowStyle}>
          <strong>Modo aplicado</strong>
          <span>
            {appliedMode
              ? appliedMode === "stream"
                ? "Stream"
                : "Cache"
              : "Sin confirmar"}
            {appliedMode && appliedMode !== configuredMode ? " (pendiente de aplicar)" : ""}
          </span>
        </p>
        <p style={rowStyle}>
          <strong>Origen real</strong>
          <span>{telemetryFresh ? ORIGIN_LABELS[telemetry.origin] || ORIGIN_LABELS.unknown : "—"}</span>
        </p>
        {telemetryFresh && telemetry.webUrl && (
          <p style={rowStyle}>
            <strong>URL web</strong>
            <span style={{ overflowWrap: "anywhere" }}>{telemetry.webUrl}</span>
          </p>
        )}
        {telemetryFresh && telemetry.error && (
          <p style={{ ...rowStyle, color: "#b42318" }}>
            <strong>Error</strong>
            <span>{telemetry.error}</span>
          </p>
        )}
      </div>

      {command && (
        <p style={mutedStyle}>
          Ultimo comando: {COMMAND_TYPE_LABELS[command.type] || command.type} —{" "}
          {COMMAND_STATUS_LABELS[command.status] || command.status}
          {commandOpen && commandExpiresAt
            ? commandExpiresAt > now
              ? ` (expira a las ${formatTime(commandExpiresAt)})`
              : " (expiro sin confirmacion de la pantalla)"
            : ""}
          {command.status === "expired" && commandExpiresAt ? ` a las ${formatTime(commandExpiresAt)}` : ""}
          {formatResult(command.result) ? `. ${formatResult(command.result)}` : ""}
        </p>
      )}

      <div style={actionsStyle}>
        <button type="button" className="visual-outline-button" onClick={handleRefresh} disabled={!loaded || !enabled || Boolean(busy) || commandOpen}>
          Recargar pantalla
        </button>
        <button
          type="button"
          className="visual-outline-button"
          onClick={handleToggleMonitor}
          disabled={!enabled && !monitorOpen}
        >
          {monitorOpen ? "Cerrar monitor" : "Ver pantalla"}
        </button>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Modo
          <select
            value={configuredMode}
            onChange={handleModeChange}
            disabled={!loaded || !enabled || Boolean(busy)}
          >
            <option value="cache">Cache</option>
            <option value="stream">Stream</option>
          </select>
        </label>
      </div>
      <p style={mutedStyle}>
        En modo stream la app no guarda copias, pero el navegador puede mantener su cache interna fuera de este
        control.
      </p>

      {monitorOpen && (
        <div style={{ marginTop: 12 }}>
          <strong>Monitor en vivo</strong>
          <div
            style={{
              marginTop: 8,
              background: "#000",
              aspectRatio: "16 / 9",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              textAlign: "center",
              padding: 8,
            }}
          >
            {showFrame ? (
              <img
                src={monitor.frame.dataUrl}
                alt="Captura real de la pantalla"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <span>
                {!online
                  ? "Pantalla fuera de linea: sin captura."
                  : sameSession && monitor?.captureError
                    ? monitor.captureError
                    : sameSession && monitor?.frame && !frameFresh
                      ? "Captura caducada; esperando la siguiente."
                      : "Esperando la primera captura (hasta ~10 s)..."}
              </span>
            )}
          </div>
          <p style={mutedStyle}>
            {showFrame ? `Captura de las ${formatTime(capturedAt)}. ` : ""}
            Solo se captura el contenido del reproductor (imagen, video, plantilla y anuncio). Las paginas web
            (iframe) no son compatibles con captura.
          </p>
          {monitorError && (
            <p role="alert" style={errorStyle}>
              Monitor: {monitorError}
            </p>
          )}

          {telemetryFresh && telemetry?.type === "web" && (
            <div style={{ marginTop: 8 }}>
              <div style={actionsStyle}>
                <button
                  type="button"
                  className="visual-outline-button"
                  disabled={!canControlWeb}
                  onClick={() => sendCommand("web_reload")}
                >
                  Recargar web
                </button>
                <button
                  type="button"
                  className="visual-outline-button"
                  disabled={!canControlWeb}
                  onClick={() => sendCommand("web_scroll", { direction: "up" })}
                >
                  Subir
                </button>
                <button
                  type="button"
                  className="visual-outline-button"
                  disabled={!canControlWeb}
                  onClick={() => sendCommand("web_scroll", { direction: "down" })}
                >
                  Bajar
                </button>
              </div>
              <form style={actionsStyle} onSubmit={handleWebNavigate}>
                <input
                  value={webPath}
                  onChange={(event) => setWebPath(event.target.value)}
                  placeholder="/ruta"
                  aria-label="Ruta relativa"
                />
                <button type="submit" className="visual-outline-button" disabled={!canControlWeb}>
                  Ir a ruta
                </button>
              </form>
              <p style={mutedStyle}>
                Scroll y navegacion solo funcionan si la web es del mismo origen y permite interaccion; si no, la
                pantalla reportara fallo.
              </p>
            </div>
          )}
        </div>
      )}

      <form style={{ ...actionsStyle, marginTop: 14 }} onSubmit={handleRebind}>
        <input
          value={rebindCode}
          onChange={(event) => setRebindCode(event.target.value.toUpperCase())}
          placeholder="Codigo de /signage/setup"
          aria-label="Codigo de revinculacion"
          disabled={Boolean(busy)}
        />
        <button type="submit" className="visual-outline-button" disabled={Boolean(busy) || !deviceId}>
          Revincular dispositivo
        </button>
      </form>

      {actionError && (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      )}
      {notice && <p style={noticeStyle}>{notice}</p>}
    </section>
  );
}
