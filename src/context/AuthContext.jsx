import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadUserProfile(user) {
    if (!user?.uid) {
      return null;
    }

    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

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

  async function refreshProfile() {
    if (!firebaseUser) {
      setProfile(null);
      return null;
    }

    const updatedProfile = await loadUserProfile(firebaseUser);
    setProfile(updatedProfile);

    return updatedProfile;
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

  const role = profile?.role || "";

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        login,
        logout,
        refreshProfile,

        uid: firebaseUser?.uid || null,
        userEmail: firebaseUser?.email || null,

        isAdmin: role === "admin",
        isCollaborator: role === "collaborator",
        isRequester: role === "requester",

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