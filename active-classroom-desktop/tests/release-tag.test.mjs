import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readReleaseTag } from "../scripts/release-tag.mjs";

const tag = "active-classroom-v1.0.17";
const sha = "a".repeat(40);
const reference = { ref: `refs/tags/${tag}`, object: { type: "commit", sha } };

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
  const workflow = await readFile("../.github/workflows/active-classroom-linux.yml", "utf8");
  assert.ok(workflow.includes('existing_tag="$(node active-classroom-desktop/scripts/release-tag.mjs "$GITHUB_REF_NAME")"'));
  assert.ok(!workflow.includes('existing_tag="$(gh api'));
  assert.ok(workflow.includes('test "$existing_tag" = "$RELEASE_COMMIT"'));
});
