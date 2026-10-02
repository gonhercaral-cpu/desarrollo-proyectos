import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { signInWithCustomToken } from "firebase/auth";
import { auth, logout, sessionToken } from "./auth";
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
      if (!response.ok) throw new Error("No se pudo conectar el equipo.");
      const data = (await response.json()).result as DeviceResponse;
      if (!data || !["authorized", "pending", "revoked"].includes(data.status)) throw new Error("Respuesta de activación inválida.");
      return data;
    },
    signIn: async (customToken, owner) => {
      const session = await signInWithCustomToken(auth, customToken);
      if (session.user.uid !== owner) { await logout(); throw new Error("Identidad de sesión inválida."); }
    },
    token: sessionToken,
    signOut: logout,
  }, notify);
}
