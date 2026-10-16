import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const releaseRepository = "gonhercaral-cpu/desarrollo-proyectos";
export const updateEndpoint = `https://github.com/${releaseRepository}/releases/latest/download/latest.json`;
// GitHub normalizes spaces in uploaded filenames. Publish an explicit safe name.
export const updaterArtifactName = version => `Active.Classroom_${version}_amd64.deb`;
export function publicKey(value) {
  const decoded = Buffer.from(value || "", "base64").toString("utf8");
  const lines = decoded.trim().split(/\r?\n/);
  const raw = Buffer.from(lines[1] || "", "base64");
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment:") || raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") throw new Error("Falta ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY válido (clave pública Tauri)");
  return value.trim();
}
export function manifest(version, signature, notes, date = new Date().toISOString()) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Solo versiones estables SemVer");
  const decoded = Buffer.from(signature.trim(), "base64").toString("utf8");
  const trusted = decoded.split(/\r?\n/).find(line => line.startsWith("trusted comment:"));
  if (!trusted?.split("\t").includes(`version:${version}`)) throw new Error("Firma no vinculada a versión de release");
  return { version, notes, pub_date: date, platforms: {
    "linux-x86_64-deb": { signature: signature.trim(), url: `https://github.com/${releaseRepository}/releases/download/active-classroom-v${version}/${updaterArtifactName(version)}` },
  } };
}
export async function releaseNotes(version) {
  const changelog = await readFile("CHANGELOG.md", "utf8");
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find(value => new RegExp(`^\\[?${version.replaceAll(".", "\\.")}\\]?(?:\\s|$)`).test(value));
  const notes = section?.slice(section.indexOf("\n") + 1).trim();
  if (!notes) throw new Error(`Faltan notas CHANGELOG para ${version}`);
  return notes;
}
async function main() {
  const [action, destination] = process.argv.slice(2);
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  if (action === "config") {
    const key = publicKey(process.env.ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY);
    const configured = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
    if (publicKey(configured.plugins?.updater?.pubkey) !== key || configured.plugins.updater.endpoints?.[0] !== updateEndpoint) throw new Error("Clave/endpoint compilados no coinciden con configuración oficial de release");
    await writeFile(destination, JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: key, endpoints: [updateEndpoint], requireSignedVersion: true } } }));
  } else if (action === "metadata") {
    const directory = "src-tauri/target/release/bundle/deb";
    const expected = `Active Classroom_${version}_amd64.deb`;
    const packages = (await readdir(directory)).filter(name => name.endsWith(".deb"));
    if (packages.length !== 1 || packages[0] !== expected) throw new Error("Paquete Debian inesperado");
    const bytes = await readFile(join(directory, expected));
    const signature = await readFile(join(directory, `${expected}.sig`), "utf8");
    const notes = await releaseNotes(version);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "latest.json"), JSON.stringify(manifest(version, signature, notes), null, 2) + "\n");
    await writeFile(join(destination, "release-notes.md"), notes + "\n");
    const published = updaterArtifactName(version);
    await writeFile(join(destination, published), bytes);
    await writeFile(join(destination, `${published}.sig`), signature);
    await writeFile(join(destination, `${published}.sha256`), `${createHash("sha256").update(bytes).digest("hex")}  ${published}\n`);
    await writeFile(join(directory, `${expected}.sha256`), `${createHash("sha256").update(bytes).digest("hex")}  ${basename(expected)}\n`);
  } else { throw new Error("Uso: updater-release.mjs config <path> | metadata <directory>"); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
