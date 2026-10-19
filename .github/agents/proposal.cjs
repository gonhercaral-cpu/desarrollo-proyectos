// Exporta y comprueba propuestas sin red, credenciales ni ejecución del código propuesto.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { policy, parseAssignment, validateChanges } = require("./policy.cjs");

function git(cwd, args, encoding = "utf8") {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.excludesFile=/dev/null", ...args], {
    cwd, encoding, maxBuffer: policy.maxPatchBytes * 4,
  });
}

function readTask(file) {
  if (fs.statSync(file).size > 20000) throw new Error("Contrato de artefacto demasiado grande.");
  const task = JSON.parse(fs.readFileSync(file, "utf8"));
  parseAssignment(`/codex-delegate ${task.agent}\n${JSON.stringify({
    version: task.version, kind: task.kind, objective: task.objective,
    paths: task.paths, acceptance: task.acceptance, tests: task.tests,
  })}`);
  if (!/^[a-f0-9]{40}$/.test(task.baseSha)) throw new Error("SHA base inválido.");
  return task;
}

function inspect(cwd, task) {
  const numstat = git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z", task.baseSha]);
  const changes = numstat.split("\0").filter(Boolean).map((row) => {
    const [added, removed, file] = row.split("\t");
    const resolved = path.resolve(cwd, file);
    const mode = fs.existsSync(resolved)
      ? (fs.lstatSync(resolved).isSymbolicLink() ? "120000" : fs.lstatSync(resolved).isFile() ? "100644" : "160000")
      : "000000";
    return { path: file, binary: added === "-" || removed === "-", mode };
  });
  const patch = git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--full-index", task.baseSha], null);
  // Git's raw diff is the authority for modes; lstat alone would miss chmod changes.
  const raw = git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--raw", "-z", task.baseSha]);
  for (const header of raw.split("\0").filter((entry) => entry.startsWith(":"))) {
    const [oldMode, newMode] = header.slice(1).split(" ");
    if (![oldMode, newMode].every((mode) => ["100644", "000000"].includes(mode))) throw new Error("Modo Git prohibido.");
  }
  validateChanges(task, changes, patch.length);
  return { changes, patch };
}

function exportProposal(cwd, taskFile, destination) {
  const task = readTask(taskFile);
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  validateChanges(task, untracked.map((file) => ({ path: file, mode: "100644" })), 0);
  if (untracked.length) git(cwd, ["add", "--intent-to-add", "--", ...untracked]);
  const { changes, patch } = inspect(cwd, task);
  if (task.kind === "implement" && !changes.length) throw new Error("Sin cambios: no se presenta una implementación ficticia.");
  const reportPath = path.join(cwd, ".multiagent/report.md");
  if (!fs.existsSync(reportPath) || fs.lstatSync(reportPath).isSymbolicLink()) throw new Error("Falta un informe regular.");
  const report = fs.readFileSync(reportPath);
  if (!report.length || report.length > policy.maxReportBytes) throw new Error("Tamaño de informe inválido.");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "proposal.patch"), patch);
  fs.writeFileSync(path.join(destination, "report.md"), report);
  fs.copyFileSync(taskFile, path.join(destination, "assignment.json"));
  fs.writeFileSync(path.join(destination, "result.json"), JSON.stringify({
    version: 1, status: "proposal-unreviewed", agent: task.agent,
    baseSha: task.baseSha, sourceHead: task.sourceHead, runId: task.runId,
    runAttempt: task.runAttempt, commentId: task.commentId, changes,
    testsExecuted: false, // Las herramientas auxiliares no tienen shell. Codex/CI validan.
  }, null, 2) + "\n");
  return changes;
}

function checkProposal(cwd, directory) {
  const task = readTask(path.join(directory, "assignment.json"));
  const patchFile = path.resolve(directory, "proposal.patch");
  if (fs.statSync(patchFile).size > policy.maxPatchBytes) throw new Error("Parche demasiado grande.");
  // Nunca aplicar sobre cambios ajenos; este comando solo comprueba y no modifica el checkout.
  if (git(cwd, ["status", "--porcelain"]).trim()) throw new Error("Se requiere un checkout limpio y aislado.");
  if (git(cwd, ["rev-parse", "HEAD"]).trim() !== task.baseSha) throw new Error("El checkout no coincide con el SHA base.");
  const patch = fs.readFileSync(patchFile, "utf8");
  if (task.kind === "review") {
    if (patch.length) throw new Error("Una revisión no admite parches.");
    return task;
  }
  const headers = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
  if (!headers.length || headers.length > policy.maxFiles) throw new Error("Cabeceras de parche inválidas.");
  const changes = headers.map((match) => {
    if (match[1] !== match[2]) throw new Error("No se permiten renombrados.");
    return { path: match[1], mode: "100644", binary: false };
  });
  validateChanges(task, changes, Buffer.byteLength(patch));
  if (/^(?:new file mode|deleted file mode|old mode|new mode) (?!100644$)/m.test(patch) || /^(?:GIT binary patch|Binary files|rename |copy )/m.test(patch)) {
    throw new Error("Formato de parche no admitido.");
  }
  if (/^index [a-f0-9]+\.\.[a-f0-9]+ (?!100644$)/m.test(patch)) throw new Error("Modo de índice prohibido.");
  // git apply puede elegir nombres de ---/+++ distintos de diff --git.
  // Validar los destinos que Git interpretará, además de las cabeceras visibles.
  const actual = git(cwd, ["apply", "--numstat", "-z", "--", patchFile]).split("\0").filter(Boolean).map((row) => {
    const [added, removed, file] = row.split("\t");
    return { path: file, mode: "100644", binary: added === "-" || removed === "-" };
  });
  validateChanges(task, actual, Buffer.byteLength(patch));
  if (actual.length !== changes.length) throw new Error("Parche ambiguo.");
  git(cwd, ["apply", "--check", "--index", "--", patchFile]);
  return task;
}

if (require.main === module) {
  const [command, first, second] = process.argv.slice(2);
  try {
    if (command === "export" && first && second) exportProposal(process.cwd(), first, second);
    else if (command === "check" && first) checkProposal(process.cwd(), first);
    else throw new Error("Uso: node proposal.cjs export <assignment.json> <destino> | check <artefacto>");
    console.log("Propuesta comprobada. Pendiente de revisión y pruebas de Codex.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { readTask, inspect, exportProposal, checkProposal };
