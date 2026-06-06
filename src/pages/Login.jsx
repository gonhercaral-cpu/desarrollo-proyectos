import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../services/firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Ingresa tu correo electrónico y contraseña.");
      return;
    }

    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error(error);

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        setError("Correo o contraseña incorrectos.");
      } else if (error.code === "auth/too-many-requests") {
        setError("Demasiados intentos. Intenta nuevamente más tarde.");
      } else {
        setError("No se pudo iniciar sesión. Revisa tus datos e intenta otra vez.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-redesign-screen">
      <section className="login-brand-side">
        <div className="login-brand-content">
          <div className="login-logo-card">
            <img
              src="/active-logo.png"
              alt="Active for life"
              className="login-brand-logo"
            />
          </div>

          <div className="login-brand-text">
            <h1>
              Desarrollo
              <br />
              de Proyectos
            </h1>

            <div className="login-red-line" />

            <p>
              Administra, supervisa y da seguimiento a tus proyectos
              de Active English School de forma eficiente.
            </p>
          </div>

          <div className="login-feature-grid">
            <FeatureCard
              icon="◔"
              title="Planificación"
              text="Organiza tareas, responsables y recursos de forma clara."
            />

            <FeatureCard
              icon="✓"
              title="Seguimiento"
              text="Monitorea avances, evidencias y cumplimiento de objetivos."
            />

            <FeatureCard
              icon="👥"
              title="Colaboración"
              text="Coordina el trabajo del equipo en tiempo real."
            />
          </div>
        </div>

        <div className="login-building-graphic" />
        <div className="login-red-wave" />
      </section>

      <section className="login-form-side">
        <div className="login-form-card">
          <div className="login-lock-icon">🔒</div>

          <h2>Iniciar sesión</h2>

          <p>
            Ingresa tus credenciales para acceder
            <br />
            al sistema.
          </p>

          <form onSubmit={handleSubmit}>
            <label className="login-field">
              <span>Correo electrónico</span>

              <div className="login-input-wrap">
                <b>☻</b>

                <input
                  type="email"
                  placeholder="usuario@active.edu.mx"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </div>
            </label>

            <label className="login-field">
              <span>Contraseña</span>

              <div className="login-input-wrap">
                <b>▣</b>

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  className="login-eye-button"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? "Ocultar" : "Ver"}
                </button>
              </div>
            </label>

            <div className="login-options-row">
              <label className="login-check">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />

                <span>Recordarme</span>
              </label>

              <button
                type="button"
                className="forgot-password-button"
                onClick={() =>
                  setError(
                    "Solicita al administrador del sistema que restablezca tu contraseña."
                  )
                }
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {error && <div className="login-error-box">{error}</div>}

            <button
              type="submit"
              className="login-main-button"
              disabled={loading}
            >
              {loading ? "Ingresando..." : "Iniciar sesión"}
            </button>
          </form>

          <div className="login-help-text">
            ¿Necesitas ayuda? Contacta al{" "}
            <strong>administrador del sistema</strong>.
          </div>
        </div>

        <div className="login-mini-card">
          <div className="login-mini-icon">▥</div>

          <div>
            <strong>Sistema integrado</strong>
            <p>Conecta planificación, recursos y resultados en un solo lugar.</p>
          </div>

          <div className="login-mini-illustration">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, text }) {
  return (
    <div className="login-feature-card">
      <div>{icon}</div>

      <strong>{title}</strong>

      <p>{text}</p>
    </div>
  );
}