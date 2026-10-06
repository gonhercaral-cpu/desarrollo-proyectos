import { invoke } from "@tauri-apps/api/core";
import { saveMonitorPreference, readMonitorPreference } from "../src/player/projection/monitors.ts";
import { saveDeviceLabel, readDeviceLabel } from "../src/offline/device-label.ts";
async function run() {
  const stage = await invoke("acceptance_stage");
  const deviceId = "a".repeat(32);
  if (stage !== "restarted") {
    saveMonitorPreference({ id: "HDMI-1", name: "CI projector", primary: false, width: 1920, height: 1080, x: 1920, y: 0, scaleFactor: 1 });
    saveDeviceLabel(localStorage, { deviceId, displayName: "Nombre visible CI" });
  }
  const preferencesValid = readMonitorPreference()?.id === "HDMI-1" && readDeviceLabel(localStorage, deviceId) === "Nombre visible CI";
  await invoke("acceptance_ready", { preferencesValid });
}
void run().catch(error => { console.error("Updater fixture failed", String(error)); });
