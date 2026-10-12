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
    await scroll(manifest);
    for (const count of [10, 50, 120]) await scroll(manifest, count, true);
    return { ok: true, observations };
  } catch (error) { return { ok: false, message: String(error), observations }; }
}
void run().then(result => window.webkit.messageHandlers.result.postMessage(JSON.stringify(result)));
