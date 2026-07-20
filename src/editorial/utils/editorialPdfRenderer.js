import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { resolveLocalElements, resolveMasterElements } from "./editorialInheritance.js";
import { resolveAcademicViewElements } from "./editorialAcademicVisibility.js";
import { buildEditorialVariableValues } from "./editorialVariables.js";
import { resolveAutomaticIndexElement } from "./editorialAutomaticIndex.js";
import { getPdfPageSize } from "./editorialPdfMeasurements.js";
import { drawPdfShape, pdfFontFamily, pdfTextContent } from "./editorialPdfTypography.js";
import { borderDash, buildLinePoints, buildShapePoints, getShapeKind } from "../models/editorialShapes.js";
import { applyTextTransform, konvaTextDecoration, normalizeTextStroke, normalizeTextStyle, textContentBox } from "../models/editorialTypography.js";
import { normalizeImageBorder, normalizeShadow } from "../models/editorialEffects.js";
import { fontRecordVariant, fontVariantKey, isSafeFont } from "../models/editorialFonts.js";
import { computeBackgroundLayout, getBackgroundTileOrigins, normalizeBackgroundImage, normalizeEditorialBackground } from "../models/editorialBackground.js";
import { createEditorialPdfCoordinateAdapter, documentFontSizeToPdfPoints } from "./editorialPdfCoordinateAdapter.js";

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("Exportación cancelada.", "AbortError");
}

function fontStyle(element) {
  const weight = String(element.style?.fontWeight || "normal").toLowerCase();
  const italic = element.style?.fontStyle === "italic";
  if ((weight === "bold" || Number(weight) >= 600) && italic) return "bolditalic";
  if (weight === "bold" || Number(weight) >= 600) return "bold";
  return italic ? "italic" : "normal";
}

function setColor(method, doc, color, fallback) {
  try { doc[method](color || fallback); } catch { doc[method](fallback); }
}

function rotatePoint(point, center, angle) {
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: center.x + (point.x - center.x) * cosine - (point.y - center.y) * sine,
    y: center.y + (point.x - center.x) * sine + (point.y - center.y) * cosine,
  };
}

function shapePath(doc, x, y, width, height, rotation, style) {
  setColor("setFillColor", doc, style.fill, "#ffffff");
  setColor("setDrawColor", doc, style.borderColor, style.fill || "#ffffff");
  doc.setLineWidth(Math.max(0, Number(style.borderWidth || 0)) / 96);
  doc.setLineDashPattern?.(borderDash(style.borderStyle, style.borderWidth || 1).map((value) => value / 96), 0);
  if (!rotation) {
    const radius = Math.max(0, Number(style.cornerRadius || 0)) / 96;
    if (radius && doc.roundedRect) doc.roundedRect(x, y, width, height, radius, radius, Number(style.borderWidth || 0) > 0 ? "FD" : "F");
    else doc.rect(x, y, width, height, Number(style.borderWidth || 0) > 0 ? "FD" : "F");
    doc.setLineDashPattern?.([], 0);
    return;
  }
  const origin = { x, y };
  const points = [rotatePoint({ x, y }, origin, rotation), rotatePoint({ x: x + width, y }, origin, rotation), rotatePoint({ x: x + width, y: y + height }, origin, rotation), rotatePoint({ x, y: y + height }, origin, rotation)];
  doc.lines(points.slice(1).map((point, index) => [point.x - points[index].x, point.y - points[index].y]), points[0].x, points[0].y, [1, 1], Number(style.borderWidth || 0) > 0 ? "FD" : "F", true);
  doc.setLineDashPattern?.([], 0);
}

async function imageData(url, cache, signal) {
  if (cache.has(url)) return cache.get(url);
  abortIfNeeded(signal);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`No fue posible cargar imagen (${response.status}).`);
  const blob = await response.blob();
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
  });
  cache.set(url, data);
  return data;
}

export function resolveEditorialPageSurface(snapshot, page) {
  const master = (snapshot.masters || []).find((item) => item.id === page.masterPageId);
  const background = page?.background && typeof page.background === "object"
    ? normalizeEditorialBackground(page.background, page.backgroundImage)
    : page?.backgroundImage
      ? normalizeEditorialBackground(page.background, page.backgroundImage)
      : normalizeEditorialBackground(master?.background ?? page.background, master?.backgroundImage);
  return {
    background,
    backgroundImage: background.type === "image" ? background.image : null,
  };
}

