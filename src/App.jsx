import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { canAccessEditorial } from "./utils/departmentMembership";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CertificateValidation from "./pages/CertificateValidation";
import CredentialValidation from "./pages/CredentialValidation";
import PublicCertificateRequest from "./pages/PublicCertificateRequest";
import PublicCertificateStatus from "./pages/PublicCertificateStatus";
import PublicMaterialCorrectionReport from "./pages/PublicMaterialCorrectionReport";
import PublicMaterialCorrectionTracking from "./pages/PublicMaterialCorrectionTracking";
import SignagePlayer from "./components/SignagePlayer";
import SignageSetup from "./components/SignageSetup";

import "./styles/app.css";

const EditorialModule = lazy(() => import("./editorial/EditorialModule"));

const THEME_STORAGE_KEY = "dp.ui.theme";

function getInitialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function CertificateValidationRoute() {
  const params = useParams();
  const validationCode = decodeURIComponent((params["*"] || "").replace(/\/+$/, ""));

  return <CertificateValidation validationCode={validationCode} />;
}

function CredentialValidationRoute() {
  const params = useParams();
  const validationCode = decodeURIComponent((params["*"] || "").replace(/\/+$/, ""));

  return <CredentialValidation validationCode={validationCode} />;
}

function ProtectedSystem({ theme, onToggleTheme }) {
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

  return <Dashboard theme={theme} onToggleTheme={onToggleTheme} />;
}

function ProtectedEditorialSystem({ theme, onToggleTheme }) {
  const { firebaseUser, profile, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="loading-screen"><h2>Cargando Editor Editorial...</h2></div>;
  }

  if (!firebaseUser) {
    return <Login />;
  }

  if (!profile) {
    return (
      <div className="loading-screen">
        <div className="card">
          <h2>Usuario sin perfil</h2>
          <p>Editor Editorial requiere un perfil activo en Firestore.</p>
        </div>
      </div>
    );
  }

  if (!canAccessEditorial(profile, isAdmin)) {
    return (
      <div className="loading-screen">
        <div className="card">
          <h2>No tienes permiso para acceder</h2>
          <p>
            El Editor Editorial está disponible solo para el departamento de
            Desarrollo de Material.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="loading-screen"><h2>Cargando Editor Editorial...</h2></div>}>
      <EditorialModule
        profile={profile}
        isAdmin={isAdmin}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
    </Suspense>
  );
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  return (
    <div className="app-root">
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
            path="/reportar-error-material"
            element={<PublicMaterialCorrectionReport />}
          />

          <Route
            path="/seguimiento-error-material/:folio"
            element={<PublicMaterialCorrectionTracking />}
          />

          <Route
            path="/validar-certificado/*"
            element={<CertificateValidationRoute />}
          />

          <Route
            path="/validar-credencial/*"
            element={<CredentialValidationRoute />}
          />

          <Route
            path="/signage/setup"
            element={<SignageSetup />}
          />

          <Route
            path="/signage/player/:deviceToken"
            element={<SignagePlayer />}
          />

          <Route
            path="/editorial"
            element={<ProtectedEditorialSystem theme={theme} onToggleTheme={toggleTheme} />}
          />

          <Route
            path="/editorial/:projectId"
            element={<ProtectedEditorialSystem theme={theme} onToggleTheme={toggleTheme} />}
          />

          <Route
            path="/*"
            element={<ProtectedSystem theme={theme} onToggleTheme={toggleTheme} />}
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
