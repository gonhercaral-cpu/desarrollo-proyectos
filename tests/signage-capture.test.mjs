import test from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAGE_CAPTURE_LIMITS,
  captureSignageStage,
  isDrmVideo,
  toEpochMillis,
} from "../src/utils/signageCapture.js";

const SMALL_DATA_URL = `data:image/jpeg;base64,${"A".repeat(64)}`;

function makeDocument({ dataUrl = SMALL_DATA_URL, taint = false } = {}) {
  const canvases = [];

  return {
    canvases,
    createElement(tag) {
      assert.equal(tag, "canvas");
      const calls = [];
      const canvas = {
        width: 0,
        height: 0,
        calls,
        toDataArgs: null,
        getContext() {
          return {
            set fillStyle(value) {
              calls.push(["fillStyle", value]);
            },
            fillRect: (...args) => calls.push(["fillRect", ...args]),
            drawImage: (...args) => calls.push(["drawImage", ...args]),
          };
        },
        toDataURL(type, quality) {
          if (taint) throw new Error("SecurityError: tainted canvas");
          canvas.toDataArgs = [type, quality];
          return typeof dataUrl === "function" ? dataUrl(canvas) : dataUrl;
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

function makeStage({ img = null, video = null, imgs = [], all = [], size = { width: 1920, height: 1080 } } = {}) {
  return {
    isConnected: true,
    getBoundingClientRect: () => size,
    querySelector: (selector) => (selector === "img" ? img : selector === "video" ? video : null),
    querySelectorAll: (selector) => (selector === "img" ? imgs : selector === "*" ? all : []),
  };
}

test("imagen renderizada: canvas <=640 px, contain sobre negro y JPEG 0.6", async () => {
  const documentRef = makeDocument();
  const image = { complete: true, naturalWidth: 1000, naturalHeight: 1000 };
  const before = Date.now();

  const result = await captureSignageStage({
    stage: makeStage({ img: image }),
    type: "image",
    documentRef,
  });

  assert.equal(result.captureError, "");
  assert.equal(result.frame.dataUrl, SMALL_DATA_URL);
  assert.ok(result.frame.capturedAt >= before && result.frame.capturedAt <= Date.now());

  const [canvas] = documentRef.canvases;
  assert.equal(canvas.width, SIGNAGE_CAPTURE_LIMITS.maxWidth);
  assert.equal(canvas.height, 360);
  assert.deepEqual(canvas.toDataArgs, ["image/jpeg", 0.6]);
  assert.deepEqual(canvas.calls[0], ["fillStyle", "#000"]);
  assert.deepEqual(canvas.calls[1], ["fillRect", 0, 0, 640, 360]);
  // Contain: 1000x1000 en 640x360 => 360x360 centrado (barras negras laterales).
  assert.deepEqual(canvas.calls[2], ["drawImage", image, 140, 0, 360, 360]);
});

test("imagen incompleta o con canvas contaminado (CORS) no genera frame", async () => {
  const incomplete = await captureSignageStage({
    stage: makeStage({ img: { complete: false, naturalWidth: 0 } }),
    type: "image",
    documentRef: makeDocument(),
  });
  assert.equal(incomplete.frame, null);
  assert.match(incomplete.captureError, /no termina|aun no/i);

  const tainted = await captureSignageStage({
    stage: makeStage({ img: { complete: true, naturalWidth: 10, naturalHeight: 10 } }),
    type: "image",
    documentRef: makeDocument({ taint: true }),
  });
  assert.equal(tainted.frame, null);
  assert.match(tainted.captureError, /CORS/);
});

test("video: rechaza no listo y DRM; captura fotograma listo", async () => {
  assert.equal(isDrmVideo({ mediaKeys: {} }), true);
  assert.equal(isDrmVideo({}), false);

  const notReady = await captureSignageStage({
    stage: makeStage({ video: { readyState: 1, videoWidth: 0 } }),
    type: "video",
    documentRef: makeDocument(),
  });
  assert.equal(notReady.frame, null);

  const drm = await captureSignageStage({
    stage: makeStage({ video: { readyState: 4, videoWidth: 1280, videoHeight: 720, mediaKeys: {} } }),
    type: "video",
    documentRef: makeDocument(),
  });
  assert.equal(drm.frame, null);
  assert.match(drm.captureError, /DRM/);

  const documentRef = makeDocument();
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
  const ready = await captureSignageStage({ stage: makeStage({ video }), type: "video", documentRef });
  assert.ok(ready.frame);
  assert.equal(documentRef.canvases[0].calls[2][1], video);
});

test("iframe/web se declara no compatible sin crear canvas", async () => {
  const documentRef = makeDocument();
  const result = await captureSignageStage({ stage: makeStage(), type: "web", documentRef });

  assert.equal(result.frame, null);
  assert.match(result.captureError, /no compatible/);
  assert.equal(documentRef.canvases.length, 0);
});

test("reduce ancho cuando excede 100k y rechaza si aun asi no cabe", async () => {
  const image = { complete: true, naturalWidth: 100, naturalHeight: 100 };
  const big = `data:image/jpeg;base64,${"A".repeat(SIGNAGE_CAPTURE_LIMITS.maxDataUrlLength)}`;

  const shrinking = makeDocument({ dataUrl: (canvas) => (canvas.width > 400 ? big : SMALL_DATA_URL) });
  const fits = await captureSignageStage({ stage: makeStage({ img: image }), type: "image", documentRef: shrinking });
  assert.ok(fits.frame);
  assert.ok(fits.frame.dataUrl.length <= SIGNAGE_CAPTURE_LIMITS.maxDataUrlLength);
  assert.ok(shrinking.canvases.at(-1).width <= 400);

  const never = await captureSignageStage({
    stage: makeStage({ img: image }),
    type: "image",
    documentRef: makeDocument({ dataUrl: big }),
  });
  assert.equal(never.frame, null);
  assert.match(never.captureError, /tamano/);
});

test("template/visual_ad: sin garantia de recursos completos no hay imagen parcial", async () => {
  let html2canvasCalls = 0;
  const html2canvasLoader = async () => ({
    default: async () => {
      html2canvasCalls += 1;
      return { width: 640, height: 360 };
    },
  });
  const getComputedStyleRef = (element) => ({ backgroundImage: element.bg || "none" });
  const base = {
    type: "visual_ad",
    documentRef: makeDocument(),
    html2canvasLoader,
    getComputedStyleRef,
  };

  const blockedBackground = await captureSignageStage({
    ...base,
    stage: makeStage({ all: [{ bg: 'url("https://cdn.test/bg.png")' }] }),
    probeImage: async () => false,
  });
  assert.equal(blockedBackground.frame, null);
  assert.match(blockedBackground.captureError, /CORS/);

  const loadingImage = await captureSignageStage({
    ...base,
    stage: makeStage({ imgs: [{ complete: false, naturalWidth: 0 }] }),
    probeImage: async () => true,
  });
  assert.equal(loadingImage.frame, null);
  assert.equal(html2canvasCalls, 0);

  const complete = await captureSignageStage({
    ...base,
    stage: makeStage({
      imgs: [{ complete: true, naturalWidth: 50, currentSrc: "https://cdn.test/logo.png" }],
      all: [{ bg: 'url("blob:local-bg")' }],
    }),
    probeImage: async () => true,
  });
  assert.ok(complete.frame);
  assert.equal(html2canvasCalls, 1);
});

test("stage ausente o desmontado no captura", async () => {
  const missing = await captureSignageStage({ stage: null, type: "image", documentRef: makeDocument() });
  assert.equal(missing.frame, null);

  const detached = { ...makeStage(), isConnected: false };
  const result = await captureSignageStage({ stage: detached, type: "image", documentRef: makeDocument() });
  assert.equal(result.frame, null);
});

test("toEpochMillis normaliza numeros, ISO y Timestamp", () => {
  assert.equal(toEpochMillis(1500), 1500);
  assert.equal(toEpochMillis("2026-01-01T00:00:00.000Z"), Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(toEpochMillis({ toMillis: () => 42 }), 42);
  assert.equal(toEpochMillis({ seconds: 2 }), 2000);
  assert.equal(toEpochMillis(null), 0);
});
