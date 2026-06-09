import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

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

export default app;