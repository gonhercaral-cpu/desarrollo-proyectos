import { useEffect, useRef } from "react";
import {
  isSecureSignageToken,
  playerSignageExchange,
} from "../../services/digital-signage/controlService";
import { captureSignageStage, toEpochMillis } from "../../utils/signageCapture";
import { getSignageScopeKey } from "../../utils/signageCache";

const EXCHANGE_INTERVAL_MS = 10 * 1000;
const FIRST_FRAME_DELAY_MS = 1500;
const ACK_RETRY_MS = 2000;
const RECORD_RETENTION_MS = 60 * 60 * 1000;
const MAX_RECORDS = 50;
const MAX_RESULT_LENGTH = 300;
const COMMANDS_STORAGE_PREFIX = "signage:control:commands:";
const MODE_STORAGE_PREFIX = "signage:control:mode:";

function getStorages() {
  const storages = [];
  if (typeof window === "undefined") return storages;

  try {
    if (window.localStorage) storages.push(window.localStorage);
  } catch {
    // Storage bloqueado.
  }
  try {
    if (window.sessionStorage) storages.push(window.sessionStorage);
  } catch {
    // Storage bloqueado.
  }

  return storages;
}

function readStored(key) {
  for (const storage of getStorages()) {
    try {
      const raw = storage.getItem(key);
      if (raw) return raw;
    } catch {
      // Intenta el siguiente storage.
    }
  }
  return "";
}

function writeStored(key, value) {
  for (const storage of getStorages()) {
    try {
      storage.setItem(key, value);
      return;
    } catch {
      // Intenta el siguiente storage.
    }
  }
}

export function readStoredSignageMode(token) {
  const scopeKey = getSignageScopeKey(token);
  if (!scopeKey) return "cache";
  return readStored(`${MODE_STORAGE_PREFIX}${scopeKey}`) === "stream" ? "stream" : "cache";
}

