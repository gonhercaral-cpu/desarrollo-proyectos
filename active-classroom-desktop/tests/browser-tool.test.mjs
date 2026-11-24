import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { BrowserTool, normalizeBrowserUrl } from "../src/browser/BrowserTool.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

class FakeResizeObserver {
  static instances = [];
  constructor(callback) { this.callback = callback; this.observing = false; FakeResizeObserver.instances.push(this); }
  observe() { this.observing = true; }
  disconnect() { this.observing = false; }
  fire() { if (this.observing) this.callback([]); }
}

// Stateful fake of the native bridge: it records every call, can hold or fail a method, and keeps a tiny history.
function fakeBridge() {
  const calls = [], gates = new Map(), failures = new Set(), history = [];
  const state = { open: false, url: "", title: "", loading: false, presenting: false };
  let index = -1, reloads = 0;
  const visit = url => { history.splice(index + 1); history.push(url); index = history.length - 1; Object.assign(state, { url, title: `Página ${url}` }); };
  const changes = {
    open: url => { history.length = 0; index = -1; visit(url); state.open = true; },
    navigate: visit,
    back: () => { if (index > 0) { index--; Object.assign(state, { url: history[index], title: `Página ${history[index]}` }); } },
    forward: () => { if (index < history.length - 1) { index++; Object.assign(state, { url: history[index], title: `Página ${history[index]}` }); } },
    reload: () => { reloads++; },
    layout: () => {}, status: () => {},
    present: () => { state.presenting = true; },
    returnToHost: () => { state.presenting = false; },
    close: () => { Object.assign(state, { open: false, url: "", title: "", presenting: false }); history.length = 0; index = -1; },
  };
  const bridge = { calls, state, history, get reloads() { return reloads; } };
  for (const [name, change] of Object.entries(changes)) {
    bridge[name] = async (...args) => {
      calls.push({ name, args });
      const gate = gates.get(name); if (gate) await gate;
      if (failures.has(name)) { failures.delete(name); throw "Fallo nativo"; }
      change(...args); return { ...state };
    };
  }
  bridge.hold = name => { let release; gates.set(name, new Promise(resolve => { release = () => { gates.delete(name); resolve(); }; })); return release; };
  bridge.fail = name => failures.add(name);
  bridge.names = () => calls.map(call => call.name);
  return bridge;
}

