import type { CatalogFile, LibraryCatalog } from "../models/library-catalog";
import type { ClassroomState } from "../state/classroom-store";
import { escapeHtml } from "../utils/dom";

export function classProgramMarkup(): string {
  return `<section class="rail-card class-program-card ui-card" aria-labelledby="class-program-title">
    <div class="rail-heading"><div><span class="section-kicker">Documento guía</span><h2 id="class-program-title">Programa de clase</h2></div></div>
    <div id="class-program-content" class="class-program-content"></div>
  </section>`;
}

export function renderClassProgram(target: HTMLElement, catalog: LibraryCatalog, state: ClassroomState): CatalogFile | undefined {
  const program = findClassProgram(catalog.files.filter(({ folderId }) => folderId === state.unitId));
  if (!program) {
    target.innerHTML = `<div class="class-program-empty"><span>PDF</span><strong>Sin programa asignado</strong><small>Agrega “Programa de clase” o “Lesson plan” desde administración.</small></div>`;
    return undefined;
  }
  const isPdf = extension(program) === "pdf" || program.mimeType === "application/pdf";
  target.innerHTML = `<div class="class-program-preview${isPdf ? " is-pdf" : ""}">${isPdf && program.url
    ? `<object data="${escapeHtml(program.url)}" type="application/pdf" aria-label="Vista previa de ${escapeHtml(program.name)}"><span>PDF</span></object>`
    : `<span>${extension(program).toUpperCase() || "DOC"}</span>`}</div>
    <div class="class-program-meta"><strong>${escapeHtml(program.name)}</strong><small>${escapeHtml(program.size)} · ${isPdf ? "PDF" : "Documento"}</small></div>
    <button class="button button-outline class-program-open" type="button" data-program-file-id="${program.id}">Abrir programa</button>`;
  return program;
}

export function findClassProgram(files: CatalogFile[]): CatalogFile | undefined {
  return files.find((file) => {
    const normalized = normalizeName(file.name.replace(/\.[^.]+$/, ""));
    const document = extension(file) === "pdf" || file.kind === "document";
    return document && (normalized.includes("programa de clase") || normalized.includes("lesson plan"));
  });
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

function extension(file: CatalogFile): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}
