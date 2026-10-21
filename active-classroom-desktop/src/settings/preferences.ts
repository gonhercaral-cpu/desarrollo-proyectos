export interface DesktopSettings { version: 1; autoAppUpdate: boolean; rememberProjector: boolean; pauseBackgroundMusic: boolean; seekIntervalSeconds: number; density: "comfortable" | "compact" }
export const SETTINGS_KEY = "active-classroom-settings:v1";
export function desktopSettings(storage = globalThis.window?.localStorage || globalThis.localStorage): DesktopSettings {
  try { const value = JSON.parse(storage?.getItem(SETTINGS_KEY) || "{}"); return { version: 1, autoAppUpdate: value.autoAppUpdate !== false, rememberProjector: value.rememberProjector !== false, pauseBackgroundMusic: value.pauseBackgroundMusic !== false, seekIntervalSeconds: Number.isSafeInteger(value.seekIntervalSeconds) && value.seekIntervalSeconds >= 1 && value.seekIntervalSeconds <= 300 ? value.seekIntervalSeconds : 5, density: value.density === "compact" ? "compact" : "comfortable" }; }
  catch { return { version: 1, autoAppUpdate: true, rememberProjector: true, pauseBackgroundMusic: true, seekIntervalSeconds: 5, density: "comfortable" }; }
}
export function saveDesktopSettings(patch: Partial<DesktopSettings>, storage = globalThis.window?.localStorage || globalThis.localStorage): void {
  const next = { ...desktopSettings(storage), ...patch, version: 1 };
  storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  applyDesktopSettings(); window.dispatchEvent(new window.Event("classroom-settings-changed"));
}
export function applyDesktopSettings(): void { if (globalThis.document) document.documentElement.dataset.desktopDensity = desktopSettings().density; }
