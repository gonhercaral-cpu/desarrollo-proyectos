import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCertificate, verifyArtifactFiles } from "../scripts/validation-artifacts.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const expected = { commit: "a".repeat(40), runId: "12345", repository: "owner/repo", version: "1.0.16" };
const proof = () => ({ ...expected, schemaVersion: 1, artifacts: ["Active.Classroom_1.0.16_amd64.deb", "Active-Classroom-1.0.16-x86_64.AppImage", "verify_updater"].map(name => ({ name, sha256: "b".repeat(64), size: 100 })) });
test("release exige mismo commit, run, repositorio y versión validados", () => {
  assert.doesNotThrow(() => validateCertificate(proof(), expected));
  for (const key of Object.keys(expected)) assert.throws(() => validateCertificate({ ...proof(), [key]: "other" }, expected));
});
test("certificado rechaza path traversal, faltantes y duplicados", () => {
  for (const name of ["../../secret", "latest.json", "Active.Classroom_1.0.15_amd64.deb"]) { const value = proof(); value.artifacts[0].name = name; assert.throws(() => validateCertificate(value, expected)); }
  const value = proof(); value.artifacts.pop(); assert.throws(() => validateCertificate(value, expected));
  const duplicate = proof(); duplicate.artifacts[0] = duplicate.artifacts[1]; assert.throws(() => validateCertificate(duplicate, expected));
});
test("release rechaza instalador/verificador alterados aunque tamaño siga igual", async t => {
  const directory = await mkdtemp(join(tmpdir(), "classroom-validation-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const value = proof(); const bytes = Buffer.alloc(100, 7); const hash = createHash("sha256").update(bytes).digest("hex");
  for (const artifact of value.artifacts) { artifact.sha256 = hash; await writeFile(join(directory, artifact.name), bytes); }
  await writeFile(join(directory, "validation.json"), JSON.stringify(value));
  await verifyArtifactFiles(directory, expected);
  for (const artifact of value.artifacts) {
    await writeFile(join(directory, artifact.name), Buffer.alloc(100, 8));
    await assert.rejects(verifyArtifactFiles(directory, expected), /alterado/);
    await writeFile(join(directory, artifact.name), bytes);
  }
});
import { verifyValidationRun } from "../scripts/verify-validation-run.mjs";
test("RELEASE bloqueada ante validación fallida, omitida, ajena o de otro commit", () => {
  const run = { id: 12345, repository: { full_name: expected.repository }, workflow_id: 77, head_sha: expected.commit, event: "push", status: "completed", conclusion: "success" };
  const current = { ...run, id: 23456, event: "workflow_dispatch" };
  const jobs = ["Autorización de equipos y reglas Firebase", "Conversión Office real en contenedor", "Tests, Cargo y paquete Debian", "VALIDATION completa"].map(name => ({ name, status: "completed", conclusion: "success" }));
  assert.doesNotThrow(() => verifyValidationRun(run, current, jobs, expected));
  for (const patch of [{ conclusion: "failure" }, { conclusion: "cancelled" }, { status: "in_progress" }, { head_sha: "b".repeat(40) }, { workflow_id: 88 }, { repository: { full_name: "attacker/repo" } }, { event: "pull_request" }, { id: 54321 }]) assert.throws(() => verifyValidationRun({ ...run, ...patch }, current, jobs, expected));
  assert.throws(() => verifyValidationRun(run, { ...current, head_sha: "b".repeat(40) }, jobs, expected));
  for (let index = 0; index < jobs.length; index++) for (const conclusion of ["failure", "skipped", "cancelled"]) assert.throws(() => verifyValidationRun(run, current, jobs.map((job, position) => position === index ? { ...job, conclusion } : job), expected));
  assert.throws(() => verifyValidationRun(run, current, jobs.slice(1), expected));
  assert.throws(() => verifyValidationRun(run, current, [...jobs, { name: "Publicar release estable verificado", conclusion: "success" }], expected));
});
