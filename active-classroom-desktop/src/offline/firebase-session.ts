import { signInWithCustomToken, signOut, type Auth } from "firebase/auth";
import { SyncError } from "./manifest.ts";

export async function signInDevice(auth: Auth, customToken: string, owner: string): Promise<void> {
  const session = await signInWithCustomToken(auth, customToken);
  if (session.user.uid !== owner) { await signOut(auth); throw new SyncError("auth", "Identidad de sesión inválida."); }
}
export async function deviceIdToken(auth: Auth, owner: string, force = false): Promise<string> {
  const user = auth.currentUser;
  if (!user || user.uid !== owner) throw new SyncError("auth", "La sesión del equipo no está disponible.");
  const result = await user.getIdTokenResult(force);
  if (auth.currentUser?.uid !== owner || result.claims.activeClassroomDevice !== true || `ac-device-${result.claims.deviceId}` !== owner || !Number.isSafeInteger(result.claims.deviceGeneration)) {
    throw new SyncError("auth", "La identidad no corresponde a un equipo autorizado.");
  }
  return result.token;
}