export function resolvePdfFontSelection(element, registeredFonts = new Set()) {
  const family = element.style?.fontFamily || "Arial";
  const variant = fontStyle(element);
  if (!isSafeFont(family) && registeredFonts.has(fontVariantKey(family, variant))) return { family, variant, fallback: false };
  return { family: pdfFontFamily(family), variant, fallback: !isSafeFont(family) };
}

async function registerPdfFonts(doc, fonts = [], signal) {
  const registered = new Set();
  for (const font of fonts) {
    if (!font.pdfEmbeddable || !font.url) continue;
    abortIfNeeded(signal);
    try {
      const response = await fetch(font.url, { signal });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      const fileName = `editorial-font-${font.id}.${font.extension || "ttf"}`;
      const variant = fontRecordVariant(font);
      doc.addFileToVFS(fileName, btoa(binary));
      doc.addFont(fileName, font.family, variant);
      registered.add(fontVariantKey(font.family, variant));
    } catch {
      // Preflight ya informa fallback; exportación sigue con fuente estándar.
    }
  }
  return registered;
}

export function resolveEditorialPageForOutput(snapshot, page, variant) {
  const section = snapshot.sections.find((item) => item.id === page.sectionId) || null;
  const variables = buildEditorialVariableValues({
    project: snapshot.project, document: snapshot.document, page, section, sections: snapshot.sections,
    numbering: snapshot.numbering, customVariables: snapshot.variables, variant,
  });
  const stylesById = new Map(snapshot.styles.map((item) => [item.id, item]));
  const componentsById = new Map(snapshot.components.map((item) => [item.id, item]));
  const master = snapshot.masters.find((item) => item.id === page.masterPageId);
  const masterElements = master ? resolveMasterElements(master.elements || [], page.masterOverrides, { stylesById, variables }) : [];
  const localElements = resolveLocalElements(page.elements || [], { stylesById, componentsById, variables });
  const input = { pages: snapshot.pages, sections: snapshot.sections, numbering: snapshot.numbering };
  return resolveAcademicViewElements([...masterElements, ...localElements], variant)
    .map((element) => resolveAutomaticIndexElement(element, input))
    .filter((element) => element.visible !== false)
    .sort((left, right) => Number(left.zIndex || 0) - Number(right.zIndex || 0));
}

function strokePdfBox(doc, x, y, width, height, rotation, border) {
  setColor("setDrawColor", doc, border.color, "#1f2937");
  doc.setLineWidth(Math.max(0, Number(border.width || 0)) / 96);
  if (!rotation) {
    const radius = Math.min(width / 2, height / 2, Number(border.radius || 0) / 96);
    if (radius && doc.roundedRect) doc.roundedRect(x, y, width, height, radius, radius, "S");
    else doc.rect(x, y, width, height, "S");
    return;
  }
  const origin = { x, y };
  const points = [rotatePoint({ x, y }, origin, rotation), rotatePoint({ x: x + width, y }, origin, rotation), rotatePoint({ x: x + width, y: y + height }, origin, rotation), rotatePoint({ x, y: y + height }, origin, rotation)];
  doc.lines(points.slice(1).map((point, index) => [point.x - points[index].x, point.y - points[index].y]), points[0].x, points[0].y, [1, 1], "S", true);
}

