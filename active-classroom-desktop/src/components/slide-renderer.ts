import type { InternalSlide, SlideElement } from "../models/presentation";
import { assetUrl } from "../services/tauri-bridge";
import { escapeHtml } from "../utils/dom";

export function renderSlideMarkup(slide: InternalSlide, controls: boolean, mediaPlaying: boolean, slideWidth: number, slideHeight: number): string {
  const aspectRatio = slideWidth / slideHeight;
  return `<div class="internal-slide" data-slide-number="${slide.number}" style="--slide-ratio:${aspectRatio}">${slide.elements.map((element) => renderSlideElement(element, controls, mediaPlaying, slideWidth)).join("")}${slide.warnings.length && controls ? `<div class="slide-warning" title="${escapeHtml(slide.warnings.join(" "))}">⚠ ${slide.warnings.length}</div>` : ""}</div>`;
}

function renderSlideElement(element: SlideElement, controls: boolean, mediaPlaying: boolean, slideWidth: number): string {
  const style = `left:${element.x}%;top:${element.y}%;width:${element.width}%;height:${element.height}%`;
  if (element.type === "text") {
    const slideWidthPoints = Math.max(1, slideWidth / 12_700);
    const fontSize = Math.max(0.25, (element.fontSize / slideWidthPoints) * 100);
    const legacyText = element.text.replace(/\s*\n\s*/g, " ");
    const content = element.runs?.length
      ? element.runs.map((run) => `<span style="${run.bold ? "font-weight:700;" : ""}${run.italic ? "font-style:italic;" : ""}${run.color ? `color:${run.color};` : ""}">${escapeHtml(run.text)}</span>`).join("")
      : escapeHtml(legacyText);
    const textStyle = `z-index:${element.zIndex ?? 2};font-size:clamp(3px,${fontSize}cqw,${Math.max(5, element.fontSize * 1.34)}px);color:${element.color ?? "#182238"};background:${element.backgroundColor ?? "transparent"};text-align:${element.textAlign ?? "left"};align-items:${element.verticalAlign ?? "center"}`;
    return `<div class="slide-text" style="${style};${textStyle}"><span class="slide-text-content">${content}</span></div>`;
  }
  if (element.type === "image") {
    const isBackground = element.x <= 1 && element.y <= 1 && element.width >= 98 && element.height >= 98;
    return `<img class="slide-image" style="${style};z-index:${element.zIndex ?? (isBackground ? 0 : 3)}" src="${assetUrl(element.path)}" alt="" />`;
  }
  const source = element.path ? assetUrl(element.path) : element.linkedTarget;
  const mediaStyle = `${style};z-index:${element.zIndex ?? 4}`;
  if (!source) return `<div class="slide-media-missing" style="${mediaStyle}">${element.mediaKind === "audio" ? "♫" : "▶"} Recurso detectado</div>`;
  const attributes = `${controls ? "controls" : ""} ${mediaPlaying ? "autoplay" : ""}`;
  return element.mediaKind === "audio"
    ? `<audio class="slide-audio" style="${mediaStyle}" src="${escapeHtml(source)}" ${attributes}></audio>`
    : `<video class="slide-video" style="${mediaStyle}" src="${escapeHtml(source)}" ${attributes}></video>`;
}
