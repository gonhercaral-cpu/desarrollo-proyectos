import { validateAcademicElements } from "./editorialAcademicValidation.js";
import { effectiveImageDpi } from "./editorialPdfMeasurements.js";
import { isAutomaticIndexStale } from "./editorialAutomaticIndex.js";

const SAFE_FONTS = new Set(["Arial", "Helvetica", "Times", "Times New Roman", "Courier", "Verdana", "Georgia"]);

function issue({ code, severity = "warning", page, element, message }) {
  return {
    id: `${code}:${page?.id || "document"}:${element?.id || "none"}`,
    code, severity, pageId: page?.id || "", pageName: page?.name || "Documento",
    elementId: element?.id || "", elementName: element?.name || "", message,
  };
}

function estimateTextOverflow(element) {
  const fontSize = Number(element.style?.fontSize || 16);
  const lineHeight = Number(element.style?.lineHeight || 1.2);
  const charsPerLine = Math.max(1, Math.floor(Number(element.width || 1) / (fontSize * 0.55)));
  const lines = String(element.content || "").split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * lineHeight > Number(element.height || 0) + 1;
}

function hasUnresolvedVariables(element) {
  return /\{\{[^{}]+\}\}|\[Sin valor:[^\]]+\]/.test(String(element.content || ""));
}

function fontAvailable(fontFamily, availableFonts) {
  if (!fontFamily || SAFE_FONTS.has(fontFamily)) return true;
  if (availableFonts?.has(fontFamily)) return true;
  if (typeof document !== "undefined" && document.fonts?.check) return document.fonts.check(`12px "${fontFamily}"`);
  return false;
}

function validatePage(page, context) {
  const results = [];
  const elements = page.elements || [];
  const project = context.project || {};
  const internalWidth = Number(context.internalWidth || 768);
  const internalHeight = internalWidth * (Number(page.height || 10) / Number(page.width || 8));
  const pxPerIn = internalWidth / Number(page.width || 8);
  const margins = project.margins || { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
  const safe = {
    left: Number(margins.left || 0) * pxPerIn,
    top: Number(margins.top || 0) * pxPerIn,
    right: internalWidth - Number(margins.right || 0) * pxPerIn,
    bottom: internalHeight - Number(margins.bottom || 0) * pxPerIn,
  };

  if (!page.isBlank && !elements.some((element) => element.visible !== false)) {
    results.push(issue({ code: "empty_page", page, message: "Página vacía no marcada como intencional." }));
  }
  if (Number(project.bleedIn || 0) > 0 && ["transparent", "none", ""].includes(String(page.background || "").toLowerCase())) {
    const reachesBleed = elements.some((element) => element.isBackground && Number(element.x) <= 0 && Number(element.y) <= 0 && Number(element.width) >= internalWidth && Number(element.height) >= internalHeight);
    if (!reachesBleed) results.push(issue({ code: "background_bleed", page, message: "Fondo no alcanza sangrado." }));
  }
  elements.forEach((element) => {
    if (element.visible === false) return;
    if (element.type === "text" && estimateTextOverflow(element)) results.push(issue({ code: "text_overflow", severity: "error", page, element, message: "Texto desbordado del marco." }));
    if (Number(element.x) < safe.left || Number(element.y) < safe.top || Number(element.x) + Number(element.width) > safe.right || Number(element.y) + Number(element.height) > safe.bottom) {
      results.push(issue({ code: "outside_safe_area", page, element, message: "Elemento fuera del área segura." }));
    }
    if (element.type === "image") {
      if (!element.assetUrl) results.push(issue({ code: "missing_image", severity: "error", page, element, message: "Imagen sin archivo disponible." }));
      else if (effectiveImageDpi(element, page) < Number(context.minimumDpi || 150)) results.push(issue({ code: "low_resolution", page, element, message: `Resolución efectiva baja (${Math.round(effectiveImageDpi(element, page))} dpi).` }));
    }
    if (element.type === "text" && !fontAvailable(element.style?.fontFamily, context.availableFonts)) results.push(issue({ code: "font_unavailable", severity: "error", page, element, message: `Fuente no disponible: ${element.style?.fontFamily}.` }));
    if (element.type === "text" && hasUnresolvedVariables(element)) results.push(issue({ code: "unresolved_variable", severity: "error", page, element, message: "Variable sin resolver." }));
    if (["qr_audio", "audio_reference"].includes(element.academicBlockType) && !String(element.content || element.linkUrl || "").trim()) results.push(issue({ code: "empty_link", page, element, message: "QR o referencia sin destino." }));
    if (element.styleId && !context.stylesById?.has(element.styleId)) results.push(issue({ code: "invalid_style", severity: "error", page, element, message: "Referencia a estilo inexistente." }));
    if (element.componentId && !context.componentsById?.has(element.componentId)) results.push(issue({ code: "invalid_component", severity: "error", page, element, message: "Referencia a componente inexistente." }));
    if (isAutomaticIndexStale(element, context.indexInput)) results.push(issue({ code: "stale_index", page, element, message: "Índice automático desactualizado." }));
  });
  if (page.masterPageId && !context.mastersById?.has(page.masterPageId)) results.push(issue({ code: "invalid_master", severity: "error", page, message: "Página maestra vinculada inexistente." }));
  validateAcademicElements(elements, context.variables || {}).forEach((academicIssue) => results.push(issue({
    code: academicIssue.code || "academic", severity: academicIssue.severity === "error" ? "error" : "warning", page,
    element: elements.find((element) => element.id === academicIssue.elementId), message: academicIssue.message,
  })));
  return results;
}

export function runEditorialPreflight(snapshot = {}, options = {}) {
  const pages = snapshot.pages || [];
  const numbering = snapshot.numbering || {};
  const results = [];
  const seenLabels = new Map();
  pages.forEach((page) => {
    const label = (numbering?.get?.(page.id) || numbering?.[page.id])?.label;
    if (page.numberingEnabled !== false && label && label !== "—") {
      if (seenLabels.has(label)) results.push(issue({ code: "duplicate_number", severity: "error", page, message: `Numeración duplicada: ${label}.` }));
      seenLabels.set(label, page.id);
    }
  });
  const sharedContext = {
    ...options, project: snapshot.project, internalWidth: options.internalWidth || 768,
    stylesById: new Map((snapshot.styles || []).map((item) => [item.id, item])),
    componentsById: new Map((snapshot.components || []).map((item) => [item.id, item])),
    mastersById: new Map((snapshot.masters || []).map((item) => [item.id, item])),
    indexInput: { pages, sections: snapshot.sections || [], numbering },
  };
  pages.forEach((page) => results.push(...validatePage(page, sharedContext)));
  const ignored = snapshot.reviewState?.ignoredPreflight || {};
  return results.map((result) => ({ ...result, ignored: Boolean(ignored[result.id]), ignoreReason: ignored[result.id]?.reason || "" }));
}

export function summarizePreflight(results = []) {
  return results.reduce((summary, result) => {
    summary[result.severity] = (summary[result.severity] || 0) + (result.ignored ? 0 : 1);
    return summary;
  }, { error: 0, warning: 0, info: 0 });
}

export function hasBlockingPreflight(results = []) {
  return results.some((result) => result.severity === "error" && !result.ignored);
}
