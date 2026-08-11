import { ClassroomStore, type ClassroomState } from "../state/classroom-store";
import { queryElement, escapeHtml } from "../utils/dom";
import { renderSlideMarkup } from "./slide-renderer";
import { selectionPath } from "./teacher-sidebar";

export function renderAudience(root: HTMLDivElement, classroomStore: ClassroomStore): void {
  root.innerHTML = `<main class="audience-shell"><div id="audience-content" class="audience-content"></div></main>`;
  const content = queryElement<HTMLDivElement>("audience-content");
  classroomStore.subscribe((state) => renderAudienceCard(content, state, false));
}

export function renderAudienceCard(target: HTMLElement, state: ClassroomState, compact: boolean): void {
  target.classList.toggle("is-hidden", !state.audienceVisible);
  const slide = state.presentation?.slides[state.currentSlideIndex];
  target.classList.toggle("has-slide", Boolean(state.audienceVisible && slide));
  target.innerHTML = !state.audienceVisible
    ? `<div class="audience-paused"><span>●</span><p>La proyección está en pausa</p></div>`
    : slide
      ? renderSlideMarkup(slide, false, state.mediaPlaying, state.presentation?.width ?? 12_192_000, state.presentation?.height ?? 6_858_000)
      : `<div class="audience-brand">ACTIVE CLASSROOM</div><div class="audience-message">${escapeHtml(state.audienceMessage)}</div><div class="audience-path">${selectionPath(state)}</div>`;
  target.classList.toggle("compact", compact);
}
