import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
const source = await readFile(path, "utf8");
const execute = 'exec "$this_dir"/AppRun.wrapped "$@"';
const hooks = ["system-glib", "wayland"].map(name =>
  `source "$this_dir"/apprun-hooks/"zz-active-classroom-${name}.sh"`);
assert.equal(source.split(execute).length, 2, "AppRun de Tauri cambió; revisar antes de publicar");
if (!hooks.every(hook => source.includes(hook))) {
  assert.ok(hooks.every(hook => !source.includes(hook)), "AppRun contiene hooks parciales");
  await writeFile(path, source.replace(execute, `${hooks.join("\n")}\n\n${execute}`));
}
