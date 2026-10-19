const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { policy, assertAllowedPath, parseAssignment, validateChanges } = require("../.github/agents/policy.cjs");
const authorize = require("../.github/agents/authorize.cjs");
const { exportProposal, checkProposal } = require("../.github/agents/proposal.cjs");

const contract = {
  version: 1, kind: "implement", objective: "Ajustar una utilidad aislada.",
  paths: ["src/utils/example.js", "tests/example.test.mjs"],
  acceptance: "Conservar la API existente.", tests: "node --test tests/example.test.mjs",
};
const body = (data = contract, agent = "claude") => `/codex-delegate ${agent}\n${JSON.stringify(data)}`;

test("acepta contratos explícitos de ambos auxiliares y rechaza tareas ambiguas", () => {
  for (const agent of policy.agents) assert.equal(parseAssignment(body(contract, agent)).agent, agent);
  for (const invalid of ["@claude arregla todo", " /codex-delegate claude\n{}", body({ ...contract, paths: ["src/**"] }),
    body({ ...contract, version: 2 }), body({ ...contract, objective: "" }), body({ ...contract, deploy: true }),
    body({ ...contract, paths: ["src/utils/example.js", "src/utils/Example.js"] })]) {
    assert.throws(() => parseAssignment(invalid));
  }
});

test("bloquea infraestructura, secretos, instrucciones, rutas ambiguas y artefactos", () => {
  for (const file of ["../src/a.js", "/src/a.js", "src/../a.js", "src//a.js", "src/a.js\nb.js",
    "src\\a.js", "src/.env", "src/CON.js", ".github/workflows/run.yml", "firestore.rules", "storage.rules",
    "firebase.json", "functions/index.js", "functions/deviceAccess.js", "drive/index.js", "src/context/Auth.jsx",
    "src/services/firebase.js", "src/CLAUDE.md", "docs/AGENTS.md", "docs/GEMINI.md", "docs/multiagent-collaboration.md",
    "functions/service-account.json", "docs/secret.json", "src/package.json", "src/package-lock.json",
    "src/vite.config.js", "public/key.pem", "public/installer.deb", "active-classroom-desktop/src-tauri/main.rs",
    "tests/multiagent-security.test.cjs"]) assert.throws(() => assertAllowedPath(file), file);
  assert.equal(assertAllowedPath("src/utils/example.js"), "src/utils/example.js");
});

test("bloquea cambios fuera de alcance, binarios, symlinks y presupuestos excesivos", () => {
  const assignment = parseAssignment(body());
  const change = { path: contract.paths[0], mode: "100644", binary: false };
  validateChanges(assignment, [change], 10);
  for (const invalid of [{ ...change, path: "src/utils/other.js" }, { ...change, mode: "120000" },
    { ...change, mode: "160000" }, { ...change, mode: "100755" }, { ...change, binary: true }]) {
    assert.throws(() => validateChanges(assignment, [invalid], 10));
  }
  assert.throws(() => validateChanges(assignment, [change], policy.maxPatchBytes + 1));
  assert.throws(() => validateChanges({ ...assignment, kind: "review" }, [change], 10));
});

function mockAuthorization(options = {}) {
  const outputs = {};
  const context = {
    actor: "leader", repo: { owner: "owner", repo: "project" }, runId: 42,
    eventName: "issue_comment", ref: "refs/heads/main",
    payload: { action: "created", repository: { default_branch: "main" }, comment: { id: 12 }, issue: { number: 7 } },
  };
  const comment = { body: body(), user: { login: "leader", type: "User" }, issue_url: "https://api.github.com/repos/owner/project/issues/7", updated_at: "2026-10-19T00:00:00Z" };
  const github = { rest: {
    users: { getByUsername: async () => ({ data: { type: options.userType || "User" } }) },
    repos: {
      getCollaboratorPermissionLevel: async () => ({ data: { permission: options.permission || "write" } }),
      getBranch: async () => ({ data: { commit: { sha: "a".repeat(40) } } }),
    },
    issues: {
      getComment: async () => ({ data: comment }),
      get: async () => ({ data: { state: options.closed ? "closed" : "open", pull_request: options.pr ? {} : undefined } }),
    },
    pulls: { get: async (args) => ({ data: args.mediaType ? "diff" : {
      head: { repo: { full_name: options.fork ? "attacker/project" : "owner/project" }, sha: "b".repeat(40) },
      base: { ref: "main", sha: "c".repeat(40) }, changed_files: 1,
    } }) },
  } };
  const args = { github, context, core: { setOutput: (name, value) => { outputs[name] = value; } }, controllers: "leader", triggeringActor: "leader" };
  return { args, comment, outputs };
}

