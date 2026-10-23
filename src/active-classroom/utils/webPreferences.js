import { normalizeLibraryPreferences } from "./libraryPreferences.js";
export const WEB_PREFERENCES_KEY = "active-classroom-web-preferences";
function normalize(value = {}) {
  const clean = normalizeLibraryPreferences({ ...value, viewMode: value.view || value.viewMode, sortMode: value.sort || value.sortMode });
  return { ...clean, view: clean.viewMode, sort: clean.sortMode };
}
export function readWebPreferences(userId) {
  try { return normalize(JSON.parse(localStorage.getItem(`${WEB_PREFERENCES_KEY}:${userId || "local"}`) || localStorage.getItem(WEB_PREFERENCES_KEY) || "{}")); }
  catch { return normalize(); }
}
export function writeWebPreferences(value, userId) {
  const next = normalize(value);
  try { localStorage.setItem(`${WEB_PREFERENCES_KEY}:${userId || "local"}`, JSON.stringify(next)); } catch { /* Preferences never block management. */ }
  window.dispatchEvent(new Event("classroom-web-preferences"));
  return next;
}
