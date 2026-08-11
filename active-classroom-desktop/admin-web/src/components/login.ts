import { getElement } from "../utils/dom";

export function loginTemplate(): string {
  return `<section id="login-screen" class="login-screen" aria-labelledby="login-title">
    <div class="login-showcase">
      <a class="login-wordmark" href="#" aria-label="Active Classroom"><img src="/logo-a-original.png" alt="" /><span><strong>Active</strong><strong>Classroom</strong></span></a>
      <div class="showcase-copy"><h1>Gestiona tu<br />biblioteca de clases.</h1><span class="headline-rule" aria-hidden="true"></span><p>Organiza, actualiza y controla todos los<br />recursos de aprendizaje de tu institución.</p></div>
      <div class="format-cards" aria-label="Tipos de contenido: Presentaciones, Videos y Audios">
        <span class="dot-pattern" aria-hidden="true"></span>
        <article class="tilted-card presentations-card"><span class="format-icon presentation">▤</span><strong>Presentaciones</strong><span class="card-lines" aria-hidden="true"><i></i><i></i><i></i></span></article>
        <article class="tilted-card videos-card"><span class="format-icon video">▶</span><strong>Videos</strong><span class="card-lines" aria-hidden="true"><i></i><i></i><i></i></span></article>
        <article class="tilted-card audios-card"><span class="format-icon audio">◉</span><strong>Audios</strong><span class="card-lines" aria-hidden="true"><i></i><i></i><i></i></span></article>
      </div>
    </div>
    <div class="login-form-side"><div class="login-card">
      <div class="login-heading"><h2 id="login-title">Inicia sesión</h2><p><strong>Modo demostración local.</strong> La autenticación no está activa.</p></div>
      <form id="demo-login-form" novalidate>
        <label>Correo electrónico<span class="input-field"><span class="field-icon" aria-hidden="true">✉</span><input id="demo-email" name="email" type="email" autocomplete="off" placeholder="nombre@ejemplo.com" required /></span></label>
        <label>Contraseña<span class="input-field password-field"><span class="field-icon" aria-hidden="true">♙</span><input id="demo-password" name="password" type="password" autocomplete="off" placeholder="Ingresa tu contraseña" required /><button id="toggle-password" type="button" aria-label="Mostrar contraseña">◉</button></span></label>
        <button id="recovery-link" class="recovery-link" type="button">¿Olvidaste tu contraseña?</button><button class="demo-submit" type="submit">Iniciar sesión</button>
      </form>
      <div class="login-divider"><span>o continúa con</span></div>
      <div class="provider-buttons"><button type="button" data-demo-provider="Google"><span class="google-mark">G</span>Continuar con Google</button><button type="button" data-demo-provider="Microsoft"><span class="microsoft-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Continuar con Microsoft</button></div>
      <p class="access-help">¿Necesitas acceso? <button id="access-help" type="button">Solicítalo a un administrador.</button></p>
      <p id="login-status" class="login-status" aria-live="polite">Demo local: cualquier correo y clave no vacíos abren el panel. No se guardan ni envían.</p>
    </div></div>
  </section>`;
}

export function bindLogin(): void {
  getElement<HTMLFormElement>("demo-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = getElement<HTMLInputElement>("demo-email");
    const password = getElement<HTMLInputElement>("demo-password");
    const status = getElement("login-status");
    if (!email.value.trim() || !password.value) {
      status.textContent = "Escribe un correo y una clave de prueba para continuar.";
      status.classList.add("has-error");
      (!email.value.trim() ? email : password).focus();
      return;
    }
    status.classList.remove("has-error");
    status.textContent = "Modo demostración: abriendo biblioteca local…";
    password.value = "";
    window.setTimeout(() => {
      getElement("login-screen").hidden = true;
      getElement("admin-shell").hidden = false;
      getElement("page-title").focus({ preventScroll: true });
    }, 180);
  });

  getElement("toggle-password").addEventListener("click", () => {
    const password = getElement<HTMLInputElement>("demo-password");
    const showing = password.type === "text";
    password.type = showing ? "password" : "text";
    getElement("toggle-password").setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
  });

  const setStatus = (message: string) => { const status = getElement("login-status"); status.classList.remove("has-error"); status.textContent = message; };
  getElement("recovery-link").addEventListener("click", () => setStatus("Recuperación no disponible: este prototipo no tiene cuentas ni autenticación."));
  getElement("access-help").addEventListener("click", () => setStatus("Solicitud no disponible: este prototipo local no tiene cuentas ni administradores conectados."));
  document.querySelectorAll<HTMLButtonElement>("[data-demo-provider]").forEach((button) => button.addEventListener("click", () => setStatus(`${button.dataset.demoProvider} es solo una referencia visual. OAuth no está conectado.`)));

  getElement("demo-logout").addEventListener("click", () => {
    getElement("admin-shell").hidden = true;
    getElement("login-screen").hidden = false;
    getElement<HTMLInputElement>("demo-email").value = "";
    getElement<HTMLInputElement>("demo-password").value = "";
    getElement("login-status").textContent = "Sesión de demostración cerrada. No se guardaron credenciales.";
    getElement<HTMLInputElement>("demo-email").focus();
  });
}
