import assert from "node:assert/strict";
import test from "node:test";
import { hasImageSource, resolveImageUrl } from "../src/editorial/utils/editorialImageSource.js";
import {
  buildDownloadName,
  downloadableExports,
  hasDownloadableExports,
  isDownloadable,
  resolveDownloadTarget,
  variantLabel,
} from "../src/editorial/utils/editorialDownloads.js";
import {
  filterLinkableProjects,
  projectDisplayLabel,
  projectSubLabel,
} from "../src/editorial/utils/editorialProjectPicker.js";
import { levelCan } from "../src/editorial/models/editorialPermissions.js";

test("resolución de imagen usa assetUrl y respaldos", () => {
  assert.equal(resolveImageUrl({ assetUrl: "https://x/a.png" }), "https://x/a.png");
  assert.equal(resolveImageUrl({ src: "https://x/b.png" }), "https://x/b.png");
  assert.equal(resolveImageUrl({ url: "https://x/c.png" }), "https://x/c.png");
  assert.equal(resolveImageUrl({}), "");
  assert.equal(resolveImageUrl(null), "");
  assert.equal(hasImageSource({ assetUrl: "https://x/a.png" }), true);
  assert.equal(hasImageSource({}), false);
});

test("selección de descarga: downloadUrl o fallback storagePath", () => {
  assert.equal(isDownloadable({ downloadUrl: "https://x/e.pdf" }), true);
  assert.equal(isDownloadable({ storagePath: "editorial/x/e.pdf" }), true);
  assert.equal(isDownloadable({}), false);

  const direct = resolveDownloadTarget({ exportId: "e1", downloadUrl: "https://x/e.pdf", variant: "student" }, { projectName: "Libro 3" });
  assert.equal(direct.url, "https://x/e.pdf");
  assert.equal(direct.needsResolve, false);
  assert.equal(direct.name, "Libro-3-alumno.pdf");

  const fallback = resolveDownloadTarget({ exportId: "e2", storagePath: "editorial/x/e2.pdf", variant: "print" });
  assert.equal(fallback.needsResolve, true);
  assert.equal(fallback.storagePath, "editorial/x/e2.pdf");

  assert.equal(resolveDownloadTarget({}), null);
  assert.equal(variantLabel("teacher"), "Maestro");
  assert.equal(buildDownloadName({ variant: "review" }, "Guía Ñandú"), "Guia-Nandu-revision.pdf");
});

test("publicación filtra sólo exportaciones descargables", () => {
  const pub = {
    exports: [
      { exportId: "e1", variant: "student", downloadUrl: "https://x/1.pdf" },
      { exportId: "e2", variant: "teacher", storagePath: "editorial/x/2.pdf" },
      { exportId: "e3", variant: "print" }, // sin archivo
    ],
  };
  assert.equal(hasDownloadableExports(pub), true);
  assert.equal(downloadableExports(pub).length, 2);
  assert.equal(hasDownloadableExports({ exports: [{ exportId: "z" }] }), false);
});

test("selector de proyectos: label legible, subetiqueta y filtrado", () => {
  assert.equal(projectDisplayLabel({ id: "p1", name: "Campaña Otoño" }), "Campaña Otoño");
  assert.equal(projectDisplayLabel({ id: "p1", title: "Con title" }), "Con title");
  assert.equal(projectDisplayLabel({ id: "p1" }), "Proyecto sin nombre");
  assert.equal(projectDisplayLabel({ id: "p1", name: { bad: 1 } }), "Proyecto sin nombre"); // nunca [object Object]
  assert.equal(projectSubLabel({ status: "En proceso", assignedToName: "Ana" }), "En proceso · Ana");
  assert.equal(projectSubLabel({}), "Sin estado · Sin responsable");

  const projects = [
    { id: "a", name: "Beta" },
    { id: "b", name: "Álfa" },
    { id: "c", name: "Gamma" },
  ];
  const linked = new Set(["c"]);
  const filtered = filterLinkableProjects(projects, linked, "alf");
  assert.deepEqual(filtered.map((project) => project.id), ["b"]); // acento-insensible
  const all = filterLinkableProjects(projects, linked, "");
  assert.deepEqual(all.map((project) => project.name), ["Álfa", "Beta"]); // ordenado, sin vinculados
});

test("permisos de acciones: viewer bloqueado, designer edita, publisher publica", () => {
  // Toolbar/menú deshabilitado según capacidad.
  assert.equal(levelCan("viewer", "edit_content"), false); // Insertar/Duplicar/Eliminar off
  assert.equal(levelCan("viewer", "download"), true); // descarga sí
  assert.equal(levelCan("commenter", "edit_content"), false);
  assert.equal(levelCan("designer", "edit_content"), true); // Insertar on
  assert.equal(levelCan("reviewer", "publish"), false);
  assert.equal(levelCan("publisher", "publish"), true);
});
