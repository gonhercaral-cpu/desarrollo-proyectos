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
