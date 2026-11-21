export const SIGNAGE_CAPTURE_LIMITS = Object.freeze({
  maxWidth: 640,
  quality: 0.6,
  maxDataUrlLength: 100000,
  probeTimeoutMs: 3000,
});

const FALLBACK_WIDTHS = [640, 480, 360, 240];

export function toEpochMillis(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value) || 0;
}

function limitation(captureError) {
  return { frame: null, captureError };
}

export function isDrmVideo(video) {
  return Boolean(video?.mediaKeys || video?.webkitKeys || video?.webkitKeySystem);
}

function getStageSize(stage) {
  const rect = stage?.getBoundingClientRect?.() || {};
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  return width > 0 && height > 0 ? { width, height } : { width: 1280, height: 720 };
}

function createCanvas(documentRef, width, height) {
  const canvas = documentRef.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function drawContain(context, source, sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    source,
    (canvasWidth - drawWidth) / 2,
    (canvasHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
}

// Codifica con ancho <=640 y JPEG 0.6; reduce ancho si el dataUrl excede el limite.
function encodeFrame({ documentRef, draw, stageSize }) {
  const { maxWidth, quality, maxDataUrlLength } = SIGNAGE_CAPTURE_LIMITS;
  const widths = FALLBACK_WIDTHS.filter((width) => width <= maxWidth);

  for (const targetWidth of widths) {
    const width = Math.min(targetWidth, stageSize.width);
    const height = (width * stageSize.height) / stageSize.width;
    const canvas = createCanvas(documentRef, width, height);
    const context = canvas.getContext("2d");
    if (!context) return limitation("Canvas 2D no disponible.");

    draw(context, canvas.width, canvas.height);

    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    } catch {
      return limitation("El contenido bloquea la captura (origen sin CORS).");
    }

    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/jpeg") && dataUrl.length <= maxDataUrlLength) {
      return { frame: { dataUrl, capturedAt: Date.now() }, captureError: "" };
    }
  }

  return limitation("La captura excede el tamano maximo permitido.");
}

function captureMediaElement({ element, sourceWidth, sourceHeight, stage, documentRef }) {
  const stageSize = getStageSize(stage);

  try {
    return encodeFrame({
      documentRef,
      stageSize,
      draw: (context, width, height) =>
        drawContain(context, element, sourceWidth, sourceHeight, width, height),
    });
  } catch {
    return limitation("No se pudo dibujar el elemento renderizado.");
  }
}

function captureImage(stage, documentRef) {
  const image = stage.querySelector("img");
  if (!image) return limitation("No hay imagen renderizada en el stage.");
  if (!image.complete || !(image.naturalWidth > 0)) {
    return limitation("La imagen aun no termina de cargar.");
  }

  return captureMediaElement({
    element: image,
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    stage,
    documentRef,
  });
}

function captureVideo(stage, documentRef) {
  const video = stage.querySelector("video");
  if (!video) return limitation("No hay video renderizado en el stage.");
  if (isDrmVideo(video)) return limitation("Video con proteccion DRM no capturable.");
  if (!(video.readyState >= 2) || !(video.videoWidth > 0)) {
    return limitation("El video aun no tiene fotograma disponible.");
  }

  return captureMediaElement({
    element: video,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
    stage,
    documentRef,
  });
}

function defaultProbeImage(url) {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(false);
      return;
    }

    const probe = new Image();
    const timer = setTimeout(() => resolve(false), SIGNAGE_CAPTURE_LIMITS.probeTimeoutMs);
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    probe.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    probe.src = url;
  });
}

function extractCssUrls(backgroundImage) {
  const urls = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  let match = pattern.exec(String(backgroundImage || ""));
  while (match) {
    if (match[2]) urls.push(match[2]);
    match = pattern.exec(String(backgroundImage || ""));
  }
  return urls;
}

// Devuelve "" si los recursos visuales estan completos y son capturables; si no, el motivo.
async function verifyDomResources(stage, { probeImage, getComputedStyleRef }) {
  const images = Array.from(stage.querySelectorAll?.("img") || []);
  const urls = new Set();

  for (const image of images) {
    if (!image.complete || !(image.naturalWidth > 0)) {
      return "Hay imagenes del contenido sin terminar de cargar.";
    }
    const src = image.currentSrc || image.src;
    if (src) urls.add(src);
  }

  const elements = [stage, ...Array.from(stage.querySelectorAll?.("*") || [])];
  for (const element of elements) {
    const style = getComputedStyleRef?.(element);
    extractCssUrls(style?.backgroundImage).forEach((url) => urls.add(url));
  }

  for (const url of urls) {
    if (url.startsWith("data:") || url.startsWith("blob:")) continue;
    // Si no carga con CORS, html2canvas la omitiria y la imagen saldria parcial.
    const ok = await probeImage(url);
    if (!ok) return "Un recurso del contenido no permite captura completa (CORS o carga incompleta).";
  }

  return "";
}

async function captureDom(stage, { documentRef, html2canvasLoader, probeImage, getComputedStyleRef }) {
  const reason = await verifyDomResources(stage, { probeImage, getComputedStyleRef });
  if (reason) return limitation(reason);

  let html2canvas;
  try {
    const loaded = await html2canvasLoader();
    html2canvas = loaded?.default || loaded;
  } catch {
    return limitation("html2canvas no disponible.");
  }
  if (typeof html2canvas !== "function") return limitation("html2canvas no disponible.");

  const stageSize = getStageSize(stage);

  try {
    const rendered = await html2canvas(stage, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#000",
      logging: false,
      scale: Math.min(1, SIGNAGE_CAPTURE_LIMITS.maxWidth / stageSize.width),
    });

    return encodeFrame({
      documentRef,
      stageSize,
      draw: (context, width, height) =>
        drawContain(context, rendered, rendered.width, rendered.height, width, height),
    });
  } catch {
    return limitation("No se pudo renderizar el contenido del stage.");
  }
}

/**
 * Captura real del elemento stage ya renderizado (nunca escritorio ni body).
 * Devuelve { frame: {dataUrl, capturedAt} | null, captureError: string }.
 */
export async function captureSignageStage({
  stage,
  type,
  documentRef = globalThis.document,
  html2canvasLoader = () => import("html2canvas"),
  probeImage = defaultProbeImage,
  getComputedStyleRef = globalThis.getComputedStyle?.bind(globalThis),
} = {}) {
  if (!stage || stage.isConnected === false || typeof stage.querySelector !== "function") {
    return limitation("El stage del reproductor no esta montado.");
  }
  if (!documentRef?.createElement) return limitation("Documento no disponible para capturar.");
  if (stage.querySelector("iframe")) return limitation("El contenido incluye un iframe; no se permite capturarlo.");

  try {
    if (type === "image") return captureImage(stage, documentRef);
    if (type === "video") return captureVideo(stage, documentRef);
    if (type === "template" || type === "visual_ad" || type === "room_layout") {
      return await captureDom(stage, { documentRef, html2canvasLoader, probeImage, getComputedStyleRef });
    }
    if (type === "web") {
      return limitation("Contenido web (iframe) no compatible con captura.");
    }
  } catch {
    return limitation("Error inesperado al capturar el stage.");
  }

  return limitation("No hay contenido compatible para capturar.");
}
