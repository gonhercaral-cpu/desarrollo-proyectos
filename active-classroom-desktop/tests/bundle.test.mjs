import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result.sort();
}

test("build incluye todos los assets PDF.js en las rutas usadas por el renderer local", async () => {
  for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    const source = join(root, "node_modules/pdfjs-dist", folder);
    const bundled = join(root, "dist/pdfjs", folder);
    const expected = await files(source);
    assert.ok(expected.length > 0);
    assert.deepEqual(await files(bundled), expected, `Assets incompletos en /pdfjs/${folder}/`);
    for (const file of expected) assert.deepEqual(await readFile(join(bundled, file)), await readFile(join(source, file)), `Asset alterado: ${folder}/${file}`);
  }
});

test("worker PDF.js se incluye como archivo local y el runtime lo referencia", async () => {
  const assets = join(root, "dist/assets");
  const names = await readdir(assets);
  const workers = names.filter((name) => /^pdf\.worker\.min-.+\.mjs$/.test(name));
  assert.equal(workers.length, 1);
  assert.deepEqual(await readFile(join(assets, workers[0])), await readFile(join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")));
  const runtimes = names.filter((name) => /^pdf-runtime-.+\.js$/.test(name));
  assert.equal(runtimes.length, 1);
  assert.ok((await readFile(join(assets, runtimes[0]), "utf8")).includes(workers[0]));
});