function drawPdfText(doc, element, { x, y, width, height, scale, registeredFonts, color, offsetX = 0, offsetY = 0, decorations = true }) {
  const style = normalizeTextStyle(element.style);
  const box = textContentBox({ ...element, style });
  const drawX = x + box.x * scale + offsetX;
  const drawY = y + box.y * scale + offsetY;
  const drawWidth = Math.max(0.01, width - (box.x + style.padding.right) * scale);
  const drawHeight = Math.max(0.01, height - (box.y + style.padding.bottom) * scale);
  const selection = resolvePdfFontSelection(element, registeredFonts);
  doc.setFont(selection.family, selection.variant);
  const fontSizePt = documentFontSizeToPdfPoints(style.fontSize);
  doc.setFontSize(fontSizePt);
  doc.setLineHeightFactor(style.lineHeight);
  setColor("setTextColor", doc, color || style.fill, "#111111");
  const stroke = normalizeTextStroke(style.textStroke);
  if (stroke.enabled && decorations) {
    setColor("setDrawColor", doc, stroke.color, "#ffffff");
    doc.setLineWidth(Math.max(0.1, stroke.width) * scale);
  }
  const lines = doc.splitTextToSize ? doc.splitTextToSize(pdfTextContent(element), drawWidth) : String(pdfTextContent(element)).split("\n");
  const lineStep = style.fontSize * scale * style.lineHeight;
  const blockHeight = Math.max(lineStep, lines.length * lineStep);
  const verticalOffset = style.boxMode === "fixed_box"
    ? Math.max(0, drawHeight - blockHeight) * (style.verticalAlign === "middle" ? 0.5 : style.verticalAlign === "bottom" ? 1 : 0)
    : 0;
  const align = style.align || "left";
  const anchorX = align === "center" ? drawX + drawWidth / 2 : align === "right" ? drawX + drawWidth : drawX;
  lines.forEach((line, index) => {
    const baseline = drawY + verticalOffset + style.fontSize * scale + index * lineStep;
    doc.text(String(line), anchorX, baseline, {
      maxWidth: drawWidth,
      angle: -Number(element.rotation || 0),
      align,
      charSpace: style.letterSpacing * scale,
      ...(stroke.enabled && decorations ? { renderingMode: "fillThenStroke" } : {}),
    });
    if (!decorations) return;
    const decoration = konvaTextDecoration(style);
    if (!decoration) return;
    const measured = Math.min(drawWidth, doc.getTextWidth(String(line)));
    const startX = align === "center" ? anchorX - measured / 2 : align === "right" ? anchorX - measured : anchorX;
    setColor("setDrawColor", doc, style.fill, "#111111");
    doc.setLineWidth(Math.max(0.4, style.fontSize / 18) * scale);
    const drawDecoration = (lineY) => {
      const start = rotatePoint({ x: startX, y: lineY }, { x, y }, Number(element.rotation || 0));
      const end = rotatePoint({ x: startX + measured, y: lineY }, { x, y }, Number(element.rotation || 0));
      doc.line(start.x, start.y, end.x, end.y);
    };
    if (decoration.includes("underline")) drawDecoration(baseline + style.fontSize * scale * 0.08);
    if (decoration.includes("line-through")) drawDecoration(baseline - style.fontSize * scale * 0.32);
  });
}

async function drawPdfElement(doc, element, page, bleedIn, imageCache, signal, settings, registeredFonts) {
  const adapter = createEditorialPdfCoordinateAdapter(page, bleedIn);
  const scale = adapter.scaleIn;
  const x = adapter.xIn(element.x);
  const y = adapter.yIn(element.y);
  const width = adapter.lengthIn(element.width);
  const height = adapter.lengthIn(element.height);
  const opacity = Math.max(0, Math.min(1, Number(element.opacity ?? 1)));
  const shadow = normalizeShadow(element.type === "text" ? element.style?.textShadow : element.shadow || element.style?.shadow);
  if (shadow.enabled) {
    const shadowState = doc.GState ? new doc.GState({ opacity: opacity * shadow.opacity, "stroke-opacity": opacity * shadow.opacity }) : null;
    if (shadowState) doc.setGState(shadowState);
    const shadowX = shadow.offsetX * scale; const shadowY = shadow.offsetY * scale;
    if (element.type === "shape") {
      const shadowElement = { ...element, style: { ...(element.style || {}), fill: shadow.color, borderColor: shadow.color, borderWidth: 0 } };
      const kind = getShapeKind(element.shapeType || "rectangle");
      if (kind === "rect") shapePath(doc, x + shadowX, y + shadowY, width, height, Number(element.rotation || 0), shadowElement.style);
      else drawPdfShape(doc, { element: shadowElement, x: x + shadowX, y: y + shadowY, scale });
    } else if (element.type === "text") {
      drawPdfText(doc, element, { x, y, width, height, scale, registeredFonts, color: shadow.color, offsetX: shadowX, offsetY: shadowY, decorations: false });
    } else if (element.type === "image") {
      setColor("setFillColor", doc, shadow.color, "#0f172a");
      shapePath(doc, x + shadowX, y + shadowY, width, height, Number(element.rotation || 0), { fill: shadow.color, borderWidth: 0 });
    }
  }
  const gState = doc.GState ? new doc.GState({ opacity, "stroke-opacity": opacity }) : null;
  if (gState) doc.setGState(gState);
  if (element.type === "shape") {
    const kind = getShapeKind(element.shapeType || "rectangle");
    if (kind === "rect") shapePath(doc, x, y, width, height, Number(element.rotation || 0), element.style || {});
    else drawPdfShape(doc, { element, x, y, width, height, scale });
  }
  if (element.type === "text") {
    // Resaltado (fondo detrás del texto).
    if (element.style?.textHighlight?.enabled) {
      shapePath(doc, x, y, width, height, Number(element.rotation || 0), { fill: element.style.textHighlight.color || "#fff2ac", cornerRadius: element.style.textHighlight.radius || 0, borderWidth: 0 });
    }
    drawPdfText(doc, element, { x, y, width, height, scale, registeredFonts });
  }
  if (element.type === "image" && element.assetUrl) {
    const data = await imageData(element.assetUrl, imageCache, signal);
    const border = normalizeImageBorder(element.imageBorder || element.style?.imageBorder);
    const naturalRatio = Number(element.naturalWidth || 1) / Math.max(1, Number(element.naturalHeight || 1));
    const boxRatio = width / Math.max(0.001, height);
    let drawWidth = width; let drawHeight = height; let drawX = x; let drawY = y;
    if (element.style?.fit === "contain") {
      if (naturalRatio > boxRatio) { drawHeight = width / naturalRatio; drawY += (height - drawHeight) / 2; }
      else { drawWidth = height * naturalRatio; drawX += (width - drawWidth) / 2; }
    } else if (naturalRatio > boxRatio) { drawWidth = height * naturalRatio; drawX -= (drawWidth - width) / 2; }
    else { drawHeight = width / naturalRatio; drawY -= (drawHeight - height) / 2; }
    const shouldClip = element.style?.fit !== "contain" && doc.clip;
    if (shouldClip) {
      doc.saveGraphicsState();
      const radius = Math.min(width / 2, height / 2, border.radius / 96);
      if (radius && doc.roundedRect) doc.roundedRect(x, y, width, height, radius, radius);
      else doc.rect(x, y, width, height);
      doc.clip(); doc.discardPath?.();
    }
    doc.addImage(data, undefined, drawX, drawY, drawWidth, drawHeight, undefined, settings.type === "print" ? "NONE" : "MEDIUM", Number(element.rotation || 0));
    if (shouldClip) doc.restoreGraphicsState();
    if (border.enabled && border.width > 0) strokePdfBox(doc, x, y, width, height, Number(element.rotation || 0), border);
  }
  if (gState) doc.setGState(new doc.GState({ opacity: 1, "stroke-opacity": 1 }));
}

