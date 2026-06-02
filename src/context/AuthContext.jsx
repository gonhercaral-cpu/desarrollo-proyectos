import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../services/firebase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadUserProfile(user) {
    console.log("Proyecto conectado:", db.app.options.projectId);
    console.log("Email autenticado:", user.email);
    console.log("UID autenticado:", user.uid);

    // Ahora buscamos el documento directamente por UID:
    // users / UID_DEL_USUARIO
    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    console.log("Buscando perfil con UID:", user.uid);
    console.log("¿Existe perfil?:", userSnapshot.exists());

    if (!userSnapshot.exists()) {
      console.warn(
        "No existe un documento en Firestore para este UID:",
        user.uid
      );
      return null;
    }

    return {
      id: userSnapshot.id,
      uid: user.uid,
      ...userSnapshot.data(),
    };
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);

      try {
        setFirebaseUser(user);

        if (user) {
          const userProfile = await loadUserProfile(user);
          setProfile(userProfile);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Error cargando perfil del usuario:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  async function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    return signOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        login,
        logout,

        // Datos útiles del usuario
        uid: firebaseUser?.uid || null,
        userEmail: firebaseUser?.email || null,

        // Roles
        isAdmin: profile?.role === "admin",
        isCollaborator: profile?.role === "collaborator",
        isRequester: profile?.role === "requester",

        // Estado del usuario
        isActive: profile?.active === true,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}