test("autoriza al controlador incluido en allowlist y registra el SHA base", async () => {
  const { args, outputs } = mockAuthorization();
  await authorize(args);
  assert.equal(outputs.agent, "claude");
  assert.equal(JSON.parse(outputs.task).baseSha, "a".repeat(40));
});

test("rechaza actores externos, bots, permisos read, contratos ajenos y ramas no predeterminadas", async () => {
  for (const option of [{ permission: "read" }, { userType: "Bot" }, { closed: true }, { pr: true, fork: true }]) {
    const { args } = mockAuthorization(option);
    await assert.rejects(() => authorize(args));
  }
  for (const mutate of [
    ({ args }) => { args.context.actor = "outsider"; },
    ({ args }) => { args.triggeringActor = "outsider"; },
    ({ args }) => { args.controllers = ""; },
    ({ args }) => { args.context.ref = "refs/heads/agents/claude/test"; },
    ({ args }) => { args.context.payload.action = "edited"; },
    ({ comment }) => { comment.issue_url = "https://api.github.com/repos/owner/project/issues/999"; },
    ({ comment }) => { comment.user.login = "outsider"; },
    ({ comment }) => { comment.user.type = "Bot"; },
  ]) {
    const mock = mockAuthorization();
    mutate(mock);
    await assert.rejects(() => authorize(mock.args));
  }
});

test("dispatch exige IDs válidos y el mismo contrato autorizado del Issue", async () => {
  const { args, outputs } = mockAuthorization();
  args.context.eventName = "workflow_dispatch";
  args.context.payload.inputs = { issue_number: "7", comment_id: "12" };
  await authorize(args);
  assert.equal(JSON.parse(outputs.task).commentId, 12);
  args.context.payload.inputs.comment_id = "12; echo bad";
  await assert.rejects(() => authorize(args));
});

test("revisa PRs del repositorio como texto y rechaza cambios concurrentes del SHA", async () => {
  const { args, comment, outputs } = mockAuthorization({ pr: true });
  comment.body = body({ ...contract, kind: "review" }, "gemini");
  await authorize(args);
  assert.equal(JSON.parse(outputs.task).sourceHead, "b".repeat(40));
  assert.equal(outputs.pr_diff, "diff");
  const originalGet = args.github.rest.pulls.get;
  let reads = 0;
  args.github.rest.pulls.get = async (params) => {
    const response = await originalGet(params);
    if (!params.mediaType && ++reads === 2) response.data.head.sha = "d".repeat(40);
    return response;
  };
  await assert.rejects(() => authorize(args), /cambió/);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-multiagent-test-"));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("codex-multiagent-test-")) {
      throw new Error("Limpieza fuera del directorio temporal.");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const repo = path.join(directory, "repo");
  fs.mkdirSync(path.join(repo, "src/utils"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.excludesFile=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repo, ".gitignore"), ".multiagent/\n");
  fs.writeFileSync(path.join(repo, "src/utils/example.js"), "export const value = 1;\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  const task = { ...parseAssignment(body()), baseSha: git("rev-parse", "HEAD"), runId: "42", runAttempt: 1, commentId: 12 };
  const taskFile = path.join(directory, "assignment.json");
  fs.writeFileSync(taskFile, JSON.stringify(task));
  fs.mkdirSync(path.join(repo, ".multiagent"));
  fs.writeFileSync(path.join(repo, ".multiagent/report.md"), "Propuesta; pruebas pendientes de Codex.\n");
  return { directory, repo, git, task, taskFile, artifact: path.join(directory, "artifact") };
}

test("exporta cambios reales y los comprueba sin aplicarlos ni ejecutar código", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, contract.paths[0]), "export const value = 2;\n");
  exportProposal(f.repo, f.taskFile, f.artifact);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.artifact, "result.json"))).testsExecuted, false);
  f.git("restore", contract.paths[0]);
  checkProposal(f.repo, f.artifact);
  assert.equal(fs.readFileSync(path.join(f.repo, contract.paths[0]), "utf8"), "export const value = 1;\n");
  assert.equal(f.git("status", "--porcelain"), "");
  fs.writeFileSync(path.join(f.repo, "src/unrelated.js"), "// Cambios ajenos\n");
  assert.throws(() => checkProposal(f.repo, f.artifact), /limpio/);
});

