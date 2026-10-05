export interface ProjectionMonitor { id: string; name: string; primary: boolean; width: number; height: number; x: number; y: number; scaleFactor: number }
export interface ProjectionStatus { monitors: ProjectionMonitor[]; projecting: boolean; disconnected: boolean }
const preferenceKey = "active-classroom-projection-monitor";
export function preferredMonitor(monitors: ProjectionMonitor[], saved?: Partial<ProjectionMonitor>): ProjectionMonitor | undefined {
  if (monitors.length < 2) return;
  const exact = monitors.find((monitor) => monitor.id === saved?.id);
  if (exact) return exact;
  const matching = monitors.filter((monitor) => monitor.name === saved?.name && monitor.width === saved.width && monitor.height === saved.height);
  if (matching.length === 1) return matching[0];
  const sameName = monitors.filter((monitor) => monitor.name === saved?.name);
  if (sameName.length === 1) return sameName[0];
  return monitors.find((monitor) => !monitor.primary) || monitors[1];
}
export function readMonitorPreference(): Partial<ProjectionMonitor> | undefined {
  try { const data = JSON.parse(localStorage.getItem(preferenceKey) || "null"); return data && typeof data === "object" ? data : undefined; } catch { return; }
}
export function saveMonitorPreference(monitor: ProjectionMonitor): void { try { localStorage.setItem(preferenceKey, JSON.stringify(monitor)); } catch { /* Selection still works for this class. */ } }
