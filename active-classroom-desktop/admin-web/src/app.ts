import { createInspectorController, inspectorTemplate } from "./components/inspector";
import { createLibraryController, libraryTemplate } from "./components/library";
import { bindLogin, loginTemplate } from "./components/login";
import { bindSidebar, sidebarTemplate } from "./components/sidebar";
import { createSettingsController, settingsTemplate } from "./components/settings-modal";
import { loadLocalCatalog, mirrorFile } from "./services/local-catalog";
import { hydrateLibrary, storageError } from "./services/storage";
import { createAppState } from "./state/store";
import { getElement, showToast } from "./utils/dom";

export function mountApp(root: HTMLElement): void {
  const state = createAppState();
  root.innerHTML = `${loginTemplate()}<div id="admin-shell" class="admin-shell" hidden>${sidebarTemplate()}${libraryTemplate()}</div>${settingsTemplate()}<div id="toast" class="toast" role="status" aria-live="polite"></div>`;
  getElement("inspector-slot").outerHTML = inspectorTemplate();

  const inspector = createInspectorController(state);
  const library = createLibraryController(state, inspector.render);
  const settings = createSettingsController();
  bindSidebar(settings.open);
  bindLogin();

  void loadLocalCatalog().then(async (catalog) => {
    state.folders.splice(0, state.folders.length, ...catalog.folders);
    state.resources.splice(0, state.resources.length, ...catalog.files.map((resource) => ({ ...resource, url: resource.url ? `${location.origin}${resource.url}` : undefined, persisted: true })));
    const browserLibrary = await hydrateLibrary().catch(() => ({ files: [], folders: [] }));
    for (const resource of browserLibrary.files) {
      if (state.resources.some(({ id }) => id === resource.id) || !resource.blob) continue;
      const folderId = state.folders.some(({ id, kind }) => id === resource.folderId && kind === "unit") ? resource.folderId : "level-1-unit-01";
      const migrated = { ...resource, folderId };
      try {
        const mirrored = await mirrorFile(migrated, resource.blob);
        state.resources.push({ ...migrated, ...mirrored, url: migrated.url, persisted: true });
      } catch { state.resources.push(migrated); }
    }
    if (state.resources.length) state.selectedResourceId = state.resources.at(-1)?.id ?? "";
    library.render();
    inspector.render();
    showToast(`Catálogo local: ${catalog.folders.length} carpetas · ${state.resources.length} archivo${state.resources.length === 1 ? "" : "s"}`);
  }).catch((error) => {
    getElement("page-title").setAttribute("data-storage-warning", storageError(error));
    showToast("Puente local no disponible. Inicia admin con npm run admin:dev");
    library.render(); inspector.render();
  });
}
