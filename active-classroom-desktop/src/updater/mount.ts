import { DesktopSettingsPanel } from "../settings/panel";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgramUpdater, type UpdateStatus } from "./controller";
import { renderUpdater } from "./view";
import "./updater.css";
import { setProgramUpdateVisual } from "../ui/shell";
import { StartupPreferences, type StartupAction, type StartupSettings } from "../startup/controller";
export async function mountProgramUpdater(): Promise<{ updater: ProgramUpdater; preferences: StartupPreferences } | undefined> {
  if (!isTauri()) return;
  const host = document.createElement("aside"); host.className = "app-updater";
  host.setAttribute("aria-label", "Actualizaciones del programa"); document.body.append(host);
  const render = () => { settings?.refreshUpdater(); renderUpdater(host, updater, preferences, false, settings?.isOpen); setProgramUpdateVisual(updater.status.phase === "available"); };
  const preferences = new StartupPreferences((action: StartupAction, value, target) => invoke<StartupSettings>("classroom_startup", { action, value, target }), () => { settings?.refresh(); });
  const updater: ProgramUpdater = new ProgramUpdater({
    action: action => invoke<UpdateStatus>("classroom_app_update", { action, startup: updater.automatic }),
    listen: async callback => listen<UpdateStatus>("classroom-app-update", event => callback(event.payload)),
  }, render);
  const settings = new DesktopSettingsPanel(updater, preferences, render);
  render();
  await updater.start(false);
  const openAbout = (event: Event) => {
    if ((event.target as Element | null)?.closest?.("[data-desktop-about]")) { settings?.open((event.target as Element).closest<HTMLElement>("[data-desktop-about]")?.dataset.desktopAbout === "settings" ? "general" : "about"); }
  };
  document.addEventListener("click", openAbout);
  window.addEventListener("beforeunload", () => { settings?.destroy(); updater.destroy(); document.removeEventListener("click", openAbout); }, { once: true });
  return { updater, preferences };
}
