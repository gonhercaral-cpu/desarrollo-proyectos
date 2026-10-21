import { ProgramUpdater, updateBusy } from "./controller.ts";
import { escapeHtml } from "../utils/dom.ts";
import type { StartupPreferences } from "../startup/controller.ts";
import { reconcileLibrary } from "../ui/library-dom.ts";
import { bindStableEvent } from "../utils/events.ts";
export function renderUpdater(host: HTMLElement, updater: ProgramUpdater, _preferences?: StartupPreferences, embedded = false, suppressDialog = false): void {
  const status = updater.status;
  const busy = updateBusy(status.phase);
  const available = !!status.newVersion && ["available", "failed"].includes(status.phase);
  const percent = status.total ? Math.min(100, Math.floor(100 * status.downloaded / status.total)) : undefined;
  if (updater.automatic) {
    reconcileLibrary(host, `<section class="startup-update" role="dialog" aria-modal="true" aria-labelledby="startup-update-title"><div class="ui-card"><img src="/active-classroom-icon.png" alt="" width="64"/><h2 id="startup-update-title">Actualizando Active Classroom</h2><p>Instalando versión ${escapeHtml(status.newVersion || "…")}…</p><p>Versión actual: ${escapeHtml(status.currentVersion)} · Nueva versión: ${escapeHtml(status.newVersion || "…")}</p><progress max="100" ${percent === undefined ? "" : `value="${percent}"`} aria-label="Descarga de actualización del programa"></progress><small>${percent === undefined ? "Preparando actualización…" : `${percent}%`}</small><p role="status" aria-live="polite">${escapeHtml(status.message)}</p></div></section>`);
    return;
  }
  reconcileLibrary(host, `<button class="button button-outline app-about" data-about aria-haspopup="dialog">Ajustes / Acerca de${status.phase === "available" ? " · Nueva versión" : ""}</button>${(updater.visible && !suppressDialog) || embedded ? `<section class="ui-card app-update-card" role="dialog" aria-modal="false" aria-labelledby="app-update-title"><h2 id="app-update-title">${available ? `Nueva versión disponible: ${escapeHtml(status.newVersion || "")}` : "Acerca de Active Classroom"}</h2><p>Versión instalada: <strong>${escapeHtml(status.currentVersion || "…")}</strong>${status.newVersion ? ` · Nueva versión: <strong>${escapeHtml(status.newVersion)}</strong>` : ""}</p><p role="status" aria-live="polite">${escapeHtml(status.message)}</p>${status.notes ? `<details open><summary>Notas de versión</summary><pre class="app-update-notes">${escapeHtml(status.notes)}</pre></details>` : ""}${["downloading", "verifying", "installing"].includes(status.phase) ? `<progress max="100" ${percent === undefined ? "" : `value="${percent}"`} aria-label="Descarga de actualización del programa"></progress><small>${percent === undefined ? "Descargando…" : `${percent}%`}</small>` : ""}<div class="ui-cluster"><button class="button button-outline" data-check ${busy || status.phase === "installed" ? "disabled" : ""}>Buscar actualizaciones</button>${available ? `<button class="button button-primary" data-install>Actualizar ahora</button>` : ""}${status.phase === "installed" ? `<button class="button button-primary" data-restart>Reiniciar Active Classroom</button>` : ""}<button class="button button-quiet" data-later ${busy ? "disabled" : ""}>Después</button></div><small>Actualiza el programa. Las Units se actualizan desde Biblioteca.</small></section>` : ""}`);
  host.querySelector<HTMLButtonElement>("[data-about]")!.onclick = () => { updater.show(); host.querySelector<HTMLButtonElement>("[data-check]")?.focus(); };
  bindStableEvent(host.querySelector<HTMLButtonElement>("[data-check]"), "click", () => { void updater.run("check"); });
  bindStableEvent(host.querySelector<HTMLButtonElement>("[data-install]"), "click", () => { void updater.run("install"); });
  bindStableEvent(host.querySelector<HTMLButtonElement>("[data-restart]"), "click", () => { void updater.run("restart"); });
  bindStableEvent(host.querySelector<HTMLButtonElement>("[data-later]"), "click", () => { updater.later(); });
}