// Fase 8 — Imagen de fondo de página en PDF (respeta sangrado, aparece en export).
async function drawPdfBackground(doc, backgroundImage, page, size, bleedIn, imageCache, signal, surfaceOpacity = 1) {
  const background = normalizeBackgroundImage(backgroundImage);
  if (!background) return;
  const url = background.url;
  if (!url) return;
  let data;
  try { data = await imageData(url, imageCache, signal); }
  catch (error) { throw new Error("No fue posible cargar imagen de fondo para exportación.", { cause: error }); }
  const logicalW = size.widthIn * 96;
  const logicalH = size.heightIn * 96;
  const props = doc.getImageProperties ? doc.getImageProperties(data) : { width: logicalW, height: logicalH };
  const layout = computeBackgroundLayout({
    background,
    box: { width: logicalW, height: logicalH },
    natural: { width: props.width, height: props.height },
  });
  const scaleX = size.widthIn / logicalW; const scaleY = size.heightIn / logicalH;
  const gState = doc.GState ? new doc.GState({ opacity: background.opacity * surfaceOpacity }) : null;
  if (gState) doc.setGState(gState);
  const shouldClip = doc.clip;
  if (shouldClip) { doc.saveGraphicsState(); doc.rect(0, 0, size.widthIn, size.heightIn); doc.clip(); doc.discardPath?.(); }
  if (layout.mode === "tile") {
    getBackgroundTileOrigins(layout, { width: logicalW, height: logicalH }).forEach((tile) => {
      doc.addImage(data, undefined, tile.x * scaleX, tile.y * scaleY, layout.width * scaleX, layout.height * scaleY, undefined, "MEDIUM");
    });
  } else {
    doc.addImage(data, undefined, layout.x * scaleX, layout.y * scaleY, layout.width * scaleX, layout.height * scaleY, undefined, "MEDIUM", background.rotation);
  }
  if (shouldClip) doc.restoreGraphicsState();
  if (gState) doc.setGState(new doc.GState({ opacity: 1 }));
}

