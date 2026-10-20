import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("src-tauri/packaging/system-media.sh").replaceAll("\\", "/");
const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const required = ["libgstlibav.so", "libgstvideoparsersbad.so", "libgstplayback.so", "libgstisomp4.so", "libgstopengl.so", "libgstapp.so"];
async function fixture(t, native = false, version = "1.24.2") {
  const root = (await mkdtemp(join(resolve("."), ".system-media-test-"))).replaceAll("\\", "/");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["native", "codecs/24.04/lib", "codecs/24.04/plugins", "bin", "cache"]) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, "os-release"), "ID=zorin\nVERSION_ID=18.1\nUBUNTU_CODENAME=noble\n");
  await writeFile(join(root, "codecs/24.04/gstreamer-version"), "1.24.2\n");
  await mkdir(join(root, "codecs/24.04/plugins/libav"));
  await writeFile(join(root, "codecs/24.04/plugins/libav/libgstlibav.so"), "fallback plugin");
  await writeFile(join(root, "bin/dpkg-query"), `#!/bin/sh\nprintf '%s' '${version}'\n`, { mode: 0o755 });
  if (native) for (const name of required) await writeFile(join(root, "native", name), "native plugin");
  return root;
}
function run(root) {
  return spawnSync(shell, ["-c", `
    export LD_LIBRARY_PATH=/obsolete/bundle LD_PRELOAD=/obsolete/bundle.so GST_PLUGIN_SYSTEM_PATH_1_0=/obsolete/plugins
    export GST_PLUGIN_SCANNER=/obsolete/scanner WEBKIT_EXEC_PATH=/obsolete/webkit
    . "$1"
    classroom_system_media "$2/codecs" "$2/native" "$2/os-release" || exit "$?"
    printf '%s\\n' "ld=$LD_LIBRARY_PATH" "preload=$LD_PRELOAD" "plugins=$GST_PLUGIN_PATH_1_0" "scanner=$GST_PLUGIN_SCANNER" "webkit=$WEBKIT_EXEC_PATH" "backend=$GDK_BACKEND"
  `, "probe", script, root], { encoding: "utf8", env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, XDG_CACHE_HOME: `${root}/cache`, WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" } });
}
test("runtime nativo completo conserva bibliotecas y plugins del sistema sin overrides antiguos", async t => {
  const result = run(await fixture(t, true));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ld=\npreload=\nplugins=\nscanner=\nwebkit=\nbackend=wayland\n");
});
test("codecs ausentes usan únicamente fallback de la misma versión de distribución", async t => {
  const root = await fixture(t); const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`ld=/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:${root}/codecs/24.04/lib`));
  assert.ok(result.stdout.includes(`plugins=${root}/codecs/24.04/plugins/libav`));
  assert.ok(result.stdout.includes("preload=\n"));
  assert.ok(!result.stdout.includes("obsolete"));
});
test("rechaza mezclar plugins y core de diferentes versiones GStreamer", async t => {
  const result = run(await fixture(t, false, "1.20.3"));
  assert.equal(result.status, 78);
  assert.match(result.stderr, /codecs incompatibles/);
});
test("fallback no sustituye un plugin nativo que ya está instalado", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "native/libgstlibav.so"), "installed native plugin");
  await mkdir(join(root, "codecs/24.04/plugins/videoparsersbad"));
  await writeFile(join(root, "codecs/24.04/plugins/videoparsersbad/libgstvideoparsersbad.so"), "missing parser");
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const plugins = result.stdout.split("\n").find(line => line.startsWith("plugins="));
  assert.equal(plugins, `plugins=${root}/codecs/24.04/plugins/videoparsersbad`);
});
test("no exige codecs adicionales al updater dpkg ni vuelve a distribuir el framework", async () => {
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  assert.ok(!config.bundle.linux.deb.depends.some(name => name.startsWith("gstreamer1.0-")));
  assert.equal(config.bundle.linux.appimage.bundleMediaFramework, false);
  const packaging = await readFile("tests/prepare-appimage-runtime.sh", "utf8");
  assert.ok(!packaging.includes("patch-apprun"));
  assert.ok(!packaging.includes("system-glib"));
  assert.ok(packaging.includes("libgstreamer-1.0.so"));
});