function setup(t, options = {}) {
  const dom = new JSDOM("<main class='classroom-player'><button id='trigger'>Navegador web</button></main>", { url: "http://tauri.localhost" });
  const previous = new Map();
  for (const [name, value] of [["window", dom.window], ["document", dom.window.document], ["ResizeObserver", FakeResizeObserver]]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  FakeResizeObserver.instances.length = 0;
  const rect = { left: 10, top: 80, width: 900, height: 500 };
  t.mock.method(dom.window.Element.prototype, "getBoundingClientRect", function () {
    return this.hasAttribute("data-browser-host") ? { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height } : { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0 };
  });
  const bridge = options.bridge ?? fakeBridge();
  const monitors = options.monitors ?? [
    { id: "m1", name: "Portátil", primary: true, width: 1920, height: 1080, x: 0, y: 0, scaleFactor: 1 },
    { id: "m2", name: "Proyector", primary: false, width: 1280, height: 720, x: 1920, y: 0, scaleFactor: 1 },
  ];
  const trigger = document.querySelector("#trigger"), root = document.querySelector("main").parentElement;
  const hooks = { before: 0 };
  const tool = new BrowserTool({ root, trigger, bridge, available: options.available ?? true, monitors: async () => monitors, beforeOpen: options.beforeOpen ?? (() => { hooks.before++; }), pollMs: 1000 });
  t.after(() => {
    tool.dispose(); dom.window.close();
    for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
  });
  const query = selector => document.querySelector(selector);
  const type = value => { query("[data-browser-url]").value = value; query("[data-browser-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); };
  const open = async () => { trigger.click(); await settle(); };
  const openPage = async (url = "example.com") => { await open(); type(url); await settle(); };
  const key = (name, extra = {}) => { const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }); window.dispatchEvent(event); return event; };
  const status = () => query("[data-browser-status]");
  return { dom, tool, bridge, rect, trigger, hooks, query, type, open, openPage, key, status, monitors };
}

test("normalizeBrowserUrl usa https por defecto y solo acepta http(s)", () => {
  assert.equal(normalizeBrowserUrl("example.com"), "https://example.com/");
  assert.equal(normalizeBrowserUrl("  http://aula.test/clase?x=1 "), "http://aula.test/clase?x=1");
  assert.equal(normalizeBrowserUrl("localhost:3000/a"), "https://localhost:3000/a");
  for (const bad of ["", "   ", "javascript:alert(1)", "JaVaScript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "ftp://a.b", "about:blank", "dos palabras.com", "https://"]) assert.equal(normalizeBrowserUrl(bad), null, bad);
});

test("sin Tauri muestra un mensaje explícito, no llama al backend y no simula un navegador", async t => {
  const h = setup(t, { available: false });
  await h.open();
  assert.equal(h.query("[data-browser-tool]").hidden, false);
  assert.match(h.query("[data-browser-note]").textContent, /solo está disponible en la aplicación de escritorio/);
  assert.match(h.status().textContent, /no disponible/i);
  assert.equal(h.query("[data-browser-url]").disabled, true); assert.equal(h.query("[data-browser-go]").disabled, true);
  h.type("example.com"); await settle();
  assert.deepEqual(h.bridge.calls, []); assert.equal(h.hooks.before, 0);
  assert.equal(h.query("iframe"), null);
  h.key("Escape"); await settle();
  assert.equal(h.query("[data-browser-tool]").hidden, true); assert.equal(document.activeElement, h.trigger);
});

test("una URL inválida no inicia el backend y muestra el error", async t => {
  const h = setup(t); await h.open();
  h.type("javascript:alert(1)"); await settle();
  assert.deepEqual(h.bridge.calls, []);
  assert.equal(h.status().hidden, false); assert.equal(h.status().getAttribute("role"), "alert"); assert.match(h.status().textContent, /http o https/);
});

test("flujo completo: abrir, navegar, historial, recargar, mostrar, volver y cerrar", async t => {
  const h = setup(t);
  h.trigger.click(); await settle();
  assert.equal(h.hooks.before, 1); h.trigger.click(); await settle(); assert.equal(h.hooks.before, 1);
  assert.equal(h.query("[data-browser-tool]").getAttribute("role"), "dialog");
  assert.equal(h.query("[data-browser-monitor]").options.length, 2); assert.equal(h.query("[data-browser-monitor]").value, "m2");
  assert.equal(h.query("[data-browser-host]").children.length, 1); // only the note: the native child is not in this DOM
  assert.equal(h.query("[data-browser-back]").disabled, true); assert.equal(h.query("[data-browser-present]").disabled, true);
  h.type("example.com"); await settle();
  assert.deepEqual(h.bridge.calls, [{ name: "open", args: ["https://example.com/", { x: 10, y: 80, width: 900, height: 500 }] }]);
  assert.equal(h.query("[data-browser-title]").textContent, "Página https://example.com/");
  assert.equal(h.query("[data-browser-address]").textContent, "https://example.com/");
  assert.equal(h.query("[data-browser-back]").disabled, false); assert.equal(h.query("[data-browser-present]").disabled, false);
  assert.equal(h.query("[data-browser-note]").hidden, true);

  h.type("http://example.org/docs"); await settle();
  assert.deepEqual(h.bridge.calls.at(-1), { name: "navigate", args: ["http://example.org/docs"] });
  h.query("[data-browser-back]").click(); await settle(); assert.equal(h.bridge.state.url, "https://example.com/");
  assert.equal(h.query("[data-browser-url]").value, "https://example.com/", "la barra sigue al historial");
  h.query("[data-browser-url]").value = "escribiendo"; h.query("[data-browser-url]").dispatchEvent(new window.Event("input", { bubbles: true }));
  h.query("[data-browser-reload]").click(); await settle();
  assert.equal(h.query("[data-browser-url]").value, "escribiendo", "no se pisa lo que el profesor escribe");
  h.query("[data-browser-forward]").click(); await settle(); assert.equal(h.bridge.state.url, "http://example.org/docs");
  h.query("[data-browser-reload]").click(); await settle(); assert.equal(h.bridge.reloads, 2);

  h.query("[data-browser-present]").click(); await settle();
  assert.deepEqual(h.bridge.calls.at(-1), { name: "present", args: ["m2"] });
  assert.equal(h.query("[data-browser-note]").hidden, true, "la página continúa en el host");
  assert.match(h.query("[data-browser-status]").textContent, /Duplicando/);
  assert.equal(h.query("[data-browser-present]").disabled, true); assert.equal(h.query("[data-browser-return]").disabled, false);
  assert.equal(h.query("[data-browser-back]").disabled, false); assert.equal(h.query("[data-browser-close]").disabled, false);
  assert.equal(h.query("[data-browser-tool]").hidden, false);
  h.rect.width = 700; window.dispatchEvent(new window.Event("resize")); await settle();
  assert.equal(h.bridge.names().includes("layout"), true, "el navegador docente sigue respondiendo al tamaño durante la duplicación");
  h.query("[data-browser-return]").click(); await settle();
  assert.deepEqual(h.bridge.calls.at(-1), { name: "returnToHost", args: [{ x: 10, y: 80, width: 700, height: 500 }] });
  assert.equal(h.bridge.state.presenting, false); assert.equal(h.query("[data-browser-return]").disabled, true);

  h.query("[data-browser-close]").click(); await settle();
  assert.equal(h.bridge.names().at(-1), "close"); assert.equal(h.bridge.state.open, false);
  assert.equal(h.query("[data-browser-tool]").hidden, true); assert.equal(document.activeElement, h.trigger);
  await h.open(); h.type("example.net"); await settle();
  assert.equal(h.bridge.names().at(-1), "open", "tras cerrar se abre una página nueva");
});

test("título y URL remotos se muestran como texto, nunca como HTML", async t => {
  const h = setup(t); await h.openPage();
  h.bridge.state.title = "<img src=x onerror=alert(1)><b>hola</b>"; h.bridge.state.url = "https://example.com/?q=<script>";
  h.query("[data-browser-reload]").click(); await settle();
  assert.equal(h.query("[data-browser-title]").textContent, "<img src=x onerror=alert(1)><b>hola</b>");
  assert.equal(h.query("[data-browser-tool] img"), null); assert.equal(h.query("[data-browser-tool] script"), null); assert.equal(h.query("[data-browser-title] b"), null);
});

test("layout sigue al host con resize y ResizeObserver, coalesce ráfagas y omite rectángulos vacíos", async t => {
  const h = setup(t); await h.openPage();
  const [observer] = FakeResizeObserver.instances; assert.equal(observer.observing, true);
  assert.equal(h.bridge.names().includes("layout"), false, "mismo rectángulo: sin layout");
  h.rect.width = 800; window.dispatchEvent(new window.Event("resize")); await settle();
  assert.deepEqual(h.bridge.calls.at(-1), { name: "layout", args: [{ x: 10, y: 80, width: 800, height: 500 }] });
  h.rect.height = 400; for (let i = 0; i < 5; i++) observer.fire(); await settle();
  assert.equal(h.bridge.names().filter(name => name === "layout").length, 2);
  assert.deepEqual(h.bridge.calls.at(-1).args[0], { x: 10, y: 80, width: 800, height: 400 });
  observer.fire(); await settle(); assert.equal(h.bridge.names().filter(name => name === "layout").length, 2);
  Object.assign(h.rect, { width: 0, height: 0 }); observer.fire(); await settle();
  assert.equal(h.bridge.names().filter(name => name === "layout").length, 2);
  h.query("[data-browser-close]").click(); await settle();
  assert.equal(observer.observing, false);
  h.rect.width = 300; window.dispatchEvent(new window.Event("resize")); await settle();
  assert.equal(h.bridge.names().filter(name => name === "layout").length, 2, "tras cerrar no hay layout");
});

test("un fallo al abrir es visible, limpia el backend y permite reintentar", async t => {
  const h = setup(t); await h.open();
  h.bridge.fail("open"); h.type("example.com"); await settle();
  assert.equal(h.status().hidden, false); assert.equal(h.status().textContent, "Fallo nativo"); assert.equal(h.status().getAttribute("role"), "alert");
  assert.deepEqual(h.bridge.names(), ["open", "close"]);
  assert.equal(h.query("[data-browser-back]").disabled, true);
  h.type("example.com"); await settle();
  assert.deepEqual(h.bridge.names(), ["open", "close", "open"]);
  assert.equal(h.status().hidden, true); assert.equal(h.bridge.state.open, true);
});

test("un fallo al navegar mantiene la página y el error se limpia al reintentar", async t => {
  const h = setup(t); await h.openPage();
  h.bridge.fail("navigate"); h.type("example.org"); await settle();
  assert.equal(h.status().textContent, "Fallo nativo"); assert.equal(h.query("[data-browser-back]").disabled, false);
  h.type("example.org"); await settle();
  assert.equal(h.status().hidden, true); assert.equal(h.bridge.state.url, "https://example.org/");
});

test("cerrar mientras open está pendiente no reabre la vista y el backend termina cerrado", async t => {
  const h = setup(t); await h.open();
  const release = h.bridge.hold("open"); h.type("example.com"); await settle();
  assert.equal(h.status().textContent, "Cargando…");
  h.query("[data-browser-close]").click(); await settle();
  assert.equal(h.query("[data-browser-tool]").hidden, true);
  release(); await settle();
  assert.deepEqual(h.bridge.names(), ["open", "close"]);
  assert.equal(h.bridge.state.open, false); assert.equal(h.query("[data-browser-tool]").hidden, true);
  assert.equal(h.query("[data-browser-title]").textContent, "", "el resultado tardío no se aplica");
  h.rect.width = 500; window.dispatchEvent(new window.Event("resize")); await settle();
  assert.deepEqual(h.bridge.names(), ["open", "close"]);
});

test("cerrar antes de que empiece una acción en cola la descarta", async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = setup(t, { beforeOpen: () => gate });
  h.trigger.click(); await settle();
  h.type("example.com"); await settle();
  h.query("[data-browser-close]").click(); await settle();
  release(); await settle();
  assert.deepEqual(h.bridge.calls, []);
  assert.equal(h.query("[data-browser-tool]").hidden, true);
});

test("el sondeo cada 1000 ms no se solapa, refleja presenting y se detiene al cerrar", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t); await h.openPage();
  const statusCalls = () => h.bridge.names().filter(name => name === "status").length;
  t.mock.timers.tick(999); await settle(); assert.equal(statusCalls(), 0);
  t.mock.timers.tick(1); await settle(); assert.equal(statusCalls(), 1);
  const release = h.bridge.hold("status");
  t.mock.timers.tick(1000); await settle(); assert.equal(statusCalls(), 2);
  t.mock.timers.tick(5000); await settle(); assert.equal(statusCalls(), 2, "sin sondeos solapados");
  h.bridge.state.presenting = true; h.bridge.state.loading = true;
  release(); await settle();
  assert.equal(h.query("[data-browser-return]").disabled, false); assert.equal(h.status().textContent, "Cargando…");
  h.bridge.state.loading = false;
  t.mock.timers.tick(1000); await settle(); assert.equal(statusCalls(), 3); assert.equal(h.status().hidden, false); assert.match(h.status().textContent, /Duplicando/);
  h.query("[data-browser-close]").click(); await settle();
  const after = h.bridge.calls.length;
  t.mock.timers.tick(10000); await settle(); assert.equal(h.bridge.calls.length, after);
});

