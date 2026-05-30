import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      await login(email, password);
    } catch (err) {
      console.error(err);
      setError("No se pudo iniciar sesión. Revisa el correo y la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-info">
          <small>Active English School</small>
          <h1>Sistema de Desarrollo de Proyectos</h1>
          <p>
            Acceso interno para administrar solicitudes, proyectos, responsables,
            avances, evidencias e historial de trabajo.
          </p>

          <div className="login-bullets">
            <div>✓ Alta y aprobación de proyectos.</div>
            <div>✓ Panel individual para colaboradores.</div>
            <div>✓ Seguimiento por estatus y evidencias.</div>
            <div>✓ Control administrativo del área.</div>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h2>Ingresar</h2>
          <p>Usa el correo y contraseña registrados en Firebase Authentication.</p>

          <label>Correo electrónico</label>
          <input
            type="email"
            placeholder="correo@activeenglishschool.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label>Contraseña</label>
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error && <div className="error-box">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}