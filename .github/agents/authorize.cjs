const { parseAssignment, policy } = require("./policy.cjs");

module.exports = async function authorize({ github, context, core, controllers, triggeringActor = process.env.GITHUB_TRIGGERING_ACTOR }) {
  const { owner, repo } = context.repo;
  const allowlist = (controllers || "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  async function checkController(login) {
    if (!login || !allowlist.includes(login.toLowerCase())) throw new Error("Identidad fuera de CODEX_CONTROLLER_LOGINS.");
    const [{ data: permission }, { data: user }] = await Promise.all([
      github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login }),
      github.rest.users.getByUsername({ username: login }),
    ]);
    if (user.type !== "User" || !["admin", "maintain", "write"].includes(permission.permission)) {
      throw new Error("Se requiere un controlador humano con permiso write, maintain o admin.");
    }
  }
  await checkController(context.actor);
  await checkController(triggeringActor || context.actor);
  const defaultBranch = context.payload.repository.default_branch;
  if (context.ref !== `refs/heads/${defaultBranch}`) throw new Error("Solo se ejecuta desde la rama predeterminada.");
  let commentId;
  let issueNumber;
  if (context.eventName === "issue_comment" && context.payload.action === "created") {
    commentId = context.payload.comment.id;
    issueNumber = context.payload.issue.number;
  } else if (context.eventName === "workflow_dispatch") {
    commentId = Number(context.payload.inputs.comment_id);
    issueNumber = Number(context.payload.inputs.issue_number);
  } else {
    throw new Error("Evento no permitido.");
  }
  if (![commentId, issueNumber].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("IDs inválidos.");
  const { data: comment } = await github.rest.issues.getComment({ owner, repo, comment_id: commentId });
  if (Number(comment.issue_url.split("/").pop()) !== issueNumber || comment.user.type !== "User") {
    throw new Error("El comentario debe pertenecer al Issue/PR y a un controlador humano.");
  }
  await checkController(comment.user.login);
  const assignment = parseAssignment(comment.body);
  const { data: issue } = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  if (issue.state !== "open") throw new Error("El Issue/PR debe estar abierto.");
  let prDiff = "";
  let sourceHead = null;
  if (issue.pull_request) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: issueNumber });
    if (pr.head.repo?.full_name !== `${owner}/${repo}` || pr.base.ref !== defaultBranch) {
      throw new Error("No se procesan forks ni PRs hacia otra rama.");
    }
    if (assignment.kind !== "review") throw new Error("Los PRs solo admiten revisión; implementa desde un Issue.");
    if (pr.changed_files > policy.maxFiles) throw new Error("PR demasiado grande; divide la revisión.");
    const { data: diff } = await github.rest.pulls.get({ owner, repo, pull_number: issueNumber, mediaType: { format: "diff" } });
    prDiff = String(diff);
    if (Buffer.byteLength(prDiff) > policy.maxPatchBytes) throw new Error("Diff de revisión demasiado grande.");
    const { data: currentPr } = await github.rest.pulls.get({ owner, repo, pull_number: issueNumber });
    if (currentPr.head.sha !== pr.head.sha || currentPr.base.sha !== pr.base.sha) {
      throw new Error("El PR cambió durante la lectura; delega otra revisión del SHA actual.");
    }
    sourceHead = pr.head.sha;
  }
  const { data: branch } = await github.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
  const task = {
    ...assignment, issueNumber, commentId, sourceHead,
    repository: `${owner}/${repo}`, controller: comment.user.login,
    commentUpdatedAt: comment.updated_at, baseSha: branch.commit.sha,
    runId: String(context.runId), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  };
  core.setOutput("agent", task.agent);
  core.setOutput("base_sha", task.baseSha);
  core.setOutput("task", JSON.stringify(task));
  core.setOutput("pr_diff", prDiff);
};
