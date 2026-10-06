import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgramUpdater, type UpdateStatus } from "./controller";
import { renderUpdater } from "./view";
import "./updater.css";
export function mountProgramUpdater(): void {
  if (!isTauri()) return;
  const host = document.createElement("aside"); host.className = "app-updater";
  host.setAttribute("aria-label", "Actualizaciones del programa"); document.body.append(host);
  const updater = new ProgramUpdater({
    action: action => invoke<UpdateStatus>("classroom_app_update", { action }),
    listen: async callback => listen<UpdateStatus>("classroom-app-update", event => callback(event.payload)),
  }, () => renderUpdater(host, updater));
  renderUpdater(host, updater);
  // No await: Library restore and activation do not wait for Internet.
  void updater.start();
  window.addEventListener("beforeunload", () => updater.destroy(), { once: true });
}
