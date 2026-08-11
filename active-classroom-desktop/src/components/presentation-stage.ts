import type { ResourceKind } from "../models/content";
import type { ClassroomState } from "../state/classroom-store";
import type { ImportedSessionResource } from "../services/session-resources";
import { formatFileSize, resourceLabel } from "../services/session-resources";
import { escapeHtml, queryElement } from "../utils/dom";
import { renderSlideMarkup } from "./slide-renderer";

export function stageMarkup(): string {
  return `<section class="stage-card ui-card">
    <div class="stage-heading"><div><span class="section-kicker">Contenido en preparación</span><h2 id="stage-title">Tu clase está lista para comenzar</h2></div><button class="icon-button" aria-label="Pantalla completa">⛶</button></div>
    <div id="content-stage" class="content-stage ui-media-frame"></div>
    <div class="stage-progress"><span id="resource-counter">Sin recursos seleccionados</span><div class="progress-dots"><i class="active"></i><i></i><i></i><i></i></div></div>
  </section>`;
}

export function mediaControlsMarkup(): string {
  return `<section class="media-controls ui-card ui-cluster" aria-label="Controles de presentación">
    <button id="previous-slide" class="transport-button" disabled><span>↶</span><small>Anterior</small></button>
    <button id="show-content" class="transport-button transport-primary"><span>▶</span><small>Mostrar</small></button>
    <button id="hide-content" class="transport-button"><span>■</span><small>Ocultar</small></button>
    <button id="toggle-media" class="transport-button"><span>⏯</span><small>Medios</small></button>
    <button id="next-slide" class="transport-button" disabled><span>↷</span><small>Siguiente</small></button>
    <label class="slide-jump">Ir a <select id="slide-jump" aria-label="Ir a diapositiva" disabled><option>—</option></select></label>
    <div class="volume-control"><span>◖</span><input aria-label="Volumen" type="range" min="0" max="100" value="75" /><strong>75%</strong></div>
  </section>`;
}

export function resourceChip(kind: ResourceKind, label: string): string {
  return `<span class="resource-chip resource-${kind}">${label}</span>`;
}

export function renderContentStage(target: HTMLElement, title: HTMLElement, resource?: ImportedSessionResource): void {
  if (!resource) {
    title.textContent = "Tu clase está lista para comenzar";
    target.innerHTML = `<div class="stage-empty"><span class="stage-empty-icon">▱</span><h3>Selecciona archivo de esta Unit</h3><p>Biblioteca docente es solo lectura. Administración web organiza y publica contenido.</p></div>`;
    queryElement("resource-counter").textContent = "Sin recursos seleccionados";
    return;
  }
  title.textContent = resource.name;
  queryElement("resource-counter").textContent = resource.presentation
    ? `${resource.presentation.slides.length} diapositivas · formato interno`
    : `${resourceLabel(resource)} · ${formatFileSize(resource.size)}`;
  if (resource.presentation) {
    target.innerHTML = renderSlideMarkup(resource.presentation.slides[0], true, false, resource.presentation.width, resource.presentation.height);
  } else if (resource.kind === "image") {
    target.innerHTML = `<img class="stage-media" src="${resource.url}" alt="Vista previa de ${escapeHtml(resource.name)}" />`;
  } else if (resource.kind === "video") {
    target.innerHTML = `<video class="stage-media" src="${resource.url}" controls preload="metadata"></video>`;
  } else if (resource.kind === "audio") {
    target.innerHTML = `<div class="audio-stage"><span>♫</span><strong>${escapeHtml(resource.name)}</strong><audio src="${resource.url}" controls preload="metadata"></audio></div>`;
  } else if (resource.kind === "document") {
    target.innerHTML = resource.extension === "pdf"
      ? `<object class="stage-media document-preview" data="${escapeHtml(resource.url ?? "")}" type="application/pdf"><div class="file-placeholder"><span>PDF</span><strong>${escapeHtml(resource.name)}</strong><p>WebView no pudo mostrar PDF.</p>${openLink(resource)}</div></object>`
      : `<div class="file-placeholder"><span>${escapeHtml(resource.extension.toUpperCase() || "DOC")}</span><strong>${escapeHtml(resource.name)}</strong><p>Formato requiere visor compatible del sistema.</p>${openLink(resource)}</div>`;
  } else {
    target.innerHTML = `<div class="file-placeholder presentation-placeholder"><span>P</span><strong>${escapeHtml(resource.name)}</strong><p>Motor interno convierte PPTX. Este formato requiere visor compatible del sistema.</p>${openLink(resource)}</div>`;
  }
}

function openLink(resource: ImportedSessionResource): string {
  return resource.url ? `<a class="stage-open-link" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">Abrir archivo</a>` : `<small>Binario no disponible en catálogo local.</small>`;
}

export function renderPresenterState(target: HTMLElement, title: HTMLElement, state: ClassroomState, previous: HTMLButtonElement, next: HTMLButtonElement, jump: HTMLSelectElement): void {
  const presentation = state.presentation;
  if (!presentation) return;
  const index = Math.max(0, Math.min(state.currentSlideIndex, presentation.slides.length - 1));
  title.textContent = `${presentation.title} · Diapositiva ${index + 1}`;
  target.innerHTML = `${renderSlideMarkup(presentation.slides[index], true, state.mediaPlaying, presentation.width, presentation.height)}${presenterNavigationMarkup(index, presentation.slides.length)}`;
  queryElement("resource-counter").textContent = `${index + 1} / ${presentation.slides.length} · ${presentation.slides[index].warnings.length} advertencia(s) en esta diapositiva`;
  previous.disabled = index === 0;
  next.disabled = index >= presentation.slides.length - 1;
  if (jump.options.length !== presentation.slides.length) {
    jump.innerHTML = presentation.slides.map((slide, slideIndex) => `<option value="${slideIndex}">Diapositiva ${slide.number}</option>`).join("");
  }
  jump.disabled = false;
  jump.value = String(index);
}

export function renderNextPreview(target: HTMLElement, state: ClassroomState): void {
  const next = state.presentation?.slides[state.currentSlideIndex + 1];
  target.innerHTML = next ? renderSlideMarkup(next, false, false, state.presentation?.width ?? 12_192_000, state.presentation?.height ?? 6_858_000) : `<span>Fin de la presentación</span>`;
}

function presenterNavigationMarkup(index: number, total: number): string {
  return `<nav class="stage-navigation" aria-label="Navegación sobre la diapositiva">
    <button class="stage-nav-button stage-nav-previous" data-slide-direction="-1" aria-label="Diapositiva anterior" title="Diapositiva anterior (flecha izquierda)" ${index === 0 ? "disabled" : ""}><span aria-hidden="true">‹</span><small>Anterior</small></button>
    <button class="stage-nav-button stage-nav-next" data-slide-direction="1" aria-label="Diapositiva siguiente" title="Diapositiva siguiente (flecha derecha)" ${index >= total - 1 ? "disabled" : ""}><span aria-hidden="true">›</span><small>Siguiente</small></button>
  </nav>`;
}
