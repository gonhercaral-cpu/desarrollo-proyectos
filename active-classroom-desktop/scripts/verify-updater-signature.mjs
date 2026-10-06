import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { publicKey } from "./updater-release.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const artifact = `src-tauri/target/release/bundle/deb/Active Classroom_${version}_amd64.deb`;
const key = Buffer.from(publicKey(process.env.ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY), "base64").toString("utf8");
const signature = Buffer.from((await readFile(`${artifact}.sig`, "utf8")).trim(), "base64").toString("utf8");
const directory = await mkdtemp(join(tmpdir(), "ac-public-signature-"));
try {
  const path = join(directory, "artifact.minisig"); await writeFile(path, signature);
  const verified = spawnSync("minisign", ["-Vm", artifact, "-P", key.trim().split(/\r?\n/)[1], "-x", path], { stdio: "inherit" });
  if (verified.status !== 0) throw new Error("Firma updater no corresponde a clave pública incrustada");
  const trusted = signature.split(/\r?\n/).find(line => line.startsWith("trusted comment:"));
  if (!trusted?.split("\t").includes(`version:${version}`)) throw new Error("Firma no vinculada a versión");
} finally { await rm(directory, { recursive: true, force: true }); }
