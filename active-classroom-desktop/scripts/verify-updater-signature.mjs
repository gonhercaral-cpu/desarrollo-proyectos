import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { publicKey } from "./updater-release.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const artifact = `src-tauri/target/release/bundle/deb/Active Classroom_${version}_amd64.deb`;
publicKey(process.env.ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY);
// Crypto verification needs only the public key, never the signing secrets.
const environment = { ...process.env };
delete environment.TAURI_SIGNING_PRIVATE_KEY;
delete environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
const verified = spawnSync("cargo", ["run", "--release", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example", "verify_updater", "--", artifact, `${artifact}.sig`, version], { stdio: "inherit", env: environment });
if (verified.status !== 0) throw new Error("Firma updater no corresponde a clave pública/versión compiladas");
