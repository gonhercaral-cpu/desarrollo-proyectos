import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CertificateValidation from "./pages/CertificateValidation";
import PublicCertificateRequest from "./pages/PublicCertificateRequest";
import PublicCertificateStatus from "./pages/PublicCertificateStatus";

import "./styles/app.css";

function CertificateValidationRoute() {
  const params = useParams();
  const validationCode = decodeURIComponent((params["*"] || "").replace(/\/+$/, ""));

  return <CertificateValidation validationCode={validationCode} />;
}

function ProtectedSystem() {
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/solicitar-certificados"
          element={<PublicCertificateRequest />}
        />

        <Route
          path="/certificados/seguimiento/:requestId"
          element={<PublicCertificateStatus />}
        />

        <Route
          path="/validar-certificado/*"
          element={<CertificateValidationRoute />}
        />

        <Route path="/*" element={<ProtectedSystem />} />
      </Routes>
    </BrowserRouter>
  );
}