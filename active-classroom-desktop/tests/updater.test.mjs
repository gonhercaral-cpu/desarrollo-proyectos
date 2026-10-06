import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { renderUpdater } from "../src/updater/view.ts";
import { manifest, publicKey, updateEndpoint, releaseNotes } from "../scripts/updater-release.mjs";
const status = (phase, extra = {}) => ({ phase, currentVersion: "1.0.4", downloaded: 0, message: phase, ...extra });
function fixture(actions = {}) {
  let emit; const calls = []; let closed = false;
  const updater = new ProgramUpdater({ listen: async callback => { emit = callback; return () => { closed = true; }; },
    action: async action => { calls.push(action); return await (actions[action]?.() ?? status(action === "status" ? "idle" : "available", { newVersion: "1.0.5", notes: "Mejoras" })); },
  }, () => {});
  return { updater, calls, emit: value => emit(value), closed: () => closed };
}
test("arranque no espera Internet; detecta 1.0.5 y Después no instala", async () => {
  let release; const f = fixture({ check: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.updater.start(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ["status", "check"]);
  release(status("available", { newVersion: "1.0.5" })); await pending;
  assert.equal(f.updater.visible, true); f.updater.later(); assert.equal(f.updater.visible, false);
  assert.ok(!f.calls.includes("install")); f.updater.show(); assert.equal(f.updater.status.newVersion, "1.0.5");
  f.updater.destroy(); assert.equal(f.closed(), true);
});
test("instalación muestra progreso, firma e instalación; reinicio exige instalación completada", async () => {
  const f = fixture({ install: async () => { f.emit(status("downloading", { downloaded: 50, total: 100 })); assert.equal(f.updater.status.downloaded, 50); f.emit(status("verifying")); f.emit(status("installing")); return status("installed", { newVersion: "1.0.5" }); }, restart: () => status("installed") });
  await f.updater.start(); await f.updater.run("restart"); assert.ok(!f.calls.includes("restart"));
  await f.updater.run("install"); assert.equal(f.updater.status.phase, "installed"); await f.updater.run("restart"); assert.equal(f.calls.at(-1), "restart");
});
test("fallo Internet/firma mantiene UI funcional y permite reintento", async () => {
  let fail = true; const f = fixture({ install: async () => { if (fail) throw new Error("invalid signature"); return status("installed"); } });
  await f.updater.start(); await f.updater.run("install"); assert.equal(f.updater.status.phase, "failed");
  fail = false; await f.updater.run("install"); assert.equal(f.updater.status.phase, "installed");
  const offline = fixture({ check: () => { throw new Error("network"); } }); await offline.updater.start(); assert.equal(offline.updater.status.phase, "failed"); assert.equal(offline.updater.visible, false);
});
test("bloquea doble instalación y no cierra progreso por Después", async () => {
  let done; const f = fixture({ install: () => new Promise(resolve => { done = resolve; }) }); await f.updater.start();
  const pending = f.updater.run("install"); f.emit(status("downloading")); f.updater.later(); assert.equal(f.updater.visible, true);
  await f.updater.run("install"); assert.equal(f.calls.filter(x => x === "install").length, 1); done(status("installed")); await pending;
});

test("configuración ausente evita consulta; red fallida nunca muestra updater no configurado", async () => {
  const missing = fixture({ status: () => status("unconfigured", { message: "Actualizaciones no configuradas en esta instalación" }) });
  await missing.updater.start(); assert.deepEqual(missing.calls, ["status"]);
  assert.equal(missing.updater.status.phase, "unconfigured");
  const offline = fixture({ check: () => { throw new Error("offline"); } });
  await offline.updater.start(); assert.equal(offline.updater.status.phase, "failed");
  assert.equal(offline.updater.status.message, "No se pudo buscar actualizaciones");
});
test("Acerca de muestra versiones/notas seguras, botones y progreso", async t => {
  const dom = new JSDOM("<aside></aside>"); t.after(() => dom.window.close()); const f = fixture(); await f.updater.start();
  f.emit(status("available", { newVersion: "1.0.5", notes: "<script>alert(1)</script>" }));
  const host = dom.window.document.querySelector("aside"); renderUpdater(host, f.updater);
  assert.equal(host.querySelector("script"), null); assert.match(host.textContent, /Nueva versión disponible/); assert.match(host.textContent, /1.0.4/); assert.match(host.textContent, /1.0.5/);
  assert.equal(host.querySelector("[data-install]").textContent, "Actualizar ahora");
  f.emit(status("downloading", { downloaded: 25, total: 100 })); renderUpdater(host, f.updater); assert.equal(host.querySelector("progress").value, 25); assert.equal(host.querySelector("[data-check]").disabled, true);
});
test("metadata estable apunta a .deb, firma versión y clave pública exige formato", () => {
  const signature = Buffer.from("untrusted comment: test\nabc\ntrusted comment: timestamp:1\tfile:test\tversion:1.0.5\nxyz\n").toString("base64");
  const result = manifest("1.0.5", signature, "Notas");
  assert.equal(result.platforms["linux-x86_64-deb"].url, "https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/download/active-classroom-v1.0.5/Active.Classroom_1.0.5_amd64.deb");
  assert.throws(() => manifest("1.0.2", signature, "")); assert.throws(() => manifest("1.0.5-beta", signature, "")); assert.throws(() => publicKey(""));
  assert.equal(new URL(updateEndpoint).protocol, "https:");
});
test("notas CI incluyen sección completa y excluyen versiones anteriores", async () => {
  const notes = await releaseNotes("1.0.4");
  assert.match(notes, /Actualización del programa/); assert.match(notes, /CI verifica/);
  assert.doesNotMatch(notes, /Panel derecho acotado/);
});

test("CI publica nombre compatible con GitHub sin alterar paquete o firma", async t => {
  const directory = await mkdtemp(join(tmpdir(), "classroom-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "src-tauri/target/release/bundle/deb");
  const destination = join(directory, "assets");
  const bytes = Buffer.from("Debian fixture exact bytes");
  const signature = Buffer.from("untrusted comment: test\nabc\ntrusted comment: timestamp:1\tfile:test\tversion:1.0.5\nxyz\n").toString("base64");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ version: "1.0.5" }));
  await writeFile(join(directory, "CHANGELOG.md"), "## 1.0.5\nNotas de prueba\n");
  await writeFile(join(bundle, "Active Classroom_1.0.5_amd64.deb"), bytes);
  await writeFile(join(bundle, "Active Classroom_1.0.5_amd64.deb.sig"), signature);
  const script = fileURLToPath(new URL("../scripts/updater-release.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "metadata", destination], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const published = "Active.Classroom_1.0.5_amd64.deb";
  assert.deepEqual(await readFile(join(destination, published)), bytes);
  assert.equal(await readFile(join(destination, `${published}.sig`), "utf8"), signature);
  assert.equal(await readFile(join(destination, `${published}.sha256`), "utf8"), `${createHash("sha256").update(bytes).digest("hex")}  ${published}\n`);
  const metadata = JSON.parse(await readFile(join(destination, "latest.json"), "utf8"));
  assert.ok(metadata.platforms["linux-x86_64-deb"].url.endsWith(`/${published}`));
});

test("configuración distribuida tiene clave pública válida y artefactos de updater habilitados", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(publicKey(config.plugins.updater.pubkey), config.plugins.updater.pubkey);
  assert.deepEqual(config.plugins.updater.endpoints, [updateEndpoint]);
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
});