function loadRecords(scopeKey) {
  try {
    const parsed = JSON.parse(readStored(`${COMMANDS_STORAGE_PREFIX}${scopeKey}`) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistRecords(scopeKey, records) {
  const cutoff = Date.now() - RECORD_RETENTION_MS;
  const entries = Object.entries(records)
    .filter(([, record]) => Number(record?.at) >= cutoff)
    .sort((first, second) => second[1].at - first[1].at)
    .slice(0, MAX_RECORDS);

  Object.keys(records).forEach((id) => delete records[id]);
  entries.forEach(([id, record]) => {
    records[id] = record;
  });

  writeStored(`${COMMANDS_STORAGE_PREFIX}${scopeKey}`, JSON.stringify(records));
}

function findPendingAck(records) {
  const cutoff = Date.now() - RECORD_RETENTION_MS;
  const entry = Object.values(records).find(
    (record) => record?.ack?.id && Number(record.at) >= cutoff
  );
  return entry?.ack || null;
}

function clampResult(value) {
  return String(value || "").slice(0, MAX_RESULT_LENGTH);
}

function parseMonitor(monitor) {
  const sessionId = String(monitor?.sessionId || "");
  const expiresAt = toEpochMillis(monitor?.expiresAt);
  return sessionId && expiresAt ? { sessionId, expiresAt } : null;
}

function safeCall(callback) {
  try {
    return callback?.() || null;
  } catch {
    return null;
  }
}

/**
 * Intercambio periodico (10s, secuencial) del player con el backend de control:
 * telemetria, comandos con ACK deduplicado y frames del monitor mientras el lease siga vivo.
 */
export default function useSignageControl({
  token,
  device,
  stageRef,
  getTelemetry,
  onRefresh,
  webControlRef,
  onModeChange,
}) {
  const enabled = Boolean(device) && device.active !== false && isSecureSignageToken(token);
  const latest = useRef({});

  useEffect(() => {
    latest.current = { stageRef, getTelemetry, onRefresh, webControlRef, onModeChange };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let timer = 0;
    let monitor = null;
    let framedSessionId = "";
    let lastCaptureAt = 0;
    const playerSessionId = crypto.randomUUID();
    let lastMode = readStoredSignageMode(token);
    const scopeKey = getSignageScopeKey(token);
    const records = loadRecords(scopeKey);
    let pendingAck = findPendingAck(records);

    function applyMode(mode) {
      if ((mode !== "cache" && mode !== "stream") || mode === lastMode) return;
      lastMode = mode;
      writeStored(`${MODE_STORAGE_PREFIX}${scopeKey}`, mode);
      latest.current.onModeChange?.(mode);
    }

    function recordResult(id, status, result) {
      const ack = { id, status, result: clampResult(result) };
      records[id] = { state: "done", at: Date.now(), ack };
      pendingAck = ack;
      persistRecords(scopeKey, records);
    }

    function confirmAck(id) {
      if (records[id]) {
        delete records[id].ack;
        persistRecords(scopeKey, records);
      }
      pendingAck = null;
    }

    async function executeCommand(command) {
      const context = latest.current;
      const payload = command.payload || {};

      if (command.type === "refresh") {
        if (typeof context.onRefresh !== "function") throw new Error("Refresco no disponible.");
        const message = await context.onRefresh();
        return typeof message === "string" && message ? message : "Configuracion y playlist actualizadas.";
      }

      if (["web_reload", "web_scroll", "web_navigate"].includes(command.type)) {
        const telemetry = safeCall(context.getTelemetry);
        if (!monitor || monitor.sessionId !== command.sessionId || monitor.expiresAt <= Date.now()) {
          throw new Error("La sesión de control ha finalizado.");
        }
        if (telemetry?.type !== "web" || telemetry.contentId !== payload.expectedContentId ||
          telemetry.webUrl !== payload.expectedWebUrl) {
          throw new Error("El contenido web cambió desde que se envió la orden.");
        }
        const control = context.webControlRef?.current;
        if (!control) throw new Error("La pantalla no esta mostrando contenido web seleccionado.");
        if (command.type === "web_reload") return control.reload();
        if (command.type === "web_scroll") return control.scroll(payload.direction);
        return control.navigate(payload.path);
      }

      throw new Error("Tipo de comando no soportado.");
    }

    async function handleCommand(command) {
      const id = String(command?.id || "");
      if (!id) return;

      // Un ID ya visto nunca se vuelve a ejecutar; solo se reintenta su ACK pendiente.
      if (records[id]) {
        if (records[id].ack && !pendingAck) pendingAck = records[id].ack;
        return;
      }

      const expiresAt = toEpochMillis(command.expiresAt);
      if (expiresAt && expiresAt <= Date.now()) {
        recordResult(id, "failed", "Comando expirado antes de ejecutarse.");
        return;
      }

      records[id] = { state: "executing", at: Date.now() };
      persistRecords(scopeKey, records);

      let status = "executed";
      let result;
      try {
        result = await executeCommand(command);
      } catch (error) {
        status = "failed";
        result = error?.message || "Error al ejecutar el comando.";
      }

      if (cancelled) return;
      recordResult(id, status, result);
    }

    async function tick() {
      if (cancelled) return;
      let nextDelay = EXCHANGE_INTERVAL_MS;
      const ackToSend = pendingAck;

      try {
        const context = latest.current;
        const telemetry = safeCall(context.getTelemetry);
        const payload = { playerSessionId };
        if (telemetry) payload.telemetry = telemetry;
        if (ackToSend) payload.ack = ackToSend;

        const leaseAlive = monitor && monitor.expiresAt > Date.now();
        const frameDue =
          leaseAlive &&
          (framedSessionId !== monitor.sessionId ||
            Date.now() - lastCaptureAt >= EXCHANGE_INTERVAL_MS - 500);

        if (frameDue) {
          payload.monitorSessionId = monitor.sessionId;
          const stage = context.stageRef?.current;
          if (stage) {
            const capture = await captureSignageStage({ stage, type: telemetry?.type });
            if (cancelled) return;
            if (capture.frame) payload.frame = capture.frame;
            else payload.captureError = capture.captureError;
          } else {
            payload.captureError = "El stage del reproductor no esta montado.";
          }
          lastCaptureAt = Date.now();
          framedSessionId = monitor.sessionId;
        }

        const response = await playerSignageExchange(token, payload);
        if (cancelled) return;

        if (ackToSend && pendingAck === ackToSend) confirmAck(ackToSend.id);
        applyMode(response?.mode);

        monitor = parseMonitor(response?.monitor);
        if (!monitor) framedSessionId = "";
        else if (monitor.sessionId !== framedSessionId) nextDelay = FIRST_FRAME_DELAY_MS;

        if (response?.command) {
          await handleCommand(response.command);
          if (cancelled) return;
          if (pendingAck) nextDelay = ACK_RETRY_MS;
        }
      } catch {
        if (cancelled) return;
        // Conserva el ACK hasta una respuesta del servidor, incluso tras una caída larga.
      }

      if (!cancelled) timer = window.setTimeout(tick, nextDelay);
    }

    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, token]);
}
