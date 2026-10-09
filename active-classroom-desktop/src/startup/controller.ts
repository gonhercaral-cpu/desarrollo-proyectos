import type { ProgramUpdater } from "../updater/controller.ts";

export interface InstalledUpdate { from: string; target: string }
export interface StartupSettings {
  autostart: boolean; kiosk: boolean; kioskActive: boolean; launchedAutomatically: boolean;
  installedUpdate?: InstalledUpdate | null;
}
export type StartupAction = "initialize" | "status" | "autostart" | "kiosk" | "exit-kiosk" | "library-ready" | "remember-update";
export class StartupPreferences {
  status?: StartupSettings;
  busy = false;
  error = "";
  private transport: (action: StartupAction, value?: boolean, target?: string) => Promise<StartupSettings>;
  private changed: () => void;
  constructor(transport: StartupPreferences["transport"], changed: () => void) { this.transport = transport; this.changed = changed; }
  async run(action: StartupAction, value?: boolean, target?: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true; this.error = ""; this.changed();
    try { this.status = await this.transport(action, value, target); return true; }
    catch { this.error = "No se pudo guardar o aplicar la configuración de inicio."; return false; }
    finally { this.busy = false; this.changed(); }
  }
}
export function newerStableVersion(current: string, next: string): boolean {
  const parse = (value: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split(".").map(Number) : undefined;
  const before = parse(current); const after = parse(next);
  if (!before || !after || [...before, ...after].some(value => !Number.isSafeInteger(value))) return false;
  for (let index = 0; index < 3; index++) if (before[index] !== after[index]) return after[index] > before[index];
  return false;
}
export class StartupUpdate {
  private started = false;
  async run(updater: ProgramUpdater, preferences: StartupPreferences, options: { online: boolean; canUpdate: () => boolean; timeoutMs?: number }): Promise<void> {
    if (this.started) return; this.started = true;
    if (!options.online || updater.status.phase === "unconfigured") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        updater.run("check").then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), options.timeoutMs ?? 4000); }),
      ]);
      if (!completed) { console.warn("[Active Classroom Startup] update-check-timeout; continuing locally"); return; }
      const status = updater.status;
      if (status.phase === "failed") { console.warn("[Active Classroom Startup] update-check-failed; continuing locally"); return; }
      const target = status.newVersion;
      if (status.phase !== "available" || !target || !newerStableVersion(status.currentVersion, target) || !preferences.status || !options.canUpdate()) return;
      const installed = preferences.status.installedUpdate;
      if (installed?.from === status.currentVersion && installed.target === target) {
        console.warn("[Active Classroom Startup] repeated-installed-version; automatic restart suppressed"); return;
      }
      updater.setAutomatic(true);
      await updater.run("install");
      if (updater.status.phase !== "installed") { console.warn("[Active Classroom Startup] update-install-failed; continuing locally"); return; }
      // Persist before restarting. A stale executable cannot reinstall forever.
      if (!await preferences.run("remember-update", undefined, target)) return;
      await updater.run("restart");
    } finally {
      clearTimeout(timer); updater.setAutomatic(false);
      if (updater.status.phase === "failed") updater.later();
    }
  }
}
