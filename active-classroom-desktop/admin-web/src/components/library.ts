import type { AppState, DriveFolder, Resource } from "../models";
import { createLocalResource, kindLabel, readImageDimensions, resourceIcon } from "../services/files";
import { mirrorFile, mirrorFolder, renameCatalogFolder } from "../services/local-catalog";
import { persistFile, persistFolder, storageError } from "../services/storage";
import { escapeHtml, getElement, showToast } from "../utils/dom";

export function libraryTemplate(): string {
  return `<main class="admin-main"><section class="drive-page">
    <header class="drive-heading"><button id="mobile-menu" class="mobile-menu" aria-label="Abrir navegación" aria-expanded="false">☰</button><h1 id="page-title" tabindex="-1">Biblioteca</h1><span class="demo-chip">DEMO LOCAL · CATÁLOGO COMPARTIDO</span></header>
    <nav id="library-breadcrumb" class="library-breadcrumb" aria-label="Ruta de biblioteca"></nav>
    <div class="drive-layout">
      <section class="drive-library" aria-label="Archivos de biblioteca">
        <div class="drive-toolbar">
          <button id="new-folder" class="drive-primary"><span>＋</span>Nueva carpeta</button>
          <label id="upload-label" class="drive-button"><span>⇧</span>Subir archivos<input id="file-input" type="file" multiple accept="image/*,audio/*,video/*,.pdf,.pptx,.doc,.docx,.xlsx" /></label>
          <button id="library-more" class="drive-icon-button" aria-label="Más acciones">•••</button><span class="toolbar-spacer"></span>
          <div class="view-switch" aria-label="Vista"><button id="grid-view" aria-label="Vista de cuadrícula" aria-pressed="false">▦</button><button id="list-view" class="is-active" aria-label="Vista de lista" aria-pressed="true">☷</button></div>
          <button id="toggle-filters" class="drive-button" aria-expanded="true" aria-controls="filter-panel"><span>▽</span>Filtrar</button>
        </div>
        <div id="filter-panel" class="filter-panel">
          <label class="drive-search"><span>⌕</span><input id="search" type="search" placeholder="Buscar por nombre" autocomplete="off" /></label>
          <label><span class="sr-only">Tipo de archivo</span><select id="type-filter"><option value="all">Tipo de archivo</option><option value="image">Imagen</option><option value="audio">Audio</option><option value="video">Video</option><option value="pdf">PDF</option><option value="document">Documento</option><option value="presentation">Presentación</option></select></label>
          <label><span class="sr-only">Estado</span><select id="status-filter"><option value="all">Estado</option><option value="active">Activo</option><option value="draft">Borrador</option></select></label>
          <label><span class="sr-only">Ordenar</span><select id="sort-filter"><option value="name">Ordenar por: Nombre</option><option value="date">Ordenar por: Modificado</option></select></label>
          <button id="clear-filters" class="clear-filters">Limpiar filtros</button>
        </div>
        <div class="resource-table-wrap"><table class="resource-table drive-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" /></th><th>Nombre <span>⌃</span></th><th>Tipo</th><th>Tamaño</th><th>Modificado <span>⌃</span></th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="resource-list"></tbody></table></div>
        <div id="empty-state" class="empty-state" hidden><span>⌕</span><strong>Carpeta vacía</strong><small>Abre otra carpeta o agrega contenido desde administración.</small></div>
      </section>
      <div id="inspector-slot"></div>
    </div>
  </section></main>
  <dialog id="folder-dialog" class="folder-dialog"><form id="folder-form" method="dialog">
    <div class="modal-icon">▰</div><div class="modal-copy"><h2 id="folder-dialog-title">Nueva Unit</h2><p id="folder-dialog-copy">Se guardará en catálogo local compartido con aplicación docente.</p></div>
    <label>Nombre de carpeta<input id="folder-name" name="folder-name" required maxlength="56" placeholder="Ej. Unit 17" /></label>
    <div class="modal-actions"><button type="button" id="cancel-folder" class="button button-secondary">Cancelar</button><button type="submit" class="button button-primary">Guardar</button></div>
  </form></dialog>`;
}

export interface LibraryController { render(): void; }

