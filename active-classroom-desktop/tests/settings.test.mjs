import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { desktopSettings, saveDesktopSettings, SETTINGS_KEY } from "../src/settings/preferences.ts";
import { readShortcuts, defaultShortcuts, assignShortcut, restoreShortcuts, shortcutFor, combination, reservedShortcut, SHORTCUTS_KEY } from "../src/player/shortcuts.ts";
import { contentOwner, saveContentPreferences, contentPreferences } from "../src/offline/content-preferences.ts";
import { StartupPreferences } from "../src/startup/controller.ts";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { initialRendererState } from "../src/player/types.ts";
import { playerMarkup } from "../src/ui/player-view.ts";
registerHooks({ load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); } });
const { DesktopSettingsPanel } = await import("../src/settings/panel.ts");
function environment() {
  const dom = new JSDOM('<body><button id="before">Ajustes</button><div id="player"></div></body>', { url: "https://desktop.test/" }); const previous = {};
  for (const key of ["window", "document", "localStorage", "HTMLElement", "HTMLButtonElement", "Element", "Event"]) { previous[key] = globalThis[key]; globalThis[key] = key === "localStorage" ? dom.window.localStorage : dom.window[key]; }
  dom.restore = () => { dom.window.close(); for (const [key, value] of Object.entries(previous)) globalThis[key] = value; }; return dom;
}
const key = (dom, value, options = {}) => new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });

