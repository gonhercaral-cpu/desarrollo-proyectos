import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { StartupPreferences, StartupUpdate, newerStableVersion } from "../src/startup/controller.ts";
import { renderUpdater } from "../src/updater/view.ts";

const state = (phase, extra = {}) => ({ phase, currentVersion: "1.0.6", newVersion: "1.0.7", downloaded: 0, message: phase, ...extra });
async function fixture(actions = {}, installedUpdate) {
  let emit; const calls = [];
  const settings = { autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: true, installedUpdate };
  const preferences = new StartupPreferences(async (action, value, target) => {
    calls.push(action);
    if (action === "remember-update") settings.installedUpdate = { from: "1.0.6", target };
    if (action === "autostart") settings.autostart = value;
    if (action === "kiosk") settings.kiosk = value;
    if (action === "library-ready") settings.kioskActive = settings.kiosk;
    if (action === "exit-kiosk") settings.kioskActive = false;
    return { ...settings };
  }, () => {});
  const updater = new ProgramUpdater({ listen: async callback => { emit = callback; return () => {}; }, action: async action => {
    calls.push(action); return await (actions[action]?.(value => emit(value)) ?? state(action === "status" ? "idle" : action === "check" ? "available" : "installed"));
  } }, () => {});
  await preferences.run("initialize"); await updater.start(false);
  return { updater, preferences, calls, flow: new StartupUpdate(), options: { online: true, canUpdate: () => true } };
}
test("inicio instala versión nueva, muestra progreso y guarda guardia antes de relanzar", async () => {
  const f = await fixture({ install: async emit => {
    assert.equal(f.updater.automatic, true); emit(state("downloading", { downloaded: 50, total: 100 }));
    const dom = new JSDOM('<div id="host"></div>'); const host = dom.window.document.querySelector("#host");
    renderUpdater(host, f.updater, f.preferences); assert.match(host.textContent, /Actualizando Active Classroom/);
    assert.match(host.textContent, /1.0.6.*1.0.7/); assert.equal(host.querySelector("progress").value, 50);
    assert.equal(host.querySelector("[data-install]"), null); dom.window.close();
    emit(state("verifying")); emit(state("installing")); return state("installed");
  } });
  await f.flow.run(f.updater, f.preferences, f.options);
  assert.deepEqual(f.calls, ["initialize", "status", "check", "install", "remember-update", "restart"]);
  assert.deepEqual(f.preferences.status.installedUpdate, { from: "1.0.6", target: "1.0.7" });
  await f.flow.run(f.updater, f.preferences, f.options); assert.equal(f.calls.filter(action => action === "restart").length, 1);
});
for (const [name, check] of [["sin actualización", () => state("current", { newVersion: null })], ["error de Internet", () => { throw new Error("offline"); }], ["error updater", () => state("failed")]]) {
  test(`${name}: continúa sin instalar ni reiniciar`, async () => {
    const f = await fixture({ check }); await f.flow.run(f.updater, f.preferences, f.options);
    assert.ok(!f.calls.includes("install")); assert.ok(!f.calls.includes("restart")); assert.equal(f.updater.automatic, false);
  });
}
test("offline conocido omite red; respuesta tardía no instala durante una clase", async () => {
  const offline = await fixture(); await offline.flow.run(offline.updater, offline.preferences, { ...offline.options, online: false }); assert.ok(!offline.calls.includes("check"));
  let resolve; const late = await fixture({ check: () => new Promise(done => { resolve = done; }) });
  await late.flow.run(late.updater, late.preferences, { ...late.options, timeoutMs: 15 });
  resolve(state("available")); await new Promise(done => setImmediate(done));
  assert.ok(!late.calls.includes("install")); assert.equal(late.updater.status.phase, "available");
  const inClass = await fixture(); await inClass.flow.run(inClass.updater, inClass.preferences, { ...inClass.options, canUpdate: () => false }); assert.ok(!inClass.calls.includes("install"));
});
test("mismo ejecutable después de instalación no repite update; versión nueva continúa", async () => {
  const stale = await fixture({}, { from: "1.0.6", target: "1.0.7" }); await stale.flow.run(stale.updater, stale.preferences, stale.options); assert.ok(!stale.calls.includes("install"));
  const updated = await fixture({ status: () => state("idle", { currentVersion: "1.0.7" }), check: () => state("current", { currentVersion: "1.0.7", newVersion: null }) }, { from: "1.0.6", target: "1.0.7" });
  await updated.flow.run(updated.updater, updated.preferences, updated.options); assert.ok(!updated.calls.includes("install"));
  assert.equal(newerStableVersion("1.0.7", "1.0.7"), false); assert.equal(newerStableVersion("1.0.7", "1.0.6"), false);
  assert.equal(newerStableVersion("1.0.7", "1.0.8-beta"), false); assert.equal(newerStableVersion("1.0.9", "1.0.10"), true);
});
test("fallo de descarga/firma continúa; configuración no guardada impide restart automático", async () => {
  const f = await fixture({ install: () => state("failed") }); await f.flow.run(f.updater, f.preferences, f.options); assert.ok(!f.calls.includes("restart"));
  const g = await fixture(); g.preferences.run = async () => false; await g.flow.run(g.updater, g.preferences, g.options); assert.ok(!g.calls.includes("restart"));
});
test("Ajustes permite autostart y kiosco on/off; salida temporal conserva preferencia", async () => {
  const f = await fixture(); f.updater.show(); const dom = new JSDOM('<div id="host"></div>'); const host = dom.window.document.querySelector("#host");
  renderUpdater(host, f.updater, f.preferences); assert.equal(host.querySelector("[data-autostart]").checked, true); assert.equal(host.querySelector("[data-kiosk]").checked, true);
  await f.preferences.run("autostart", false); await f.preferences.run("kiosk", false); assert.equal(f.preferences.status.autostart, false); assert.equal(f.preferences.status.kiosk, false);
  await f.preferences.run("autostart", true); await f.preferences.run("kiosk", true); await f.preferences.run("library-ready"); await f.preferences.run("exit-kiosk");
  assert.equal(f.preferences.status.kioskActive, false); assert.equal(f.preferences.status.kiosk, true); dom.window.close();
});
