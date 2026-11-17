import assert from "node:assert/strict";
import { test } from "node:test";
import { SlideThumbnails, rasterizeImage, fitThumbnail, imageDimensions, fetchLocalBytes } from "../src/player/slide-thumbnails.ts";

const withTimeout = (promise, ms = 2000) => Promise.race([promise, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("la promesa no se resolvió a tiempo")), ms).unref())]);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 200; i++) await tick(); }
const pdfResource = id => ({ resourceId: id, name: `${id}.pdf`, download: { mimeType: "application/pdf", sizeBytes: 1000 } });
const imageResource = id => ({ resourceId: id, name: `${id}.png`, download: { mimeType: "image/png", sizeBytes: 100 } });

function manifest(count, extra = {}) {
  return {
    mainPresentationId: "deck",
    resources: [pdfResource("deck"), ...(extra.resources || [])],
    slides: Array.from({ length: count }, (_, index) => ({ slideId: `s${index}`, index, title: `Slide ${index + 1}`, resourceIds: [], metadata: { pageNumber: index + 1, ...(extra.metadata?.(index) || {}) } })),
  };
}
function harness(m, options = {}) {
  const log = { verify: [], fetch: [], raster: [], opened: [], destroyed: [], rendered: [], revoked: [], created: 0, active: 0, maxActive: 0, evicted: [] };
  const classroom = { manifest: m, resolveResource: id => ({ path: `/cache/${id}`, mimeType: m.resources.find(item => item.resourceId === id).download.mimeType, name: id, kind: "x" }) };
  let renderGate = null;
  const thumbnails = new SlideThumbnails({
    classroom, toUrl: path => `asset://localhost${path}`,
    verifyResource: async id => { log.verify.push(id); return !options.invalid?.has(id); },
    fetchBytes: async (url, signal, max) => {
      log.fetch.push(url); log.maxRequested = max; if (signal.aborted) throw new Error("abort");
      if (options.fetchHang) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("abort")), { once: true }));
      return new Uint8Array(options.bytesLength ?? m.resources.find(item => url.endsWith(`/${item.resourceId}`)).download.sizeBytes);
    },
    rasterizeImage: async (blob, signal) => { log.raster.push(blob.size); if (signal.aborted) throw new Error("abort"); return new Blob(["small"]); },
    openPdf: async (_bytes, signal) => {
      if (options.openHang) { log.openStarted = (log.openStarted || 0) + 1; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { log.openAborted = (log.openAborted || 0) + 1; reject(new Error("abort")); }, { once: true })); }
      if (options.openFail) throw new Error(options.openFail);
      const doc = { id: log.opened.length, destroyed: false,
        async render(page, signal) {
          log.active++; log.maxActive = Math.max(log.maxActive, log.active);
          try {
            if (renderGate && !signal.aborted) await new Promise(resolve => { renderGate.waiting.push(resolve); signal.addEventListener("abort", resolve, { once: true }); });
            if (signal.aborted) throw new Error("abort");
            if (options.failPages?.has(page)) throw new Error(`falla ${page}`);
            log.rendered.push(page); return new Blob([`page-${page}`]);
          } finally { log.active--; }
        },
        destroy() { doc.destroyed = true; log.destroyed.push(doc.id); } };
      log.opened.push(doc); return doc;
    },
    objectUrls: { create: () => `blob:thumb-${++log.created}`, revoke: url => log.revoked.push(url) },
    maxCacheEntries: options.cache, maxSourceBytes: options.maxBytes, openTimeoutMs: options.openTimeout, cancelGraceMs: options.grace,
  });
  thumbnails.onEvict = index => log.evicted.push(index);
  if (options.retain) thumbnails.retain = options.retain;
  return { thumbnails, log, gate() { renderGate = { waiting: [] }; return { release: () => { const waiting = renderGate.waiting.splice(0); for (const resolve of waiting) resolve(); }, get waiting() { return renderGate.waiting.length; } }; } };
}

