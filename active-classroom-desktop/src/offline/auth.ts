import { initializeApp } from "firebase/app";
import { inMemoryPersistence, initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { SyncError } from "./manifest.ts";

// Public Firebase application configuration; credentials remain with Firebase Auth.
const app = initializeApp({
  apiKey: "AIzaSyC6VvBRH4DGGvb9dRfeqJwgpcj_LgSgPKk",
  authDomain: "sistema-desarrollo-proyectos.firebaseapp.com",
  projectId: "sistema-desarrollo-proyectos",
  appId: "1:826143652602:web:db29375bea9462dded2743",
});
// Device proof restores Auth on startup; Firebase refresh tokens never reach localStorage.
export const auth = initializeAuth(app, { persistence: inMemoryPersistence });
export const observeSession = (callback: (user: User | null) => void) => onAuthStateChanged(auth, callback);
export async function login(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}
export const logout = () => signOut(auth);
export async function sessionToken(owner: string, force = false): Promise<string> {
  const user = auth.currentUser;
  if (!user || user.uid !== owner) throw new SyncError("auth", "Conecta Internet para sincronizar.");
  const token = await user.getIdToken(force);
  if (auth.currentUser?.uid !== owner) throw new SyncError("auth", "La sesión cambió durante la descarga.");
  return token;
}