test("intervalo persiste con ajustes existentes y conserva mapeo personalizado", async t => {
  const dom = environment(); const updater = new ProgramUpdater({ action: async () => updater.status, listen: async () => () => {} }, () => {});
  const startup = new StartupPreferences(async () => ({ autostart: true, kiosk: false, kioskActive: false, launchedAutomatically: false }), () => {});
  const panel = new DesktopSettingsPanel(updater, startup); t.after(() => { panel.destroy(); dom.restore(); });
  assignShortcut("SEEK_FORWARD", "Ctrl+l");
  assert.equal(desktopSettings().seekIntervalSeconds, 5);
  document.querySelector("#player").innerHTML = playerMarkup();
  panel.open("shortcuts"); await new Promise(resolve => setImmediate(resolve));
  const input = document.querySelector("[data-seek-interval]"); assert.equal(input.value, "5");
  input.value = "13"; document.querySelector("[data-seek-settings]").dispatchEvent(new Event("submit", { cancelable: true }));
  assert.equal(desktopSettings().seekIntervalSeconds, 13);
  assert.match(document.querySelector("[data-seek-status]").textContent, /guardado/);
  assert.equal(document.querySelector('[data-command="SEEK_FORWARD"]').textContent, "+13 s");
  assert.equal(document.querySelector('[data-command="SEEK_BACKWARD"]').textContent, "−13 s");
  panel.close(); panel.open("shortcuts");
  assert.equal(document.querySelector("[data-seek-interval]").value, "13");
  const restarted = await import("../src/settings/preferences.ts?seek-restart");
  assert.equal(restarted.desktopSettings().seekIntervalSeconds, 13);
  assert.deepEqual(readShortcuts().SEEK_FORWARD, ["Ctrl+l"]);
  for (const invalid of ["0", "301", "1.5", ""]) {
    document.querySelector("[data-seek-interval]").value = invalid;
    document.querySelector("[data-seek-settings]").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(desktopSettings().seekIntervalSeconds, 13);
  }
  for (const invalid of [null, "10", 0, 301, 1.5]) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ seekIntervalSeconds: invalid })); assert.equal(desktopSettings().seekIntervalSeconds, 5);
  }
});
test("settings versionados sobreviven reinicio/update sin tocar identidad, niveles ni caché", t => {
  const dom = environment(); t.after(dom.restore); localStorage.setItem("deviceId", "identity"); localStorage.setItem("active-classroom-projection-monitor", "previous"); contentOwner("test"); saveContentPreferences({ followedLevels: ["kids"], pendingUnits: ["unit"] });
  assert.equal(desktopSettings().autoAppUpdate, true); saveDesktopSettings({ autoAppUpdate: false, density: "compact" });
  const saved = localStorage.getItem(SETTINGS_KEY); assert.equal(JSON.parse(saved).version, 1); assert.equal(desktopSettings().autoAppUpdate, false); assert.equal(desktopSettings().density, "compact");
  assert.equal(localStorage.getItem("deviceId"), "identity"); assert.equal(localStorage.getItem("active-classroom-projection-monitor"), "previous"); assert.deepEqual(contentPreferences().followedLevels, ["kids"]);
  localStorage.setItem(SETTINGS_KEY, "broken"); assert.equal(desktopSettings().autoAppUpdate, true);
});
test("atajos simples y Ctrl/Alt/Shift, conflictos explícitos, reemplazo y defaults", t => {
  const dom = environment(); t.after(dom.restore); assert.deepEqual(readShortcuts(), defaultShortcuts());
  assert.equal(combination(key(dom, "K", { ctrlKey: true, altKey: true, shiftKey: true })), "Ctrl+Alt+Shift+k");
  assert.deepEqual(assignShortcut("ADVANCE", "f"), { conflict: "FULLSCREEN" }); assert.deepEqual(readShortcuts(), defaultShortcuts());
  assignShortcut("ADVANCE", "f", true); assert.deepEqual(readShortcuts().FULLSCREEN, []); assert.equal(shortcutFor(key(dom, "f"), true), "ADVANCE");
  assignShortcut("MUTE", "Ctrl+Alt+Shift+k"); assert.equal(shortcutFor(key(dom, "K", { ctrlKey: true, altKey: true, shiftKey: true })), "MUTE");
  const persisted = localStorage.getItem(SHORTCUTS_KEY); assert.ok(persisted); assert.deepEqual(readShortcuts().MUTE, ["Ctrl+Alt+Shift+k"]);
  restoreShortcuts(); assert.deepEqual(readShortcuts(), defaultShortcuts());
  for (const value of ["Alt+Tab", "Alt+F4", "Alt+Space", "Ctrl+Alt+F1", "Ctrl+Alt+Delete", "Meta+k"]) { assert.equal(reservedShortcut(value), true); assert.equal(assignShortcut("MUTE", value).reserved, true); }
});
test("atajos bloqueados en inputs/select/textarea/contenteditable y botón Espacio", t => {
  const dom = environment(); t.after(dom.restore);
  for (const html of ["<input>", "<select></select>", "<textarea></textarea>", '<div contenteditable="true"><span></span></div>']) { const host = document.createElement("div"); host.innerHTML = html; document.body.append(host); const target = host.querySelector("span") || host.firstElementChild; assert.equal(shortcutFor({ ...key(dom, "f"), key: "f", target }), null); }
  assert.equal(shortcutFor({ key: " ", target: document.querySelector("button") }), null);
});
test("modal Ajustes abre/cierra, secciones reales, captura, conflicto y restauración", async t => {
  const dom = environment(); let startup = { autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false }; let panel;
  const preferences = new StartupPreferences(async (action, value) => { if (action === "kiosk" || action === "autostart") startup = { ...startup, [action]: value }; return startup; }, () => panel?.refresh()); preferences.status = startup;
  const updater = new ProgramUpdater({ action: async () => ({ phase: "current", currentVersion: "1.0.11", message: "Estás usando la versión más reciente", downloaded: 0 }), listen: async () => () => {} }, () => panel?.refresh()); updater.status.currentVersion = "1.0.11";
  panel = new DesktopSettingsPanel(updater, preferences); t.after(() => { panel.destroy(); dom.restore(); }); document.querySelector("#before").focus(); panel.open(); await new Promise(resolve => setImmediate(resolve));
  for (const section of ["general", "content", "projector", "appearance", "startup", "shortcuts", "about"]) { document.querySelector(`[data-settings-section="${section}"]`).click(); assert.ok(document.querySelector(".settings-content h2")); }
  assert.match(document.querySelector(".settings-content").textContent, /1.0.11/); assert.ok(document.querySelector("[data-check]"));
  document.querySelector('[data-settings-section="shortcuts"]').click(); document.querySelector('[data-shortcut="ADVANCE"]').click(); window.dispatchEvent(key(dom, "f")); assert.match(document.body.textContent, /ya está asignado a Pantalla completa/);
  document.querySelector("[data-replace-shortcut]").click(); assert.deepEqual(readShortcuts().ADVANCE, ["f"]); assert.deepEqual(readShortcuts().FULLSCREEN, []);
  dom.window.confirm = () => false; document.querySelector("[data-restore-shortcuts]").click(); assert.deepEqual(readShortcuts().ADVANCE, ["f"]);
  dom.window.confirm = () => true; document.querySelector("[data-restore-shortcuts]").click(); assert.deepEqual(readShortcuts(), defaultShortcuts());
  panel.close(); assert.equal(document.querySelector("[data-settings-dialog]"), null); assert.equal(document.activeElement.id, "before");
});
test("shortcut personalizado invoca Player ADVANCE/BACK y conserva builds offline", async t => {
  const dom = environment(); assignShortcut("ADVANCE", "Ctrl+n"); assignShortcut("BACK", "Alt+b");
  const manifest = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url))); manifest.resources[0].download.mimeType = "image/png"; manifest.slides.forEach(slide => { slide.metadata.presentationResourceId = manifest.mainPresentationId; slide.metadata.pageNumber = 1; }); Object.assign(manifest.slides[0], { interactionMode: "builds", buildCount: 2, interaction: { mode: "builds", buildCount: 2, source: "manual" }, builds: [{ order: 1, layers: [{ type: "text", text: "one", x: 0, y: 0, width: 20, height: 10, color: "#000000", fontSize: 3 }] }, { order: 2, layers: [{ type: "text", text: "two", x: 0, y: 20, width: 20, height: 10, color: "#000000", fontSize: 3 }] }] });
  const renderer = { kind: "image", mount: async (_host, _source, options) => options.onState(initialRendererState()), command() {}, setPage() {}, setSource: async () => {}, seek() {}, setVolume() {}, destroy() {} };
  const player = new ClassroomPlayer(document.querySelector("#player"), { manifest, resolveResource: id => ({ path: `/cache/${id}`, mimeType: "image/png", kind: "image", name: id }) }, () => {}, { verifyResource: async () => true, createRenderer: async () => renderer, toUrl: path => `asset://localhost${path}` }); t.after(() => { player.destroy(); dom.restore(); });
  await new Promise(resolve => setImmediate(resolve));
  window.dispatchEvent(key(dom, "n", { ctrlKey: true })); await new Promise(resolve => setImmediate(resolve)); assert.equal(player.controller.currentBuild, 1);
  window.dispatchEvent(key(dom, "n", { ctrlKey: true })); await new Promise(resolve => setImmediate(resolve)); assert.equal(player.controller.currentBuild, 2);
  window.dispatchEvent(key(dom, "b", { altKey: true })); await new Promise(resolve => setImmediate(resolve)); assert.equal(player.controller.currentBuild, 1);
  document.querySelector("[data-slide-next]").click(); await new Promise(resolve => setImmediate(resolve)); assert.equal(player.controller.currentBuild, 2);
  assert.equal(readShortcuts().ADVANCE[0], "Ctrl+n");
  assert.equal(document.querySelector("[data-audio-dock]").hidden, true);
  await player.dispatch("OPEN_RESOURCE"); assert.equal(manifest.resources.find(resource => resource.resourceId === manifest.slides[0].resourceIds[0]).kind, "audio");
  assert.equal(player.controller.isPresentation, true); assert.equal(player.controller.slideIndex, 0); assert.equal(player.controller.currentBuild, 2); assert.equal(document.querySelector("[data-audio-dock]").hidden, false);
  manifest.slides[0].resourceIds = ["uploaded-guide", "drive-audio"];
  await player.dispatch("OPEN_RESOURCE"); assert.equal(player.controller.isPresentation, false);
  document.querySelector("[data-slide-next]").click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.controller.slideIndex, 1); assert.equal(player.controller.currentBuild, 0); assert.equal(player.controller.isPresentation, true);
});