test("un fallo de sondeo se muestra y se limpia solo; si el backend cierra la página se avisa", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t); await h.openPage();
  h.bridge.fail("status"); t.mock.timers.tick(1000); await settle();
  assert.match(h.status().textContent, /No se pudo consultar/);
  t.mock.timers.tick(1000); await settle(); assert.equal(h.status().hidden, true);
  h.bridge.state.open = false; t.mock.timers.tick(1000); await settle();
  assert.match(h.status().textContent, /La página se cerró/);
  assert.equal(h.query("[data-browser-back]").disabled, true);
  const calls = h.bridge.calls.length; t.mock.timers.tick(5000); await settle(); assert.equal(h.bridge.calls.length, calls, "sin sondeo sin página");
  h.type("example.com"); await settle(); assert.equal(h.bridge.names().at(-1), "open");
});

test("dispose cierra el backend, limpia timer, observer y listeners y quita el overlay", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t); await h.openPage();
  const [observer] = FakeResizeObserver.instances;
  h.tool.dispose(); await settle();
  assert.equal(h.bridge.names().at(-1), "close"); assert.equal(h.bridge.state.open, false);
  assert.equal(document.querySelector("[data-browser-tool]"), null); assert.equal(observer.observing, false);
  const calls = h.bridge.calls.length;
  t.mock.timers.tick(5000); window.dispatchEvent(new window.Event("resize")); h.key("Escape"); h.trigger.click(); await settle();
  assert.equal(h.bridge.calls.length, calls); assert.equal(h.tool.active, false);
  h.tool.dispose(); await settle(); assert.equal(h.bridge.calls.length, calls, "dispose es idempotente");
});