function drawCropMarks(doc, size) {
  const bleed = size.bleedIn;
  if (!bleed) return;
  const length = Math.min(0.2, bleed);
  doc.setDrawColor("#000000"); doc.setLineWidth(0.003);
  [[bleed, 0, bleed, length], [size.widthIn - bleed, 0, size.widthIn - bleed, length], [bleed, size.heightIn - length, bleed, size.heightIn], [size.widthIn - bleed, size.heightIn - length, size.widthIn - bleed, size.heightIn], [0, bleed, length, bleed], [size.widthIn - length, bleed, size.widthIn, bleed], [0, size.heightIn - bleed, length, size.heightIn - bleed], [size.widthIn - length, size.heightIn - bleed, size.widthIn, size.heightIn - bleed]].forEach((line) => doc.line(...line));
}

export async function renderEditorialPdf({ snapshot, pages, variant = "student", settings = {}, onProgress, signal }) {
  if (!pages.length) throw new Error("Selecciona al menos una página.");
  const print = settings.type === "print";
  const bleedIn = print ? Math.max(0, Number(settings.bleedIn ?? snapshot.project.bleedIn ?? 0)) : 0;
  let pdf = null;
  let registeredFonts = new Set();
  const imageCache = new Map();
  for (let index = 0; index < pages.length; index += 1) {
    abortIfNeeded(signal);
    const page = pages[index];
    const size = getPdfPageSize(page, bleedIn);
    if (!pdf) {
      pdf = new jsPDF({ unit: "in", format: [size.widthIn, size.heightIn], orientation: size.widthIn > size.heightIn ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true });
      registeredFonts = await registerPdfFonts(pdf, snapshot.fonts || [], signal);
    }
    else pdf.addPage([size.widthIn, size.heightIn], size.widthIn > size.heightIn ? "landscape" : "portrait");
    const surface = resolveEditorialPageSurface(snapshot, page);
    if (surface.background.type !== "none") {
      const backgroundState = pdf.GState ? new pdf.GState({ opacity: surface.background.opacity }) : null;
      if (backgroundState) pdf.setGState(backgroundState);
      setColor("setFillColor", pdf, surface.background.color, "#ffffff");
      pdf.rect(0, 0, size.widthIn, size.heightIn, "F");
      if (backgroundState) pdf.setGState(new pdf.GState({ opacity: 1 }));
    }
    await drawPdfBackground(pdf, surface.backgroundImage, page, size, bleedIn, imageCache, signal, surface.background.opacity);
    const elements = resolveEditorialPageForOutput(snapshot, page, variant);
    for (const element of elements) await drawPdfElement(pdf, element, page, bleedIn, imageCache, signal, settings, registeredFonts);
    if (print && settings.cropMarks) drawCropMarks(pdf, size);
    if (!print && settings.watermark) {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(44); pdf.setTextColor("#b8bec8");
      pdf.text(String(settings.watermarkText || "REVISIÓN"), size.widthIn / 2, size.heightIn / 2, { align: "center", angle: 35 });
    }
    if (!print && (settings.includeDate || settings.includeStatus || settings.includeVersion)) {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor("#536070");
      const footer = [settings.includeDate ? new Date().toLocaleDateString("es-MX") : "", settings.includeVersion ? settings.versionName || "Sin versión" : "", settings.includeStatus ? snapshot.document.reviewState?.status || "draft" : ""].filter(Boolean).join(" · ");
      pdf.text(footer, 0.2, size.heightIn - 0.12);
    }
    onProgress?.({ completed: index + 1, total: pages.length, percent: Math.round(((index + 1) / pages.length) * 100) });
    imageCache.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  pdf.setProperties({ title: snapshot.document.name || snapshot.project.name, subject: settings.type === "print" ? "PDF para imprenta" : "PDF de revisión", creator: "AES Editor Editorial" });
  return pdf.output("blob");
}

async function loadCanvasImage(url, cache, signal) {
  if (cache.has(url)) return cache.get(url);
  const data = await imageData(url, new Map(), signal);
  const image = await new Promise((resolve, reject) => { const next = new Image(); next.onload = () => resolve(next); next.onerror = reject; next.src = data; });
  cache.set(url, image); return image;
}

function drawCanvasShape(context, element, width, height, factor) {
  const kind = getShapeKind(element.shapeType || "rectangle");
  const style = element.style || {};
  const shadow = normalizeShadow(element.shadow || style.shadow);
  if (shadow.enabled) {
    context.shadowColor = shadow.color;
    context.shadowBlur = shadow.blur * factor;
    context.shadowOffsetX = shadow.offsetX * factor;
    context.shadowOffsetY = shadow.offsetY * factor;
  }
  context.fillStyle = style.fill || "#dce9fb";
  context.strokeStyle = style.borderColor || "#1f6fd6";
  context.lineWidth = Math.max(0, Number(style.borderWidth || 0)) * factor;
  context.setLineDash(borderDash(style.borderStyle, style.borderWidth || 1).map((value) => value * factor));
  if (kind === "rect") {
    const radius = Math.min(width / 2, height / 2, Number(style.cornerRadius || 0) * factor);
    context.beginPath();
    if (radius && context.roundRect) context.roundRect(0, 0, width, height, radius);
    else context.rect(0, 0, width, height);
    context.fill();
    if (style.borderWidth) context.stroke();
    context.setLineDash([]);
    return;
  }
  if (kind === "ellipse") {
    context.beginPath();
    context.ellipse(width / 2, height / 2, width / 2, kind === "ellipse" && element.shapeType === "circle" ? width / 2 : height / 2, 0, 0, Math.PI * 2);
    context.fill();
    if (style.borderWidth) context.stroke();
    context.setLineDash([]);
    return;
  }
  const points = kind === "line" || kind === "arrow"
    ? buildLinePoints(element.width, element.height, element)
    : buildShapePoints(element.shapeType, element.width, element.height, element);
  context.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i] * factor;
    const py = points[i + 1] * factor;
    if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
  }
  if (kind !== "line" && kind !== "arrow") { context.closePath(); context.fill(); }
  if (style.borderWidth || kind === "line" || kind === "arrow") { context.lineWidth = Math.max(1, Number(style.borderWidth || 3)) * factor; context.stroke(); }
  if (kind === "arrow") {
    const size = Math.max(8, Number(style.borderWidth || 3) * 3) * factor;
    const drawHead = (fromX, fromY, toX, toY) => {
      const angle = Math.atan2(toY - fromY, toX - fromX); const wing = Math.PI / 7;
      context.beginPath(); context.moveTo(toX, toY);
      context.lineTo(toX - Math.cos(angle - wing) * size, toY - Math.sin(angle - wing) * size);
      context.lineTo(toX - Math.cos(angle + wing) * size, toY - Math.sin(angle + wing) * size);
      context.closePath(); context.fillStyle = style.borderColor || "#1f6fd6"; context.fill();
    };
    const scaled = points.map((value) => value * factor);
    if ((style.pointerEnd || "arrow") === "arrow") drawHead(scaled.at(-4), scaled.at(-3), scaled.at(-2), scaled.at(-1));
    if ((style.pointerStart || (element.shapeType === "double_arrow" ? "arrow" : "none")) === "arrow") drawHead(scaled[2], scaled[3], scaled[0], scaled[1]);
  }
  context.setLineDash([]);
}

