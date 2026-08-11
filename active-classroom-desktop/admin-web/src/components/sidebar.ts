import { getElement, showToast } from "../utils/dom";

function navButton(label: string, icon: string, active = false): string {
  return `<button class="${active ? "is-active" : ""}" data-section="${label}"><span>${icon}</span>${label}</button>`;
}

export function sidebarTemplate(): string {
  return `<aside class="admin-sidebar">
    <a class="admin-brand" href="#" aria-label="Active Classroom, administración"><img src="/logo-a-original.png" alt="" /><span><strong>Active</strong><strong>Classroom</strong></span></a>
    <nav class="admin-nav" aria-label="Navegación de administración">
      ${navButton("Biblioteca", "▤", true)}${navButton("Publicaciones", "◉")}${navButton("Equipos", "♙")}${navButton("Ajustes", "⚙")}
      <span class="nav-divider" aria-hidden="true"></span>
      ${navButton("Panel de anuncios", "◁")}${navButton("Observaciones", "▢")}${navButton("Sugerencias", "♧")}
    </nav>
    <div class="local-badge"><span></span><strong>Prototipo local</strong><small>Sin conexión a la nube</small></div>
    <div class="admin-profile"><span class="avatar">MG</span><span><strong>María González</strong><small>Administradora · demo</small></span><button id="demo-logout" aria-label="Salir del modo demostración">⌄</button></div>
  </aside>`;
}

export function bindSidebar(openSettings: (trigger: HTMLButtonElement) => void): void {
  document.querySelectorAll<HTMLButtonElement>(".admin-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section ?? "Biblioteca";
      if (section === "Ajustes") { openSettings(button); return; }
      document.querySelectorAll(".admin-nav button").forEach((item) => item.classList.toggle("is-active", item === button));
      showToast(section === "Biblioteca" ? "Biblioteca activa" : `${section}: módulo visual previsto para una etapa posterior`);
    });
  });

  getElement("mobile-menu").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const open = document.body.classList.toggle("nav-open");
    button.setAttribute("aria-expanded", String(open));
  });
}
