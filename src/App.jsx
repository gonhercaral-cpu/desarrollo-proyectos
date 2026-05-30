import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import "./styles/app.css";

export default function App() {
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <h2>Cargando sistema...</h2>
      </div>
    );
  }

  if (!firebaseUser) {
    return <Login />;
  }

  if (!profile) {
    return (
      <div className="loading-screen">
        <h2>Usuario sin perfil</h2>
        <p>
          Tu cuenta existe en Firebase Authentication, pero todavía no tiene
          perfil en Firestore.
        </p>
        <p>
          Revisa que exista un documento en la colección <strong>users</strong>{" "}
          con este correo.
        </p>
      </div>
    );
  }

  return <Dashboard />;
}