test("100 eventos updater conservan dialog/nav/scroll/foco y un único handler", async t => {
  const dom = environment(); const updater = new ProgramUpdater({ action: async () => updater.status, listen: async () => () => {} }, () => {});
  const preferences = new StartupPreferences(async () => ({ autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false }), () => {});
  const panel = new DesktopSettingsPanel(updater, preferences); t.after(() => { panel.destroy(); dom.restore(); });
  updater.status = { phase: "downloading", currentVersion: "1.0.14", newVersion: "1.0.15", downloaded: 0, total: 100, message: "Descargando" }; panel.open("about");
  const dialog = document.querySelector("[data-settings-dialog]"); const nav = dialog.querySelector("nav"); const content = dialog.querySelector("main"); const progress = dialog.querySelector("progress"); content.scrollTop = 123;
  const focused = dialog.querySelector('[data-settings-section="about"]'); focused.focus();
  for (let index = 1; index <= 100; index++) { updater.status.downloaded = index; panel.refresh(); assert.equal(document.querySelector("[data-settings-dialog]"), dialog); assert.equal(dialog.querySelector("nav"), nav); assert.equal(dialog.querySelector("main"), content); assert.equal(dialog.querySelector("progress"), progress); assert.equal(document.activeElement, focused); }
  assert.equal(content.scrollTop, 123); assert.match(content.textContent, /100/);
  let closed = 0; const close = panel.close.bind(panel); panel.close = () => { closed++; close(); }; document.querySelector("[data-settings-close]").click(); assert.equal(closed, 1);
});
test("recuperación manual emite una sola acción y conserva preferencias/caché", async t => {
  const dom = environment(); const updater = new ProgramUpdater({ action: async () => updater.status, listen: async () => () => {} }, () => {});
  const preferences = new StartupPreferences(async () => ({ autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false }), () => {});
  const panel = new DesktopSettingsPanel(updater, preferences); t.after(() => { panel.destroy(); dom.restore(); });
  localStorage.setItem("offline-cache", "verified-content"); saveDesktopSettings({ density: "compact" }); const before = localStorage.getItem(SETTINGS_KEY);
  let resets = 0; window.addEventListener("classroom-reset-binding", () => resets++);
  panel.open("about"); panel.refresh(); panel.refresh();
  assert.ok(document.querySelector('[data-media-report="start"]')); assert.ok(document.querySelector('[data-media-report="export"]'));
  document.querySelector("[data-reset-binding]").click(); assert.equal(resets, 1); assert.equal(panel.isOpen, false);
  assert.equal(localStorage.getItem("offline-cache"), "verified-content"); assert.equal(localStorage.getItem(SETTINGS_KEY), before);
});
