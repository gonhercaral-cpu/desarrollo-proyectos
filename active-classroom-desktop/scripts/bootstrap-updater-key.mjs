// Run ONLY inside the manually invoked GitHub bootstrap workflow.
// Production private key exists in process memory and GitHub Secret only.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Solo GitHub Actions");
const repository = process.env.GITHUB_REPOSITORY;
if (!process.env.GH_TOKEN) throw new Error("Falta Secret temporal UPDATER_BOOTSTRAP_TOKEN");
const existing = spawnSync("gh", ["variable", "get", "ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY", "--repo", repository], { encoding: "utf8" });
if (existing.status === 0 && existing.stdout.trim()) throw new Error("Clave pública ya configurada: no se permite rotar/perder confianza de instalaciones existentes");
if (existing.status !== 0 && !existing.stderr.includes("404")) throw new Error("No se pudo comprobar configuración existente; no se generó clave");
const secrets = spawnSync("gh", ["secret", "list", "--repo", repository, "--json", "name"], { encoding: "utf8" });
if (secrets.status !== 0) throw new Error("No se pudo comprobar Secrets existentes; no se generó clave");
if (JSON.parse(secrets.stdout).some(value => ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"].includes(value.name))) throw new Error("Hay Secrets de firma existentes: no se permite sobrescribirlos");
const password = randomBytes(32).toString("hex");
console.log(`::add-mask::${password}`);
const result = spawnSync(process.env.TAURI_BOOTSTRAP_CLI || "node_modules/.bin/tauri", ["signer", "generate", "--ci", "--password", password], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (result.status !== 0) throw new Error("No se pudo generar clave; salida omitida");
const privateKey = result.stdout.match(/Private: \(Keep it secret!\)\s+([A-Za-z0-9+/=]+)/)?.[1];
const publicKey = result.stdout.match(/Public:\s+([A-Za-z0-9+/=]+)/)?.[1];
if (!privateKey || !publicKey) throw new Error("Formato de clave inesperado; salida omitida");
console.log(`::add-mask::${privateKey}`);
for (const [name, value] of [["TAURI_SIGNING_PRIVATE_KEY", privateKey], ["TAURI_SIGNING_PRIVATE_KEY_PASSWORD", password]]) {
  const uploaded = spawnSync("gh", ["secret", "set", name, "--repo", repository], { input: value, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (uploaded.status !== 0) throw new Error(`No se pudo guardar Secret ${name}; salida omitida`);
}
const uploaded = spawnSync("gh", ["variable", "set", "ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY", "--repo", repository, "--body", publicKey], { stdio: "pipe" });
if (uploaded.status !== 0) throw new Error("No se pudo guardar clave pública; no repitas generación: recupera configuración de Secrets antes de continuar");
console.log("Clave creada en Secrets; clave pública en variable. Elimina UPDATER_BOOTSTRAP_TOKEN.");
