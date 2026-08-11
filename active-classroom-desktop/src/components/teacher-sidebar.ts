import type { ResourceKind } from "../models/content";
import type { LibraryCatalog } from "../models/library-catalog";
import { type ClassroomState, ClassroomStore } from "../state/classroom-store";
import { escapeHtml } from "../utils/dom";

export function teacherSidebarMarkup(catalog: LibraryCatalog, connected: boolean): string {
  return `<aside class="sidebar">
    <div class="brand"><span class="brand-mark"><img src="/active-classroom-icon.png" alt="" /></span><div><strong>Active Classroom</strong><span>Panel docente</span></div></div>
    <div class="sidebar-library">
      <div class="section-label"><span>Biblioteca de clases</span><small>Nivel · Unit</small></div>
      <div class="class-accordion" aria-label="Contenido por nivel">${sidebarLibraryMarkup(catalog)}</div>
    </div>
    <div class="sidebar-footer"><span class="connection-dot${connected ? "" : " is-offline"}"></span><div><strong>${connected ? "Catálogo local" : "Catálogo de respaldo"}</strong><small>${connected ? "Solo lectura · admin conectado" : "Inicia admin para actualizar"}</small></div></div>
  </aside>`;
}

export function refreshSidebarCatalog(catalog: LibraryCatalog): void {
  const accordion = document.querySelector<HTMLElement>(".class-accordion");
  if (accordion) accordion.innerHTML = sidebarLibraryMarkup(catalog);
}

export function selectionPath(state: ClassroomState): string {
  return [state.levelTitle, state.unitTitle].filter(Boolean).join(" / ") || "Listos para aprender";
}

export function setupSidebarAccordion(classroomStore: ClassroomStore, onUnitSelected: () => void): void {
  const accordion = document.querySelector<HTMLElement>(".class-accordion");
  if (!accordion) return;
  accordion.onclick = (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLButtonElement>("[data-accordion-toggle]");
    if (toggle) {
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      if (!panel) return;
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      if (opening) accordion.querySelectorAll<HTMLButtonElement>(".level-toggle[aria-expanded='true']").forEach((other) => {
        if (other === toggle) return;
        other.setAttribute("aria-expanded", "false");
        const otherPanel = document.getElementById(other.getAttribute("aria-controls") ?? "");
        if (otherPanel) otherPanel.hidden = true;
      });
      toggle.setAttribute("aria-expanded", String(opening)); panel.hidden = !opening; return;
    }
    const unit = target.closest<HTMLButtonElement>(".class-unit-button");
    if (!unit) return;
    classroomStore.update({
      levelId: unit.dataset.levelId ?? null,
      levelTitle: unit.dataset.levelTitle ?? null,
      unitId: unit.dataset.unitId ?? null,
      unitTitle: unit.dataset.unitTitle ?? null,
      dayId: null,
      resourceId: null,
      presentation: null,
      currentSlideIndex: 0,
    });
    onUnitSelected();
  };
  accordion.onkeydown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(accordion.querySelectorAll<HTMLButtonElement>("button")).filter((button) => !button.closest("[hidden]"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || buttons.length === 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  classroomStore.subscribe((state) => updateActiveUnit(accordion, state));
}

function sidebarLibraryMarkup(catalog: LibraryCatalog): string {
  const levels = catalog.folders.filter(({ parentId, kind }) => parentId === null && kind === "level").sort(numberSort).slice(0, 5);
  return levels.map((level, index) => {
    const open = index === 0;
    const panelId = `level-panel-${level.id}`;
    const units = catalog.folders.filter(({ parentId, kind }) => parentId === level.id && kind === "unit").sort(numberSort);
    const tone = ["yellow", "red", "blue", "green", "purple"][index] ?? "blue";
    return `<section class="class-level level-${tone}">
      <button id="level-toggle-${level.id}" class="level-toggle" type="button" data-accordion-toggle aria-expanded="${open}" aria-controls="${panelId}" data-compact-label="N${index + 1}"><span class="level-swatch" aria-hidden="true"></span><span class="level-title">${escapeHtml(level.name)}</span><span class="level-chevron" aria-hidden="true">⌄</span></button>
      <div id="${panelId}" class="level-panel unit-list" role="region" aria-labelledby="level-toggle-${level.id}" ${open ? "" : "hidden"}>${units.map((unit) => `<button class="class-unit-button" type="button" data-level-id="${level.id}" data-level-title="${escapeHtml(level.name)}" data-unit-id="${unit.id}" data-unit-title="${escapeHtml(unit.name)}"><span>${escapeHtml(unit.name)}</span><small>${catalog.files.filter(({ folderId }) => folderId === unit.id).length}</small></button>`).join("") || `<p class="level-empty">Sin Units</p>`}</div>
    </section>`;
  }).join("");
}

function updateActiveUnit(accordion: HTMLElement, state: ClassroomState): void {
  accordion.querySelectorAll<HTMLButtonElement>(".class-unit-button").forEach((button) => {
    const active = button.dataset.unitId === state.unitId;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
}

function numberSort(a: { name: string }, b: { name: string }): number {
  return Number(a.name.match(/\d+/)?.[0] ?? 999) - Number(b.name.match(/\d+/)?.[0] ?? 999) || a.name.localeCompare(b.name, "es");
}

export function resourceIcon(kind: ResourceKind): string {
  return ({ presentation: "P", video: "▶", audio: "♫", image: "▧", document: "PDF" })[kind];
}
