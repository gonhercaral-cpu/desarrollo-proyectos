const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readTask } = require("./proposal.cjs");

const control = path.join(process.env.RUNNER_TEMP, "multiagent-control");
fs.mkdirSync(control, { recursive: true });
for (const file of ["policy.json", "policy.cjs", "proposal.cjs"]) {
  fs.copyFileSync(path.join(__dirname, file), path.join(control, file));
}
const taskFile = path.join(control, "assignment.json");
fs.writeFileSync(taskFile, process.env.ASSIGNMENT_JSON);
const task = readTask(taskFile);
const model = task.agent === "claude" ? process.env.CLAUDE_MODEL : process.env.GEMINI_MODEL;
if (!model || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,120}$/.test(model)) {
  throw new Error("Configura un identificador de modelo válido y autorizado para el proveedor seleccionado.");
}
if (!/^\d+$/.test(task.runId) || !Number.isSafeInteger(task.issueNumber) || !Number.isSafeInteger(task.runAttempt)) {
  throw new Error("Metadatos de ejecución inválidos.");
}
fs.mkdirSync(".multiagent", { recursive: true });
fs.copyFileSync(taskFile, ".multiagent/assignment.json");
fs.writeFileSync(".multiagent/pr.diff", process.env.PR_DIFF || "");
execFileSync("git", ["-c", "core.hooksPath=/dev/null", "switch", "-c",
  `agents/${task.agent}/issue-${task.issueNumber}-${task.runId}-${task.runAttempt}`], { stdio: "inherit" });
