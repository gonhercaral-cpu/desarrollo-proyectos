import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../local-library/catalog.json", import.meta.url), "utf8"));
const roots = catalog.folders.filter((folder) => folder.parentId === null && folder.kind === "level");
assert.deepEqual(roots.map(({ name }) => name), ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5"]);
for (const root of roots) {
  const units = catalog.folders.filter((folder) => folder.parentId === root.id && folder.kind === "unit");
  assert.equal(units.length, 16, `${root.name} debe tener 16 Units`);
}

const shared = catalog.files.find(({ id }) => id === "qa-shared-landscape");
assert.ok(shared, "Falta archivo real compartido de QA");
assert.equal(shared.folderId, "level-1-unit-01");
await access(new URL(`../local-library/files/${shared.storedName}`, import.meta.url));

const teacherCatalog = await readFile(new URL("../src/services/library-catalog.ts", import.meta.url), "utf8");
const teacherDashboard = await readFile(new URL("../src/components/teacher-dashboard.ts", import.meta.url), "utf8");
const teacherSidebar = await readFile(new URL("../src/components/teacher-sidebar.ts", import.meta.url), "utf8");
const adminCatalog = await readFile(new URL("../admin-web/src/services/local-catalog.ts", import.meta.url), "utf8");
assert.ok(teacherCatalog.includes("http://127.0.0.1:1430"));
assert.ok(teacherCatalog.includes("/__active_classroom/catalog"));
assert.ok(!teacherCatalog.includes('method: "POST"'), "Docente debe ser read-only");
assert.ok(adminCatalog.includes("mirrorFolder") && adminCatalog.includes("mirrorFile"));
assert.ok(teacherSidebar.includes("class-unit-button") && !teacherSidebar.includes("class-resource"));
assert.ok(teacherDashboard.includes("Archivos de esta unidad"));
assert.ok(!teacherDashboard.includes("resource-import") && !teacherDashboard.includes("run-presentation"));
assert.ok(teacherDashboard.includes("getAudienceStatus"));

console.log(`local integration: OK · ${roots.length} niveles · 80 Units · ${catalog.files.length} archivos`);
