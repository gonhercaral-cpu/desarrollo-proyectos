import type { StartupPreferences } from "./controller.ts";
import { escapeHtml } from "../utils/dom.ts";
export function startupSettingsMarkup(preferences: StartupPreferences): string {
  const state = preferences.status;
  return `<section class="startup-settings" aria-label="Inicio"><h3>Inicio</h3><label><input type="checkbox" data-autostart ${state?.autostart ? "checked" : ""} ${preferences.busy || !state ? "disabled" : ""}/> Abrir Active Classroom al iniciar la computadora</label><small>Se ejecuta al iniciar tu sesión Linux.</small><label><input type="checkbox" data-kiosk ${state?.kiosk ? "checked" : ""} ${preferences.busy || !state ? "disabled" : ""}/> Iniciar en modo kiosco</label><small>Ventana docente en pantalla completa durante el inicio automático.</small>${state?.kioskActive ? '<button class="button button-outline" data-exit-kiosk>Salir de modo kiosco</button>' : ""}${preferences.error ? `<p role="alert">${escapeHtml(preferences.error)}</p>` : ""}</section>`;
}
export function bindStartupSettings(host: HTMLElement, preferences: StartupPreferences): void {
  for (const [selector, action] of [["[data-autostart]", "autostart"], ["[data-kiosk]", "kiosk"]] as const) {
    host.querySelector<HTMLInputElement>(selector)?.addEventListener("change", event => { void preferences.run(action, (event.target as HTMLInputElement).checked); });
  }
  host.querySelector("[data-exit-kiosk]")?.addEventListener("click", () => { void preferences.run("exit-kiosk"); });
}
