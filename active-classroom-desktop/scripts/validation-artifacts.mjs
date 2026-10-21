import { readFile, writeFile, copyFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleArtifacts, sha256, updaterArtifactName, appImageArtifactName } from "./updater-release.mjs";

export function validateCertificate(proof, expected) {
  for (const key of ["commit", "runId", "repository", "version"]) if (proof[key] !== expected[key]) throw new Error(`Validación no corresponde a ${key}`);
  if (proof.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(proof.commit) || !/^\d+$/.test(proof.runId) || !/^\d+\.\d+\.\d+$/.test(proof.version)) throw new Error("Certificado de validación inválido");
  const names = [updaterArtifactName(proof.version), appImageArtifactName(proof.version), "verify_updater"];
  if (!Array.isArray(proof.artifacts) || proof.artifacts.length !== names.length || new Set(proof.artifacts.map(item => item.name)).size !== names.length || proof.artifacts.some(item => !names.includes(item.name) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size <= 0)) throw new Error("Artefactos de validación inválidos");
  return proof;
}
export async function verifyArtifactFiles(directory, expected) {
  const proof = validateCertificate(JSON.parse(await readFile(join(directory, "validation.json"), "utf8")), expected);
  for (const artifact of proof.artifacts) {
    const path = join(directory, artifact.name);
    if ((await stat(path)).size !== artifact.size || await sha256(path) !== artifact.sha256) throw new Error(`Artefacto validado alterado: ${artifact.name}`);
  }
  return proof;
}
async function main() {
  const [action, directory] = process.argv.slice(2);
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  if (action === "collect") {
    await mkdir(directory, { recursive: true });
    const sources = [...await bundleArtifacts(version), { path: "src-tauri/target/release/examples/verify_updater", name: "verify_updater" }];
    const artifacts = [];
    for (const source of sources) {
      const target = join(directory, source.name); await copyFile(source.path, target);
      artifacts.push({ name: source.name, sha256: await sha256(target), size: (await stat(target)).size });
    }
    const proof = { schemaVersion: 1, repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, commit: process.env.GITHUB_SHA, version, artifacts };
    validateCertificate(proof, proof);
    await writeFile(join(directory, "validation.json"), JSON.stringify(proof, null, 2));
  } else if (action === "verify") {
    const proof = await verifyArtifactFiles(directory, { repository: process.env.GITHUB_REPOSITORY, runId: process.env.VALIDATION_RUN, commit: process.env.RELEASE_COMMIT, version });
    console.info(`VALIDATED_ARTIFACTS commit=${proof.commit} version=${version} source_run=${proof.runId}`);
  } else throw new Error("Uso: validation-artifacts.mjs collect|verify <directory>");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
