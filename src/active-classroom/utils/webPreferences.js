export const WEB_PREFERENCES_KEY = "active-classroom-web-preferences";
export function readWebPreferences() { try { const value = JSON.parse(localStorage.getItem(WEB_PREFERENCES_KEY) || "{}"); return { view: value.view === "list" ? "list" : "grid", sort: value.sort === "date" ? "date" : "name" }; } catch { return { view: "grid", sort: "name" }; } }
