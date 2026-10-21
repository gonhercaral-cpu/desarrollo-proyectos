import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import React, { act } from "react";

// Reuse the Desktop test dependency; no additional package or lockfile is needed.
const { JSDOM } = createRequire(new URL("../active-classroom-desktop/package.json", import.meta.url))("jsdom");
test("Equipos: autorización, rechazo, renombrado, revocación y permisos de UI", async (t) => {
  const dom = new JSDOM("<main id='root'></main>", { url: "http://localhost" });
  const prior = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  dom.window.confirm = () => true;
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, plugins: [react(), {
    name: "device-api-test", enforce: "pre",
    resolveId(source) { if (source.endsWith("services/deviceService")) return "\0device-api-test"; },
    load(id) { if (id === "\0device-api-test") return "export const deviceService = {};"; },
  }] });
  const { default: TeamsPanel } = await server.ssrLoadModule("/src/active-classroom/components/TeamsPanel.jsx");
  const root = createRoot(dom.window.document.querySelector("#root"));
  t.after(async () => { await act(async () => root.unmount()); await server.close(); dom.window.close(); globalThis.window = prior.window; globalThis.document = prior.document; globalThis.IS_REACT_ACT_ENVIRONMENT = prior.act; });
  let records = [
    { deviceId: "a".repeat(32), name: "Aula nueva", deviceName: "Aula nueva", displayName: "", status: "pending", code: "A1234B5678", requestedAt: Date.now(), expiresAt: Date.now() + 60000 },
    { deviceId: "b".repeat(32), name: "Código viejo", status: "pending", code: "B1234B5678", expiresAt: Date.now() - 1000 },
    { deviceId: "c".repeat(32), name: "Aula activa", deviceName: "active-T4-PRO", displayName: "Aula activa", status: "authorized", appVersion: "0.1.0", lastSeenAt: Date.now(), lastSyncAt: Date.now(), lastSyncUnitId: "unit1", lastSyncVersion: 1 },
    { deviceId: "d".repeat(32), name: "Aula revocada", status: "revoked" },
  ];
  const calls = [];
  let listCalls = 0;
  const api = {
    list: async () => { listCalls++; return { devices: structuredClone(records), nextCursor: null }; },
    approve: async (data) => { calls.push(["approve", data]); const device = records.find((item) => item.code === data.code); device.status = "authorized"; device.code = null; device.displayName = data.displayName; },
    reject: async (data) => { calls.push(["reject", data]); const device = records.find((item) => item.deviceId === data.deviceId); device.status = "revoked"; device.revokedReason = "rejected"; },
    rename: async (data) => { calls.push(["rename", data]); records.find((item) => item.deviceId === data.deviceId).displayName = data.displayName; },
    reauthorize: async data => { calls.push(["reauthorize", data]); records.find(item => item.deviceId === data.deviceId).status = "authorized"; },
    unlink: async data => { calls.push(["unlink", data]); records.find(item => item.deviceId === data.deviceId).status = "unlinked"; },
    remove: async data => { calls.push(["remove", data]); records = records.filter(item => item.deviceId !== data.deviceId); },
    revoke: async (data) => { calls.push(["revoke", data]); records.find((item) => item.deviceId === data.deviceId).status = "revoked"; },
  };
  const render = (profile = { active: true, role: "admin" }) => act(async () => { root.render(React.createElement(TeamsPanel, { profile, api })); await new Promise((resolve) => setImmediate(resolve)); });
  const inspector = () => dom.window.document.querySelector(".ac-console-inspector");
  const select = async name => { const row = [...dom.window.document.querySelectorAll("tbody tr")].find(item => item.textContent.includes(name)); assert.ok(row, name); await act(async () => row.querySelector("button").click()); };
  const click = async text => { const button = [...inspector().querySelectorAll("button")].find(item => item.textContent.trim() === text); assert.ok(button, text); await act(async () => { button.click(); await new Promise(resolve => setImmediate(resolve)); }); };
  const change = async (input, value) => { await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
  await render();
  await t.test("tabla e inspector utilizan datos reales y no crean telemetría remota", async () => { await select("Aula activa"); assert.match(inspector().textContent, /active-T4-PRO/); assert.match(inspector().textContent, /0.1.0/); assert.match(inspector().textContent, /unit1 v1/); assert.equal(dom.window.document.body.textContent.includes("Sincronizar ahora"), false); });
  await t.test("reauthoriza y desvincula/elimina desde inspector sin reinstalar", async () => {
    await select("Aula revocada"); await click("Reautorizar"); assert.ok(calls.some(([action]) => action === "reauthorize"));
    await click("Desvincular"); assert.ok(calls.some(([action]) => action === "unlink"));
    await click("Eliminar equipo"); assert.ok(calls.some(([action]) => action === "remove"));
    assert.ok(!dom.window.document.querySelector("tbody").textContent.includes("Aula revocada"));
  });
  await t.test("solicitud vencida no puede autorizarse", async () => { await select("Código viejo"); assert.equal([...inspector().querySelectorAll("button")].find(button => button.textContent === "Autorizar equipo").disabled, true); });
  await t.test("vincula con código y conserva API existente", async () => { await select("Aula nueva"); await change(inspector().querySelector("input"), "Salón 4 - Inglés"); await click("Autorizar equipo"); assert.deepEqual(calls.at(-1), ["approve", { code: "A1234B5678", displayName: "Salón 4 - Inglés" }]); await select("Salón 4 - Inglés"); assert.match(inspector().textContent, /Offline|En línea/); });
  await t.test("renombra y revoca equipo con confirmación", async () => { await select("Aula activa"); await click("Renombrar pantalla"); const input = inspector().querySelector("input"); assert.equal(input.value, "Aula activa"); await change(input, "Aula 20"); await act(async () => { input.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setImmediate(resolve)); }); assert.deepEqual(calls.at(-1), ["rename", { deviceId: "c".repeat(32), displayName: "Aula 20" }]); await click("Revocar acceso"); assert.equal(calls.at(-1)[0], "revoke"); assert.match(inspector().textContent, /Revocado/); });
  await t.test("sin permiso no consulta equipos, permiso delegado sí", async () => { const before = listCalls; await render({ active: true, role: "collaborator" }); assert.equal(listCalls, before); assert.match(dom.window.document.body.textContent, /administrador|permiso/); await render({ active: true, role: "collaborator", activeClassroomPermissions: { access: true, manageDevices: true } }); assert.ok(dom.window.document.querySelector("tbody tr")); assert.ok(listCalls > before); });
});