test("incluye archivos nuevos del contrato y rechaza archivos nuevos fuera del contrato", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repo, "tests"));
  fs.writeFileSync(path.join(f.repo, contract.paths[1]), "// Test propuesto\n");
  exportProposal(f.repo, f.taskFile, f.artifact);
  assert.match(fs.readFileSync(path.join(f.artifact, "proposal.patch"), "utf8"), /new file mode 100644/);
  fs.writeFileSync(path.join(f.repo, "src/unassigned.js"), "// Fuera de alcance\n");
  assert.throws(() => exportProposal(f.repo, f.taskFile, f.artifact), /contrato/);
});

test("rechaza implementaciones vacías y revisiones que modifican código", (t) => {
  const f = fixture(t);
  assert.throws(() => exportProposal(f.repo, f.taskFile, f.artifact), /Sin cambios/);
  f.task.kind = "review";
  fs.writeFileSync(f.taskFile, JSON.stringify(f.task));
  exportProposal(f.repo, f.taskFile, f.artifact);
  assert.equal(fs.statSync(path.join(f.artifact, "proposal.patch")).size, 0);
  fs.writeFileSync(path.join(f.repo, contract.paths[0]), "export const value = 2;\n");
  assert.throws(() => exportProposal(f.repo, f.taskFile, f.artifact), /revisión/);
});

test("rechaza parches con destinos protegidos, modos peligrosos y SHA base incorrecto", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, contract.paths[0]), "export const value = 2;\n");
  exportProposal(f.repo, f.taskFile, f.artifact);
  f.git("restore", contract.paths[0]);
  const file = path.join(f.artifact, "proposal.patch");
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, original.replaceAll("src/utils/example.js", ".github/workflows/pwn.yml"));
  assert.throws(() => checkProposal(f.repo, f.artifact));
  fs.writeFileSync(file, original.replace(/^(---|\+\+\+) ([ab])\/src\/utils\/example\.js/gm, "$1 $2/.github/workflows/pwn.yml"));
  assert.throws(() => checkProposal(f.repo, f.artifact));
  fs.writeFileSync(file, original.replace("index ", "old mode 100644\nnew mode 120000\nindex "));
  assert.throws(() => checkProposal(f.repo, f.artifact));
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(f.artifact, "assignment.json"), JSON.stringify({ ...f.task, baseSha: "f".repeat(40) }));
  assert.throws(() => checkProposal(f.repo, f.artifact), /SHA base/);
});

test("los flujos multiagente no conceden escritura, no despliegan y fijan todas las acciones", () => {
  for (const file of ["multiagent-delegate.yml", "multiagent-ci.yml"]) {
    const yaml = fs.readFileSync(path.join(__dirname, "../.github/workflows", file), "utf8");
    assert.doesNotMatch(yaml, /:\s*write\b|pull_request_target|workflow_run|secrets:\s*inherit|firebase deploy|gh pr merge|git push/);
    for (const match of yaml.matchAll(/uses:\s*(\S+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
    assert.match(yaml, /persist-credentials: false/);
    assert.match(yaml, /timeout-minutes:/);
  }
  const delegate = fs.readFileSync(path.join(__dirname, "../.github/workflows/multiagent-delegate.yml"), "utf8");
  assert.match(delegate, /vars.MULTIAGENT_ENABLED == 'true'/);
  assert.match(delegate, /environment: multiagent-readonly/);
  assert.match(delegate, /max-budget-usd 2/);
  assert.match(delegate, /maxSessionTurns.*12/);
  assert.doesNotMatch(delegate, /secrets\.(?:FIREBASE|TAURI|UPDATER|GCP|GOOGLE_APPLICATION)/);
});
