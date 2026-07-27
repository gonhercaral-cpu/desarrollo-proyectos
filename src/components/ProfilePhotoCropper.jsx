import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_VIEW_SIZE = 300;
const PREVIEW_SIZE = 112;
const OUTPUT_SIZE = 512;
const MAX_OUTPUT_BYTES = 400 * 1024;
const MAX_ZOOM = 3;

export default function ProfilePhotoCropper({
  sourceURL,
  fileName = "foto-perfil",
  onConfirm,
  onCancel,
}) {
  const viewportRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [viewSize, setViewSize] = useState(DEFAULT_VIEW_SIZE);
  const [imageSize, setImageSize] = useState(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    let frameId = 0;
    const updateSize = () => {
      frameId = window.requestAnimationFrame(() => {
        setViewSize(viewport.clientWidth || DEFAULT_VIEW_SIZE);
      });
    };
    const observer =
      typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver(updateSize)
        : null;

    observer?.observe(viewport);
    updateSize();

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !processing) onCancel();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, processing]);

  const metrics = imageSize
    ? getRenderMetrics(imageSize, viewSize, zoom)
    : null;
  const previewRatio = PREVIEW_SIZE / viewSize;

  function handleImageLoad(event) {
    const image = event.currentTarget;

    if (!image.naturalWidth || !image.naturalHeight) {
      setError("No se pudo leer la imagen seleccionada.");
      return;
    }

    setImageSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setPosition({ x: 0, y: 0 });
    setError("");
  }

  function handleZoomChange(value) {
    const nextZoom = clamp(Number(value), 1, MAX_ZOOM);
    setZoom(nextZoom);
    setPosition((current) =>
      clampPosition(
        {
          x: current.x * (nextZoom / zoom),
          y: current.y * (nextZoom / zoom),
        },
        imageSize,
        viewSize,
        nextZoom
      )
    );
  }

  function handlePointerDown(event) {
    if (!imageSize || processing) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position,
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextPosition = {
      x: drag.position.x + event.clientX - drag.startX,
      y: drag.position.y + event.clientY - drag.startY,
    };

    setPosition(clampPosition(nextPosition, imageSize, viewSize, zoom));
  }

  function handlePointerEnd(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  }

  function handleWheel(event) {
    if (!imageSize || processing) return;
    event.preventDefault();
    handleZoomChange(zoom + (event.deltaY < 0 ? 0.08 : -0.08));
  }

  async function handleConfirm() {
    if (!imageSize || !imageRef.current || processing) return;

    setProcessing(true);
    setError("");

    try {
      const croppedFile = await createCroppedImageFile({
        image: imageRef.current,
        imageSize,
        viewSize,
        zoom,
        position,
        fileName,
      });

      await onConfirm(croppedFile);
    } catch (cropError) {
      console.error("No se pudo preparar la foto de perfil:", cropError);
      setError(
        cropError?.message ||
          "No se pudo procesar la imagen. Intenta con otro archivo."
      );
      setProcessing(false);
    }
  }

  return (
    <div className="profile-cropper-layer" role="presentation">
      <button
        type="button"
        className="profile-cropper-backdrop"
        aria-label="Cancelar recorte"
        onClick={processing ? undefined : onCancel}
      />

      <section
        className="profile-cropper-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-cropper-title"
      >
        <header>
          <div>
            <h2 id="profile-cropper-title">Ajustar foto de perfil</h2>
            <p>Mueve la foto y ajusta el zoom dentro del círculo.</p>
          </div>
          <button
            type="button"
            aria-label="Cancelar recorte"
            autoFocus
            disabled={processing}
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className="profile-cropper-content">
          <div className="profile-cropper-workspace">
            <div
              ref={viewportRef}
              className={`profile-cropper-viewport ${
                imageSize ? "ready" : "loading"
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onWheel={handleWheel}
            >
              <img
                ref={imageRef}
                src={sourceURL}
                alt="Foto seleccionada para recortar"
                draggable="false"
                style={
                  metrics
                    ? getImageStyle(metrics, position)
                    : { visibility: "hidden" }
                }
                onLoad={handleImageLoad}
                onError={() =>
                  setError("No se pudo abrir la imagen seleccionada.")
                }
              />
              {!imageSize && !error && <span>Preparando imagen...</span>}
              <i className="profile-cropper-circle-guide" aria-hidden="true" />
            </div>

            <label className="profile-cropper-zoom">
              <span>Zoom</span>
              <input
                type="range"
                min="1"
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                disabled={!imageSize || processing}
                onChange={(event) => handleZoomChange(event.target.value)}
              />
              <strong>{Math.round(zoom * 100)}%</strong>
            </label>
          </div>

          <aside className="profile-cropper-preview-panel">
            <span>Vista previa</span>
            <div className="profile-cropper-preview">
              {metrics && (
                <img
                  src={sourceURL}
                  alt="Vista previa circular"
                  draggable="false"
                  style={getImageStyle(
                    {
                      width: metrics.width * previewRatio,
                      height: metrics.height * previewRatio,
                    },
                    {
                      x: position.x * previewRatio,
                      y: position.y * previewRatio,
                    }
                  )}
                />
              )}
            </div>
            <small>Así se verá en miniaturas y encabezado.</small>
          </aside>
        </div>

        {error && (
          <p className="profile-cropper-error" role="alert">
            {error}
          </p>
        )}

        <footer>
          <button
            type="button"
            className="visual-outline-button"
            disabled={processing}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="visual-primary-button"
            disabled={!imageSize || processing || Boolean(error)}
            onClick={handleConfirm}
          >
            {processing ? "Procesando..." : "Usar esta foto"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function getRenderMetrics(imageSize, viewSize, zoom) {
  const coverScale = Math.max(
    viewSize / imageSize.width,
    viewSize / imageSize.height
  );
  const scale = coverScale * zoom;

  return {
    scale,
    width: imageSize.width * scale,
    height: imageSize.height * scale,
  };
}

function clampPosition(position, imageSize, viewSize, zoom) {
  if (!imageSize) return { x: 0, y: 0 };

  const metrics = getRenderMetrics(imageSize, viewSize, zoom);
  const maxX = Math.max(0, (metrics.width - viewSize) / 2);
  const maxY = Math.max(0, (metrics.height - viewSize) / 2);

  return {
    x: clamp(position.x, -maxX, maxX),
    y: clamp(position.y, -maxY, maxY),
  };
}

function getImageStyle(metrics, position) {
  return {
    width: `${metrics.width}px`,
    height: `${metrics.height}px`,
    transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
  };
}

async function createCroppedImageFile({
  image,
  imageSize,
  viewSize,
  zoom,
  position,
  fileName,
}) {
  const metrics = getRenderMetrics(imageSize, viewSize, zoom);
  const sourceSize = viewSize / metrics.scale;
  const rawSourceX =
    (metrics.width / 2 - viewSize / 2 - position.x) / metrics.scale;
  const rawSourceY =
    (metrics.height / 2 - viewSize / 2 - position.y) / metrics.scale;
  const sourceX = clamp(rawSourceX, 0, imageSize.width - sourceSize);
  const sourceY = clamp(rawSourceY, 0, imageSize.height - sourceSize);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Tu navegador no pudo procesar la imagen.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  const blob = await createOptimizedBlob(canvas);
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  const safeBaseName =
    String(fileName || "foto-perfil")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "foto-perfil";

  return new File([blob], `${safeBaseName}.${extension}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

async function createOptimizedBlob(canvas) {
  for (const quality of [0.88, 0.8, 0.72]) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") break;
    if (blob.size <= MAX_OUTPUT_BYTES || quality === 0.72) {
      return blob;
    }
  }

  for (const quality of [0.86, 0.76, 0.68]) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob && (blob.size <= MAX_OUTPUT_BYTES || quality === 0.68)) {
      return blob;
    }
  }

  throw new Error("No se pudo optimizar la imagen.");
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
