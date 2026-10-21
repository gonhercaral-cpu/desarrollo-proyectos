import { DesktopSettingsPanel } from "../src/settings/panel.ts";
import { StartupPreferences } from "../src/startup/controller.ts";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { reconcileLibrary } from "../src/ui/library-dom.ts";
import { unitCard } from "../src/ui/library-view.ts";
import { scroll, observations } from "./media-browser.mjs";
async function run() {
  try {
    const manifest = await (await fetch("/fixture")).json();
    const root = document.querySelector("#app");
    const library = percent => `<div class="desktop-shell offline-shell"><section class="library-workspace"><main class="offline-content"><div class="unit-grid">${Array.from({ length: 32 }, (_, index) => unitCard({ unitId: `unit-${index}`, local: { ...manifest, unit: { ...manifest.unit, unitId: `unit-${index}` } }, remote: { unitId: `unit-${index}`, name: `Unit ${index}`, levelId: manifest.unit.levelId, version: 2 }, busy: index < 2, percent: index < 2 ? percent : 0, progressLabel: "Vídeo grande", disableSync: index < 2, opening: false, activating: false })).join("")}</div></main></section></div>`;
    reconcileLibrary(root, library(0));
    const grid = root.querySelector(".unit-grid"); const cards = [...root.querySelectorAll("[data-unit-card]")];
    const positions = cards.map(card => ({ top: card.getBoundingClientRect().top, left: card.getBoundingClientRect().left }));
    for (let percent = 1; percent <= 100; percent++) {
      reconcileLibrary(root, library(percent));
      if (grid !== root.querySelector(".unit-grid") || cards.some((card, index) => card !== root.querySelectorAll("[data-unit-card]")[index])) throw new Error("Biblioteca desmontada durante progreso");
      if (cards.some((card, index) => card.getBoundingClientRect().top !== positions[index].top || card.getBoundingClientRect().left !== positions[index].left)) throw new Error("Tarjetas cambiaron de posición durante descarga");
    }
    observations.push({ library: "32 Units", progressUpdates: 100, cardsPreserved: true, positionsPreserved: true });
    const startup = new StartupPreferences(async () => ({ autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false }), () => {});
    startup.status = { autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false };
    const updater = new ProgramUpdater({ action: async () => ({ phase: "current", currentVersion: "1.0.11", downloaded: 0, message: "Versión actual" }), listen: async () => () => {} }, () => {});
    updater.status.currentVersion = "1.0.11";
    const settings = new DesktopSettingsPanel(updater, startup);
    try {
      settings.open();
      for (const section of ["general", "content", "projector", "appearance", "startup", "shortcuts", "about"]) {
        document.querySelector(`[data-settings-section="${section}"]`).click();
        const modal = document.querySelector(".desktop-settings"); const body = document.querySelector(".settings-content");
        const rectangle = modal.getBoundingClientRect();
        if (rectangle.bottom > innerHeight || rectangle.right > innerWidth || rectangle.top < 0) throw new Error(`Ajustes fuera del viewport: ${section}`);
        body.scrollTop = body.scrollHeight;
        const last = body.lastElementChild;
        if (last && last.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1) throw new Error(`Ajuste final inaccesible: ${section}`);
      }
      observations.push({ settings: "7 secciones", lastControlsReachable: true, viewport: [innerWidth, innerHeight] });
    } finally { settings.destroy(); }
    await scroll(manifest);
    for (const count of [10, 50, 120]) await scroll(manifest, count, true);
    return { ok: true, observations };
  } catch (error) { return { ok: false, message: String(error), observations }; }
}
void run().then(result => window.webkit.messageHandlers.result.postMessage(JSON.stringify(result)));
