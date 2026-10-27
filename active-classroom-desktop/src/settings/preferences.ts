export interface DesktopSettings { version: 1; autoAppUpdate: boolean; rememberProjector: boolean; pauseBackgroundMusic: boolean; seekIntervalSeconds: number; audioSeekBackwardSeconds: number; audioSeekForwardSeconds: number; density: "comfortable" | "compact" }
export const SETTINGS_KEY = "active-classroom-settings:v1";
const AUDIO_SEEK_FIELDS = ["audioSeekBackwardSeconds", "audioSeekForwardSeconds"] as const;
const validSeconds = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 300;
export function desktopSettings(storage = globalThis.window?.localStorage || globalThis.localStorage): DesktopSettings {
  try {
    const value = JSON.parse(storage?.getItem(SETTINGS_KEY) || "{}"); const seekIntervalSeconds = validSeconds(value.seekIntervalSeconds) ? value.seekIntervalSeconds : 5;
    // Each audio field is validated on its own; an absent or invalid one inherits the video interval without touching the stored value.
    return { version: 1, autoAppUpdate: value.autoAppUpdate !== false, rememberProjector: value.rememberProjector !== false, pauseBackgroundMusic: value.pauseBackgroundMusic !== false, seekIntervalSeconds, audioSeekBackwardSeconds: validSeconds(value.audioSeekBackwardSeconds) ? value.audioSeekBackwardSeconds : seekIntervalSeconds, audioSeekForwardSeconds: validSeconds(value.audioSeekForwardSeconds) ? value.audioSeekForwardSeconds : seekIntervalSeconds, density: value.density === "compact" ? "compact" : "comfortable" };
  }
  catch { return { version: 1, autoAppUpdate: true, rememberProjector: true, pauseBackgroundMusic: true, seekIntervalSeconds: 5, audioSeekBackwardSeconds: 5, audioSeekForwardSeconds: 5, density: "comfortable" }; }
}
export function saveDesktopSettings(patch: Partial<DesktopSettings>, storage = globalThis.window?.localStorage || globalThis.localStorage): void {
  const current = desktopSettings(storage); const next: Partial<DesktopSettings> & Record<string, unknown> = { ...current, ...patch, version: 1 };
  let stored: Record<string, unknown> = {}; try { const raw = JSON.parse(storage?.getItem(SETTINGS_KEY) || "{}"); if (raw && typeof raw === "object") stored = raw; } catch { /* Unreadable storage is rewritten below. */ }
  // Unsaved audio fields stay absent so they keep inheriting, unless the video interval changes: then they keep the value they were inheriting.
  for (const field of AUDIO_SEEK_FIELDS) if (!(field in patch) && !validSeconds(stored[field]) && patch.seekIntervalSeconds === undefined) delete next[field];
  storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  applyDesktopSettings(); window.dispatchEvent(new window.Event("classroom-settings-changed"));
}
export function applyDesktopSettings(): void { if (globalThis.document) document.documentElement.dataset.desktopDensity = desktopSettings().density; }
