import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { resolveLocalElements, resolveMasterElements } from "./editorialInheritance.js";
import { resolveAcademicViewElements } from "./editorialAcademicVisibility.js";
import { buildEditorialVariableValues } from "./editorialVariables.js";
import { resolveAutomaticIndexElement } from "./editorialAutomaticIndex.js";
import { getPdfPageSize } from "./editorialPdfMeasurements.js";

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("Exportación cancelada.", "AbortError");
}

function mapFont(fontFamily = "Arial") {
  const normalized = fontFamily.toLowerCase();
  if (normalized.includes("times") || normalized.includes("georgia")) return "times";
  if (normalized.includes("courier") || normalized.includes("mono")) return "courier";
  return "helvetica";
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
  doc.setLineWidth(Math.max(0, Number(style.borderWidth || 0)) / 72);
  if (!rotation) {
    const radius = Math.max(0, Number(style.cornerRadius || 0)) / 96;
    if (radius && doc.roundedRect) doc.roundedRect(x, y, width, height, radius, radius, Number(style.borderWidth || 0) > 0 ? "FD" : "F");
    else doc.rect(x, y, width, height, Number(style.borderWidth || 0) > 0 ? "FD" : "F");
    return;
  }
  const center = { x: x + width / 2, y: y + height / 2 };
  const points = [rotatePoint({ x, y }, center, rotation), rotatePoint({ x: x + width, y }, center, rotation), rotatePoint({ x: x + width, y: y + height }, center, rotation), rotatePoint({ x, y: y + height }, center, rotation)];
  doc.lines(points.slice(1).map((point, index) => [point.x - points[index].x, point.y - points[index].y]), points[0].x, points[0].y, [1, 1], Number(style.borderWidth || 0) > 0 ? "FD" : "F", true);
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

async function drawPdfElement(doc, element, page, bleedIn, imageCache, signal, settings) {
  const scale = Number(page.width || 8) / 768;
  const x = bleedIn + Number(element.x || 0) * scale;
  const y = bleedIn + Number(element.y || 0) * scale;
  const width = Number(element.width || 0) * scale;
  const height = Number(element.height || 0) * scale;
  const opacity = Math.max(0, Math.min(1, Number(element.opacity ?? 1)));
  const gState = doc.GState ? new doc.GState({ opacity, "stroke-opacity": opacity }) : null;
  if (gState) doc.setGState(gState);
  if (element.type === "shape") shapePath(doc, x, y, width, height, Number(element.rotation || 0), element.style || {});
  if (element.type === "text") {
    doc.setFont(mapFont(element.style?.fontFamily), fontStyle(element));
    doc.setFontSize(Number(element.style?.fontSize || 16));
    setColor("setTextColor", doc, element.style?.fill, "#142033");
    doc.setLineHeightFactor(Number(element.style?.lineHeight || 1.2));
    doc.text(String(element.content || ""), x, y + Number(element.style?.fontSize || 16) / 72, {
      maxWidth: width, angle: -Number(element.rotation || 0), align: element.style?.align || "left",
    });
  }
  if (element.type === "image" && element.assetUrl) {
    const data = await imageData(element.assetUrl, imageCache, signal);
    const naturalRatio = Number(element.naturalWidth || 1) / Math.max(1, Number(element.naturalHeight || 1));
    const boxRatio = width / Math.max(0.001, height);
    let drawWidth = width; let drawHeight = height; let drawX = x; let drawY = y;
    if (element.style?.fit === "contain") {
      if (naturalRatio > boxRatio) { drawHeight = width / naturalRatio; drawY += (height - drawHeight) / 2; }
      else { drawWidth = height * naturalRatio; drawX += (width - drawWidth) / 2; }
    } else if (naturalRatio > boxRatio) { drawWidth = height * naturalRatio; drawX -= (drawWidth - width) / 2; }
    else { drawHeight = width / naturalRatio; drawY -= (drawHeight - height) / 2; }
    const shouldClip = element.style?.fit !== "contain" && doc.clip;
    if (shouldClip) { doc.saveGraphicsState(); doc.rect(x, y, width, height); doc.clip(); doc.discardPath?.(); }
    doc.addImage(data, undefined, drawX, drawY, drawWidth, drawHeight, undefined, settings.type === "print" ? "NONE" : "MEDIUM", Number(element.rotation || 0));
    if (shouldClip) doc.restoreGraphicsState();
  }
  if (gState) doc.setGState(new doc.GState({ opacity: 1, "stroke-opacity": 1 }));
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
  const imageCache = new Map();
  for (let index = 0; index < pages.length; index += 1) {
    abortIfNeeded(signal);
    const page = pages[index];
    const size = getPdfPageSize(page, bleedIn);
    if (!pdf) pdf = new jsPDF({ unit: "in", format: [size.widthIn, size.heightIn], orientation: size.widthIn > size.heightIn ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true });
    else pdf.addPage([size.widthIn, size.heightIn], size.widthIn > size.heightIn ? "landscape" : "portrait");
    setColor("setFillColor", pdf, page.background, "#ffffff");
    pdf.rect(0, 0, size.widthIn, size.heightIn, "F");
    const elements = resolveEditorialPageForOutput(snapshot, page, variant);
    for (const element of elements) await drawPdfElement(pdf, element, page, bleedIn, imageCache, signal, settings);
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

async function renderPageCanvas(snapshot, page, variant, scale, format, quality, signal) {
  const pixelsPerInch = Math.max(72, Number(scale || 150));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(Number(page.width || 8) * pixelsPerInch);
  canvas.height = Math.round(Number(page.height || 10) * pixelsPerInch);
  const context = canvas.getContext("2d");
  context.fillStyle = page.background || "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  const factor = canvas.width / 768; const imageCache = new Map();
  for (const element of resolveEditorialPageForOutput(snapshot, page, variant)) {
    abortIfNeeded(signal); context.save(); context.globalAlpha = Number(element.opacity ?? 1);
    const x = Number(element.x || 0) * factor; const y = Number(element.y || 0) * factor; const width = Number(element.width || 0) * factor; const height = Number(element.height || 0) * factor;
    context.translate(x + width / 2, y + height / 2); context.rotate(Number(element.rotation || 0) * Math.PI / 180); context.translate(-width / 2, -height / 2);
    if (element.type === "shape") { context.fillStyle = element.style?.fill || "#ffffff"; context.fillRect(0, 0, width, height); if (element.style?.borderWidth) { context.strokeStyle = element.style.borderColor || "#000000"; context.lineWidth = Number(element.style.borderWidth) * factor; context.strokeRect(0, 0, width, height); } }
    if (element.type === "text") { context.fillStyle = element.style?.fill || "#142033"; context.font = `${element.style?.fontWeight || "normal"} ${Number(element.style?.fontSize || 16) * factor}px ${element.style?.fontFamily || "Arial"}`; String(element.content || "").split("\n").forEach((line, lineIndex) => context.fillText(line, 0, (lineIndex + 1) * Number(element.style?.fontSize || 16) * factor * Number(element.style?.lineHeight || 1.2), width)); }
    if (element.type === "image" && element.assetUrl) { const image = await loadCanvasImage(element.assetUrl, imageCache, signal); context.drawImage(image, 0, 0, width, height); }
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
