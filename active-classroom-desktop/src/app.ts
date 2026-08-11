import { renderAudience } from "./components/audience-window";
import { renderTeacher } from "./components/teacher-dashboard";
import { currentViewLabel } from "./services/tauri-bridge";
import { loadLibraryCatalog } from "./services/library-catalog";
import { ClassroomStore } from "./state/classroom-store";

export async function mountDesktopApp(root: HTMLDivElement): Promise<void> {
  const store = new ClassroomStore();
  if (currentViewLabel() === "audience") renderAudience(root, store);
  else {
    root.innerHTML = `<main class="desktop-loading"><strong>Active Classroom</strong><span>Cargando biblioteca local…</span></main>`;
    renderTeacher(root, store, await loadLibraryCatalog());
  }
}