test("referencia: imagen de la diapositiva, PDF principal con página explícita o implícita", () => {
  const m = manifest(3, { resources: [imageResource("img-2")], metadata: index => index === 1 ? { presentationResourceId: "img-2", pageNumber: 1 } : index === 2 ? { pageNumber: undefined } : {} });
  const { thumbnails } = harness(m);
  assert.deepEqual(thumbnails.reference(0), { resourceId: "deck", page: 1 });
  assert.deepEqual(thumbnails.reference(1), { resourceId: "img-2", page: 1 });
  assert.deepEqual(thumbnails.reference(2), { resourceId: "deck", page: 3 });
  assert.equal(thumbnails.reference(9), null);
});

test("200 diapositivas: un solo PDF abierto, un solo verify, renders seriales y caché acotada con URLs revocadas", async () => {
  const h = harness(manifest(200), { cache: 8 }); h.gate();
  const results = Array.from({ length: 200 }, (_, index) => h.thumbnails.request(index));
  await settle();
  assert.equal(h.log.opened.length, 1, "un único documento PDF");
  assert.equal(h.thumbnails.pendingCount, 200);
  h.thumbnails.cancelAll(); assert.ok((await withTimeout(Promise.all(results))).every(result => result.status === "cancelled"), "cancelAll resuelve todo sin liberar la compuerta");
  const progressive = harness(manifest(200), { cache: 8 });
  for (let index = 0; index < 20; index++) assert.equal((await progressive.thumbnails.request(index)).status, "ready");
  assert.equal(progressive.log.maxActive, 1); assert.equal(progressive.log.fetch.length, 1); assert.equal(progressive.log.verify.length, 1); assert.equal(progressive.log.opened.length, 1);
  assert.equal(progressive.thumbnails.cachedCount, 8); assert.equal(progressive.log.revoked.length, 12);
  assert.deepEqual(progressive.log.evicted, Array.from({ length: 12 }, (_, index) => index));
  assert.equal(progressive.thumbnails.get(0), undefined); assert.ok(progressive.thumbnails.get(19));
  assert.equal(progressive.log.rendered.length, 20, "no se renderiza lo no pedido");
});

test("los renders corren en serie aunque se pidan en paralelo y respetan prioridad", async () => {
  const h = harness(manifest(10)); const gate = h.gate();
  const pending = [h.thumbnails.request(0), h.thumbnails.request(1), h.thumbnails.request(2), h.thumbnails.request(3, { priority: true })];
  await settle(); assert.equal(h.log.active, 1);
  gate.release(); await settle(); gate.release(); await settle(); gate.release(); await settle(); gate.release(); await settle();
  await Promise.all(pending);
  assert.equal(h.log.maxActive, 1); assert.deepEqual(h.log.rendered, [1, 4, 2, 3]);
});

test("cancelar: un trabajo en cola nunca renderiza y uno en curso se aborta; con dos solicitantes sobrevive al primer cancel", async () => {
  const h = harness(manifest(5)); const gate = h.gate();
  const running = h.thumbnails.request(0), queued = h.thumbnails.request(1), shared = h.thumbnails.request(2); const sharedAgain = h.thumbnails.request(2);
  await settle(); assert.equal(h.log.active, 1);
  h.thumbnails.cancel(1); assert.deepEqual(await queued, { status: "cancelled" });
  h.thumbnails.cancel(2); assert.equal(h.thumbnails.pendingCount, 2, "otro solicitante lo mantiene");
  h.thumbnails.cancel(0); gate.release(); assert.deepEqual(await running, { status: "cancelled" });
  gate.release(); await settle(); gate.release(); await settle();
  assert.equal((await shared).status, "ready"); assert.equal((await sharedAgain).status, "ready");
  assert.deepEqual(h.log.rendered, [3]); assert.equal(h.thumbnails.get(0), undefined);
  assert.equal(h.thumbnails.pendingCount, 0);
});

test("fallos explícitos: archivo dañado, demasiado grande, página que falla; reintento posible", async () => {
  const damaged = harness(manifest(2), { invalid: new Set(["deck"]) });
  const result = await damaged.thumbnails.request(0);
  assert.equal(result.status, "error"); assert.match(result.message, /dañado/); assert.equal(damaged.log.fetch.length, 0);
  const big = manifest(2); big.resources[0].download.sizeBytes = 64 * 1024 * 1024;
  const large = harness(big); assert.match((await large.thumbnails.request(0)).message, /demasiado grande/); assert.equal(large.log.fetch.length, 0);
  const flaky = harness(manifest(3), { failPages: new Set([2]) });
  assert.equal((await flaky.thumbnails.request(0)).status, "ready");
  assert.match((await flaky.thumbnails.request(1)).message, /falla 2/); assert.match(flaky.thumbnails.failure(1), /falla 2/);
  assert.equal((await flaky.thumbnails.request(1)).status, "error"); assert.equal(flaky.log.rendered.length, 1, "no reintenta solo");
  assert.equal((await flaky.thumbnails.request(2)).status, "ready");
});

