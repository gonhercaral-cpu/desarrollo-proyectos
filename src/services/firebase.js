import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
} from "firebase/storage";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "firebase/functions";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC6VvBRH4DGGvb9dRfeqJwgpcj_LgSgPKk",
  authDomain: "sistema-desarrollo-proyectos.firebaseapp.com",
  projectId: "sistema-desarrollo-proyectos",
  storageBucket: "sistema-desarrollo-proyectos.firebasestorage.app",
  messagingSenderId: "826143652602",
  appId: "1:826143652602:web:db29375bea9462dded2743",
  measurementId: "G-Y4Z8GE0VG0",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");

const useFirebaseEmulators = import.meta.env.DEV
  && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

if (useFirebaseEmulators) {
  const emulatorConnections = globalThis.__firebaseEmulatorConnections || {};

  if (!emulatorConnections.auth) {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    emulatorConnections.auth = true;
  }

  if (!emulatorConnections.firestore) {
    connectFirestoreEmulator(db, "localhost", 8080);
    emulatorConnections.firestore = true;
  }

  if (!emulatorConnections.storage) {
    connectStorageEmulator(storage, "localhost", 9199);
    emulatorConnections.storage = true;
  }

  if (!emulatorConnections.functions) {
    connectFunctionsEmulator(functions, "localhost", 5001);
    emulatorConnections.functions = true;
  }

  globalThis.__firebaseEmulatorConnections = emulatorConnections;
}

export default app;
