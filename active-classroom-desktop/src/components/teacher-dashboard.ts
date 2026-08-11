import type { CatalogFile, CatalogLoadResult } from "../models/library-catalog";
import { loadLibraryCatalog } from "../services/library-catalog";
import { getAudienceStatus, importPresentation, isTauri, showAudienceWindow } from "../services/tauri-bridge";
import type { ImportedSessionResource } from "../services/session-resources";
import { ClassroomStore } from "../state/classroom-store";
import { escapeHtml, queryElement, querySelect } from "../utils/dom";
import { renderAudienceCard } from "./audience-window";
import { classProgramMarkup, renderClassProgram } from "./class-program";
import { mediaControlsMarkup, renderContentStage, renderPresenterState, stageMarkup } from "./presentation-stage";
import { refreshSidebarCatalog, selectionPath, setupSidebarAccordion, teacherSidebarMarkup } from "./teacher-sidebar";
import { renderUnitFiles, unitFilesMarkup } from "./unit-files";

export function renderTeacher(root: HTMLDivElement, classroomStore: ClassroomStore, initial: CatalogLoadResult): void {
  let catalog = initial.catalog;
  let catalogConnected = initial.connected;
  root.innerHTML = `<div class="teacher-shell">
    ${teacherSidebarMarkup(catalog, catalogConnected)}
    <section class="workspace">
      <header class="workspace-header">
        <div><p class="breadcrumb"><span id="header-path">${escapeHtml(selectionPath(classroomStore.snapshot))}</span></p><h1 id="workspace-title">${escapeHtml(classroomStore.snapshot.unitTitle ?? "Espacio de clase")}</h1></div>
        <div class="header-actions"><span id="catalog-sync-status" class="sync-status"><i></i> ${catalogConnected ? "Biblioteca local" : "Respaldo"}</span><button id="audience-window" class="button button-outline"><span class="screen-icon">▣</span> Pantalla del alumnado</button></div>
      </header>
      <main class="dashboard teacher-library-dashboard">
        <div class="content-column ui-stack">
          ${stageMarkup()}
          ${mediaControlsMarkup()}
          ${unitFilesMarkup()}
          <section class="notes-card ui-card"><div class="notes-title"><span>✎</span><div><strong>Instrucción para alumnado</strong><small>Sincronizada con segunda pantalla</small></div></div><textarea id="audience-message" rows="2" placeholder="Escribe indicación breve…"></textarea></section>
        </div>
        <aside class="right-rail compact-projector-rail">
          <section class="rail-card projector-card compact-projector-card ui-card">
            <div class="rail-heading"><div><span class="section-kicker">Salida externa</span><h2>Segunda pantalla</h2><small id="audience-resolution">1920 × 1080 · respaldo</small></div><span id="audience-live" class="live-pill is-offline">En espera</span></div>
            <div id="audience-preview" class="mini-audience ui-media-frame"></div>
            <button class="button button-quiet projector-open" id="projector-open">Abrir en pantalla externa</button>
          </section>
          ${classProgramMarkup()}
        </aside>
      </main>
    </section>
  </div>`;

  const message = queryElement<HTMLTextAreaElement>("audience-message");
  const feedback = queryElement<HTMLDivElement>("catalog-feedback");
  const fileList = queryElement<HTMLDivElement>("unit-file-list");
  const programContent = queryElement<HTMLDivElement>("class-program-content");
  const stage = queryElement<HTMLDivElement>("content-stage");
  const stageTitle = queryElement<HTMLElement>("stage-title");
  const slideJump = querySelect("slide-jump");
  const previousSlide = queryElement<HTMLButtonElement>("previous-slide");
  const nextSlide = queryElement<HTMLButtonElement>("next-slide");

  const renderLibrary = () => {
    queryElement("unit-files-title").textContent = `Archivos de esta unidad · ${classroomStore.snapshot.unitTitle ?? "Sin Unit"}`;
    renderUnitFiles(fileList, catalog, classroomStore.snapshot);
    renderClassProgram(programContent, catalog, classroomStore.snapshot);
    feedback.classList.toggle("has-error", !catalogConnected);
    feedback.textContent = catalogConnected ? `Catálogo actualizado ${formatCatalogDate(catalog.updatedAt)}. Cambios de admin visibles al actualizar.` : "Puente admin no disponible. Mostrando estructura base sin archivos.";
  };

  setupSidebarAccordion(classroomStore, () => {
    renderLibrary();
    renderContentStage(stage, stageTitle);
    previousSlide.disabled = true; nextSlide.disabled = true; slideJump.disabled = true; slideJump.innerHTML = "<option>—</option>";
  });

  const changeSlide = (index: number) => {
    const presentation = classroomStore.snapshot.presentation;
    if (!presentation) return;
    classroomStore.update({ currentSlideIndex: Math.max(0, Math.min(index, presentation.slides.length - 1)), audienceVisible: true });
  };
  previousSlide.addEventListener("click", () => changeSlide(classroomStore.snapshot.currentSlideIndex - 1));
  nextSlide.addEventListener("click", () => changeSlide(classroomStore.snapshot.currentSlideIndex + 1));
  stage.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-slide-direction]");
    if (!button || button.disabled) return;
    changeSlide(classroomStore.snapshot.currentSlideIndex + Number(button.dataset.slideDirection));
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !classroomStore.snapshot.presentation) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); changeSlide(classroomStore.snapshot.currentSlideIndex - 1); }
    else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") { event.preventDefault(); changeSlide(classroomStore.snapshot.currentSlideIndex + 1); }
  });
  slideJump.addEventListener("change", () => changeSlide(Number(slideJump.value)));

  message.addEventListener("input", () => classroomStore.update({ audienceMessage: message.value }));
  queryElement("show-content").addEventListener("click", () => classroomStore.update({ audienceVisible: true }));
  queryElement("hide-content").addEventListener("click", () => classroomStore.update({ audienceVisible: false }));
  queryElement("toggle-media").addEventListener("click", () => {
    const media = stage.querySelector<HTMLMediaElement>("audio, video");
    if (media) { if (media.paused) void media.play(); else media.pause(); }
    classroomStore.update({ mediaPlaying: !classroomStore.snapshot.mediaPlaying });
  });

  const openAudience = async () => {
    try { await showAudienceWindow(); await renderAudienceStatus(); }
    catch (error) { feedback.classList.add("has-error"); feedback.textContent = `No se abrió segunda pantalla: ${String(error)}`; }
  };
  queryElement("audience-window").addEventListener("click", openAudience);
  queryElement("projector-open").addEventListener("click", openAudience);

  fileList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-catalog-file-id]");
    if (!button) return;
    const file = catalog.files.find(({ id }) => id === button.dataset.catalogFileId);
    if (file) void openCatalogFile(file);
  });
  programContent.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-program-file-id]");
    if (!button) return;
    const file = catalog.files.find(({ id }) => id === button.dataset.programFileId);
    if (file) void openCatalogFile(file);
  });

  queryElement("refresh-library").addEventListener("click", async () => {
    const refreshed = await loadLibraryCatalog();
    catalog = refreshed.catalog; catalogConnected = refreshed.connected;
    refreshSidebarCatalog(catalog); renderLibrary(); updateCatalogStatus();
  });

  async function openCatalogFile(file: CatalogFile): Promise<void> {
    classroomStore.update({ resourceId: file.id });
    renderLibrary();
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "pptx") {
      if (!isTauri || !file.localPath) { feedback.classList.add("has-error"); feedback.textContent = "PPTX requiere app Tauri y binario guardado por puente local."; return; }
      try {
        feedback.classList.remove("has-error"); feedback.textContent = `Convirtiendo ${file.name}…`;
        const presentation = await importPresentation(file.localPath);
        classroomStore.update({ presentation, currentSlideIndex: 0, audienceVisible: true });
        const warnings = presentation.warnings.length + presentation.slides.reduce((count, slide) => count + slide.warnings.length, 0);
        feedback.textContent = `${presentation.slides.length} diapositivas listas · ${warnings} advertencia(s).`;
      } catch (error) { feedback.classList.add("has-error"); feedback.textContent = `No se convirtió PPTX: ${String(error)}`; }
      return;
    }
    classroomStore.update({ presentation: null, currentSlideIndex: 0 });
    renderContentStage(stage, stageTitle, catalogFileAsResource(file));
  }

  function updateCatalogStatus(): void {
    const status = queryElement("catalog-sync-status");
    status.innerHTML = `<i></i> ${catalogConnected ? "Biblioteca local" : "Respaldo"}`;
  }

  async function renderAudienceStatus(): Promise<void> {
    const status = await getAudienceStatus().catch(() => ({ visible: false, fullscreen: false, width: 1920, height: 1080, monitorCount: 0, available: false }));
    const live = queryElement("audience-live");
    live.textContent = status.visible ? "En vivo" : "En espera";
    live.classList.toggle("is-offline", !status.visible);
    queryElement("audience-resolution").textContent = `${status.width} × ${status.height}${status.available ? ` · ${status.monitorCount} pantalla(s)` : " · respaldo"}`;
  }

  renderContentStage(stage, stageTitle);
  renderLibrary(); void renderAudienceStatus();
  classroomStore.subscribe((state) => {
    if (document.activeElement !== message) message.value = state.audienceMessage;
    queryElement("header-path").textContent = selectionPath(state);
    queryElement("workspace-title").textContent = state.unitTitle ?? "Espacio de clase";
    renderAudienceCard(queryElement("audience-preview"), state, true);
    renderPresenterState(stage, stageTitle, state, previousSlide, nextSlide, slideJump);
  });
}

function catalogFileAsResource(file: CatalogFile): ImportedSessionResource {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = ["ppt", "pptx", "odp", "key"].includes(extension) ? "presentation"
    : ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension) ? "audio"
      : ["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension) ? "video"
        : file.kind;
  return { id: file.id, name: file.name, size: file.byteSize ?? 0, kind, extension, url: file.url, nativePath: file.localPath };
}

function formatCatalogDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recientemente" : date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
