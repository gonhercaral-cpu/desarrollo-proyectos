import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";
const manifest = await readFile(new URL("../../docs/active-classroom-manifest.example.json", import.meta.url));
const bundle = await build({ configFile: false, logLevel: "error", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./design-webkit-browser.mjs", import.meta.url)), name: "DesignAcceptance", formats: ["iife"] } } });
const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
const css = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => item.source).join("\n");
const javascript = output.find(item => item.type === "chunk").code;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const [mime, body] = path === "/fixture" ? ["application/json", manifest] : path === "/test.js" ? ["text/javascript", javascript] : path === "/style.css" ? ["text/css", css] : ["text/html", '<!doctype html><html data-layout-only><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/test.js"></script></html>'];
  response.setHeader("Content-Type", `${mime}; charset=utf-8`); response.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [920, 640]]) {
    const status = await new Promise((resolve, reject) => {
      const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1920x1200x24", "/usr/bin/python3", fileURLToPath(new URL("./webkit-runner.py", import.meta.url)), `http://127.0.0.1:${server.address().port}`, String(width), String(height)], { stdio: "inherit", timeout: 75000 });
      child.on("error", reject); child.on("exit", resolve);
    });
    assert.equal(status, 0, `Layout WebKitGTK ${width}×${height}`);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
