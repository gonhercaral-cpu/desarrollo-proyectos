const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const source = path.resolve(__dirname, "../scripts/con-entorno-macos.sh");
const inspect = "process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),path:process.env.PATH,java:process.env.JAVA_HOME??null,xdg:process.env.XDG_CONFIG_HOME??null}))";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "macos-env-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "checkout with spaces");
  const main = path.join(root, "main checkout");
  const caller = path.join(root, "caller directory");
  const bin = path.join(root, "mock bin");
  const home = path.join(root, "home");
  for (const dir of [repo, main, caller, bin, home, path.join(repo, "scripts"), path.join(repo, ".git"), path.join(main, ".git")]) fs.mkdirSync(dir, { recursive: true });
  const script = path.join(repo, "scripts/con-entorno-macos.sh");
  fs.copyFileSync(source, script);
  const executable = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o755 });
  };
  executable(path.join(bin, "uname"), "#!/bin/sh\nif [ \"$1\" = -s ]; then printf '%s\\n' \"$MACOS_ENV_TEST_PLATFORM\"; else printf '%s\\n' arm64; fi\n");
  executable(path.join(bin, "git"), "#!/bin/sh\nprintf '%s\\n' \"$MACOS_ENV_TEST_COMMON\"\nexit \"${MACOS_ENV_TEST_GIT_STATUS:-0}\"\n");
  const env = {
    HOME: home, PATH: `${bin}:/usr/bin:/bin`,
    MACOS_ENV_TEST_PLATFORM: "Linux", MACOS_ENV_TEST_COMMON: ".git",
    MACOS_ENV_TEST_NODE: process.execPath,
  };
  const firebase = (toolsRoot) => {
    const cli = path.join(toolsRoot, ".orquestacion/tools/firebase/node_modules/.bin/firebase");
    executable(cli, `#!/bin/sh\nexec "$MACOS_ENV_TEST_NODE" -e '${inspect}' -- "$@"\n`);
    return path.dirname(cli);
  };
  const profile = (toolsRoot) => {
    const dir = path.join(toolsRoot, ".firebase/cli-config");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const run = (args, overrides = {}) => spawnSync("/bin/bash", [script, ...args], { cwd: caller, env: { ...env, ...overrides }, encoding: "utf8" });
  const info = (overrides = {}) => {
    const result = run([process.execPath, "-e", inspect, "--"], overrides);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { root, repo, main, caller, bin, home, env, run, info, firebase, profile };
}

test("conserva argumentos literales, cwd y códigos de salida sin evaluar shell", (t) => {
  const f = fixture(t);
  const args = ["con espacios", "$(no-ejecutar)", "*", ""];
  const result = f.run([process.execPath, "-e", inspect, "--", ...args]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, args);
  assert.equal(JSON.parse(result.stdout).cwd, f.caller);
  assert.equal(f.run([process.execPath, "-e", "process.exit(37)"]).status, 37);
  assert.equal(f.run(["comando-inexistente-fixture"]).status, 127);
  const usage = f.run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Uso:/);
});

test("Darwin usa el prefijo elegido y prioriza versiones aun presentes al final del PATH", (t) => {
  const f = fixture(t);
  const brew = path.join(f.root, "brew with spaces");
  const node = path.join(brew, "opt/node@24/bin");
  const python = path.join(brew, "opt/python@3.12/libexec/bin");
  const java = path.join(brew, "opt/openjdk@21/libexec/openjdk.jdk/Contents/Home");
  for (const dir of [node, python, path.join(java, "bin"), path.join(brew, "bin")]) fs.mkdirSync(dir, { recursive: true });
  const result = f.info({ MACOS_ENV_TEST_PLATFORM: "Darwin", HOMEBREW_PREFIX: brew, PATH: `${f.env.PATH}:${node}` });
  const dirs = result.path.split(":");
  assert.equal(result.java, java);
  assert.ok(dirs.indexOf(node) < dirs.indexOf(path.join(brew, "bin")));
  assert.ok(dirs.includes(python));
  assert.ok(dirs.includes(path.join(java, "bin")));
  assert.ok(result.path.endsWith(`${f.env.PATH}:${node}`));
  assert.equal(result.xdg, null);
});

