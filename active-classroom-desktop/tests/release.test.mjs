import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

test("release conserva versión única, identidad de instalación y Tauri 2.12.1", async () => {
  const pkg = await json("package.json");
  const lock = await json("package-lock.json");
  const config = await json("src-tauri/tauri.conf.json");
  const cargo = await readFile(join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = await readFile(join(root, "src-tauri/Cargo.lock"), "utf8");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  for (const version of [lock.version, lock.packages[""].version, config.version,
    cargo.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1],
    cargoLock.match(/name = "active-classroom"\s+version = "([^"]+)"/)?.[1]]) {
    assert.equal(version, pkg.version);
  }
  assert.equal(config.identifier, "com.activeclassroom.desktop");
  assert.equal(config.build.frontendDist, "../dist");
  assert.equal(pkg.dependencies["@tauri-apps/api"], "2.12.1");
  assert.equal(pkg.devDependencies["@tauri-apps/cli"], "2.12.1");
  assert.match(cargo, /tauri = \{ version = "=2\.12\.1"/);
});

test("fuentes y build distribuido no contienen claves privadas, cuentas de servicio o tokens incrustados", async () => {
  // Firebase apiKey/appId are public client configuration, not administrative secrets.
  // Runtime-issued tokens and device proofs must never be literals in this package.
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /["']private_key["']\s*:\s*["']/,
    /["']type["']\s*:\s*["']service_account["']/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/,
    /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  ];
  const source = [...await files(join(root, "src")), ...await files(join(root, "src-tauri/src"))];
  const bundle = await files(join(root, "dist"));
  assert.ok(bundle.some((path) => path.endsWith("index.html")));
  for (const path of bundle) {
    assert.doesNotMatch(path, /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|.*\.(?:pem|key|p12|pfx)|.*service.account.*\.json)$/i);
    assert.doesNotMatch(path, /\.map$/, "Release no debe distribuir sourcemaps de desarrollo");
  }
  for (const path of [...source, ...bundle, join(root, "src-tauri/tauri.conf.json")]) {
    if (!/\.(?:[cm]?js|ts|rs|json|html|css)$/.test(path)) continue;
    const text = await readFile(path, "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `Secreto detectado en ${path}; contenido omitido`);
  }
});
