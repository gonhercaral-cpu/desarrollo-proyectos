import { adminSignageControl, signagePairingRequest } from "./controlService";
import { assertAdminUser } from "./shared";

// Secrets stay in the setup browser; private backend records store only hashes.
const setupSessions = new Map();

export async function createPairingSession() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `ds2_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const sessionId = crypto.randomUUID();
  const session = await signagePairingRequest({ action: "create", sessionId, token });
  setupSessions.set(session.id, token);
  return { ...session, setupSecret: token };
}

export function subscribePairingSession(sessionId, callback, onError) {
  let stopped = false;
  let timer;
  async function poll() {
    try {
      const token = setupSessions.get(sessionId);
      if (!token) throw new Error("Sesión local no disponible; genera un nuevo código.");
      const session = await signagePairingRequest({ action: "poll", sessionId, token });
      if (stopped) return;
      callback({ ...session, deviceToken: session.status === "claimed" ? token : null });
      if (session.status === "claimed" || session.status === "expired") {
        setupSessions.delete(sessionId);
        return;
      }
    } catch (error) {
      if (!stopped) onError?.(error);
    }
    if (!stopped) timer = window.setTimeout(poll, 3000);
  }
  void poll();
  return () => { stopped = true; window.clearTimeout(timer); setupSessions.delete(sessionId); };
}

// Secure sessions expire server-side; they need no public heartbeat writes.
export async function updatePairingSessionHeartbeat() {}
export async function expireOldPairingSessions() {}

export async function claimPairingCode(code, deviceData, user) {
  assertAdminUser(user);
  return adminSignageControl({ action: "claim", code, device: deviceData });
}
