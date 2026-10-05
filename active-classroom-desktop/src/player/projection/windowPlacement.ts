import { invoke } from "@tauri-apps/api/core";
import { availableMonitors, Window, type Monitor, type PhysicalPosition } from "@tauri-apps/api/window";
import type { ProjectionMonitor } from "./monitors.ts";

export interface PreparedProjection { operation: number; monitor: ProjectionMonitor }
export interface ProjectionPlacementApi {
  prepare(monitorId: string): Promise<PreparedProjection>;
  availableMonitors(): Promise<Monitor[]>;
  audience(): Promise<{ setFullscreenOnMonitor(position: PhysicalPosition): Promise<void> } | null>;
  activate(operation: number): Promise<void>;
  abort(operation: number): Promise<void>;
}
const nativePlacementApi: ProjectionPlacementApi = {
  prepare: (monitorId) => invoke("classroom_projection", { action: "prepare", data: { monitorId } }),
  availableMonitors,
  audience: () => Window.getByLabel("audience"),
  activate: (operation) => invoke("classroom_projection", { action: "activate", data: { operation } }),
  abort: (operation) => invoke("classroom_projection", { action: "abort", data: { operation } }),
};

export async function showProjectionOnMonitor(monitorId: string, api: ProjectionPlacementApi = nativePlacementApi): Promise<void> {
  const prepared = await api.prepare(monitorId); // Creates/reuses audience, still hidden.
  let fullscreenAccepted = false;
  try {
    const monitors = await api.availableMonitors();
    const selectedMonitor = monitors.find((monitor) =>
      (monitor.name || "Pantalla") === prepared.monitor.name &&
      monitor.position.x === prepared.monitor.x && monitor.position.y === prepared.monitor.y &&
      monitor.size.width === prepared.monitor.width && monitor.size.height === prepared.monitor.height &&
      monitor.scaleFactor === prepared.monitor.scaleFactor);
    if (!selectedMonitor) throw new Error("projection: Monitor desconectado o configuración cambiada");
    console.info("[Active Classroom Projection]", {
      event: "MONITOR_SELECTED", selectedMonitor: monitorId, name: selectedMonitor.name,
      position: { x: selectedMonitor.position.x, y: selectedMonitor.position.y },
      resolution: { width: selectedMonitor.size.width, height: selectedMonitor.size.height },
      scaleFactor: selectedMonitor.scaleFactor, primary: prepared.monitor.primary,
    });
    const audience = await api.audience();
    if (!audience) throw new Error("projection: Ventana del proyector ausente");
    await audience.setFullscreenOnMonitor(selectedMonitor.position);
    fullscreenAccepted = true;
    console.info("[Active Classroom Projection]", { event: "SET_FULLSCREEN_ON_MONITOR", selectedMonitor: monitorId, result: "ok" });
    // Rust rechecks the monitor and operation before showing. No generic fullscreen/position fallback.
    await api.activate(prepared.operation);
  } catch (error) {
    console.warn("[Active Classroom Projection]", { event: "PROJECTION_OPEN_FAILED", selectedMonitor: monitorId, fullscreenAccepted });
    await api.abort(prepared.operation).catch(() => {});
    throw error;
  }
}
