import { normalizeDisplayName, type DeviceLabel } from "./device-label.ts";

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
export interface DeviceState { phase: "loading" | "activation" | "ready" | "revoked" | "error"; identity?: DeviceIdentity; code?: string; online: boolean; message: string }
export class DeviceSession {
  state: DeviceState = { phase: "loading", online: false, message: "" };
  private dependencies: DeviceDependencies;
  private notify: (state: DeviceState) => void;
  private pending?: Promise<void>;
  private signedIn = false;
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
    } catch { this.update({ phase: "error", message: "No se pudo acceder a la identidad segura del equipo. Solicita asistencia técnica." }); }
  }
  offline(): void { this.update({ online: false, message: this.state.phase === "ready" ? "Modo offline" : "Conecta Internet para activar este equipo." }); }
  connect(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.exchange().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async exchange(): Promise<void> {
    if (!this.state.identity) return;
    try {
      const response = await this.dependencies.exchange(await this.dependencies.proof());
      if (response.displayName !== undefined) await this.receiveLabel({ deviceId: this.state.identity.deviceId, displayName: response.displayName });
      if (response.status === "revoked") {
        // Block in memory immediately even if the keyring cannot persist this marker.
        this.signedIn = false;
        this.update({ phase: "revoked", online: true, code: undefined, identity: { ...this.state.identity, activated: false, revoked: true }, message: "Este equipo necesita activarse. Su autorización fue revocada." });
        await this.dependencies.mark("revoked");
        await this.dependencies.signOut();
      } else if (response.status === "pending") {
        this.signedIn = false;
        this.update({ phase: "activation", online: true, code: response.code, message: "Solicita al administrador autorizar este código." });
        if (this.state.identity?.activated) await this.dependencies.mark("revoked");
      } else {
        this.signedIn = false;
        await this.dependencies.signIn(response.customToken, this.owner);
        const identity = { ...await this.dependencies.mark("activated"), displayName: this.state.identity?.displayName };
        this.signedIn = true;
        this.update({ phase: "ready", identity, online: true, code: undefined, message: "" });
      }
    } catch {
      this.update({ online: false, message: this.state.phase === "ready" ? "Modo offline" : "No se pudo conectar. Reintenta cuando haya Internet." });
    }
  }
  async token(force = false): Promise<string> {
    if (this.state.phase !== "ready") throw new Error("Este equipo necesita activarse.");
    if (!this.signedIn) await this.connect();
    if (this.state.phase !== "ready" || !this.signedIn) throw new Error("Modo offline. Las clases descargadas siguen disponibles.");
    try { return await this.dependencies.token(this.owner, force); }
    catch {
      this.signedIn = false;
      await this.connect();
      if (this.state.phase !== "ready" || !this.signedIn) throw new Error("No se pudo renovar la conexión del equipo.");
      return this.dependencies.token(this.owner, true);
    }
  }
}
