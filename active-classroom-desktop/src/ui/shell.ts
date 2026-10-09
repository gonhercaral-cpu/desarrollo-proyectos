import { escapeHtml } from "../utils/dom.ts";
import { icon } from "./icons.ts";
import packageInfo from "../../package.json" with { type: "json" };
import "./shell.css";

import { levelName } from "../offline/levels.ts";
export { levelName, libraryLevelIds } from "../offline/levels.ts";
let updateAvailable = false;
export function setProgramUpdateVisual(available: boolean): void {
  updateAvailable = available;
  document.querySelectorAll<HTMLElement>("[data-program-badge]").forEach(element => { element.hidden = !available; });
}
export interface SidebarVisual {
  levels: string[]; selectedLevel: string; localOnly?: boolean; inClass?: boolean;
  deviceName: string; state: string; detail?: string; updatedAt?: number; busy?: boolean;
}
export function sidebarMarkup(model: SidebarVisual): string {
  const status = model.busy ? "Sincronizando" : model.state;
  const positive = status === "Sincronizado";
  const date = model.updatedAt ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(model.updatedAt) : "Todavía sin consultar";
  return `<aside class="classroom-sidebar" aria-label="Active Classroom">
    <div class="classroom-brand"><img src="/active-classroom-icon.png" alt=""/><div><strong>Active Classroom</strong><span>Enseña. Proyecta. Inspira.</span></div></div>
    <nav class="classroom-navigation" aria-label="Biblioteca y niveles">
      <button class="sidebar-link ${!model.localOnly && !model.inClass ? "is-active" : ""}" data-library-nav>${icon("library")}<span>Biblioteca</span></button>
      <button class="sidebar-link ${model.localOnly ? "is-active" : ""}" data-my-classes>${icon("calendar")}<span>Mis clases</span></button>
      <div class="sidebar-levels"><button class="sidebar-link" data-level="" aria-pressed="${!model.selectedLevel}">${icon("levels")}<span>Todos los niveles</span></button>
      ${model.levels.map(level => `<button class="sidebar-link ${level === model.selectedLevel ? "is-selected" : ""}" data-level="${escapeHtml(level)}" aria-pressed="${level === model.selectedLevel}">${icon("level")}<span>${escapeHtml(levelName(level))}</span></button>`).join("")}</div>
    </nav>
    <footer class="classroom-sidebar-footer">
      <section class="sidebar-sync" aria-label="Estado de sincronización"><span class="sidebar-status-dot ${positive ? "is-positive" : model.busy ? "is-busy" : "is-offline"}"></span><div><strong>${escapeHtml(status)}</strong><small>Última actualización<br>${escapeHtml(date)}</small><small class="sidebar-device" title="${escapeHtml(model.deviceName)}">${escapeHtml(model.deviceName)}</small>${model.detail ? `<span class="visually-hidden">${escapeHtml(model.detail)}</span>` : ""}</div><button class="sidebar-refresh" data-sidebar-refresh aria-label="Actualizar biblioteca" ${model.inClass || model.busy ? "disabled" : ""}>${icon("refresh", model.busy ? "is-spinning" : "")}</button></section>
      <section class="sidebar-settings" aria-label="Configuración"><button data-desktop-about="settings">${icon("settings")}<span>Ajustes</span>${icon("next")}</button><button data-desktop-about="about">${icon("info")}<span>Acerca de <i class="program-badge" data-program-badge ${updateAvailable ? "" : "hidden"}>Nueva versión</i></span>${icon("next")}</button></section>
      <small class="sidebar-version">v${escapeHtml(packageInfo.version)}</small>
    </footer></aside>`;
}