test("solo se aceptan URLs locales: nunca se descarga un origen remoto", async () => {
  const m = manifest(1); const fetched = [];
  const thumbnails = new SlideThumbnails({ classroom: { manifest: m, resolveResource: () => ({ path: "/x", mimeType: "application/pdf", name: "x", kind: "x" }) }, toUrl: () => "https://example.com/deck.pdf", verifyResource: async () => true, fetchBytes: async url => { fetched.push(url); return new Uint8Array(1); }, openPdf: async () => ({ render: async () => new Blob(["x"]), destroy() {} }), objectUrls: { create: () => "blob:x", revoke() {} } });
  assert.equal((await thumbnails.request(0)).status, "error"); assert.deepEqual(fetched, []);
});

test("imágenes por diapositiva se leen como blob y un cambio de recurso PDF cierra el documento anterior (máximo uno activo)", async () => {
  const m = manifest(4, { resources: [pdfResource("deck-b"), imageResource("img")], metadata: index => index === 2 ? { presentationResourceId: "deck-b", pageNumber: 1 } : index === 3 ? { presentationResourceId: "img" } : {} });
  const h = harness(m);
  assert.equal((await h.thumbnails.request(0)).status, "ready");
  assert.equal((await h.thumbnails.request(2)).status, "ready");
  assert.equal(h.log.opened.length, 2); assert.deepEqual(h.log.destroyed, [0]);
  assert.equal(h.log.opened.filter(doc => !doc.destroyed).length, 1);
  assert.equal((await h.thumbnails.request(3)).status, "ready"); assert.equal(h.log.rendered.length, 2, "la imagen no pasa por PDF");
  assert.equal(h.log.fetch.at(-1), "asset://localhost/cache/img"); assert.deepEqual(h.log.raster, [100], "la imagen se rasteriza, no se conserva el original");
});

test("dispose: cancela pendientes, revoca todas las URLs, destruye el PDF y rechaza nuevas solicitudes", async () => {
  const h = harness(manifest(6)); const gate = h.gate();
  const ready = [h.thumbnails.request(0)]; await settle(); gate.release(); await ready[0];
  const running = h.thumbnails.request(1), queued = h.thumbnails.request(2); await settle();
  h.thumbnails.dispose(); gate.release();
  assert.deepEqual(await running, { status: "cancelled" }); assert.deepEqual(await queued, { status: "cancelled" });
  assert.deepEqual(h.log.revoked, ["blob:thumb-1"]); assert.equal(h.thumbnails.cachedCount, 0); await settle();
  assert.deepEqual(h.log.destroyed, [0]); assert.equal(h.thumbnails.hasOpenPdf, false);
  assert.deepEqual(await h.thumbnails.request(3), { status: "cancelled" });
  h.thumbnails.dispose();
});

test("PDF que no abre (timeout): falla con mensaje, aborta la tarea, no bloquea la cola y no reintenta por página", async () => {
  const h = harness(manifest(4, { resources: [imageResource("img")], metadata: index => index === 3 ? { presentationResourceId: "img" } : {} }), { openHang: true, openTimeout: 30 });
  const first = await withTimeout(h.thumbnails.request(0));
  assert.equal(first.status, "error"); assert.match(first.message, /Tiempo agotado/); assert.equal(h.log.openAborted, 1, "la tarea recibe el abort");
  assert.equal(h.thumbnails.hasOpenPdf, false, "el documento fallido se libera");
  assert.match((await withTimeout(h.thumbnails.request(1))).message, /Tiempo agotado/); assert.equal(h.log.openStarted, 1, "las demás páginas fallan sin reabrir");
  assert.equal((await withTimeout(h.thumbnails.request(3))).status, "ready", "una imagen después sigue funcionando");
  assert.match((await withTimeout(h.thumbnails.request(2, { retry: true }))).message, /Tiempo agotado/); assert.equal(h.log.openStarted, 2, "retry sí reabre");
});

