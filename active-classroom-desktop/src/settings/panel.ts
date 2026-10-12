import { invoke, isTauri } from "@tauri-apps/api/core";
import { ProgramUpdater } from "../updater/controller.ts";
import { renderUpdater } from "../updater/view.ts";
import { StartupPreferences } from "../startup/controller.ts";
import { startupSettingsMarkup, bindStartupSettings } from "../startup/view.ts";
import { contentPreferences, saveContentPreferences, contentSettingsMarkup, bindContentSettings } from "../offline/content-preferences.ts";
import { desktopSettings, saveDesktopSettings } from "./preferences.ts";
import { SHORTCUT_ACTIONS, readShortcuts, shortcutLabel, combination, reservedShortcut, assignShortcut, restoreShortcuts, type ShortcutCommand } from "../player/shortcuts.ts";
import { readMonitorPreference, saveMonitorPreference, type ProjectionStatus } from "../player/projection/monitors.ts";
import { cacheStatistics } from "./statistics.ts";
import { escapeHtml as escape } from "../utils/dom.ts";
import { icon } from "../ui/icons.ts";
import "./settings.css";
const sections = { general: ["General", "settings"], content: ["Contenido", "download"], projector: ["Proyector", "projector"], appearance: ["Apariencia", "grid"], startup: ["Inicio", "play"], shortcuts: ["Atajos de teclado", "slides"], about: ["Acerca de", "info"] } as const;
type Section = keyof typeof sections;
export class DesktopSettingsPanel {
  private host = document.createElement("div");
  private section: Section = "general";
  private visible = false;
  private previousFocus?: HTMLElement;
  private capture?: ShortcutCommand;
  private conflict?: { command: ShortcutCommand; key: string; other: ShortcutCommand };
  private message = "";
  private monitors: ProjectionStatus["monitors"] = [];
  private updater: ProgramUpdater;
  private startup: StartupPreferences;
  constructor(updater: ProgramUpdater, startup: StartupPreferences) {
    this.updater = updater; this.startup = startup; this.host.className = "desktop-settings-host"; document.body.append(this.host);
    window.addEventListener("keydown", this.keydown, true);
    window.addEventListener("classroom-content-preferences", this.contentChanged);
  }
  open(section: Section = "general"): void {
    this.previousFocus = document.activeElement as HTMLElement; this.section = section; this.visible = true; this.capture = undefined; this.conflict = undefined; this.message = "";
    this.render(); this.host.querySelector<HTMLButtonElement>("[data-settings-close]")?.focus();
    void this.startup.run("status");
    if (isTauri()) void invoke<ProjectionStatus>("classroom_projection", { action: "monitors" }).then(status => { this.monitors = status.monitors; if (this.visible && this.section === "projector") this.render(); }).catch(() => {});
  }
  close(): void { this.visible = false; this.capture = undefined; this.host.replaceChildren(); this.previousFocus?.focus(); }
  refresh(): void { if (this.visible && !this.capture) this.render(); }
  destroy(): void { this.close(); window.removeEventListener("keydown", this.keydown, true); window.removeEventListener("classroom-content-preferences", this.contentChanged); this.host.remove(); }
  private contentChanged = () => { if (this.visible && ["general", "content"].includes(this.section)) this.render(); };
  private keydown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (this.capture) {
      event.stopImmediatePropagation(); event.preventDefault();
      if (event.isComposing || event.repeat) return;
      const key = combination(event); if (!key) return;
      if (reservedShortcut(key)) { this.message = "Combinación reservada por el sistema. Elige otra."; this.render(); return; }
      const command = this.capture; const result = assignShortcut(command, key);
      if (result.reserved) this.message = "Combinación no compatible. Elige otra.";
      else if (result.conflict) { this.conflict = { command, key, other: result.conflict }; this.message = `Este atajo ya está asignado a ${SHORTCUT_ACTIONS[result.conflict].label}.`; }
      else { this.capture = undefined; this.conflict = undefined; this.message = "Atajo guardado."; }
      this.render(); return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    if (event.key === "Tab") {
      const targets = [...this.host.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]")];
      const index = targets.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); targets.at(-1)?.focus(); }
      else if (!event.shiftKey && index === targets.length - 1) { event.preventDefault(); targets[0]?.focus(); }
    }
  };
  private content(): string {
    const settings = desktopSettings();
    const toggle = (key: string, label: string, detail: string, checked: boolean) => `<label class="settings-row"><span><strong>${label}</strong><small>${detail}</small></span><input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""}/></label>`;
    if (this.section === "general") return `<h2>General</h2><p>Configura el comportamiento de Active Classroom en este equipo.</p>${toggle("autoAppUpdate", "Actualizar automáticamente al iniciar la aplicación", "Busca e instala la última versión durante el inicio. Conserva tus datos.", settings.autoAppUpdate)}${contentSettingsMarkup()}${startupSettingsMarkup(this.startup)}`;
    if (this.section === "startup") return `<h2>Inicio</h2><p>Inicio de sesión Linux. Una sola instancia; proyector manual al abrir la clase.</p>${startupSettingsMarkup(this.startup)}${toggle("autoAppUpdate", "Actualizar automáticamente al iniciar", "Continúa con la versión instalada si estás offline.", settings.autoAppUpdate)}`;
    if (this.section === "content") {
      const stats = cacheStatistics(); const followed = contentPreferences().followedLevels;
      return `<h2>Contenido</h2>${contentSettingsMarkup()}<h3>Niveles disponibles sin conexión</h3><p>Se mantienen actualizados e incorporan Units nuevas. Selecciona un nivel en Biblioteca para añadirlo.</p>${followed.length ? followed.map(id => `<label class="settings-row"><span>${escape(stats.levels[id] || id)}</span><input type="checkbox" data-offline-level="${escape(id)}" checked/></label>`).join("") : "<p>No hay niveles seleccionados.</p>"}<h3>Almacenamiento local</h3><p>${stats.units} Units verificadas · ${(stats.bytes / 1024 / 1024).toFixed(1)} MiB en archivos activos, sin contar duplicados.</p><small>Las versiones nuevas se activan al cerrar la clase. Esta pantalla no elimina contenido.</small>`;
    }
    if (this.section === "projector") return `<h2>Proyector</h2><p>Proyección manual desde la clase. Reconexión segura; el proyector no se abre durante el arranque.</p>${toggle("rememberProjector", "Recordar última pantalla", "Conserva la selección actual entre clases y reinicios.", settings.rememberProjector)}<label class="settings-row"><span>Pantalla preferida</span><select data-preferred-monitor ${!this.monitors.length ? "disabled" : ""}>${this.monitors.length ? this.monitors.map(monitor => `<option value="${escape(monitor.id)}" ${monitor.id === readMonitorPreference()?.id ? "selected" : ""}>${escape(monitor.name)} · ${monitor.width}×${monitor.height} · ${monitor.primary ? "Principal" : "Secundaria"}</option>`).join("") : '<option>Sin pantallas disponibles</option>'}</select></label>`;
    if (this.section === "appearance") return `<h2>Apariencia</h2><p>Tema institucional Active Classroom.</p><label class="settings-row"><span>Densidad de Biblioteca</span><select data-density><option value="comfortable" ${settings.density === "comfortable" ? "selected" : ""}>Cómoda</option><option value="compact" ${settings.density === "compact" ? "selected" : ""}>Compacta</option></select></label>`;
    if (this.section === "shortcuts") {
      const map = readShortcuts();
      return `<h2>Atajos de teclado</h2><p>Selecciona una acción y presiona la nueva tecla o combinación. Espacio tiene acciones diferentes en presentación y multimedia.</p>${this.capture ? `<section class="shortcut-capture" role="status"><strong>Presiona la nueva tecla o combinación…</strong><p>${escape(SHORTCUT_ACTIONS[this.capture].label)}</p><button data-cancel-capture>Cancelar</button>${this.conflict ? '<button class="button button-primary" data-replace-shortcut>Reemplazar asignación</button><button data-another-shortcut>Elegir otra combinación</button>' : ""}</section>` : ""}${this.message ? `<p role="status">${escape(this.message)}</p>` : ""}<div class="settings-shortcuts">${Object.entries(SHORTCUT_ACTIONS).map(([command, action]) => `<label class="settings-row"><span>${escape(action.label)}<small>${action.context === "presentation" ? "Presentación" : action.context === "media" ? "Multimedia / recursos" : "Toda la clase"}</small></span><button data-shortcut="${command}">${escape(map[command as ShortcutCommand].map(shortcutLabel).join(" / ") || "Sin asignar")}</button></label>`).join("")}</div><button class="button button-outline" data-restore-shortcuts>Restaurar atajos predeterminados</button>`;
    }
    return `<h2>Acerca de Active Classroom</h2><p>Canal estable. Actualizaciones del programa independientes del contenido.</p><p>Última comprobación: ${escape(this.updater.lastChecked ? new Date(this.updater.lastChecked).toLocaleString("es") : "Sin registro")}</p><div data-settings-updater></div>`;
  }
  private render(): void {
    if (!this.visible) return;
    const focused = (document.activeElement as HTMLElement)?.dataset.settingsSection;
    this.host.innerHTML = `<div class="settings-backdrop"><section class="desktop-settings" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title" data-settings-dialog><header><h1 id="desktop-settings-title">${icon("settings")}Ajustes</h1><button data-settings-close aria-label="Cerrar ajustes">×</button></header><div class="settings-layout"><nav aria-label="Secciones de Ajustes">${Object.entries(sections).map(([id, [label, symbol]]) => `<button data-settings-section="${id}" aria-current="${this.section === id ? "page" : "false"}" class="${this.section === id ? "is-active" : ""}">${icon(symbol as Parameters<typeof icon>[0])}<span>${label}</span></button>`).join("")}</nav><main class="settings-content">${this.content()}</main></div></section></div>`;
    this.host.querySelector("[data-settings-close]")?.addEventListener("click", () => this.close());
    this.host.querySelectorAll<HTMLButtonElement>("[data-settings-section]").forEach(button => { button.onclick = () => { this.section = button.dataset.settingsSection as Section; this.capture = undefined; this.conflict = undefined; this.message = ""; this.render(); this.host.querySelector<HTMLButtonElement>(`[data-settings-section="${this.section}"]`)?.focus(); }; });
    bindContentSettings(this.host); bindStartupSettings(this.host, this.startup);
    this.host.querySelectorAll<HTMLInputElement>("[data-setting]").forEach(input => { input.onchange = () => { saveDesktopSettings({ [input.dataset.setting!]: input.checked }); }; });
    this.host.querySelector<HTMLSelectElement>("[data-density]")?.addEventListener("change", event => saveDesktopSettings({ density: (event.target as HTMLSelectElement).value as "compact" | "comfortable" }));
    this.host.querySelector<HTMLSelectElement>("[data-preferred-monitor]")?.addEventListener("change", event => { const monitor = this.monitors.find(item => item.id === (event.target as HTMLSelectElement).value); if (monitor) saveMonitorPreference(monitor); });
    this.host.querySelectorAll<HTMLInputElement>("[data-offline-level]").forEach(input => { input.onchange = () => { if (!window.confirm("¿Dejar de mantener este nivel actualizado? Las Units descargadas se conservan.")) { input.checked = true; return; } saveContentPreferences({ followedLevels: contentPreferences().followedLevels.filter(id => id !== input.dataset.offlineLevel) }); }; });
    this.host.querySelectorAll<HTMLButtonElement>("[data-shortcut]").forEach(button => { button.onclick = () => { this.capture = button.dataset.shortcut as ShortcutCommand; this.conflict = undefined; this.message = ""; this.render(); }; });
    this.host.querySelector("[data-cancel-capture]")?.addEventListener("click", () => { this.capture = undefined; this.conflict = undefined; this.message = ""; this.render(); });
    this.host.querySelector("[data-another-shortcut]")?.addEventListener("click", () => { this.conflict = undefined; this.message = ""; this.render(); });
    this.host.querySelector("[data-replace-shortcut]")?.addEventListener("click", () => { if (this.conflict) { assignShortcut(this.conflict.command, this.conflict.key, true); this.capture = undefined; this.conflict = undefined; this.message = "Atajo guardado; asignación anterior retirada."; this.render(); } });
    this.host.querySelector("[data-restore-shortcuts]")?.addEventListener("click", () => { if (window.confirm("¿Restaurar todos los atajos predeterminados?")) { restoreShortcuts(); this.render(); } });
    const about = this.host.querySelector<HTMLElement>("[data-settings-updater]"); if (about) renderUpdater(about, this.updater, undefined, true);
    if (focused) this.host.querySelector<HTMLButtonElement>(`[data-settings-section="${focused}"]`)?.focus();
  }
}
