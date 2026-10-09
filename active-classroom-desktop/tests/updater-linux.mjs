// Real installed packages, official updater, signature failures and actual restart.
// Runs only in an ephemeral Linux CI runner/container, never on a user's desktop.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { once } from "node:events";
import { build } from "vite";
import { fileURLToPath } from "node:url";
if (process.platform !== "linux" || process.env.CI !== "true") throw new Error("Aceptación requiere runner Linux CI aislado");
const directory = await mkdtemp(join(tmpdir(), "ac-updater-ci-"));
const original = new Map();
const saved = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
for (const path of saved) original.set(path, await readFile(path, "utf8"));
const command = (program, args, options = {}) => {
  const result = spawnSync(program, args, { stdio: "inherit", ...options });
  assert.equal(result.status, 0, `${program} falló`); return result;
};
const privileged = (program, args) => process.getuid() === 0 ? command(program, args) : command("sudo", ["-n", program, ...args]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
let server; let mode = "corrupt"; let endpoint; let packageBytes; let signature; let oldSignature; let oldBytes;
let downloads = 0;
const certPath = `/usr/local/share/ca-certificates/ac-updater-ci-${process.pid}.crt`;
try {
  const bundle = await build({ configFile: false, logLevel: "error", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./updater-browser.mjs", import.meta.url)), name: "UpdaterAcceptance", formats: ["iife"] } } });
  const script = join(directory, "updater-test.js");
  await writeFile(script, (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === "chunk").code);
  // Ephemeral TEST key in memory only. Never exported as a CI artifact or production key.
  const generation = command("node_modules/.bin/tauri", ["signer", "generate", "--ci", "--password", ""], { stdio: "pipe" });
  const output = generation.stdout.toString();
  const privateKey = output.match(/Private: \(Keep it secret!\)\s+([A-Za-z0-9+/=]+)/)?.[1];
  const publicKey = output.match(/Public:\s+([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(privateKey && publicKey, "Generación test sin imprimir claves");
  const signingEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: privateKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" };
  const cert = join(directory, "tls.crt"); const tlsKey = join(directory, "tls.key");
  const caCert = join(directory, "ca.crt"); const caKey = join(directory, "ca.key");
  const request = join(directory, "server.csr"); const extensions = join(directory, "server.ext");
  command("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caCert, "-days", "1", "-subj", "/CN=Active Classroom CI CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], { stdio: "pipe" });
  command("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", tlsKey, "-out", request, "-subj", "/CN=localhost"], { stdio: "pipe" });
  await writeFile(extensions, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n");
  command("openssl", ["x509", "-req", "-in", request, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "1", "-sha256", "-extfile", extensions], { stdio: "pipe" });
  privileged("cp", [caCert, certPath]); privileged("update-ca-certificates", []);
  server = createServer({ key: await readFile(tlsKey), cert: await readFile(cert) }, (request, response) => {
    console.log("UPDATER_FIXTURE_REQUEST", mode, request.url);
    if (mode === "offline") { response.writeHead(503).end(); return; }
    if (request.url === "/fixture/releases/latest/download/latest.json") {
      const version = mode === "current" ? "1.0.6" : "1.0.7";
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ version, notes: "Prueba CI instalada", platforms: { "linux-x86_64-deb": { url: endpoint.replace("/latest/download/latest.json", `/download/active-classroom-v${version}/fixture.deb`), signature: ["current", "replay"].includes(mode) ? oldSignature : signature } } }));
    } else if (request.url === "/fixture/releases/download/active-classroom-v1.0.7/fixture.deb") {
      downloads++;
      const bytes = mode === "replay" ? oldBytes : mode === "corrupt" ? Buffer.concat([packageBytes, Buffer.from("tampered")]) : packageBytes;
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      response.end(bytes);
    } else { response.writeHead(404).end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  endpoint = `https://127.0.0.1:${server.address().port}/fixture/releases/latest/download/latest.json`;
  const probe = spawn("curl", ["--fail", "--silent", "--show-error", endpoint], { stdio: "pipe" });
  // Before fixtures are built the endpoint returns an incomplete manifest, but
  // HTTPS must already verify against system trust with no insecure flags.
  const probeCode = await new Promise(resolve => { probe.on("exit", resolve); });
  assert.equal(probeCode, 0, "TLS local confiable para aceptación");
  const overlay = join(directory, "updater.json");
  for (const version of ["1.0.6", "1.0.7"]) {
    for (const path of saved) {
      const text = original.get(path);
      if (path.endsWith(".json")) { const value = JSON.parse(text); value.version = version; if (value.packages) value.packages[""].version = version; await writeFile(path, JSON.stringify(value, null, 2) + "\n"); }
      else await writeFile(path, text.replace(/(name = "active-classroom"\s*\nversion = ")[^"]+/, `$1${version}`));
    }
    await writeFile(overlay, JSON.stringify({ version, build: { beforeBuildCommand: "" }, bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: publicKey, endpoints: [endpoint], requireSignedVersion: true } } }));
    command("node_modules/.bin/tauri", ["build", "--config", overlay, "--features", "updater-acceptance", "--bundles", "deb", "--", "--locked"], { env: signingEnv });
    const bundle = resolve(`src-tauri/target/release/bundle/deb/Active Classroom_${version}_amd64.deb`);
    const copy = join(directory, `${version}.deb`); await copyFile(bundle, copy);
    const sig = await readFile(`${bundle}.sig`, "utf8");
    if (version === "1.0.6") { oldBytes = await readFile(copy); oldSignature = sig; }
    else { packageBytes = await readFile(copy); signature = sig; }
    // Remove only the two named test bundles, so production metadata sees one installer.
    assert.ok(bundle.startsWith(resolve("src-tauri/target/release/bundle/deb") + "/"));
    await rm(bundle); await rm(`${bundle}.sig`);
  }
  privileged("dpkg", ["-i", join(directory, "1.0.6.deb")]);
  const identity = { deviceId: "a".repeat(32), credential: randomBytes(32).toString("hex"), name: "Salón updater CI", activated: true, revoked: false };
  command("secret-tool", ["store", "--label", "CI-updater", "application", "com.activeclassroom.desktop", "credential", "device-v1"], { input: JSON.stringify(identity), stdio: "pipe" });
  const appData = join(process.env.XDG_DATA_HOME, "com.activeclassroom.desktop");
  const ownerRoot = join(appData, "offline-v1/users", digest(Buffer.from(`ac-device-${identity.deviceId}`)));
  const content = Buffer.from("Unit offline conservada"); const hash = digest(content);
  const object = join(ownerRoot, "objects", hash); const manifestPath = join(ownerRoot, "units/unit-ci/versions/1/manifest.json");
  await mkdir(join(ownerRoot, "objects"), { recursive: true }); await mkdir(join(ownerRoot, "units/unit-ci/versions/1"), { recursive: true });
  const unit = JSON.parse(await readFile("../docs/active-classroom-manifest.example.json", "utf8"));
  unit.unit.unitId = "unit-ci"; unit.version = 1; unit.resources = [unit.resources[0]];
  unit.resources[0].download.sizeBytes = content.length; unit.resources[0].download.checksums.sha256 = hash;
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const body = { ...unit }; for (const key of ["version", "publishedAt", "integrity"]) delete body[key];
  unit.integrity.contentHash = digest(Buffer.from(canonical(body)));
  await writeFile(object, content); await writeFile(manifestPath, JSON.stringify(unit));
  const preferences = join(process.env.XDG_CONFIG_HOME, "classroom-fixture-settings.json");
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true }); await writeFile(preferences, JSON.stringify({ projector: "HDMI-1", displayName: identity.name }));
  const before = new Map(); for (const path of [object, manifestPath, preferences]) before.set(path, digest(await readFile(path)));
  const report = join(directory, "result.json");
  async function run(stage, desktop) {
    await rm(report, { force: true });
    const child = spawn(desktop ? "gio" : "/usr/bin/active-classroom", desktop ? ["launch", desktop] : ["--from-autostart"], { stdio: "inherit", env: { ...process.env, ACTIVE_CLASSROOM_UPDATER_STAGE: stage, ACTIVE_CLASSROOM_UPDATER_REPORT: report, ACTIVE_CLASSROOM_UPDATER_SCRIPT: script } });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); }); assert.equal(code, 0, `Etapa ${stage}`);
    if (desktop) {
      for (let attempt = 0; attempt < 900; attempt++) {
        if (await readFile(report, "utf8").then(JSON.parse).catch(() => undefined)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Autostart no terminó: ${stage}`);
    }
  }
  for (const stage of ["current", "offline", "corrupt", "replay"]) {
    mode = stage; await run(stage);
    const version = command("dpkg-query", ["-W", "-f=${Version}", "active-classroom"], { stdio: "pipe" }).stdout.toString(); assert.equal(version, "1.0.6");
  }
  const autostartDirectory = join(process.env.XDG_CONFIG_HOME, "autostart");
  const entries = (await readdir(autostartDirectory)).filter(name => name.endsWith(".desktop"));
  assert.equal(entries.length, 1, "Una entrada de autostart");
  const desktop = join(autostartDirectory, entries[0]);
  const entry = await readFile(desktop, "utf8");
  assert.match(entry, /Exec=.*\/usr\/bin\/active-classroom.*--from-autostart/);
  // The successful 1.0.6 session boot uses the entry generated by the plugin.
  mode = "success"; await run("update", desktop);
  let result;
  for (let attempt = 0; attempt < 300; attempt++) {
    result = await readFile(report, "utf8").then(JSON.parse).catch(() => undefined); if (result) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(result?.ok, true, "Proceso reiniciado registra versión instalada");
  const beforeBoot = downloads;
  // A session launcher executes the real plugin-generated entry, with no Terminal.
  await new Promise(resolve => setTimeout(resolve, 500));
  mode = "offline"; await run("offline-restarted", desktop);
  await new Promise(resolve => setTimeout(resolve, 500));
  mode = "success"; await run("current-restarted", desktop);
  assert.equal(downloads, beforeBoot, "Dos nuevos arranques no reinstalan ni reinician");
  for (const [path, expected] of before) assert.equal(digest(await readFile(path)), expected, "Datos conservados byte a byte");
  const after = command("secret-tool", ["lookup", "application", "com.activeclassroom.desktop", "credential", "device-v1"], { stdio: "pipe" }).stdout.toString().trim(); assert.deepEqual(JSON.parse(after), identity);
  const verified = { ...result, sessionAutostartEntryLaunched: true, offlineAutostart: true, onlineSubsequentBootNoReinstall: true, wayland: process.env.GDK_BACKEND === "wayland", cachePreserved: true, unitsPreserved: true, preferencesPreserved: true, credentialPreserved: true, rejectedCorruptSignature: true, rejectedSignedVersionReplay: true, offlineFailurePreservedVersion: true, sameVersionRecognized: true };
  console.log("UPDATER_LINUX_RESULT", JSON.stringify(verified));
  if (process.env.ACTIVE_CLASSROOM_UPDATER_CI_REPORT) await writeFile(process.env.ACTIVE_CLASSROOM_UPDATER_CI_REPORT, JSON.stringify(verified, null, 2));
} finally {
  if (server) { server.closeAllConnections(); server.close(); }
  for (const [path, text] of original) await writeFile(path, text);
  privileged("rm", ["-f", certPath]); privileged("update-ca-certificates", []);
  await rm(directory, { recursive: true, force: true });
}