export function createLibraryController(state: AppState, onSelection: () => void): LibraryController {
  const list = getElement("resource-list");
  const fileInput = getElement<HTMLInputElement>("file-input");
  const folderDialog = getElement<HTMLDialogElement>("folder-dialog");
  let editingFolderId: string | null = null;

  const currentFolder = () => state.folders.find(({ id }) => id === state.selectedFolderId);
  const matchesSearch = (value: string) => !state.searchTerm || value.toLocaleLowerCase("es").includes(state.searchTerm);
  function matchesType(resource: Resource): boolean {
    if (state.typeFilter === "all") return true;
    if (state.typeFilter === "pdf") return resource.mimeType === "application/pdf" || resource.name.toLowerCase().endsWith(".pdf");
    return resource.kind === state.typeFilter;
  }
  const matchesStatus = (resource: Resource) => state.statusFilter === "all" || (state.statusFilter === "active" ? resource.published : !resource.published);

  function render(): void {
    const parentId = state.selectedFolderId === "root" ? null : state.selectedFolderId;
    const visibleFolders = state.typeFilter === "all" && state.statusFilter === "all"
      ? state.folders.filter((folder) => folder.parentId === parentId && matchesSearch(folder.name)).sort(folderSort)
      : [];
    const visibleResources = state.resources
      .filter((resource) => resource.folderId === state.selectedFolderId && matchesSearch(resource.name) && matchesType(resource) && matchesStatus(resource))
      .sort((a, b) => state.sortMode === "date" ? b.updated.localeCompare(a.updated, "es") : a.name.localeCompare(b.name, "es"));
    list.innerHTML = `${visibleFolders.map(folderRow).join("")}${visibleResources.map((resource) => resourceRow(resource, resource.id === state.selectedResourceId)).join("")}`;
    getElement("empty-state").hidden = visibleFolders.length + visibleResources.length > 0;
    renderBreadcrumb(state);
    const unitSelected = currentFolder()?.kind === "unit";
    fileInput.disabled = !unitSelected;
    getElement("upload-label").classList.toggle("is-disabled", !unitSelected);
    getElement("new-folder").toggleAttribute("disabled", currentFolder()?.kind !== "level");
  }

  function setView(mode: "list" | "grid"): void {
    state.viewMode = mode;
    getElement("grid-view").classList.toggle("is-active", mode === "grid");
    getElement("list-view").classList.toggle("is-active", mode === "list");
    getElement("grid-view").setAttribute("aria-pressed", String(mode === "grid"));
    getElement("list-view").setAttribute("aria-pressed", String(mode === "list"));
    document.querySelector(".drive-library")?.classList.toggle("grid-mode", mode === "grid");
  }

  async function addFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    if (currentFolder()?.kind !== "unit") { showToast("Abre una Unit antes de subir archivos"); return; }
    let shared = 0;
    for (const file of files) {
      const resource = createLocalResource(file, state.selectedFolderId);
      if (resource.kind === "image" && resource.url) resource.dimensions = await readImageDimensions(resource.url);
      state.resources.push(resource);
      state.selectedResourceId = resource.id;
      try { await persistFile(resource, file); resource.persisted = true; }
      catch (error) { resource.persisted = false; showToast(`IndexedDB no guardó ${file.name}: ${storageError(error)}`); }
      try {
        const mirrored = await mirrorFile(resource, file);
        Object.assign(resource, mirrored, { url: resource.url, persisted: true });
        shared += 1;
      } catch (error) { showToast(`${file.name} no llegó a docente: ${storageError(error)}`); }
    }
    render(); onSelection();
    showToast(`${shared} de ${files.length} archivo${files.length === 1 ? "" : "s"} compartido${shared === 1 ? "" : "s"} con docente`);
  }

  getElement<HTMLInputElement>("search").addEventListener("input", (event) => { state.searchTerm = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase("es"); render(); });
  getElement<HTMLSelectElement>("type-filter").addEventListener("change", (event) => { state.typeFilter = (event.target as HTMLSelectElement).value; render(); });
  getElement<HTMLSelectElement>("status-filter").addEventListener("change", (event) => { state.statusFilter = (event.target as HTMLSelectElement).value; render(); });
  getElement<HTMLSelectElement>("sort-filter").addEventListener("change", (event) => { state.sortMode = (event.target as HTMLSelectElement).value; render(); });
  getElement("clear-filters").addEventListener("click", () => {
    state.searchTerm = ""; state.typeFilter = "all"; state.statusFilter = "all"; state.sortMode = "name";
    getElement<HTMLInputElement>("search").value = ""; getElement<HTMLSelectElement>("type-filter").value = "all"; getElement<HTMLSelectElement>("status-filter").value = "all"; getElement<HTMLSelectElement>("sort-filter").value = "name"; render();
  });
  getElement("toggle-filters").addEventListener("click", () => { const panel = getElement("filter-panel"); panel.hidden = !panel.hidden; getElement("toggle-filters").setAttribute("aria-expanded", String(!panel.hidden)); });
  getElement("grid-view").addEventListener("click", () => setView("grid"));
  getElement("list-view").addEventListener("click", () => setView("list"));
  getElement("library-more").addEventListener("click", () => showToast("Acciones masivas requieren etapa posterior"));

  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const rename = target.closest<HTMLButtonElement>("[data-rename-folder]");
    if (rename) { openRename(rename.dataset.renameFolder ?? ""); return; }
    const folder = target.closest<HTMLElement>("[data-folder-id]");
    if (folder) { state.selectedFolderId = folder.dataset.folderId ?? "root"; state.selectedResourceId = ""; render(); onSelection(); return; }
    const row = target.closest<HTMLElement>("[data-resource-id]");
    if (!row) return;
    state.selectedResourceId = row.dataset.resourceId ?? state.selectedResourceId;
    getElement("drive-inspector").hidden = false; getElement("admin-shell").classList.remove("inspector-closed"); render(); onSelection();
  });
  list.addEventListener("keydown", (event) => { if (!["Enter", " "].includes(event.key)) return; const row = (event.target as HTMLElement).closest<HTMLElement>("[data-folder-id], [data-resource-id]"); if (row) { event.preventDefault(); row.click(); } });
  getElement("library-breadcrumb").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-breadcrumb-id]"); if (!button) return; state.selectedFolderId = button.dataset.breadcrumbId ?? "root"; state.selectedResourceId = ""; render(); onSelection(); });

  getElement("new-folder").addEventListener("click", () => {
    if (currentFolder()?.kind !== "level") { showToast("Abre un Nivel para crear una Unit"); return; }
    editingFolderId = null; getElement("folder-dialog-title").textContent = "Nueva Unit"; getElement<HTMLInputElement>("folder-name").value = ""; folderDialog.showModal(); getElement<HTMLInputElement>("folder-name").focus();
  });
  getElement("cancel-folder").addEventListener("click", () => folderDialog.close());
  getElement<HTMLFormElement>("folder-form").addEventListener("submit", (event) => {
    event.preventDefault(); void saveFolder();
  });
  fileInput.addEventListener("change", () => { void addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ""; });
  document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); getElement<HTMLInputElement>("search").focus(); } });

  async function saveFolder(): Promise<void> {
    const name = getElement<HTMLInputElement>("folder-name").value.trim();
    if (!name) return;
    try {
      if (editingFolderId) {
        const saved = await renameCatalogFolder(editingFolderId, name);
        const folder = state.folders.find(({ id }) => id === editingFolderId);
        if (folder) Object.assign(folder, saved);
        if (folder) await persistFolder(folder);
        showToast(`Unit renombrada: ${name}`);
      } else {
        const folder: DriveFolder = { id: `unit-${crypto.randomUUID()}`, name, updated: new Date().toISOString(), parentId: state.selectedFolderId, kind: "unit" };
        const saved = await mirrorFolder(folder); state.folders.push(saved); await persistFolder(saved); showToast(`Unit “${name}” creada y compartida`);
      }
      folderDialog.close(); render();
    } catch (error) { showToast(`No se guardó carpeta: ${storageError(error)}`); }
  }

  function openRename(id: string): void {
    const folder = state.folders.find((item) => item.id === id);
    if (!folder || folder.kind === "level") return;
    editingFolderId = id; getElement("folder-dialog-title").textContent = "Renombrar Unit"; getElement<HTMLInputElement>("folder-name").value = folder.name; folderDialog.showModal(); getElement<HTMLInputElement>("folder-name").focus();
  }

  render();
  return { render };
}

