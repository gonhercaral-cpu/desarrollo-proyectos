import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { publicKey, bundleArtifacts } from "./updater-release.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
publicKey(process.env.ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY);
// Crypto verification needs only the public key, never the signing secrets.
const environment = { ...process.env };
delete environment.TAURI_SIGNING_PRIVATE_KEY;
delete environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
for (const { path: artifact } of await bundleArtifacts(version)) {
  const verified = spawnSync("cargo", ["run", "--release", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example", "verify_updater", "--", artifact, `${artifact}.sig`, version], { stdio: "inherit", env: environment });
  if (verified.status !== 0) throw new Error("Firma no corresponde a clave pública/versión compiladas");
}
