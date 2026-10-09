import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { ProjectionPlayer } from "../src/player/projection/ProjectionPlayer.ts";
import { convertFileSrc } from "@tauri-apps/api/core";
const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 5000; while (!check() && Date.now() < end) await delay(20); assert(check(), "Revelado nativo no llegó"); }
export async function interactiveSlides(fixture) {
  const root = document.querySelector("#app"), audience = document.querySelector("#audience");
  root.style.height = "700px";
  const follower = new ProjectionPlayer(audience);
  const snapshots = [];
  const bridge = { async status() { return { monitors: [], projecting: true, disconnected: false }; }, async show() {}, async hide() {}, async publish(snapshot) { snapshots.push(snapshot); await follower.receive(snapshot); } };
  const player = new ClassroomPlayer(root, { manifest: fixture.manifest, resolveResource(id) { const resource = fixture.manifest.resources.find(item => item.resourceId === id); return { path: fixture.paths[id], mimeType: resource.download.mimeType, name: resource.name, kind: "image" }; } }, () => {}, { verifyResource: async id => !!fixture.paths[id], projectionBridge: bridge });
  const previous = window.fetch;
  window.fetch = () => Promise.reject(new Error("Test offline: red bloqueada"));
  try {
    await until(() => root.querySelector(".player-image")?.naturalWidth > 0 && root.querySelector("[data-status]").hidden);
    const initialImage = root.querySelector(".player-image");
    root.querySelector("[data-renderer]").click();
    await until(() => player.controller.currentBuild === 1 && snapshots.at(-1)?.currentBuild === 1 && root.querySelector(".player-image").src === convertFileSrc(fixture.paths["state-1"]));
    assert(audience.querySelector(".player-image"), "Proyector sin imagen");
    const secondImage = root.querySelector(".player-image"); assert(initialImage === secondImage, "Revelado remontó imagen base");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await until(() => snapshots.at(-1)?.currentBuild === 2 && audience.querySelector(".player-image")?.src === root.querySelector(".player-image")?.src);
    assert(root.querySelector("[data-build]").textContent === "Paso 2 / 2", "Contador del profesor"); assert(!audience.querySelector("[data-build]"), "Indicador privado visible al alumnado");
    root.querySelector("[data-slide-previous]").click(); await until(() => snapshots.at(-1)?.currentBuild === 1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); await until(() => snapshots.at(-1)?.currentBuild === 0);
    root.querySelector("[data-slide-next]").click(); await until(() => snapshots.at(-1)?.currentBuild === 1);
    root.querySelector("[data-slide-next]").click(); await until(() => snapshots.at(-1)?.currentBuild === 2);
    root.querySelector("[data-slide-next]").click(); await until(() => player.controller.slideIndex === 1 && snapshots.at(-1)?.slideIndex === 1);
    assert(player.controller.currentBuild === 0, "Build no reinició al cambiar slide");
    return { pngBuilds: 2, clickKeyboardButtons: true, teacherProjector: true, offline: true, imageNotRemounted: true };
  } finally { window.fetch = previous; player.destroy(); follower.destroy(); root.style.height = ""; }
}