async function drawCanvasBackground(context, backgroundImage, page, canvas, imageCache, signal, surfaceOpacity = 1) {
  const background = normalizeBackgroundImage(backgroundImage);
  if (!background?.url) return;
  let image;
  try { image = await loadCanvasImage(background.url, imageCache, signal); }
  catch (error) { throw new Error("No fue posible cargar imagen de fondo para exportación.", { cause: error }); }
  const logicalW = Number(page.width || 8) * 96; const logicalH = Number(page.height || 10) * 96;
  const layout = computeBackgroundLayout({ background, box: { width: logicalW, height: logicalH }, natural: { width: image.width, height: image.height } });
  const factorX = canvas.width / logicalW; const factorY = canvas.height / logicalH;
  context.save();
  context.globalAlpha = background.opacity * surfaceOpacity;
  if (layout.mode === "tile") {
    getBackgroundTileOrigins(layout, { width: logicalW, height: logicalH }).forEach((tile) => context.drawImage(image, tile.x * factorX, tile.y * factorY, layout.width * factorX, layout.height * factorY));
  } else {
    const x = layout.x * factorX; const y = layout.y * factorY; const width = layout.width * factorX; const height = layout.height * factorY;
    context.translate(x + width / 2, y + height / 2);
    context.rotate(background.rotation * Math.PI / 180);
    context.drawImage(image, -width / 2, -height / 2, width, height);
  }
  context.restore();
}

function wrapCanvasText(context, text, maxWidth, letterSpacing) {
  const lines = [];
  String(text).split("\n").forEach((paragraph) => {
    const words = paragraph.split(/\s+/);
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      const width = context.measureText(candidate).width + Math.max(0, candidate.length - 1) * letterSpacing;
      if (line && width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    });
    lines.push(line);
  });
  return lines;
}

