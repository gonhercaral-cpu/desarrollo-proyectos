import { PlayerController } from "./controller.ts";
import { initialRendererState, type RendererSource, type RendererState } from "./types.ts";
import { assertLocalUrl } from "./local-source.ts";

export interface ProjectionSnapshot {
  sessionId: string; revision: number; unitId: string; version: number;
  resourceId: string; slideIndex: number | null; page: number; currentBuild?: number;
  source: RendererSource | null; playback: RendererState; updatedAt: number;
}

export function isProjectionSnapshot(value: unknown): value is ProjectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as ProjectionSnapshot;
  const integer = (number: number, minimum: number) => Number.isSafeInteger(number) && number >= minimum;
  const nonnegative = (number: number) => Number.isFinite(number) && number >= 0;
  if (data.currentBuild != null && (!integer(data.currentBuild, 0) || data.currentBuild > 50)) return false;
  if (typeof data.sessionId !== "string" || !data.sessionId || data.sessionId.length > 80 ||
      typeof data.unitId !== "string" || typeof data.resourceId !== "string" ||
      !integer(data.revision, 1) || !integer(data.version, 1) || !integer(data.page, 1) ||
      (data.slideIndex !== null && !integer(data.slideIndex, 0)) || !nonnegative(data.updatedAt)) return false;
  const state = data.playback;
  if (!state || typeof state.loading !== "boolean" || typeof state.playing !== "boolean" || typeof state.muted !== "boolean" ||
      typeof state.error !== "string" || !integer(state.page, 1) || !integer(state.pages, 0) ||
      !nonnegative(state.time) || !nonnegative(state.duration) || !nonnegative(state.volume) || state.volume > 1) return false;
  if (data.source === null) return true;
  const source = data.source;
  if (!source || typeof source.url !== "string" || typeof source.mimeType !== "string" ||
      typeof source.name !== "string" || !integer(source.sizeBytes, 0)) return false;
  try {
    assertLocalUrl(source.url);
    if (source.layers != null) {
      if (!Array.isArray(source.layers) || source.layers.length > 50) return false;
      for (const layer of source.layers) {
        if (!["text", "answer", "image"].includes(layer.type) || [layer.x, layer.y, layer.width, layer.height].some(value => !Number.isFinite(value) || value < 0 || value > 100) || layer.width <= 0 || layer.height <= 0 || layer.x + layer.width > 100 || layer.y + layer.height > 100) return false;
        if (layer.type === "image") { assertLocalUrl(layer.url || ""); }
        else if (typeof layer.text !== "string" || layer.text.length > 2000 || !/^#[a-fA-F0-9]{6}$/.test(layer.color || "") || !Number.isFinite(layer.fontSize) || Number(layer.fontSize) < 0.5 || Number(layer.fontSize) > 20) return false;
      }
    }
    return true;
  } catch { return false; }
}

// Teacher is the only session authority. Audience receives immutable snapshots.
export class ClassSessionController extends PlayerController {
  readonly sessionId = crypto.randomUUID();
  private revision = 0;
  private source?: { resourceId: string; value: RendererSource };
  playback = initialRendererState();
  projector = { projecting: false, connected: false, message: "Sin segunda pantalla" };
  record(state: RendererState, source?: RendererSource): void {
    this.playback = { ...state };
    this.source = source ? { resourceId: this.selectedResourceId, value: source } : undefined;
  }
  snapshot(): ProjectionSnapshot {
    return {
      sessionId: this.sessionId, revision: ++this.revision, unitId: this.manifest.unit.unitId, version: this.manifest.version,
      resourceId: this.selectedResourceId, slideIndex: this.slideIndex, page: this.page,
      currentBuild: this.currentBuild,
      source: this.source?.resourceId === this.selectedResourceId ? { ...this.source.value, name: "" } : null,
      playback: { ...this.playback }, updatedAt: Date.now(),
    };
  }
}
