import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Exercise the real Window.fetch in the same WebKitGTK API used by Linux Tauri.
// Auth and claims are independently exercised by device-auth-emulator.test.mjs.
const bytes = Buffer.from("Archivo congelado de prueba WebKit");
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url), "utf8"));
Object.assign(manifest.resources[0].download, { sizeBytes: bytes.length, checksums: { sha256: hash } });
const device = { deviceId: "a".repeat(32), displayName: "Equipo Prueba" };
const publication = { unitId: manifest.unit.unitId, name: manifest.unit.name, levelId: manifest.unit.levelId, version: manifest.version, contentHash: manifest.integrity.contentHash };
const bundle = await build({ configFile: false, logLevel: "error", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./webkit-publications-browser.mjs", import.meta.url)), name: "PublicationTest", formats: ["iife"] } } });
const javascript = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((item) => item.type === "chunk").code;
const csp = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;
const seen = new Set();
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname;
  if (path === "/") { response.setHeader("Content-Type", "text/html"); response.setHeader("Content-Security-Policy", csp); return response.end('<!doctype html><html><meta charset="utf-8"><title>Publicaciones WebKitGTK</title><pre id="result">Ejecutando…</pre><script src="/test.js"></script></html>'); }
  if (path === "/test.js") { response.setHeader("Content-Type", "text/javascript"); return response.end(javascript); }
  if (path === "/fixture") { response.setHeader("Content-Type", "application/json"); return response.end(JSON.stringify({ manifest, publication, device })); }
  if (request.headers.authorization !== "Bearer webkit-test-id-token") { response.statusCode = 401; return response.end(); }
  if (path === "/probe") { response.statusCode = Number(url.searchParams.get("status")); return response.end(); }
  seen.add(path);
  if (path === "/activeClassroomPublicationFile") {
    response.setHeader("Content-Type", "application/octet-stream"); response.setHeader("Content-Length", bytes.length); response.setHeader("X-Content-SHA256", hash); return response.end(bytes);
  }
  response.setHeader("Content-Type", "application/json");
  if (path === "/listActiveClassroomPublications") return response.end(JSON.stringify({ result: { publications: [publication], nextCursor: null, device } }));
  if (path === "/getActiveClassroomPublication") return response.end(JSON.stringify({ result: { manifest, device } }));
  response.statusCode = 404; response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  const status = await new Promise((resolve, reject) => {
    const child = spawn("xvfb-run", ["-a", "/usr/bin/python3", fileURLToPath(new URL("./webkit-runner.py", import.meta.url)), url], { stdio: "inherit", timeout: 90000 });
    child.on("error", reject); child.on("exit", resolve);
  });
  assert.equal(status, 0, "Falló transporte en WebKitGTK");
  assert.deepEqual([...seen].sort(), ["/activeClassroomPublicationFile", "/getActiveClassroomPublication", "/listActiveClassroomPublications"]);
  console.log("WebKitGTK: listado, manifest, descarga, SHA-256, displayName y estados HTTP correctos.");
} finally { await new Promise((resolve) => server.close(resolve)); }
