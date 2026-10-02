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
    revoke: async (data) => { calls.push(["revoke", data]); records.find((item) => item.deviceId === data.deviceId).status = "revoked"; },
  };
  const render = (profile = { active: true, role: "admin" }) => act(async () => { root.render(React.createElement(TeamsPanel, { profile, api })); await new Promise((resolve) => setImmediate(resolve)); });
  const card = (name) => [...dom.window.document.querySelectorAll("article")].find((item) => item.querySelector("h4")?.textContent === name);
  const click = async (element, text) => {
    const button = [...element.querySelectorAll("button")].find((item) => item.textContent === text); assert.ok(button);
    await act(async () => { button.click(); await new Promise((resolve) => setImmediate(resolve)); });
  };
  try {
    await render();
    await t.test("muestra metadata y bloquea autorización de código vencido", () => {
      assert.match(card("Aula nueva").textContent, /A1234-B5678/);
      assert.match(card("Aula activa").textContent, /Última sincronización.*Declarada por Desktop.*unit1 v1.*0\.1\.0/);
      assert.match(card("Aula activa").textContent, /Hostname: active-T4-PRO/);
      assert.equal([...card("Código viejo").querySelectorAll("button")].find((item) => item.textContent === "Autorizar").disabled, true);
      assert.match(card("Aula revocada").textContent, /nueva solicitud/);
    });
    await t.test("autoriza con callable existente y actualiza estado", async () => {
      const input = card("Aula nueva").querySelector("input");
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Salón 4 - Inglés");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await click(card("Aula nueva"), "Autorizar");
      assert.deepEqual(calls.at(-1), ["approve", { code: "A1234B5678", displayName: "Salón 4 - Inglés" }]); assert.match(card("Salón 4 - Inglés").textContent, /Activo/);
    });
    await t.test("renombra y revoca equipo activo", async () => {
      await click(card("Aula activa"), "Renombrar");
      const input = card("Aula activa").querySelector("input");
      assert.equal(input.value, "Aula activa");
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Aula 20");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => { input.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setImmediate(resolve)); });
      assert.deepEqual(calls.at(-1), ["rename", { deviceId: "c".repeat(32), displayName: "Aula 20" }]);
      assert.match(card("Aula 20").textContent, /Hostname: active-T4-PRO/);
      await click(card("Aula 20"), "Revocar acceso"); assert.match(card("Aula 20").textContent, /Revocado/);
    });
    await t.test("rechaza solicitud y retira aprobación", async () => {
      await click(card("Código viejo"), "Rechazar"); assert.match(card("Código viejo").textContent, /Rechazado/);
      assert.ok(![...card("Código viejo").querySelectorAll("button")].some((item) => item.textContent === "Autorizar"));
    });
    await t.test("error de administración permanece visible después de refrescar listado", async () => {
      api.rename = async () => { throw new Error("Permiso revocado. Reintenta."); };
      await click(card("Salón 4 - Inglés"), "Renombrar");
      const input = card("Salón 4 - Inglés").querySelector("input");
      await act(async () => { input.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setImmediate(resolve)); });
      assert.match(dom.window.document.querySelector("[role=alert]").textContent, /Permiso revocado/);
    });
    await t.test("profesor e inactivo no pueden administrar ni consultar listado", async () => {
      records = [];
      const previousCalls = listCalls;
      await render({ active: true, role: "requester" });
      assert.match(dom.window.document.body.textContent, /Se requiere administrador activo/);
      await render({ active: false, role: "admin" }); assert.equal(dom.window.document.querySelectorAll("button").length, 0);
      assert.equal(listCalls, previousCalls);
    });
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    globalThis.window = prior.window; globalThis.document = prior.document; globalThis.IS_REACT_ACT_ENVIRONMENT = prior.act;
  }
});
