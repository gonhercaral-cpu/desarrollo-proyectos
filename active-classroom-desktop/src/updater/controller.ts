export type UpdatePhase = "idle" | "unconfigured" | "checking" | "available" | "current" | "downloading" | "verifying" | "installing" | "installed" | "failed";
export interface UpdateStatus {
  phase: UpdatePhase; currentVersion: string; newVersion?: string | null; notes?: string | null;
  downloaded: number; total?: number | null; message: string;
}
export interface UpdateTransport {
  action(action: "status" | "check" | "install" | "restart"): Promise<UpdateStatus>;
  listen(callback: (status: UpdateStatus) => void): Promise<() => void>;
}
export const updateBusy = (phase: UpdatePhase) => ["checking", "downloading", "verifying", "installing"].includes(phase);
export class ProgramUpdater {
  status: UpdateStatus = { phase: "idle", currentVersion: "", downloaded: 0, message: "Sin comprobar" };
  visible = false;
  automatic = false;
  private running = false;
  private unlisten?: () => void;
  private transport: UpdateTransport;
  private changed: () => void;
  constructor(transport: UpdateTransport, changed: () => void) { this.transport = transport; this.changed = changed; }
  private accept(status: UpdateStatus): void {
    this.status = status;
    if (status.phase === "available" || status.phase === "installed") this.visible = true;
    this.changed();
  }
  async start(check = true): Promise<void> {
    try {
      this.unlisten = await this.transport.listen(status => this.accept(status));
      this.accept(await this.transport.action("status"));
      if (check && this.status.phase !== "unconfigured") await this.run("check");
    } catch { this.failed("check"); }
  }
  show(): void { this.visible = true; this.changed(); }
  setAutomatic(active: boolean): void { this.automatic = active; this.changed(); }
  later(): void { if (!updateBusy(this.status.phase)) { this.visible = false; this.changed(); } }
  async run(action: "check" | "install" | "restart"): Promise<void> {
    if (this.running || updateBusy(this.status.phase) || (action === "restart" && this.status.phase !== "installed")) return;
    this.running = true;
    try { this.accept(await this.transport.action(action)); } catch { this.failed(action); }
    finally { this.running = false; }
  }
  private failed(action: "check" | "install" | "restart"): void {
    this.status = { ...this.status, phase: "failed", message: action === "check" ? "No se pudo buscar actualizaciones" : "No se pudo completar la actualización. Puedes seguir usando Active Classroom y reintentar." };
    if (action === "check") { this.status.newVersion = null; this.status.notes = null; }
    this.changed();
  }
  destroy(): void { this.unlisten?.(); }
}
