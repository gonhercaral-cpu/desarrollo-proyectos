import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { SlideNavigator } from "../src/player/SlideNavigator.ts";
import { SlideThumbnails } from "../src/player/slide-thumbnails.ts";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 200; i++) await tick(); }

class FakeObserver {
  static all = [];
  constructor(callback, options = {}) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; FakeObserver.all.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); this.disconnected = true; }
  fire(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
}
function environment(t, { observer = true } = {}) {
  const dom = new JSDOM("<div id='root'><main class='classroom-player'><nav data-slides tabindex='0'></nav></main></div>", { url: "http://tauri.localhost" });
  const previous = new Map(); FakeObserver.all = []; dom.cleanups = [];
  for (const [name, value] of [["window", dom.window], ["document", dom.window.document], ...(observer ? [["IntersectionObserver", FakeObserver]] : [])]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  t.after(() => { for (const cleanup of dom.cleanups) cleanup(); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  return dom;
}
function manifest(count) {
  const download = { mimeType: "application/pdf", sizeBytes: 1000 };
  return { mainPresentationId: "deck", resources: [{ resourceId: "deck", name: "deck.pdf", download }], slides: Array.from({ length: count }, (_, index) => ({ slideId: `s${index}`, index, title: `Tema ${index + 1}`, resourceIds: [], metadata: { pageNumber: index + 1 } })) };
}
function build(t, count = 200, env = {}) {
  const dom = environment(t, env); const m = manifest(count);
  const log = { rendered: [], revoked: [], destroyed: 0, selected: [], toggles: [], active: 0, maxActive: 0 };
  const classroom = { manifest: m, resolveResource: id => ({ path: `/cache/${id}`, mimeType: "application/pdf", name: id, kind: "x" }) };
  let created = 0;
  const thumbnails = new SlideThumbnails({
    classroom, toUrl: path => `asset://localhost${path}`, verifyResource: async () => true,
    fetchBytes: async () => new Uint8Array(1000),
    openPdf: async () => ({ async render(page) { log.active++; log.maxActive = Math.max(log.maxActive, log.active); await tick(); log.active--; log.rendered.push(page); return new Blob([String(page)]); }, destroy() { log.destroyed++; } }),
    objectUrls: { create: () => `blob:t${++created}`, revoke: url => log.revoked.push(url) }, maxCacheEntries: 12,
  });
  const host = document.querySelector("[data-slides]");
  const navigator = new SlideNavigator({ host, classroom, thumbnails, onSelect: index => log.selected.push(index), onGalleryToggle: open => log.toggles.push(open) });
  dom.cleanups.push(() => navigator.destroy());
  const gallery = () => document.querySelector(".slide-gallery");
  const items = () => [...document.querySelectorAll(".slide-gallery-item")];
  const galleryObserver = () => FakeObserver.all.find(observer => observer.options.root);
  const show = (from, to) => { const observer = galleryObserver(); for (const item of items().slice(from, to)) observer.fire(item.querySelector(".slide-thumb"), true); };
  return { dom, m, log, thumbnails, navigator, host, gallery, items, galleryObserver, show, query: selector => host.querySelector(selector) };
}
const press = (key, extra = {}, target = window) => { const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event; };

test("anterior/siguiente: posición 'N de M', extremos deshabilitados y selección por índice", t => {
  const h = build(t); const [previous, next] = [h.query("[data-slide-nav='previous']"), h.query("[data-slide-nav='next']")];
  h.navigator.update(0);
  assert.equal(h.query(".slide-navigator-position").textContent, "Diapositiva 1 de 200");
  assert.equal(previous.disabled, true); assert.equal(next.disabled, false); assert.match(next.textContent, /2\. Tema 2/); assert.match(previous.textContent, /Primera diapositiva/);
  next.click(); assert.deepEqual(h.log.selected, [1]);
  h.navigator.update(100); assert.equal(h.query(".slide-navigator-position").textContent, "Diapositiva 101 de 200");
  previous.click(); next.click(); assert.deepEqual(h.log.selected, [1, 99, 101]);
  h.navigator.update(199); assert.equal(next.disabled, true); assert.equal(previous.disabled, false); assert.match(next.textContent, /Última diapositiva/);
  next.click(); assert.deepEqual(h.log.selected, [1, 99, 101], "el extremo no navega");
  h.navigator.update(null); assert.equal(previous.disabled && next.disabled, true); assert.match(h.query(".slide-navigator-position").textContent, /sin diapositiva/);
  assert.equal(h.query("[data-slide-nav='previous']"), previous, "los botones se actualizan, no se reconstruyen");
});

test("miniaturas del navegador: solo se piden al ser visibles y sobreviven al cambio de diapositiva", async t => {
  const h = build(t); h.navigator.update(5); await settle();
  assert.equal(h.thumbnails.pendingCount, 0); assert.deepEqual(h.log.rendered, [], "sin IntersectionObserver visible no se renderiza nada");
  const strip = FakeObserver.all[0];
  for (const target of strip.targets) strip.fire(target, true); await settle();
  assert.deepEqual(h.log.rendered.sort((a, b) => a - b), [5, 7]); // páginas 5 y 7 = índices 4 y 6
  const images = [...h.host.querySelectorAll(".slide-navigator-card img")].map(image => image.getAttribute("src"));
  assert.equal(images.length, 2);
  h.navigator.update(5); await settle(); assert.deepEqual([...h.host.querySelectorAll(".slide-navigator-card img")].map(image => image.getAttribute("src")), images, "mismo estado no reinicia previews");
  h.navigator.update(6); await settle(); // la anterior (índice 5) y la siguiente (7) ; el índice 5 aún no estaba en caché
  assert.equal(h.log.maxActive, 1);
});

test("galería: 200 diapositivas numeradas, carga progresiva solo de lo visible y selección actual", async t => {
  const h = build(t); h.navigator.update(42);
  assert.equal(h.gallery(), null, "la galería no se construye hasta abrirla");
  h.query("[data-slide-gallery-open]").click();
  assert.equal(h.navigator.galleryOpen, true); assert.equal(h.items().length, 200); assert.equal(h.gallery().getAttribute("role"), "dialog"); assert.equal(h.gallery().getAttribute("aria-modal"), "true");
  assert.match(h.items()[0].textContent, /1Tema 1/); assert.match(h.items()[199].textContent, /200Tema 200/);
  assert.equal(h.items()[42].getAttribute("aria-current"), "true"); assert.equal(h.items().filter(item => item.hasAttribute("aria-current")).length, 1);
  assert.equal(document.activeElement, h.items()[42]);
  assert.equal(h.thumbnails.pendingCount, 0, "nada se carga hasta que el observador lo pide");
  h.show(0, 10); await settle();
  assert.equal(h.log.rendered.length, 10); assert.equal(h.log.maxActive, 1);
  assert.equal(h.items()[3].querySelector("img").getAttribute("src").startsWith("blob:"), true);
  assert.equal(h.items()[150].querySelector("img"), null); assert.equal(h.items()[150].querySelector(".slide-thumb").dataset.state, "loading");
  h.show(10, 30); await settle(); assert.equal(h.log.rendered.length, 30, "sin reintentos en bucle");
  assert.equal(h.thumbnails.cachedCount, 30, "lo visible nunca se desaloja");
  const observer = h.galleryObserver(), tiles = h.items().map(item => item.querySelector(".slide-thumb"));
  for (const tile of tiles.slice(0, 20)) observer.fire(tile, false);
  h.show(30, 32); await settle();
  assert.equal(h.thumbnails.cachedCount, 12, "al salir de pantalla la caché vuelve a su límite");
  assert.equal(tiles[0].querySelector("img"), null); assert.equal(tiles[0].dataset.state, "loading");
  assert.ok(tiles[25].querySelector("img"), "lo visible conserva su imagen");
  assert.equal(h.log.revoked.length, 20);
});

test("galería: seleccionar una diapositiva cierra, devuelve el foco y no reconstruye la rejilla al avanzar", async t => {
  const h = build(t); h.navigator.update(0);
  const opener = h.query("[data-slide-gallery-open]"); opener.focus(); opener.click();
  const grid = document.querySelector(".slide-gallery-grid"), nodes = h.items();
  h.navigator.update(1); // la clase avanza con la galería abierta
  assert.equal(nodes[0].hasAttribute("aria-current"), false); assert.equal(nodes[1].getAttribute("aria-current"), "true");
  assert.equal(document.querySelector(".slide-gallery-grid"), grid); assert.deepEqual(h.items(), nodes); assert.equal(h.items().length, 200);
  h.items()[57].click();
  assert.deepEqual(h.log.selected, [57]); assert.equal(h.navigator.galleryOpen, false); assert.equal(h.gallery().hidden, true);
  assert.equal(document.activeElement, opener); assert.deepEqual(h.log.toggles, [true, false]);
  h.navigator.update(57); h.query("[data-slide-gallery-open]").click();
  assert.deepEqual(h.items(), nodes, "reabrir reutiliza la rejilla"); assert.equal(h.items()[57].getAttribute("aria-current"), "true");
});

test("galería: cerrar sin elegir conserva la diapositiva y cancela lo pendiente", async t => {
  const h = build(t); h.navigator.update(10);
  h.query("[data-slide-gallery-open]").click(); h.show(0, 40);
  assert.ok(h.thumbnails.pendingCount > 0);
  h.gallery().querySelector("[data-slide-gallery-close]").click(); await settle();
  assert.equal(h.log.selected.length, 0); assert.equal(h.navigator.galleryOpen, false);
  assert.ok(h.log.rendered.length < 40, "las pendientes se cancelan al cerrar"); assert.equal(h.thumbnails.pendingCount, 0);
  assert.equal(h.query(".slide-navigator-position").textContent, "Diapositiva 11 de 200");
  assert.equal(h.galleryObserver().disconnected, true);
});

test("teclado: Escape solo cierra la galería, los atajos de clase no pasan y la rejilla se navega con flechas", async t => {
  const h = build(t, 30); h.navigator.update(0);
  const seen = []; window.addEventListener("keydown", event => seen.push(event.key));
  h.query("[data-slide-gallery-open]").click();
  for (const key of [" ", "m", "p", "f", "Enter"]) press(key, {}, document.activeElement);
  assert.deepEqual(seen, [], "ningún atajo llega a la clase mientras la galería está abierta");
  press("ArrowRight", {}, document.activeElement); assert.equal(document.activeElement, h.items()[1]);
  press("End", {}, document.activeElement); assert.equal(document.activeElement, h.items()[29]);
  press("Home", {}, document.activeElement); assert.equal(document.activeElement, h.items()[0]);
  press("ArrowLeft", {}, document.activeElement); assert.equal(document.activeElement, h.items()[0]);
  // Tab no escapa del diálogo.
  const close = h.gallery().querySelector("[data-slide-gallery-close]");
  h.items()[29].focus(); assert.equal(press("Tab", {}, h.items()[29]).defaultPrevented, true); assert.equal(document.activeElement, close);
  assert.equal(press("Tab", { shiftKey: true }, close).defaultPrevented, true); assert.equal(document.activeElement, h.items()[29]);
  // Escape, incluso con el foco fuera del diálogo.
  document.body.focus(); const escape = press("Escape", {}, document.body);
  assert.equal(escape.defaultPrevented, true); assert.equal(h.navigator.galleryOpen, false); assert.deepEqual(seen, []);
  press("ArrowRight"); assert.deepEqual(seen, ["ArrowRight"], "cerrada, el teclado vuelve a la clase");
});

test("destroy: cancela renders, revoca URLs, destruye el PDF y retira la galería", async t => {
  const h = build(t); h.navigator.update(0);
  h.query("[data-slide-gallery-open]").click(); h.show(0, 3); await settle();
  h.show(3, 20);
  assert.ok(h.thumbnails.pendingCount > 0); const urls = h.items().map(item => item.querySelector("img")?.getAttribute("src")).filter(Boolean);
  h.navigator.destroy(); await settle();
  assert.equal(h.thumbnails.pendingCount, 0); assert.equal(h.thumbnails.cachedCount, 0); assert.deepEqual(h.log.revoked.sort(), urls.sort());
  assert.equal(h.log.destroyed, 1); assert.equal(h.gallery(), null); assert.equal(h.host.querySelector(".slide-navigator"), null);
  assert.ok(FakeObserver.all.every(observer => observer.disconnected));
  const seen = []; window.addEventListener("keydown", event => seen.push(event.key)); press("Escape"); assert.deepEqual(seen, ["Escape"]);
  h.navigator.update(4); h.navigator.destroy();
});

test("sin IntersectionObserver: anterior/siguiente cargan solos y la galería solo pide una ventana, nunca las 200", async t => {
  const h = build(t, 200, { observer: false }); assert.equal(typeof IntersectionObserver, "undefined");
  h.navigator.update(50); await settle();
  assert.deepEqual(h.log.rendered.sort((a, b) => a - b), [50, 52], "anterior y siguiente se cargan sin observador");
  h.query("[data-slide-gallery-open]").click(); await settle();
  assert.ok(h.log.rendered.length <= 2 + 12, `solo una ventana inicial: ${h.log.rendered.length}`); assert.ok(h.log.rendered.length < 200);
  assert.ok(h.log.rendered.includes(51), "la ventana rodea la diapositiva actual"); assert.equal(h.log.maxActive, 1);
  h.gallery().querySelector("[data-slide-gallery-close]").click(); await settle();
  assert.equal(h.thumbnails.pendingCount, 0); h.navigator.update(60); await settle();
  assert.ok(h.log.rendered.includes(60) && h.log.rendered.includes(62), "navegar sigue cargando anterior/siguiente");
});

// --- Integración con ClassroomPlayer ---------------------------------------------------------------
const example = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url)));
test("ClassroomPlayer: la galería no sale de la clase con Escape, bloquea atajos y navegar no remonta el visual", async t => {
  const dom = environment(t);
  const m = structuredClone(example); m.resources[0].download.mimeType = "application/pdf";
  m.slides.forEach(slide => { slide.metadata.presentationResourceId = m.mainPresentationId; slide.metadata.pageNumber = slide.index + 1; slide.resourceIds = []; });
  const proto = dom.window.HTMLMediaElement.prototype;
  t.mock.method(proto, "load", () => {}); t.mock.method(proto, "play", () => Promise.resolve()); t.mock.method(proto, "pause", () => {});
  const root = document.createElement("div"); document.body.append(root);
  let exits = 0, mounts = 0; const pages = []; const renders = [];
  const classroom = { manifest: m, resolveResource: id => ({ path: `/cache/${id}`, mimeType: m.resources.find(item => item.resourceId === id).download.mimeType, name: id, kind: "x" }) };
  const player = new ClassroomPlayer(root, classroom, () => { exits++; }, {
    verifyResource: async () => true, toUrl: path => `asset://localhost${path}`,
    slideThumbnails: { fetchBytes: async () => new Uint8Array(m.resources.find(item => item.resourceId === m.mainPresentationId).download.sizeBytes), openPdf: async () => ({ async render(page) { renders.push(page); return new Blob([String(page)]); }, destroy() {} }), objectUrls: { create: () => "blob:x", revoke() {} } },
    createRenderer: async () => ({ kind: "pdf", async mount(host, _source, options) { mounts++; host.textContent = "pdf"; options.onState(initialRendererState()); }, setPage(page) { pages.push(page); }, command() {}, seek() {}, setVolume() {}, destroy() {} }),
  });
  dom.cleanups.push(() => player.destroy()); await settle();
  const slides = root.querySelector("[data-slides]");
  assert.ok(slides.querySelector(".slide-navigator")); assert.equal(root.querySelector("[data-slide-count]").textContent, `1 / ${m.slides.length}`);
  assert.equal(slides.querySelector(".slide-navigator-position").textContent, `Diapositiva 1 de ${m.slides.length}`);
  const mountsBefore = mounts;
  slides.querySelector("[data-slide-gallery-open]").click();
  const dialog = root.querySelector(".slide-gallery"); assert.ok(dialog, "la galería vive dentro de .classroom-player");
  press("ArrowRight", {}, document.activeElement); press("Escape", {}, document.activeElement);
  assert.equal(exits, 0, "Escape solo cierra la galería"); assert.equal(player.controller.slideIndex, 0); assert.equal(dialog.hidden, true);
  press("ArrowRight"); await settle(); assert.equal(player.controller.slideIndex, 1, "con la galería cerrada el teclado configurable sigue igual");
  slides.querySelector("[data-slide-gallery-open]").click(); dialog.querySelectorAll(".slide-gallery-item")[0].click(); await settle();
  assert.equal(player.controller.slideIndex, 0); assert.equal(slides.querySelector(".slide-navigator-position").textContent, `Diapositiva 1 de ${m.slides.length}`);
  assert.equal(mounts, mountsBefore, "navegar entre páginas del mismo PDF no remonta el renderer");
  press("Escape"); assert.equal(exits, 1, "sin galería, Escape sigue saliendo de la clase");
  assert.equal(root.querySelector(".slide-gallery"), null, "destroy retira la galería");
});