function drawCanvasTextLine(context, line, x, y, align, letterSpacing, maxWidth, stroke) {
  if (align === "justify" && line.includes(" ")) {
    const words = line.split(" ");
    const wordsWidth = words.reduce((sum, word) => sum + context.measureText(word).width + Math.max(0, word.length - 1) * letterSpacing, 0);
    const gap = Math.max(0, (maxWidth - wordsWidth) / Math.max(1, words.length - 1));
    let cursor = x;
    words.forEach((word) => {
      let wordCursor = cursor;
      if (stroke.enabled) for (const char of word) { context.strokeText(char, wordCursor, y); wordCursor += context.measureText(char).width + letterSpacing; }
      wordCursor = cursor;
      for (const char of word) { context.fillText(char, wordCursor, y); wordCursor += context.measureText(char).width + letterSpacing; }
      cursor += context.measureText(word).width + Math.max(0, word.length - 1) * letterSpacing + gap;
    });
    return { startX: x, width: maxWidth };
  }
  const measured = context.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing;
  let start = align === "center" ? x + (maxWidth - measured) / 2 : align === "right" ? x + maxWidth - measured : x;
  const draw = (method) => {
    if (!letterSpacing) { context[method](line, start, y, maxWidth); return; }
    for (const char of line) { context[method](char, start, y); start += context.measureText(char).width + letterSpacing; }
  };
  if (stroke.enabled) draw("strokeText");
  start = align === "center" ? x + (maxWidth - measured) / 2 : align === "right" ? x + maxWidth - measured : x;
  draw("fillText");
  return { startX: align === "center" ? x + (maxWidth - measured) / 2 : align === "right" ? x + maxWidth - measured : x, width: measured };
}

function drawCanvasText(context, element, factor) {
  const style = normalizeTextStyle(element.style);
  const box = textContentBox({ ...element, style });
  const x = box.x * factor; const y = box.y * factor; const boxWidth = box.width * factor; const boxHeight = box.height * factor;
  const fontSize = style.fontSize * factor; const lineStep = fontSize * style.lineHeight; const letterSpacing = style.letterSpacing * factor;
  context.fillStyle = style.fill;
  context.font = `${style.fontStyle === "italic" ? "italic " : ""}${style.fontWeight === "bold" || Number(style.fontWeight) >= 600 ? "bold" : "normal"} ${fontSize}px ${style.fontFamily || "Arial"}`;
  context.textBaseline = "alphabetic";
  const shadow = normalizeShadow(style.textShadow);
  if (shadow.enabled) { context.shadowColor = shadow.color; context.shadowBlur = shadow.blur * factor; context.shadowOffsetX = shadow.offsetX * factor; context.shadowOffsetY = shadow.offsetY * factor; }
  const stroke = normalizeTextStroke(style.textStroke);
  if (stroke.enabled) { context.strokeStyle = stroke.color; context.lineWidth = stroke.width * factor; }
  const lines = wrapCanvasText(context, applyTextTransform(String(element.resolvedContent ?? element.content ?? ""), style.textTransform), boxWidth, letterSpacing);
  const blockHeight = lines.length * lineStep;
  const verticalOffset = style.boxMode === "fixed_box" ? Math.max(0, boxHeight - blockHeight) * (style.verticalAlign === "middle" ? 0.5 : style.verticalAlign === "bottom" ? 1 : 0) : 0;
  lines.forEach((line, index) => {
    const baseline = y + verticalOffset + fontSize + index * lineStep;
    const metrics = drawCanvasTextLine(context, line, x, baseline, style.align, letterSpacing, boxWidth, stroke);
    context.shadowColor = "transparent";
    const decoration = konvaTextDecoration(style);
    context.strokeStyle = style.fill; context.lineWidth = Math.max(1, fontSize / 18);
    if (decoration.includes("underline")) { context.beginPath(); context.moveTo(metrics.startX, baseline + fontSize * .08); context.lineTo(metrics.startX + metrics.width, baseline + fontSize * .08); context.stroke(); }
    if (decoration.includes("line-through")) { context.beginPath(); context.moveTo(metrics.startX, baseline - fontSize * .32); context.lineTo(metrics.startX + metrics.width, baseline - fontSize * .32); context.stroke(); }
  });
}

function roundedCanvasPath(context, width, height, radius) {
  context.beginPath();
  if (radius && context.roundRect) context.roundRect(0, 0, width, height, Math.min(radius, width / 2, height / 2));
  else context.rect(0, 0, width, height);
}

