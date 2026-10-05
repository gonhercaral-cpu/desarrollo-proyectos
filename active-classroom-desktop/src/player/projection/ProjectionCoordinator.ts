import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ProjectionSnapshot } from "../ClassSessionController.ts";
import { preferredMonitor, readMonitorPreference, saveMonitorPreference, type ProjectionMonitor, type ProjectionStatus } from "./monitors.ts";
import { showProjectionOnMonitor } from "./windowPlacement.ts";

export interface ProjectionBridge { status(): Promise<ProjectionStatus>; show(monitorId: string): Promise<void>; hide(): Promise<void>; close?(sessionId: string): Promise<void>; publish(snapshot: ProjectionSnapshot): Promise<void> }
export const nativeProjectionBridge: ProjectionBridge = {
  status: () => invoke("classroom_projection", { action: "monitors" }),
  show: showProjectionOnMonitor,
  hide: () => invoke("classroom_projection", { action: "hide" }),
  close: (sessionId) => invoke("classroom_projection", { action: "close", data: { sessionId } }),
  publish: (snapshot) => invoke("classroom_projection", { action: "publish", data: snapshot }),
};
export class ProjectionCoordinator {
  monitors: ProjectionMonitor[] = [];
  selected?: ProjectionMonitor;
  projecting = false;
  message = "Sin segunda pantalla";
  private stopped = false;
  private polling = false;
  private pending?: ProjectionSnapshot;
  private sessionId = "";
  private sending = false;
  private toggling = false;
  private disconnected = false;
  private timer?: ReturnType<typeof setInterval>;
  private available: boolean;
  private changed: () => void;
  private bridge: ProjectionBridge;
  constructor(changed: () => void, bridge: ProjectionBridge = nativeProjectionBridge, available = isTauri()) { this.changed = changed; this.bridge = bridge; this.available = available; }
  start(): void { if (!this.available) return; void this.poll(); this.timer = setInterval(() => { void this.poll(); }, 1000); }
  async poll(): Promise<void> {
    if (this.stopped || this.polling || this.toggling || !this.available) return;
    this.polling = true;
    try {
      const status = await this.bridge.status(); if (this.stopped) return;
      if ((this.projecting && !status.projecting) || (this.monitors.length > 1 && status.monitors.length < 2)) this.disconnected = true;
      this.monitors = status.monitors; this.projecting = status.projecting;
      this.selected = preferredMonitor(this.monitors, readMonitorPreference() || this.selected);
      this.message = this.disconnected ? this.monitors.length > 1 ? "Segunda pantalla conectada · Restaurar proyección" : "Segunda pantalla desconectada" : this.monitors.length > 1 ? "Segunda pantalla conectada" : "Sin segunda pantalla";
      this.changed();
    } catch { if (!this.stopped) { this.message = "No se pudo consultar la salida de proyección."; this.changed(); } }
    finally { this.polling = false; }
  }
  async select(id: string): Promise<void> {
    const monitor = this.monitors.find((item) => item.id === id);
    if (!monitor || this.toggling || this.stopped) return;
    if (!this.projecting) { this.selected = monitor; saveMonitorPreference(monitor); this.changed(); return; }
    this.toggling = true;
    try {
      await this.bridge.show(monitor.id);
      if (this.stopped) { await (this.bridge.close ? this.bridge.close(this.sessionId) : this.bridge.hide()); return; }
      this.selected = monitor; saveMonitorPreference(monitor); this.disconnected = false;
    } catch {
      this.projecting = false; this.message = "No se pudo cambiar el monitor. Revisa la conexión y reintenta."; this.changed();
      return;
    } finally { this.toggling = false; }
    await this.poll();
  }
  async toggle(): Promise<void> {
    if (!this.available || this.stopped || this.toggling) return;
    this.toggling = true;
    try {
      if (this.projecting) { await this.bridge.hide(); this.projecting = false; }
      else if (this.selected && this.monitors.length > 1) { await this.bridge.show(this.selected.id); if (this.stopped) { await (this.bridge.close ? this.bridge.close(this.sessionId) : this.bridge.hide()); return; } saveMonitorPreference(this.selected); this.projecting = true; this.disconnected = false; }
      this.toggling = false; await this.poll();
    } catch { this.message = "No se pudo abrir el proyector. Revisa la conexión y reintenta."; this.changed(); }
    finally { this.toggling = false; }
  }
  update(snapshot: ProjectionSnapshot): void { if (!this.stopped && this.available) { this.sessionId = snapshot.sessionId; this.pending = snapshot; void this.flush(); } }
  private async flush(): Promise<void> {
    if (this.sending) return; this.sending = true;
    try { while (this.pending && !this.stopped) { const snapshot = this.pending; this.pending = undefined; await this.bridge.publish(snapshot); } }
    catch { if (!this.stopped) { this.message = "No se pudo actualizar el proyector. La clase local continúa."; this.changed(); } }
    finally { this.sending = false; }
  }
  destroy(): void {
    this.stopped = true; this.pending = undefined; clearInterval(this.timer);
    if (this.available) void (this.bridge.close ? this.bridge.close(this.sessionId) : this.bridge.hide()).catch(() => {});
  }
}
