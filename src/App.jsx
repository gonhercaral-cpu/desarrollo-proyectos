import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CertificateValidation from "./pages/CertificateValidation";
import "./styles/app.css";

function getCertificateValidationCodeFromPath() {
  if (typeof window === "undefined") return "";

  const path = window.location.pathname || "";
  const marker = "/validar-certificado/";
  const markerIndex = path.indexOf(marker);

  if (markerIndex < 0) return "";

  return decodeURIComponent(path.slice(markerIndex + marker.length).replace(/\/+$/, ""));
}

export default function App() {
  const { firebaseUser, profile, loading } = useAuth();
  const certificateValidationCode = getCertificateValidationCodeFromPath();

  if (certificateValidationCode) {
    return <CertificateValidation validationCode={certificateValidationCode} />;
  }

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
        <div className="card">
          <h2>Usuario sin perfil</h2>

          <p>
            Tu cuenta existe en Firebase Authentication, pero todavía no tiene
            perfil en Firestore.
          </p>

          <p>
            Revisa que exista un documento en la colección{" "}
            <strong>users</strong> con este correo.
          </p>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}
