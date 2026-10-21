import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProjectionSnapshot } from "../ClassSessionController.ts";
import { ProjectionPlayer } from "./ProjectionPlayer.ts";
import "../player.css";
export async function mountProjection(root: HTMLElement): Promise<void> {
  document.body.classList.add("projection-window");
  const player = new ProjectionPlayer(root);
  const block = (event: KeyboardEvent) => { event.preventDefault(); event.stopPropagation(); };
  window.addEventListener("keydown", block, true);
  let received = false;
  const unlisten = await listen<ProjectionSnapshot | null>("classroom-projection", ({ payload }) => { received = true; void player.receive(payload); });
  void invoke<ProjectionSnapshot | null>("classroom_projection", { action: "read" }).then((snapshot) => { if (!received) return player.receive(snapshot); }).catch(() => {});
  window.addEventListener("beforeunload", () => { unlisten(); player.destroy(); window.removeEventListener("keydown", block, true); }, { once: true });
}
