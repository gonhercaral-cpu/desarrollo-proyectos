import type { AppState, Resource } from "../models";
import { kindLabel, resourceIcon } from "../services/files";
import { escapeHtml, getElement, showToast } from "../utils/dom";

export function inspectorTemplate(): string {
  return `<aside id="drive-inspector" class="drive-inspector" aria-label="Inspector del archivo seleccionado">
    <div class="inspector-title"><h2>Inspector</h2><button id="close-inspector" type="button" aria-label="Cerrar inspector">×</button></div>
    <div id="inspector-details" class="inspector-details">
      <div class="preview-toolbar"><h3>Vista previa</h3><button id="fit-preview" type="button" data-fit-preview aria-pressed="false">↗ Ajustar al espacio</button></div>
      <div id="selected-file-preview" class="file-preview"></div>
      <section class="inspector-meta" aria-label="Información del archivo">
        <div id="selected-file-heading" class="selected-file-heading"></div>
        <dl id="file-metadata" class="file-metadata"></dl>
      </section>
      <div class="inspector-actions"><a id="download-action" class="download-action is-disabled" aria-disabled="true">⇩ Descargar</a><button id="share-action" type="button">⌯ Compartir</button><button id="more-action" type="button" aria-label="Más acciones">•••</button></div>
    </div>
  </aside>`;
}

export interface InspectorController { render(): void; }

export function createInspectorController(state: AppState): InspectorController {
  const preview = getElement("selected-file-preview");
  const heading = getElement("selected-file-heading");
  const metadata = getElement("file-metadata");
  const download = getElement<HTMLAnchorElement>("download-action");

  function render(): void {
    const resource = state.resources.find(({ id }) => id === state.selectedResourceId) ?? state.resources[0];
    if (!resource) {
      preview.className = "file-preview";
      preview.innerHTML = `<span class="preview-fallback"><i>＋</i><strong>Sin archivo seleccionado</strong><small>Abre una Unit y sube un archivo.</small></span>`;
      heading.innerHTML = `<div><strong>Biblioteca local</strong><small>Selecciona un recurso para inspeccionarlo.</small></div>`;
      metadata.innerHTML = "";
      download.removeAttribute("href"); download.classList.add("is-disabled"); download.setAttribute("aria-disabled", "true");
      return;
    }
    const pdf = isPdf(resource);
    preview.className = `file-preview type-preview-${resource.kind}${pdf ? " is-pdf" : ""}${preview.classList.contains("fit-preview") ? " fit-preview" : ""}`;
    preview.innerHTML = previewContent(resource);
    heading.innerHTML = `<i class="file-icon type-${resource.kind}">${resourceIcon(resource.kind)}</i><div><strong>${escapeHtml(resource.name)}</strong><small>${resource.size} · ${kindLabel(resource.kind, resource.name)} · ${resource.updated}</small></div>`;
    const persistence = resource.id.startsWith("file-") ? (resource.persisted ? "Almacenado localmente" : "Solo sesión actual") : "Incluido en demo";
    metadata.innerHTML = `${metaRow("Dimensiones", resource.dimensions ?? "—")}${metaRow("Páginas", resource.pages?.toString() ?? "—")}${metaRow("Tipo", kindLabel(resource.kind, resource.name))}${metaRow("Ubicación", "/Biblioteca")}${metaRow("Estado de publicación", `<span class="state-pill ${resource.published ? "active" : "draft"}">${resource.published ? "Activo" : "Borrador"}</span>`)}${metaRow("Persistencia", persistence)}`;
    if (resource.url) {
      download.href = resource.url;
      download.download = resource.name;
      download.classList.remove("is-disabled");
      download.removeAttribute("aria-disabled");
    } else {
      download.removeAttribute("href");
      download.removeAttribute("download");
      download.classList.add("is-disabled");
      download.setAttribute("aria-disabled", "true");
    }
  }

  getElement("close-inspector").addEventListener("click", () => { getElement("drive-inspector").hidden = true; getElement("admin-shell").classList.add("inspector-closed"); });
  getElement("fit-preview").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const fit = preview.classList.toggle("fit-preview");
    button.setAttribute("aria-pressed", String(fit));
    button.textContent = fit ? "↙ Vista normal" : "↗ Ajustar al espacio";
  });
  getElement("share-action").addEventListener("click", () => showToast("Compartir requiere backend; no disponible en prototipo local"));
  getElement("more-action").addEventListener("click", () => showToast("Más acciones: menú previsto para etapa posterior"));
  download.addEventListener("click", (event) => { if (download.getAttribute("aria-disabled") === "true") { event.preventDefault(); showToast("Descarga no disponible: recurso demo sin archivo binario"); } });

  render();
  return { render };
}

function isPdf(resource: Resource): boolean { return resource.mimeType === "application/pdf" || resource.name.toLowerCase().endsWith(".pdf"); }
function metaRow(label: string, value: string): string { return `<div><dt>${label}</dt><dd>${value}</dd></div>`; }

function previewContent(resource: Resource): string {
  if (resource.kind === "image" && resource.url) return `<img src="${resource.url}" alt="Vista previa de ${escapeHtml(resource.name)}" />`;
  if (resource.kind === "audio" && resource.url) return `<audio src="${resource.url}" controls preload="metadata"></audio>`;
  if (resource.kind === "video" && resource.url) return `<video src="${resource.url}" controls preload="metadata"></video>`;
  if (isPdf(resource) && resource.url) return `<object data="${resource.url}" type="application/pdf"><span class="preview-fallback"><i>PDF</i><strong>${escapeHtml(resource.name)}</strong><small>Zen no pudo mostrar este PDF.</small></span></object>`;
  if (resource.id === "guide") return `<article class="demo-pdf-page"><span class="prototype-watermark">VISTA DEMO</span><div class="pdf-brand"><img src="/logo-a-original.png" alt="" /><strong>Active<br /><i>Classroom</i></strong></div><h4>Guía del<br />estudiante</h4><b>Capítulo 1</b><h5>Introducción</h5><p>Esta guía acompaña objetivos y actividades clave del curso.</p><img class="pdf-landscape" src="/demo-landscape.svg" alt="" /><footer><button disabled>‹</button><span>1 de 24</span><button disabled>›</button></footer></article>`;
  return `<span class="preview-fallback"><i class="type-${resource.kind}">${resourceIcon(resource.kind)}</i><strong>${escapeHtml(resource.name)}</strong><small>${resource.url ? "Vista previa no disponible para este formato." : "Recurso demo sin binario. Sube archivo real para previsualizarlo."}</small></span>`;
}
