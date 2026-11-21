import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const control = httpsCallable(functions, "signageControl");
const exchange = httpsCallable(functions, "signagePlayerExchange");
const pairing = httpsCallable(functions, "signagePairing");
const recentExchanges = new Map();

export function isSecureSignageToken(token) {
  return /^ds2_[a-f0-9]{64}$/.test(String(token || ""));
}

export async function adminSignageControl(data) {
  return (await control(data)).data;
}

export async function playerSignageExchange(token, data = {}) {
  // Device configuration subscriptions reuse the authenticated telemetry exchange.
  // The player still receives updates while idle, without two polling channels.
  const recent = recentExchanges.get(token);
  if (data.readOnly && !data.forceRead && recent && Date.now() - recent.at < 15000) return recent.data;
  try {
    const result = (await exchange({ ...data, token, roomRevision: recent?.data?.roomRevision || "" })).data;
    if (!Object.hasOwn(result, "roomManifest")) result.roomManifest = recent?.data?.roomManifest || null;
    recentExchanges.set(token, { at: Date.now(), data: result });
    if (recentExchanges.size > 4) recentExchanges.delete(recentExchanges.keys().next().value);
    return result;
  } catch (error) {
    recentExchanges.delete(token);
    throw error;
  }
}

export async function rebindSignageDevice(deviceId, code) {
  return adminSignageControl({ action: "rebind", deviceId, code });
}

export async function signagePairingRequest(data) {
  return (await pairing(data)).data;
}
