import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readReleaseTag, readLatestRelease } from "../scripts/release-tag.mjs";

const tag = "active-classroom-v1.0.17";
const sha = "a".repeat(40);
const reference = { ref: `refs/tags/${tag}`, object: { type: "commit", sha } };
const workflowFile = new URL("../../.github/workflows/active-classroom-linux.yml", import.meta.url);

test("404 de tag ausente no convierte JSON de error ni null en un SHA", async () => {
  for (const body of ["null", '{"message":"Not Found"}', JSON.stringify(reference), "not JSON"]) {
    assert.equal(await readReleaseTag(async () => new Response(body, { status: 404 }), tag, "test-token"), null);
  }
});
test("tag existente devuelve solo SHA y consulta el repositorio oficial", async () => {
  const result = await readReleaseTag(async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/gonhercaral-cpu/desarrollo-proyectos/git/ref/tags/${tag}`);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.method, "GET");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(reference);
  }, tag, "test-token");
  assert.equal(result, sha);
});
test("errores 401/403/429/500 no se tratan como ausencia de tag", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readReleaseTag(async () => Response.json(reference, { status }), tag, "test-token"), new RegExp(`HTTP ${status}`));
  }
});
test("rechaza referencia distinta, tag anotado y SHA malformado sin modificar nada", async () => {
  for (const value of [null, { ...reference, ref: "refs/heads/main" }, { ...reference, object: { type: "tag", sha } }, { ...reference, object: { type: "commit", sha: null } }, {}]) {
    await assert.rejects(readReleaseTag(async () => Response.json(value), tag, "test-token"), /Referencia de tag inesperada/);
  }
  await assert.rejects(readReleaseTag(async () => new Response("not JSON"), tag, "test-token"), /Respuesta de tag no válida/);
  await assert.rejects(readReleaseTag(async () => { throw new Error("network failure"); }, tag, "test-token"), /network failure/);
  await assert.rejects(readReleaseTag(async () => { throw new Error("must not request"); }, "../main", "test-token"), /Tag de release inválido/);
});
test("workflow no oculta errores de consulta mediante sustitución de shell", async () => {
  const workflow = await readFile(workflowFile, "utf8");
  assert.ok(workflow.includes('existing_tag="$(node active-classroom-desktop/scripts/release-tag.mjs "$GITHUB_REF_NAME")"'));
  assert.ok(!workflow.includes('existing_tag="$(gh api'));
  assert.ok(workflow.includes('test "$existing_tag" = "$RELEASE_COMMIT"'));
  assert.ok(workflow.includes("node scripts/release-tag.mjs --preflight"));
  assert.ok(workflow.includes('latest_tag="$(node active-classroom-desktop/scripts/release-tag.mjs --latest)"'));
  assert.ok(!workflow.includes('latest_tag="$(gh release view'));
});

test("latest distingue primera release de errores sin permitir downgrade por fallo de red", async () => {
  const latest = { tag_name: "active-classroom-v1.0.15", draft: false, prerelease: false };
  assert.equal(await readLatestRelease(async () => Response.json(latest), "test-token"), latest.tag_name);
  assert.equal(await readLatestRelease(async () => Response.json({ message: "Not Found" }, { status: 404 }), "test-token"), null);
  for (const status of [401, 403, 429, 500]) await assert.rejects(readLatestRelease(async () => Response.json(latest, { status }), "test-token"), new RegExp(`HTTP ${status}`));
  for (const value of [null, { ...latest, draft: true }, { ...latest, prerelease: true }, { ...latest, tag_name: "other-product" }, {}]) await assert.rejects(readLatestRelease(async () => Response.json(value), "test-token"), /Última release estable inesperada/);
});

test("bash real crea solo tag ausente y aborta antes de mutar ante error o SHA distinto", async () => {
  const workflow = (await readFile(workflowFile, "utf8")).replace(/\r\n/g, "\n");
  const block = workflow.match(/^\s*existing_tag="\$\(node[^\n]+\)"\n\s*if \[\[ -n[^]*?^\s*fi$/m)?.[0];
  assert.ok(block);
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  for (const [output, exit, created] of [["", 0, "yes"], [sha, 0, "no"], ["b".repeat(40), 0, null], ['{"message":"forbidden"}', 1, null]]) {
    const result = spawnSync(shell, ["-e", "-o", "pipefail", "-c", 'node() { printf "%s" "$LOOKUP_OUTPUT"; return "$LOOKUP_EXIT"; }; gh() { created=yes; }; created=no;\n' + block + '\nprintf "created=%s" "$created"'], { encoding: "utf8", env: { ...process.env, LOOKUP_OUTPUT: output, LOOKUP_EXIT: String(exit), RELEASE_COMMIT: sha, GITHUB_REF_NAME: tag, GH_REPO: "gonhercaral-cpu/desarrollo-proyectos" } });
    if (created === null) { assert.notEqual(result.status, 0); assert.ok(!result.stdout.includes("created=yes")); }
    else { assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, `created=${created}`); }
  }
});