test("dispose con open pendiente cierra el backend cuando termina", async t => {
  const h = setup(t); await h.open();
  const release = h.bridge.hold("open"); h.type("example.com"); await settle();
  h.tool.dispose(); release(); await settle();
  assert.deepEqual(h.bridge.names(), ["open", "close"]); assert.equal(h.bridge.state.open, false);
});

test("un cierre fallido se reintenta al volver a abrir y dispose lo libera", async t => {
  const h = setup(t); await h.openPage();
  h.bridge.fail("close"); h.query("[data-browser-close]").click(); await settle();
  assert.equal(h.bridge.state.open, true);
  await h.open();
  assert.equal(h.bridge.names().filter(name => name === "close").length, 2); assert.equal(h.bridge.state.open, false);
});

test("Escape cierra el overlay y Tab queda dentro de él", async t => {
  const h = setup(t); await h.open();
  assert.equal(document.activeElement, h.query("[data-browser-url]"));
  const shiftTab = h.key("Tab", { shiftKey: true });
  assert.equal(shiftTab.defaultPrevented, true); assert.equal(document.activeElement, h.query("[data-browser-close]"));
  h.key("Tab"); assert.equal(document.activeElement, h.query("[data-browser-url]"));
  const escape = h.key("Escape"); await settle();
  assert.equal(escape.defaultPrevented, true); assert.equal(h.tool.active, false);
  assert.equal(h.query("[data-browser-tool]").hidden, true); assert.equal(document.activeElement, h.trigger);
});


test("un fallo al pausar o preparar la clase impide abrir contenido web", async t => {
 const h = setup(t, { beforeOpen: async () => { throw new Error("fallo al pausar"); } });
 await h.open(); h.type("https://example.org"); await settle();
 assert.deepEqual(h.bridge.names(), []);
 assert.equal(h.query("[data-browser-go]").disabled, true);
 assert.match(h.status().textContent, /preparad/);
 await h.tool.close();
});


test("un fallo del espejo conserva la página docente y permite reintentar", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t); await h.openPage();
  h.query("[data-browser-present]").click(); await settle();
  h.bridge.state.presenting = false;
  h.bridge.state.projectionError = "Se interrumpió la duplicación; la página sigue disponible aquí.";
  t.mock.timers.tick(1000); await settle();
  assert.match(h.status().textContent, /interrumpió/);
  assert.equal(h.status().getAttribute("role"), "alert");
  assert.equal(h.query("[data-browser-present]").disabled, false);
  assert.equal(h.query("[data-browser-back]").disabled, false);
  assert.equal(h.query("[data-browser-tool]").hidden, false);
  assert.equal(h.bridge.names().filter(name => name === "open").length, 1);
  assert.equal(h.bridge.names().includes("close"), false);
});
