import { normalizeDisplayName, type DeviceLabel } from "./device-label.ts";
import { connectionError, diagnose, type ConnectionStage } from "./connection.ts";
import { SyncError } from "./manifest.ts";

export interface DeviceIdentity { deviceId: string; name: string; displayName?: string; activated: boolean; revoked: boolean }
export interface DeviceProof { deviceId: string; name: string; credential: string }
export type DeviceResponse = ({ status: "pending"; code: string; expiresAt: number } | { status: "revoked" } | { status: "authorized"; customToken: string }) & { displayName?: string; deviceName?: string | null };
export interface DeviceDependencies {
  load(): Promise<DeviceIdentity>;
  proof(): Promise<DeviceProof>;
  mark(action: "activated" | "revoked"): Promise<DeviceIdentity>;
  exchange(proof: DeviceProof): Promise<DeviceResponse>;
  signIn(customToken: string, owner: string): Promise<void>;
  token(owner: string, force: boolean): Promise<string>;
  signOut(): Promise<void>;
  saveLabel(label: DeviceLabel): Promise<void>;
}
export interface DeviceState { phase: "loading" | "activation" | "ready" | "revoked" | "error"; identity?: DeviceIdentity; code?: string; online: boolean; message: string; issue?: string }
export class DeviceSession {
  state: DeviceState = { phase: "loading", online: false, message: "" };
  private dependencies: DeviceDependencies;
  private notify: (state: DeviceState) => void;
  private pending?: Promise<void>;
  private signedIn = false;
  private failure?: SyncError;
  constructor(dependencies: DeviceDependencies, notify: (state: DeviceState) => void) { this.dependencies = dependencies; this.notify = notify; }
  get owner(): string { return `ac-device-${this.state.identity?.deviceId || ""}`; }
  private update(patch: Partial<DeviceState>): void { this.state = { ...this.state, ...patch }; this.notify(this.state); }
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
    if (this.pending) return this.pending;
    this.pending = this.exchange().finally(() => { this.pending = undefined; });
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
      const response = await this.dependencies.exchange(proof);
      if (response.displayName !== undefined) await this.receiveLabel({ deviceId: this.state.identity.deviceId, displayName: response.displayName });
      if (response.status === "revoked") {
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
    } catch (error) { this.reportFailure(error, stage); }
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
