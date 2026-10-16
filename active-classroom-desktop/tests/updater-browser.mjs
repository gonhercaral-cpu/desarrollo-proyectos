import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { StartupPreferences, StartupUpdate } from "../src/startup/controller.ts";
import { saveMonitorPreference, readMonitorPreference } from "../src/player/projection/monitors.ts";
import { saveDeviceLabel, readDeviceLabel } from "../src/offline/device-label.ts";
async function run() {
  const stage = await invoke("acceptance_stage");
  const deviceId = "a".repeat(32);
  if (!stage.endsWith("restarted")) {
    saveMonitorPreference({ id: "HDMI-1", name: "CI projector", primary: false, width: 1920, height: 1080, x: 1920, y: 0, scaleFactor: 1 });
    saveDeviceLabel(localStorage, { deviceId, displayName: "Nombre visible CI" });
  }
  const preferencesValid = readMonitorPreference()?.id === "HDMI-1" && readDeviceLabel(localStorage, deviceId) === "Nombre visible CI";
  const preferences = new StartupPreferences((action, value, target) => invoke("classroom_startup", { action, value, target }), () => {});
  const require = (value, message) => { if (!value) throw new Error(message); };
  require(await preferences.run("initialize"), "Identidad/configuración inicial");
  require(preferences.status.autostart && preferences.status.kiosk, "Defaults después de activar");
  await invoke("acceptance_duplicate");
  require(await preferences.run("autostart", false), "Deshabilitar autostart");
  require(await preferences.run("initialize") && !preferences.status.autostart, "Opt-out conservado");
  require(await preferences.run("autostart", true), "Habilitar autostart");
  require(await preferences.run("kiosk", false), "Deshabilitar kiosco");
  require(await preferences.run("library-ready") && !preferences.status.kioskActive, "Kiosco deshabilitado");
  require(await preferences.run("kiosk", true), "Habilitar kiosco");
  const phases = [];
  const updater = new ProgramUpdater({
    action: action => action === "restart" ? invoke("acceptance_restart") : invoke("classroom_app_update", { action, startup: true }),
    listen: callback => listen("classroom-app-update", event => { phases.push(event.payload.phase); callback(event.payload); }),
  }, () => {});
  await updater.start(false);
  await new StartupUpdate().run(updater, preferences, { online: true, canUpdate: () => true });
  if (stage === "update") throw new Error("Instalación automática debía relanzar");
  await preferences.run("library-ready");
  await new Promise(resolve => setTimeout(resolve, 300));
  await preferences.run("exit-kiosk");
  await new Promise(resolve => setTimeout(resolve, 300));
  await preferences.run("status");
  require(preferences.status.kiosk && !preferences.status.kioskActive, "Salida temporal conserva preferencia");
  await preferences.run("library-ready");
  await new Promise(resolve => setTimeout(resolve, 300));
  const automaticValid = stage === "restarted" || stage === "current" || stage === "current-restarted"
    ? updater.status.phase === "current" && !phases.includes("downloading")
    : updater.status.phase === "failed";
  await invoke("acceptance_ready", { preferencesValid, automaticValid });
}
void run().catch(error => { console.error("Startup fixture failed", String(error)); });
