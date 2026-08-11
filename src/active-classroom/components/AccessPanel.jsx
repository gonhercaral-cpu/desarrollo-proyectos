export function TeamsPanel({ profile }) {
  return (
    <section className="ac-section-panel">
      <header className="ac-section-heading">
        <div>
          <span>ACCESO INSTITUCIONAL</span>
          <h2>Equipos</h2>
          <p>Active Classroom usa usuarios, sesión y roles del Sistema de Desarrollo de Proyectos.</p>
        </div>
      </header>
      <div className="ac-info-grid">
        <article>
          <span className="ac-info-icon">♙</span>
          <h3>Administración centralizada</h3>
          <p>Altas, bajas y perfiles se gestionan desde módulo Colaboradores. No existe directorio duplicado.</p>
        </article>
        <article>
          <span className="ac-info-icon">▣</span>
          <h3>Cuenta actual</h3>
          <p><strong>{profile?.name || profile?.email || "Administrador"}</strong><br />Rol: Administrador</p>
        </article>
        <article>
          <span className="ac-info-icon">◈</span>
          <h3>Acceso docente</h3>
          <p>Recursos publicados quedan preparados para lectura segura por perfiles activos.</p>
        </article>
      </div>
    </section>
  );
}
export function SettingsPanel() {
  return (
    <section className="ac-section-panel">
      <header className="ac-section-heading">
        <div>
          <span>CONFIGURACIÓN</span>
          <h2>Ajustes</h2>
          <p>Integración cloud activa. Datos aislados del resto de módulos.</p>
        </div>
      </header>
      <div className="ac-settings-list">
        <article>
          <div><strong>Catálogo</strong><small>Colecciones independientes de carpetas y recursos.</small></div>
          <span className="ac-status-pill is-active">Activo</span>
        </article>
        <article>
          <div><strong>Archivos</strong><small>Firebase Storage, máximo 250 MB por recurso.</small></div>
          <span className="ac-status-pill is-active">Activo</span>
        </article>
        <article>
          <div><strong>Permisos</strong><small>Administración restringida a usuarios con rol admin.</small></div>
          <span className="ac-status-pill is-active">Protegido</span>
        </article>
      </div>
    </section>
  );
}

export function FuturePanel({ title }) {
  return (
    <section className="ac-section-panel ac-future-panel">
      <span aria-hidden="true">◇</span>
      <h2>{title}</h2>
      <p>Módulo estaba previsto visualmente en Active Classroom original. Sin lógica real que migrar todavía.</p>
    </section>
  );
}
