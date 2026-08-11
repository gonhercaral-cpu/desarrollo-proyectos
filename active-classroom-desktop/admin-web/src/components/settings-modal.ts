import { getElement, showToast } from "../utils/dom";

export function settingsTemplate(): string {
  return `<dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
    <div class="settings-window">
      <header><h2 id="settings-title">Ajustes</h2><button id="close-settings" type="button" aria-label="Cerrar Ajustes">×</button></header>
      <div class="settings-body">
        <nav aria-label="Secciones de ajustes"><button class="is-active"><span>♙</span>Cuenta</button><button><span>♢</span>Notificaciones</button><button><span>☷</span>Preferencias</button><button><span>▣</span>Seguridad</button></nav>
        <section class="account-settings">
          <span class="settings-demo">DEMO LOCAL · LOS CAMBIOS NO SE GUARDAN</span><h3>Foto de perfil</h3>
          <div class="profile-photo-row"><span id="profile-photo" class="profile-photo">MG</span><label class="settings-button">⇧ Cambiar foto<input id="profile-photo-input" type="file" accept="image/*" /></label></div>
          <div class="account-fields"><label>Nombre<input value="María González" /></label><label>Correo electrónico<input type="email" value="maria.gonzalez@activeclassroom.com" /></label></div>
          <div class="password-setting"><div><strong>Cambiar contraseña</strong><small>Acción visual; no modifica cuentas reales.</small></div><button id="demo-change-password" type="button" class="settings-button">▣ Cambiar contraseña</button></div>
          <div class="account-details"><h3>Detalles de la cuenta</h3><p><span>Rol</span><strong>Administradora (demo)</strong></p><p><span>Miembro desde</span><strong>15 feb 2023</strong></p></div>
        </section>
      </div>
    </div>
  </dialog>`;
}

export interface SettingsController { open(trigger: HTMLButtonElement): void; }

export function createSettingsController(): SettingsController {
  const dialog = getElement<HTMLDialogElement>("settings-dialog");
  let trigger: HTMLButtonElement | null = null;

  function close(): void { if (dialog.open) dialog.close(); }
  function open(source: HTMLButtonElement): void {
    trigger = source;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => getElement("close-settings").focus());
  }

  getElement("close-settings").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("cancel", () => { /* Escape closes native dialog; close event restores focus. */ });
  dialog.addEventListener("close", () => { trigger?.focus(); trigger = null; });
  document.querySelectorAll<HTMLButtonElement>(".settings-body nav button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".settings-body nav button").forEach((item) => item.classList.toggle("is-active", item === button));
    if (!button.textContent?.includes("Cuenta")) showToast(`${button.textContent?.trim()}: sección visual de demostración`);
  }));
  getElement<HTMLInputElement>("profile-photo-input").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const preview = getElement("profile-photo");
    preview.textContent = "";
    preview.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    showToast("Foto previsualizada localmente; no se guardará");
  });
  getElement("demo-change-password").addEventListener("click", () => showToast("Contraseña sin cambios: autenticación no activa"));
  return { open };
}
