import { initialRendererState, type LocalRenderer, type RendererKind, type RendererOptions, type RendererSource, type RendererState, type PlayerCommand } from "../types.ts";

export abstract class BaseRenderer implements LocalRenderer {
  abstract kind: RendererKind;
  state = initialRendererState();
  options?: RendererOptions;
  disposed = false;
  abstract mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void>;
  notify(update: Partial<RendererState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...update }; this.options?.onState({ ...this.state });
  }
  command(_command: PlayerCommand): void | Promise<void> { /* Unsupported commands are safe no-ops. */ }
  setPage(_page: number): void | Promise<void> { /* Only PDF supports pages. */ }
  seek(_seconds: number): void { /* Only media supports seeking. */ }
  setVolume(_volume: number): void { /* Only media supports volume. */ }
  destroy(): void { this.disposed = true; this.options = undefined; }
}
