import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
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

  const usersRef = collection(db, "users");
  const allUsersSnapshot = await getDocs(usersRef);

  console.log("Cantidad total de documentos en users:", allUsersSnapshot.size);

  allUsersSnapshot.forEach((doc) => {
    console.log("Usuario en Firestore:", doc.id, doc.data());
  });

  const cleanEmail = user.email.trim().toLowerCase();

  const q = query(usersRef, where("email", "==", cleanEmail));
  const snapshot = await getDocs(q);

  console.log("Buscando email:", cleanEmail);
  console.log("Perfiles encontrados:", snapshot.size);

  if (snapshot.empty) {
    return null;
  }

  const userDoc = snapshot.docs[0];

  return {
    id: userDoc.id,
    ...userDoc.data(),
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
        isAdmin: profile?.role === "admin",
        isCollaborator: profile?.role === "collaborator",
        isRequester: profile?.role === "requester",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}