function drawCanvasImage(context, image, element, width, height, factor) {
  const border = normalizeImageBorder(element.imageBorder || element.style?.imageBorder);
  const shadow = normalizeShadow(element.shadow || element.style?.shadow);
  if (shadow.enabled) { context.shadowColor = shadow.color; context.shadowBlur = shadow.blur * factor; context.shadowOffsetX = shadow.offsetX * factor; context.shadowOffsetY = shadow.offsetY * factor; }
  context.save(); roundedCanvasPath(context, width, height, border.enabled ? border.radius * factor : 0); context.clip();
  const imageRatio = image.width / image.height; const boxRatio = width / height;
  if (element.style?.fit === "contain") {
    const ratio = Math.min(width / image.width, height / image.height); const drawWidth = image.width * ratio; const drawHeight = image.height * ratio;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else if (imageRatio > boxRatio) {
    const cropWidth = image.height * boxRatio; context.drawImage(image, (image.width - cropWidth) / 2, 0, cropWidth, image.height, 0, 0, width, height);
  } else {
    const cropHeight = image.width / boxRatio; context.drawImage(image, 0, (image.height - cropHeight) / 2, image.width, cropHeight, 0, 0, width, height);
  }
  context.restore(); context.shadowColor = "transparent";
  if (border.enabled && border.width > 0) { roundedCanvasPath(context, width, height, border.radius * factor); context.strokeStyle = border.color; context.lineWidth = border.width * factor; context.stroke(); }
}

async function renderPageCanvas(snapshot, page, variant, scale, format, quality, signal) {
  const pixelsPerInch = Math.max(72, Number(scale || 150));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(Number(page.width || 8) * pixelsPerInch);
  canvas.height = Math.round(Number(page.height || 10) * pixelsPerInch);
  const context = canvas.getContext("2d");
  const surface = resolveEditorialPageSurface(snapshot, page);
  if (surface.background.type !== "none" || format === "jpg") {
    context.save();
    context.globalAlpha = surface.background.type === "none" ? 1 : surface.background.opacity;
    context.fillStyle = surface.background.type === "none" ? "#ffffff" : surface.background.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }
  const factor = canvas.width / (Number(page.width || 8) * 96); const imageCache = new Map();
  await drawCanvasBackground(context, surface.backgroundImage, page, canvas, imageCache, signal, surface.background.opacity);
  for (const element of resolveEditorialPageForOutput(snapshot, page, variant)) {
    abortIfNeeded(signal); context.save(); context.globalAlpha = Number(element.opacity ?? 1);
    const x = Number(element.x || 0) * factor; const y = Number(element.y || 0) * factor; const width = Number(element.width || 0) * factor; const height = Number(element.height || 0) * factor;
    context.translate(x, y); context.rotate(Number(element.rotation || 0) * Math.PI / 180);
    if (element.type === "shape") drawCanvasShape(context, element, width, height, factor);
    if (element.type === "text") {
      if (element.style?.textHighlight?.enabled) { context.save(); context.globalAlpha *= Number(element.style.textHighlight.opacity ?? 1); context.fillStyle = element.style.textHighlight.color || "#fff2ac"; roundedCanvasPath(context, width, height, Number(element.style.textHighlight.radius || 0) * factor); context.fill(); context.restore(); }
      drawCanvasText(context, element, factor);
    }
    if (element.type === "image" && element.assetUrl) { const image = await loadCanvasImage(element.assetUrl, imageCache, signal); drawCanvasImage(context, image, element, width, height, factor); }
    context.restore();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, format === "jpg" ? "image/jpeg" : "image/png", quality));
}

export async function renderEditorialImages({ snapshot, pages, variant = "student", settings = {}, onProgress, signal }) {
  const format = settings.imageFormat === "jpg" ? "jpg" : "png";
  const files = [];
  for (let index = 0; index < pages.length; index += 1) {
    const blob = await renderPageCanvas(snapshot, pages[index], variant, settings.imageDpi || 150, format, Number(settings.imageQuality || 0.9), signal);
    files.push({ name: `${String(index + 1).padStart(3, "0")}-${pages[index].name}.${format}`, blob });
    onProgress?.({ completed: index + 1, total: pages.length, percent: Math.round(((index + 1) / pages.length) * 100) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (files.length === 1) return files[0];
  const zip = new JSZip(); files.forEach((file) => zip.file(file.name, file.blob));
  return { name: `${snapshot.project.name}-${variant === "student" ? "alumno" : "maestro"}.zip`, blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }) };
}
