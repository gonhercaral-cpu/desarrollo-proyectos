import { PlayerController } from "./controller.ts";
import { initialRendererState, type RendererSource, type RendererState } from "./types.ts";
import { assertLocalUrl } from "./local-source.ts";

export interface ProjectionSnapshot {
  sessionId: string; revision: number; unitId: string; version: number;
  resourceId: string; slideIndex: number | null; page: number;
  source: RendererSource | null; playback: RendererState; updatedAt: number;
}

export function isProjectionSnapshot(value: unknown): value is ProjectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as ProjectionSnapshot;
  const integer = (number: number, minimum: number) => Number.isSafeInteger(number) && number >= minimum;
  const nonnegative = (number: number) => Number.isFinite(number) && number >= 0;
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
  try { assertLocalUrl(source.url); return true; } catch { return false; }
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
      source: this.source?.resourceId === this.selectedResourceId ? { ...this.source.value, name: "" } : null,
      playback: { ...this.playback }, updatedAt: Date.now(),
    };
  }
}
