import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { profile, firebaseUser, logout, isAdmin } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <small>Active English School</small>
          <h1>Desarrollo de Proyectos</h1>
        </div>

        <div className="user-box">
          <strong>{profile?.name || "Usuario sin perfil"}</strong>
          <span>{profile?.role || "Sin rol"} · {profile?.area || "Sin área"}</span>
        </div>

        <nav>
          <button>Mis proyectos</button>

          {isAdmin && (
            <>
              <button>Dashboard general</button>
              <button>Alta de proyecto</button>
              <button>Todos los proyectos</button>
              <button>Usuarios</button>
            </>
          )}
        </nav>

        <button className="logout-button" onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="main-content">
        <h2>Bienvenido, {profile?.name}</h2>

        <div className="card">
          <h3>Conexión funcionando</h3>
          <p>
            Tu usuario inició sesión correctamente con Firebase Authentication.
          </p>

          <p>
            <strong>Correo:</strong> {firebaseUser?.email}
          </p>

          <p>
            <strong>Rol:</strong> {profile?.role}
          </p>

          <p>
            <strong>Área:</strong> {profile?.area}
          </p>
        </div>
      </main>
    </div>
  );
}