import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("Active Classroom y Digital Signage reutilizan mismo header y tokens del sistema", async () => {
  const classroom = await readFile(new URL("../src/active-classroom/components/ConsoleLayout.jsx", import.meta.url), "utf8");
  const signage = await readFile(new URL("../src/components/DigitalSignageAdmin.jsx", import.meta.url), "utf8");
  assert.match(classroom, /import ModuleHeader/); assert.match(signage, /import ModuleHeader/);
  assert.match(classroom, /<ModuleHeader/); assert.match(signage, /<ModuleHeader/);
  assert.doesNotMatch(classroom, /ac-console-mark|>ac</);
  const styles = await readFile(new URL("../src/active-classroom/styles/console.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /\.ac-console-header\s*\{/);
});
test("icono Web son mismos bytes del icono institucional Desktop, sin recrearlo", async () => {
  const [web, desktop] = await Promise.all([readFile(new URL("../public/active-classroom-icon.png", import.meta.url)), readFile(new URL("../active-classroom-desktop/public/active-classroom-icon.png", import.meta.url))]);
  assert.deepEqual(web, desktop);
});