test("PDF corrupto o con contraseña: error explícito, sin documento abierto y la cola sigue", async () => {
  for (const message of ["PDF corrupto", "PDF protegido con contraseña."]) {
    const h = harness(manifest(3), { openFail: message });
    const [a, b] = await withTimeout(Promise.all([h.thumbnails.request(0), h.thumbnails.request(1)]));
    assert.equal(a.status, "error"); assert.equal(a.message, message); assert.equal(b.message, message);
    assert.equal(h.thumbnails.hasOpenPdf, false); assert.equal(h.thumbnails.pendingCount, 0);
  }
});

test("dispose durante la apertura del PDF o la lectura cancela de inmediato, sin esperar la tarea", async () => {
  for (const hang of [{ openHang: true }, { fetchHang: true }]) {
    const h = harness(manifest(3), { ...hang, openTimeout: 60000 });
    const running = h.thumbnails.request(0), queued = h.thumbnails.request(1); await settle();
    h.thumbnails.dispose();
    assert.deepEqual(await withTimeout(running, 500), { status: "cancelled" }); assert.deepEqual(await withTimeout(queued, 500), { status: "cancelled" });
    assert.equal(h.thumbnails.hasOpenPdf, false); if (hang.openHang) assert.equal(h.log.openAborted, 1);
  }
});

test("dispose durante un render que nunca termina cancela de inmediato", async () => {
  const h = harness(manifest(2)); const gate = h.gate();
  const running = h.thumbnails.request(0); await settle(); assert.equal(h.log.active, 1);
  h.thumbnails.dispose();
  assert.deepEqual(await withTimeout(running, 500), { status: "cancelled" }); gate.release();
});

test("cancelar un render atascado que ignora el abort: pasada la gracia se descarta el documento y la cola avanza", async () => {
  const m = manifest(3), log = { opened: 0, destroyed: 0 };
  const thumbnails = new SlideThumbnails({ classroom: { manifest: m, resolveResource: id => ({ path: `/c/${id}`, mimeType: "application/pdf", name: id, kind: "x" }) }, toUrl: p => `asset://localhost${p}`, verifyResource: async () => true, cancelGraceMs: 20,
    fetchBytes: async () => new Uint8Array(1000),
    openPdf: async () => { const id = ++log.opened; return { render: page => id === 1 && page === 1 ? new Promise(() => {}) : Promise.resolve(new Blob(["x"])), destroy() { log.destroyed++; } }; },
    objectUrls: { create: () => "blob:x", revoke() {} } });
  const stuck = thumbnails.request(0), next = thumbnails.request(1); await settle();
  thumbnails.cancel(0); assert.deepEqual(await withTimeout(stuck, 500), { status: "cancelled" });
  assert.equal((await withTimeout(next)).status, "ready"); assert.equal(log.opened, 2, "documento atascado reemplazado"); assert.equal(log.destroyed, 1);
});

test("imágenes: se rasterizan con el hook, el original no se conserva y los bytes se validan contra el manifiesto", async () => {
  const m = manifest(2, { resources: [imageResource("img")], metadata: index => index === 1 ? { presentationResourceId: "img" } : {} });
  const h = harness(m);
  assert.equal((await h.thumbnails.request(1)).status, "ready"); assert.equal(h.log.maxRequested, 100, "el tope de lectura es el tamaño del manifiesto");
  const wrong = harness(m, { bytesLength: 99 });
  assert.match((await wrong.thumbnails.request(1)).message, /tamaño distinto/); assert.deepEqual(wrong.log.raster, []);
  const pdfWrong = harness(m, { bytesLength: 5 });
  assert.match((await pdfWrong.thumbnails.request(0)).message, /tamaño distinto/); assert.equal(pdfWrong.log.opened.length, 0);
});

