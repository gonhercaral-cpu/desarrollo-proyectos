import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { auth, logout } from "./auth";
import { signInDevice, deviceIdToken } from "./firebase-session";
import { connectionError } from "./connection";
import { SyncError } from "./manifest";
import { API_BASE } from "./remote";
import { DeviceSession, type DeviceIdentity, type DeviceProof, type DeviceResponse, type DeviceState } from "./device-session";
import { readDeviceLabel, saveDeviceLabel } from "./device-label";

export function createDeviceSession(notify: (state: DeviceState) => void): DeviceSession {
  const native = <T>(action: string) => invoke<T>("classroom_device", { action });
  return new DeviceSession({
    load: async () => {
      const identity = await native<DeviceIdentity>("load");
      let displayName: string | undefined;
      try { displayName = readDeviceLabel(window.localStorage, identity.deviceId); } catch { /* Public metadata unavailable. */ }
      return { ...identity, displayName };
    },
    saveLabel: async (label) => saveDeviceLabel(window.localStorage, label),
    proof: () => native<DeviceProof>("proof"),
    mark: (action) => native<DeviceIdentity>(action),
    exchange: async (proof) => {
      const appVersion = await getVersion().catch(() => undefined);
      const response = await fetch(`${API_BASE}/activeClassroomDeviceSession`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { ...proof, appVersion } }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw connectionError(new SyncError(String(response.status), ""), "activation");
      const data = (await response.json()).result as DeviceResponse;
      if (!data || !["authorized", "pending", "revoked"].includes(data.status) || (data.status === "authorized" && typeof data.customToken !== "string")) throw new SyncError("server", "Respuesta de activación inválida.");
      return data;
    },
    signIn: (customToken, owner) => signInDevice(auth, customToken, owner),
    token: (owner, force) => deviceIdToken(auth, owner, force),
    signOut: logout,
  }, notify);
}
