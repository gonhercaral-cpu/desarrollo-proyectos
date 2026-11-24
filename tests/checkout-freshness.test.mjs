import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../scripts/actualizar-checkout.sh", import.meta.url));

test("La sincronización usa Git real y conserva el trabajo local", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "checkout-freshness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd, ...args) => {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const remote = join(root, "origin.git");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  const seed = join(root, "seed");
  git(root, "clone", remote, seed);
  writeFileSync(join(seed, "contenido.txt"), "base antigua\n");
  git(seed, "add", "."); git(seed, "commit", "-m", "base"); git(seed, "push", "origin", "main");
  const old = git(seed, "rev-parse", "HEAD");
  writeFileSync(join(seed, "contenido.txt"), "base vigente\n");
  git(seed, "commit", "-am", "actualización");
  git(seed, "tag", "active-classroom-v1.0.25");
  git(seed, "push", "origin", "main", "--tags");
  const current = git(seed, "rev-parse", "HEAD");
  const bin = join(root, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "gh"), '#!/bin/sh\n[ "${CHECKOUT_TEST_GH_FAIL:-0}" = 0 ] || exit 1\nprintf "%s\\n" "${CHECKOUT_TEST_TAG:-active-classroom-v1.0.25}"\n', { mode: 0o755 });
  const checkout = (name, stale = true) => {
    const dir = join(root, name); git(root, "clone", remote, dir);
    if (stale) git(dir, "checkout", "--detach", old);
    return dir;
  };
  const run = (cwd, extra = {}) => spawnSync("bash", [script], { cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra } });

  await t.test("Adelanta una base antigua y conserva archivos sin seguimiento", () => {
    const dir = checkout("limpio"); writeFileSync(join(dir, "local.txt"), "conservar");
    const result = run(dir); assert.equal(result.status, 0, result.stderr);
    assert.equal(git(dir, "rev-parse", "HEAD"), current);
    assert.equal(readFileSync(join(dir, "local.txt"), "utf8"), "conservar");
  });
  await t.test("No sobrescribe modificaciones locales", () => {
    const dir = checkout("modificado"); writeFileSync(join(dir, "contenido.txt"), "trabajo local");
    assert.notEqual(run(dir).status, 0);
    assert.equal(git(dir, "rev-parse", "HEAD"), old);
    assert.equal(readFileSync(join(dir, "contenido.txt"), "utf8"), "trabajo local");
  });
  await t.test("No reescribe una rama divergente", () => {
    const dir = checkout("divergente"); writeFileSync(join(dir, "tarea.txt"), "propio");
    git(dir, "add", "."); git(dir, "commit", "-m", "tarea");
    const head = git(dir, "rev-parse", "HEAD");
    assert.notEqual(run(dir).status, 0); assert.equal(git(dir, "rev-parse", "HEAD"), head);
  });
  await t.test("Conserva commits nuevos basados en main vigente", () => {
    const dir = checkout("vigente", false); writeFileSync(join(dir, "tarea.txt"), "propio");
    git(dir, "add", "."); git(dir, "commit", "-m", "tarea");
    const head = git(dir, "rev-parse", "HEAD");
    assert.equal(run(dir).status, 0); assert.equal(git(dir, "rev-parse", "HEAD"), head);
  });
  await t.test("No certifica actualización si GitHub no responde", () => {
    const result = run(checkout("sin-github", false), { CHECKOUT_TEST_GH_FAIL: "1" });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /Base verificada/);
  });
  await t.test("Detecta una release publicada que main todavía no contiene", () => {
    writeFileSync(join(seed, "futuro.txt"), "fuera de main");
    git(seed, "add", "."); git(seed, "commit", "-m", "otra release");
    git(seed, "tag", "active-classroom-v1.0.26"); git(seed, "push", "origin", "refs/tags/active-classroom-v1.0.26");
    const result = run(checkout("release-no-integrada", false), { CHECKOUT_TEST_TAG: "active-classroom-v1.0.26" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /no contiene active-classroom-v1.0.26/);
  });
});