test("rasterizeImage: reduce a 320x200 máximo sin ampliar, cierra el bitmap y libera el canvas", async () => {
  assert.deepEqual(fitThumbnail(4000, 2000), { width: 320, height: 160 }); assert.deepEqual(fitThumbnail(1000, 1000), { width: 200, height: 200 });
  assert.deepEqual(fitThumbnail(100, 50), { width: 100, height: 50 }, "no se amplía");
  const events = [];
  const deps = { createImageBitmap: async () => ({ width: 4000, height: 3000, close: () => events.push("close") }),
    createCanvas: (w, h) => { events.push(`canvas ${w}x${h}`); return { draw: (_s, dw, dh) => events.push(`draw ${dw}x${dh}`), toBlob: async () => new Blob(["thumb"]), release: () => events.push("release") }; } };
  const blob = await rasterizeImage(new Blob([new Uint8Array(10)]), deps);
  assert.equal(await blob.text(), "thumb"); assert.deepEqual(events, ["canvas 267x200", "draw 267x200", "release", "close"]);
  // Falla al dibujar: aun así se cierra todo.
  events.length = 0;
  await assert.rejects(rasterizeImage(new Blob([new Uint8Array(10)]), { ...deps, createCanvas: () => ({ draw() { throw new Error("boom"); }, toBlob: async () => new Blob(), release: () => events.push("release") }) }), /boom/);
  assert.deepEqual(events, ["release", "close"]);
});

test("rasterizeImage: límite de píxeles de origen por cabecera y tras decodificar; fallback con Image revoca el temporal", async () => {
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 20000); new DataView(png.buffer).setUint32(20, 20000);
  assert.deepEqual(imageDimensions(png), { width: 20000, height: 20000 });
  let decoded = 0;
  await assert.rejects(rasterizeImage(new Blob([png]), { maxPixels: 1e6, createImageBitmap: async () => { decoded++; return { width: 1, height: 1 }; } }), /demasiado grande/);
  assert.equal(decoded, 0, "se rechaza antes de decodificar");
  const closed = []; // sin cabecera reconocible: el límite se aplica tras decodificar y el bitmap se cierra
  await assert.rejects(rasterizeImage(new Blob([new Uint8Array(8)]), { maxPixels: 100, createImageBitmap: async () => ({ width: 50, height: 50, close: () => closed.push(1) }) }), /demasiado grande/);
  assert.equal(closed.length, 1);
  const events = [];
  const out = await rasterizeImage(new Blob([new Uint8Array(8)]), { createImageBitmap: undefined, loadImage: async () => ({ source: {}, width: 640, height: 400, release: () => events.push("revoke") }),
    createCanvas: (w, h) => ({ draw: () => events.push(`draw ${w}x${h}`), toBlob: async () => new Blob(["t"]), release: () => events.push("release") }) });
  assert.equal(out.size, 1); assert.deepEqual(events, ["draw 320x200", "release", "revoke"]);
});

test("fetchLocalBytes: corta durante el streaming sin leer todo el cuerpo", async t => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 200 }));
  await assert.rejects(fetchLocalBytes("asset://x", new AbortController().signal, 4096), /demasiado grande/);
  assert.ok(pulled <= 8, `se leyó de más: ${pulled}`); await tick(); assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(100), { status: 200 }));
  assert.equal((await fetchLocalBytes("asset://x", new AbortController().signal, 4096)).length, 100);
});

test("eviction: con más visibles que el límite no se expulsan entre sí ni se recarga nada al desalojar", async () => {
  const visible = new Set(Array.from({ length: 10 }, (_, index) => index));
  const h = harness(manifest(30), { cache: 4, retain: index => visible.has(index) });
  for (let index = 0; index < 10; index++) assert.equal((await h.thumbnails.request(index)).status, "ready");
  assert.equal(h.thumbnails.cachedCount, 10, "el límite es blando respecto a lo visible"); assert.deepEqual(h.log.evicted, []); assert.equal(h.log.revoked.length, 0);
  for (let index = 0; index < 6; index++) visible.delete(index);
  assert.equal((await h.thumbnails.request(10)).status, "ready");
  assert.equal(h.thumbnails.cachedCount, 5, "solo se desaloja lo no visible hasta donde permite el límite");
  assert.deepEqual(h.log.evicted, [0, 1, 2, 3, 4, 5].slice(0, h.log.evicted.length)); assert.ok(h.log.evicted.every(index => !visible.has(index)));
  const rendered = h.log.rendered.length, created = h.log.created; await settle();
  assert.equal(h.log.rendered.length, rendered, "desalojar no dispara renders"); assert.equal(h.log.created, created); assert.equal(h.thumbnails.pendingCount, 0);
  assert.equal(h.thumbnails.get(9) !== undefined, true);
});