test("respeta JAVA_HOME del usuario y no cambia XDG para otros comandos", (t) => {
  const f = fixture(t);
  const java = path.join(f.root, "user java");
  fs.mkdirSync(path.join(java, "bin"), { recursive: true });
  const brew = path.join(f.root, "brew");
  fs.mkdirSync(brew);
  f.firebase(f.repo); f.profile(f.repo);
  const result = f.info({ MACOS_ENV_TEST_PLATFORM: "Darwin", HOMEBREW_PREFIX: brew, JAVA_HOME: java, XDG_CONFIG_HOME: "user profile" });
  assert.equal(result.java, java);
  assert.ok(result.path.split(":").includes(path.join(java, "bin")));
  assert.equal(result.xdg, "user profile");
  assert.equal(f.info().xdg, null);
});

test("worktree comparte CLI y perfil asociados al checkout principal con espacios", (t) => {
  const f = fixture(t);
  const bin = f.firebase(f.main);
  const profile = f.profile(f.main);
  f.profile(f.repo); // Un perfil vacío de emuladores no cambia la instalación elegida.
  for (const common of [path.join(f.main, ".git"), path.relative(f.repo, path.join(f.main, ".git"))]) {
    const result = f.run(["firebase", "--version"], { MACOS_ENV_TEST_COMMON: common });
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.equal(info.xdg, profile);
    assert.equal(info.path.split(":")[0], bin);
    assert.equal(info.cwd, f.caller);
    assert.deepEqual(info.args, ["--version"]);
  }
});

test("CLI del checkout actual tiene prioridad y XDG explícito incluso vacío se conserva", (t) => {
  const f = fixture(t);
  const bin = f.firebase(f.repo);
  f.firebase(f.main); f.profile(f.main);
  const profile = f.profile(f.repo);
  for (const xdg of [undefined, "", "perfil explícito"]) {
    const overrides = { MACOS_ENV_TEST_COMMON: path.join(f.main, ".git") };
    if (xdg !== undefined) overrides.XDG_CONFIG_HOME = xdg;
    const result = f.run(["firebase"], overrides);
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.equal(info.xdg, xdg === undefined ? profile : xdg);
    assert.equal(info.path.split(":")[0], bin);
  }
});

test("sin perfil existente usa el default del CLI; un Firebase explícito conserva su selección", (t) => {
  const f = fixture(t);
  f.firebase(f.repo);
  let result = f.run(["firebase"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).xdg, null);
  assert.equal(fs.existsSync(path.join(f.repo, ".firebase")), false);
  f.profile(f.repo);
  result = f.run([path.join(f.repo, ".orquestacion/tools/firebase/node_modules/.bin/firebase")]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).xdg, null);
});

test("sin instalación local conserva Firebase de PATH y en Linux no añade Homebrew", (t) => {
  const f = fixture(t);
  const local = f.firebase(f.repo);
  fs.copyFileSync(path.join(local, "firebase"), path.join(f.bin, "firebase"));
  fs.rmSync(path.join(f.repo, ".orquestacion"), { recursive: true });
  f.profile(f.repo);
  const brew = path.join(f.root, "brew");
  fs.mkdirSync(path.join(brew, "bin"), { recursive: true });
  const result = f.run(["firebase"], { HOMEBREW_PREFIX: brew, JAVA_HOME: "user java" });
  assert.equal(result.status, 0, result.stderr);
  const info = JSON.parse(result.stdout);
  assert.equal(info.xdg, null);
  assert.equal(info.java, "user java");
  assert.equal(info.path, f.env.PATH);
});

test("sin HOME ni metadatos Git aún puede reenviar un comando explícito", (t) => {
  const f = fixture(t);
  const info = f.info({ HOME: undefined, MACOS_ENV_TEST_GIT_STATUS: "128" });
  assert.equal(info.cwd, f.caller);
  assert.equal(info.path, f.env.PATH);
  assert.equal(info.xdg, null);
});
