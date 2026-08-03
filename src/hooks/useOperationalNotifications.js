import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToUserNotifications } from "../services/notificationsService";

const SOUND_STORAGE_KEY = "dp.notificationSound.enabled";

function getMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readSoundPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "false";
}

function playNotificationTone(audioContextRef) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = context;
    if (context.state === "suspended") context.resume().catch(() => undefined);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(520, context.currentTime + 0.14);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.21);
  } catch {
    // Navegadores pueden bloquear audio antes de interacción. Sin ruido en consola.
  }
}

export default function useOperationalNotifications(userId) {
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [soundEnabled, setSoundEnabledState] = useState(readSoundPreference);
  const initializedRef = useRef(false);
  const knownIdsRef = useRef(new Set());
  const audioUnlockedRef = useRef(false);
  const audioContextRef = useRef(null);
  const sessionStartedAtRef = useRef(0);

  useEffect(() => {
    function unlockAudio() {
      audioUnlockedRef.current = true;
      const context = audioContextRef.current;
      if (context?.state === "suspended") context.resume().catch(() => undefined);
    }
    window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    initializedRef.current = false;
    knownIdsRef.current = new Set();
    sessionStartedAtRef.current = Date.now();
    if (!userId) return undefined;
    return subscribeToUserNotifications(userId, (items) => {
      setNotifications(items);
      if (!initializedRef.current) {
        items.forEach((item) => knownIdsRef.current.add(item.id));
        initializedRef.current = true;
        return;
      }
      const newItems = items.filter((item) => {
        if (knownIdsRef.current.has(item.id)) return false;
        knownIdsRef.current.add(item.id);
        return item.read !== true
          && item.actorId !== userId
          && getMillis(item.createdAt) >= sessionStartedAtRef.current - 3000;
      });
      if (newItems.length === 0) return;
      const visibleItems = newItems.slice(0, 3);
      setToasts((current) => [
        ...visibleItems.map((item) => ({ ...item, toastId: `${item.id}-${Date.now()}` })),
        ...current,
      ].slice(0, 4));
      const hasAudibleEvent = newItems.some((item) =>
        item.priority === "important"
        || item.priority === "urgent"
        || String(item.type || item.tipo || "").includes("assigned")
      );
      if (hasAudibleEvent && soundEnabled && audioUnlockedRef.current) {
        playNotificationTone(audioContextRef);
      }
    });
  }, [soundEnabled, userId]);

  const setSoundEnabled = useCallback((enabled) => {
    const nextValue = enabled === true;
    setSoundEnabledState(nextValue);
    window.localStorage.setItem(SOUND_STORAGE_KEY, String(nextValue));
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((item) => item.toastId !== toastId));
  }, []);

  return {
    notifications,
    unreadNotifications: notifications.filter((item) => item.read !== true),
    toasts,
    soundEnabled,
    setSoundEnabled,
    dismissToast,
  };
}