function renderBreadcrumb(state: AppState): void {
  const target = getElement("library-breadcrumb");
  const crumbs: DriveFolder[] = [];
  let current = state.folders.find(({ id }) => id === state.selectedFolderId);
  while (current) { crumbs.unshift(current); current = state.folders.find(({ id }) => id === current?.parentId); }
  target.innerHTML = `<button data-breadcrumb-id="root">Biblioteca</button>${crumbs.map((folder) => `<span>/</span><button data-breadcrumb-id="${folder.id}" aria-current="${folder.id === state.selectedFolderId ? "page" : "false"}">${escapeHtml(folder.name)}</button>`).join("")}`;
}

function folderSort(a: DriveFolder, b: DriveFolder): number {
  const number = (value: string) => Number(value.match(/\d+/)?.[0] ?? 999);
  return number(a.name) - number(b.name) || a.name.localeCompare(b.name, "es");
}

function folderRow(folder: DriveFolder): string {
  return `<tr class="drive-folder-row" tabindex="0" role="button" data-folder-id="${folder.id}"><td><input type="checkbox" tabindex="-1" aria-label="Seleccionar carpeta ${escapeHtml(folder.name)}" /></td><td><span class="drive-name"><i class="drive-file-icon folder">▰</i><strong>${escapeHtml(folder.name)}</strong></span></td><td>${folder.kind === "level" ? "Nivel" : "Unit"}</td><td>—</td><td>${escapeHtml(folder.updated)}</td><td>${folder.kind === "unit" ? `<button class="row-menu" data-rename-folder="${folder.id}" aria-label="Renombrar ${escapeHtml(folder.name)}">✎</button>` : `<span aria-hidden="true">›</span>`}</td></tr>`;
}

function resourceRow(resource: Resource, selected: boolean): string {
  return `<tr class="drive-resource-row${selected ? " is-selected" : ""}" tabindex="0" role="button" data-resource-id="${resource.id}" aria-selected="${selected}"><td><input type="checkbox" ${selected ? "checked" : ""} tabindex="-1" aria-label="Seleccionar ${escapeHtml(resource.name)}" /></td><td><span class="drive-name"><i class="drive-file-icon type-${resource.kind}">${resourceIcon(resource.kind)}</i><strong>${escapeHtml(resource.name)}</strong></span></td><td>${kindLabel(resource.kind, resource.name)}</td><td>${resource.size}</td><td>${resource.updated}</td><td><button class="row-menu" aria-label="Más acciones para ${escapeHtml(resource.name)}">•••</button></td></tr>`;
}
