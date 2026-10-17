import { normalizeDisplayName, type DeviceLabel } from "./device-label.ts";
import { connectionError, diagnose, type ConnectionStage } from "./connection.ts";
import { SyncError } from "./manifest.ts";

export interface DeviceIdentity { deviceId: string; cacheDeviceId?: string | null; name: string; displayName?: string; activated: boolean; revoked: boolean }
export interface DeviceProof { deviceId: string; name: string; credential: string; displayName?: string; registered?: boolean }
export type DeviceResponse = ({ status: "pending"; code: string; expiresAt: number } | { status: "revoked" } | { status: "rebind_required"; reason: string } | { status: "authorized"; customToken: string }) & { displayName?: string; deviceName?: string | null };
export interface DeviceDependencies {
  load(): Promise<DeviceIdentity>;
  proof(): Promise<DeviceProof>;
  mark(action: "activated" | "revoked"): Promise<DeviceIdentity>;
  exchange(proof: DeviceProof): Promise<DeviceResponse>;
  signIn(customToken: string, owner: string): Promise<void>;
  token(owner: string, force: boolean): Promise<string>;
  signOut(): Promise<void>;
  saveLabel(label: DeviceLabel): Promise<void>;
  resetBinding?(): Promise<DeviceIdentity>;
  detach?(proof: DeviceProof): Promise<void>;
}
export type DeviceLifecycle = "UNREGISTERED" | "PENDING_ACTIVATION" | "AUTHORIZED" | "REVOKED" | "REBIND_REQUIRED";
export interface DeviceState { phase: "loading" | "activation" | "ready" | "revoked" | "rebind" | "error"; lifecycle?: DeviceLifecycle; identity?: DeviceIdentity; code?: string; online: boolean; message: string; issue?: string }
export class DeviceSession {
  state: DeviceState = { phase: "loading", lifecycle: "UNREGISTERED", online: false, message: "" };
  private dependencies: DeviceDependencies;
  private notify: (state: DeviceState) => void;
  private pending?: Promise<void>;
  private resetting?: Promise<void>;
  private automaticRebind = false;
  private signedIn = false;
  private failure?: SyncError;
  constructor(dependencies: DeviceDependencies, notify: (state: DeviceState) => void) { this.dependencies = dependencies; this.notify = notify; }
  get owner(): string { return `ac-device-${this.state.identity?.deviceId || ""}`; }
  get cacheOwner(): string { return `ac-device-${this.state.identity?.cacheDeviceId || this.state.identity?.deviceId || ""}`; }
  private update(patch: Partial<DeviceState>): void { this.state = { ...this.state, ...patch }; this.state.lifecycle = ({ loading: "UNREGISTERED", activation: "PENDING_ACTIVATION", ready: "AUTHORIZED", revoked: "REVOKED", rebind: "REBIND_REQUIRED", error: "UNREGISTERED" } as const)[this.state.phase]; this.notify(this.state); }
  private async requireRebind(): Promise<void> {
    this.signedIn = false;
    this.update({ phase: "rebind", online: false, code: undefined, identity: this.state.identity ? { ...this.state.identity, activated: false, revoked: true } : undefined, message: "Este equipo necesita volver a vincularse. Las clases descargadas y preferencias se conservan." });
    await this.dependencies.signOut().catch(() => {});
    await this.dependencies.mark("revoked").catch(() => {});
  }
  resetBinding(online: boolean): Promise<void> {
    return this.resetting ||= this.performReset(online).finally(() => { this.resetting = undefined; });
  }
  private async performReset(online: boolean): Promise<void> {
    await this.pending;
    this.automaticRebind = false;
    if (!this.dependencies.resetBinding) throw new Error("Recuperación de vinculación no disponible.");
    const label = this.state.identity?.displayName;
    this.signedIn = false; this.update({ phase: "loading", online: false, code: undefined, message: "Restableciendo vinculación…" });
    // Best effort remote retirement; offline recovery must remain possible.
    if (online && this.dependencies.detach) try { await this.dependencies.detach(await this.dependencies.proof()); } catch { diagnose("activation", "failed", "backend"); }
    await this.dependencies.signOut().catch(() => {});
    try {
      const identity = await this.dependencies.resetBinding();
      this.update({ identity: { ...identity, displayName: label }, phase: "activation", online: false, issue: undefined, message: "Conecta Internet para obtener un nuevo código de vinculación." });
      if (label !== undefined) await this.dependencies.saveLabel({ deviceId: identity.deviceId, displayName: label }).catch(() => {});
      if (online) await this.exchange();
    } catch (error) { this.reportFailure(error, "identity"); this.update({ phase: "rebind" }); }
  }
  async receiveLabel(label: DeviceLabel): Promise<void> {
    if (!this.state.identity || label.deviceId !== this.state.identity.deviceId) return;
    let displayName: string;
    try { displayName = normalizeDisplayName(label.displayName); } catch { return; }
    if (displayName === this.state.identity.displayName) return;
    // A missing/full WebView metadata store must never rotate identity or block local classes.
    await this.dependencies.saveLabel({ deviceId: label.deviceId, displayName }).catch(() => {});
    this.update({ identity: { ...this.state.identity, displayName } });
  }
  async start(online: boolean): Promise<void> {
    try {
      const identity = await this.dependencies.load();
      this.update({ identity, phase: identity.revoked ? "revoked" : identity.activated ? "ready" : "activation", online: false });
      if (online) await this.connect();
    } catch (error) { this.reportFailure(error, "identity"); this.update({ phase: "error" }); }
  }
  offline(): void { this.reportFailure(new SyncError("offline", ""), "activation"); }
  connected(): void { this.failure = undefined; this.update({ online: true, issue: undefined, message: "" }); }
  reportFailure(error: unknown, stage: ConnectionStage): void {
    this.failure = connectionError(error, stage);
    diagnose(stage, "failed", this.failure.code);
    this.update({ online: false, issue: this.failure.code, message: this.failure.message });
  }
  connect(): Promise<void> {
    if (this.resetting) return this.resetting;
    if (this.pending) return this.pending;
    this.pending = this.exchange().finally(() => {
      this.pending = undefined;
      if (this.automaticRebind && !this.resetting) { this.automaticRebind = false; void this.resetBinding(true); }
    });
    return this.pending;
  }
  async revalidateAccess(): Promise<void> {
    await this.connect();
    if (this.state.phase === "revoked") throw new SyncError("403", "La autorización de este equipo fue revocada.");
    if (this.state.phase !== "ready") throw new SyncError("not-activated", "Este equipo necesita activarse.");
  }
  private async exchange(): Promise<void> {
    if (!this.state.identity) return;
    let stage: ConnectionStage = "identity";
    try {
      const proof = await this.dependencies.proof();
      stage = "activation";
      const response = await this.dependencies.exchange({ ...proof, ...(this.state.identity.displayName !== undefined ? { displayName: this.state.identity.displayName } : {}) });
      if (response.displayName !== undefined) await this.receiveLabel({ deviceId: this.state.identity.deviceId, displayName: response.displayName });
      if (response.status === "rebind_required") {
        await this.requireRebind();
        this.automaticRebind = ["DEVICE_UNLINKED", "DEVICE_NOT_FOUND"].includes(response.reason);
      } else if (response.status === "revoked") {
        // Block in memory immediately even if the keyring cannot persist this marker.
        this.signedIn = false;
        this.failure = new SyncError("403", "La autorización de este equipo fue revocada.");
        diagnose(stage, "revoked", "403");
        this.update({ phase: "revoked", online: true, issue: "403", code: undefined, identity: { ...this.state.identity, activated: false, revoked: true }, message: "Este equipo necesita activarse. Su autorización fue revocada." });
        await this.dependencies.mark("revoked");
        await this.dependencies.signOut();
      } else if (response.status === "pending") {
        this.signedIn = false;
        diagnose(stage, "pending", "not-activated");
        this.update({ phase: "activation", online: true, issue: "not-activated", code: response.code, message: "Solicita al administrador autorizar este código." });
        if (this.state.identity?.activated) await this.dependencies.mark("revoked");
      } else {
        this.signedIn = false;
        stage = "sign-in";
        await this.dependencies.signIn(response.customToken, this.owner);
        stage = "token";
        // An activation marker is not a Firebase session. Verify ID-token issuance before announcing connectivity.
        await this.dependencies.token(this.owner, false);
        stage = "identity";
        const identity = { ...await this.dependencies.mark("activated"), displayName: this.state.identity?.displayName };
        this.signedIn = true;
        this.failure = undefined;
        diagnose("token", "authenticated");
        this.update({ phase: "ready", identity, online: true, issue: undefined, code: undefined, message: "" });
      }
    } catch (error) {
      if (error instanceof SyncError && ["DEVICE_REVOKED", "DEVICE_NOT_FOUND", "DEVICE_UNLINKED", "INVALID_DEVICE_CREDENTIAL"].includes(error.code)) { await this.requireRebind(); return; }
      this.reportFailure(error, stage);
    }
  }
  async token(force = false): Promise<string> {
    if (this.state.phase !== "ready") throw new SyncError(this.state.phase === "revoked" ? "403" : "not-activated", this.state.message || "Este equipo necesita activarse.");
    if (!this.signedIn) await this.connect();
    if (this.state.phase !== "ready" || !this.signedIn) throw this.failure || new SyncError("auth", "No se pudo autenticar el equipo.");
    try { return await this.dependencies.token(this.owner, force); }
    catch (error) {
      this.reportFailure(error, "token");
      this.signedIn = false;
      await this.connect();
      if (this.state.phase !== "ready" || !this.signedIn) throw this.failure || new SyncError("auth", "No se pudo renovar la conexión del equipo.");
      try { return await this.dependencies.token(this.owner, true); }
      catch (renewalError) { this.reportFailure(renewalError, "token"); throw this.failure; }
    }
  }
}
