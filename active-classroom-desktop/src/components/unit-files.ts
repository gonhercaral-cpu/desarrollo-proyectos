import type { CatalogFile, LibraryCatalog } from "../models/library-catalog";
import type { ClassroomState } from "../state/classroom-store";
import { escapeHtml } from "../utils/dom";
import { resourceIcon } from "./teacher-sidebar";

type CategoryKey = "presentations" | "audio" | "video" | "documents";

interface ResourceCategory {
  key: CategoryKey;
  title: string;
  icon: string;
  files: CatalogFile[];
}

const categoryMeta: Record<CategoryKey, { title: string; icon: string }> = {
  presentations: { title: "Presentaciones", icon: "P" },
  audio: { title: "Audios", icon: "♫" },
  video: { title: "Videos", icon: "▶" },
  documents: { title: "Documentos", icon: "▤" },
};

export function unitFilesMarkup(): string {
  return `<section class="unit-files-card ui-card">
    <div class="unit-files-heading"><div><span class="section-kicker">Solo lectura</span><h2 id="unit-files-title">Archivos de esta unidad</h2></div><button id="refresh-library" class="button button-quiet" type="button">↻ Actualizar</button></div>
    <div id="catalog-feedback" class="catalog-feedback" aria-live="polite"></div>
    <div id="unit-file-list" class="resource-category-grid" aria-label="Archivos de esta unidad"></div>
  </section>`;
}

export function renderUnitFiles(target: HTMLElement, catalog: LibraryCatalog, state: ClassroomState): CatalogFile[] {
  const files = catalog.files.filter(({ folderId }) => folderId === state.unitId);
  const categories = categorizeResources(files).filter(({ files: categoryFiles }) => categoryFiles.length > 0);
  target.innerHTML = categories.length
    ? categories.map((category) => categoryMarkup(category, state.resourceId)).join("")
    : `<div class="unit-files-empty"><span>▱</span><strong>Esta Unit no tiene archivos</strong><small>Agrega contenido desde administración web. Docente no puede editar.</small></div>`;
  return files;
}

export function categorizeResources(files: CatalogFile[]): ResourceCategory[] {
  const grouped: Record<CategoryKey, CatalogFile[]> = { presentations: [], audio: [], video: [], documents: [] };
  files.forEach((file) => grouped[categoryFor(file)].push(file));
  return (Object.keys(grouped) as CategoryKey[]).map((key) => ({ key, ...categoryMeta[key], files: grouped[key] }));
}

function categoryMarkup(category: ResourceCategory, selectedId: string | null): string {
  return `<section class="resource-category-card category-${category.key}">
    <header><span aria-hidden="true">${category.icon}</span><h3>${category.title}</h3><small>${category.files.length}</small></header>
    <div class="resource-category-list">${category.files.map((file) => fileMarkup(file, file.id === selectedId)).join("")}</div>
  </section>`;
}

function fileMarkup(file: CatalogFile, selected: boolean): string {
  return `<button class="unit-file-row${selected ? " is-selected" : ""}" type="button" data-catalog-file-id="${file.id}" aria-label="${actionLabel(file)} ${escapeHtml(file.name)}">
    <span class="unit-file-icon resource-${file.kind}" aria-hidden="true">${resourceIcon(file.kind)}</span>
    <span><strong>${escapeHtml(file.name)}</strong><small>${fileType(file)} · ${escapeHtml(file.size)}</small></span>
    <i>${actionLabel(file)}</i>
  </button>`;
}

function categoryFor(file: CatalogFile): CategoryKey {
  const extension = fileExtension(file);
  if (["ppt", "pptx", "odp", "key"].includes(extension) || file.kind === "presentation") return "presentations";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension) || file.kind === "audio") return "audio";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension) || file.kind === "video") return "video";
  return "documents";
}

function actionLabel(file: CatalogFile): string {
  const category = categoryFor(file);
  if (category === "presentations") return fileExtension(file) === "pptx" ? "Presentar" : "Abrir";
  if (category === "audio" || category === "video") return "Reproducir";
  return "Abrir";
}

function fileType(file: CatalogFile): string {
  const extension = fileExtension(file).toUpperCase();
  return extension || ({ presentation: "Presentación", video: "Video", audio: "Audio", image: "Imagen", document: "Documento" })[file.kind];
}

function fileExtension(file: CatalogFile): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}
