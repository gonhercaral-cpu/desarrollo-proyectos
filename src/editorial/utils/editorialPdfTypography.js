// Fase 8 — Adaptador de tipografía y figuras para PDF (jsPDF). Mantiene pequeño
// editorialPdfRenderer. Sin capturas: dibuja vectores desde el modelo.

import { borderDash, buildLinePoints, buildShapePoints, getShapeKind } from "../models/editorialShapes.js";
import { resolvePdfFont } from "../models/editorialFonts.js";
import { applyTextTransform } from "../models/editorialTypography.js";

// Fuente estándar de jsPDF para una familia (incrusta peso/itálica reales).
export function pdfFontFamily(family) {
  return resolvePdfFont(family);
}

// Contenido de texto con transformación de mayúsculas aplicada.
export function pdfTextContent(element) {
  return applyTextTransform(String(element?.content || ""), element?.style?.textTransform);
}

function setColor(method, doc, color, fallback) {
  try { doc[method](color || fallback); } catch { doc[method](fallback); }
}

function ellipsePoints(width, height, steps = 40) {
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    points.push(width / 2 + Math.cos(angle) * width / 2, height / 2 + Math.sin(angle) * height / 2);
  }
  return points;
}

export function rotateShapePoints(points, rotation = 0) {
  if (!rotation) return [...points];
  const radians = Number(rotation) * Math.PI / 180;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const output = [];
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]; const y = points[index + 1];
    output.push(x * cosine - y * sine, x * sine + y * cosine);
  }
  return output;
}

export function buildPdfShapeGeometry(element) {
  const kind = getShapeKind(element.shapeType || "rectangle");
  const width = Number(element.width || 1); const height = Number(element.height || 1);
  const base = kind === "ellipse"
    ? ellipsePoints(width, height)
    : kind === "line" || kind === "arrow"
      ? buildLinePoints(width, height, element)
      : buildShapePoints(element.shapeType, width, height, element);
  return { kind, points: rotateShapePoints(base, element.rotation) };
}

function drawClosedPath(doc, points, mode) {
  if (points.length < 6) return;
  const segments = [];
  for (let index = 2; index < points.length; index += 2) segments.push([points[index] - points[index - 2], points[index + 1] - points[index - 1]]);
  doc.lines(segments, points[0], points[1], [1, 1], mode, true);
}

function arrowHead(doc, fromX, fromY, toX, toY, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const wing = Math.PI / 7;
  drawClosedPath(doc, [
    toX, toY,
    toX - Math.cos(angle - wing) * size, toY - Math.sin(angle - wing) * size,
    toX - Math.cos(angle + wing) * size, toY - Math.sin(angle + wing) * size,
  ], "F");
}

// Dibuja una figura del registro en coordenadas ya escaladas (in). `scale` =
// factor px→in para convertir los puntos de la caja. Devuelve true si dibujó.
export function drawPdfShape(doc, { element, x, y, scale }) {
  const shapeType = element.shapeType || "rectangle";
  const kind = getShapeKind(shapeType);
  const style = element.style || {};
  const hasBorder = Number(style.borderWidth || 0) > 0;
  const mode = kind === "line" || kind === "arrow" ? "S" : (hasBorder ? "FD" : "F");

  setColor("setFillColor", doc, style.fill, "#ffffff");
  setColor("setDrawColor", doc, style.borderColor, style.fill || "#000000");
  doc.setLineWidth(Math.max(0.2, Number(style.borderWidth || 1)) * scale);
  const dash = borderDash(style.borderStyle, style.borderWidth || 1).map((value) => value * scale);
  doc.setLineDashPattern?.(dash, 0);

  if (kind === "line" || kind === "arrow") {
    const points = buildPdfShapeGeometry(element).points.map((value, index) =>
      (index % 2 === 0 ? x + value * scale : y + value * scale)
    );
    for (let i = 0; i < points.length - 2; i += 2) {
      doc.line(points[i], points[i + 1], points[i + 2], points[i + 3]);
    }
    const pointerSize = Math.max(8, Number(style.borderWidth || 3) * 3) * scale;
    if ((style.pointerEnd || (kind === "arrow" ? "arrow" : "none")) === "arrow" && points.length >= 4) {
      arrowHead(doc, points.at(-4), points.at(-3), points.at(-2), points.at(-1), pointerSize);
    }
    if ((style.pointerStart || (shapeType === "double_arrow" ? "arrow" : "none")) === "arrow" && points.length >= 4) {
      arrowHead(doc, points[2], points[3], points[0], points[1], pointerSize);
    }
    doc.setLineDashPattern?.([], 0);
    return true;
  }

  const flat = buildPdfShapeGeometry(element).points;
  if (!flat.length) return false;
  drawClosedPath(doc, flat.map((value, index) => index % 2 === 0 ? x + value * scale : y + value * scale), mode);
  doc.setLineDashPattern?.([], 0);
  return true;
}
