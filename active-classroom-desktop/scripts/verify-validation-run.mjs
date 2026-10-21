import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyValidationRun(run, current, jobs, expected) {
  if (!/^\d+$/.test(expected.runId) || !/^[a-f0-9]{40}$/.test(expected.commit)) throw new Error("Identificador de validación inválido");
  if (String(run.id) !== expected.runId || String(current.id) === expected.runId || run.repository?.full_name !== expected.repository || current.repository?.full_name !== expected.repository || run.workflow_id !== current.workflow_id || run.head_sha !== expected.commit || current.head_sha !== expected.commit || !["push", "workflow_dispatch"].includes(run.event) || run.status !== "completed" || run.conclusion !== "success") throw new Error("Se requiere VALIDATION verde del mismo workflow, repositorio y commit exacto");
  for (const name of ["Autorización de equipos y reglas Firebase", "Conversión Office real en contenedor", "Tests, Cargo y paquete Debian", "VALIDATION completa"]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success") throw new Error(`Validación obligatoria ausente o fallida: ${name}`);
  }
  if (jobs.some(job => job.name === "Publicar release estable verificado" && job.conclusion !== "skipped")) throw new Error("El origen debe ser una validación, no otra release");
}
async function main() {
  const expected = { repository: process.env.GITHUB_REPOSITORY, commit: process.env.RELEASE_COMMIT, runId: process.env.VALIDATION_RUN };
  if (!/^\d+$/.test(expected.runId || "")) throw new Error("Run inválido");
  const request = async path => {
    const response = await fetch(`https://api.github.com/repos/${expected.repository}/actions/${path}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub validation HTTP ${response.status}`);
    return response.json();
  };
  const [run, current] = await Promise.all([request(`runs/${expected.runId}`), request(`runs/${process.env.GITHUB_RUN_ID}`)]);
  const jobs = []; let page = 1;
  for (;;) { const result = await request(`runs/${expected.runId}/jobs?per_page=100&page=${page++}`); jobs.push(...result.jobs); if (result.jobs.length < 100) break; }
  verifyValidationRun(run, current, jobs, expected);
  console.info(`VALIDATION_GREEN commit=${expected.commit} source_run=${expected.runId}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
