import assert from "node:assert/strict";
import { test } from "node:test";
import { unitCatalog, catalogMetrics, filterCatalog } from "../src/active-classroom/utils/catalog.js";
import { canClassroom } from "../src/active-classroom/utils/permissions.js";
const folders = [{ id: "kids", name: "KIDS", kind: "level", active: true }, { id: "new", name: "Avanzado", kind: "level", active: true }, { id: "u", name: "Unit", kind: "unit", parentId: "kids" }, { id: "v", name: "Otra", kind: "unit", parentId: "new" }];
test("cards, estados e inspectores se derivan de catálogo dinámico y drafts activos", () => {
  const documents = [{ id: "u", publishedVersion: 3, publishedDraftRevision: 2, draftRevision: 4, draft: { mainPresentationId: "main", generalResourceIds: ["audio"], slides: [] } }];
  const files = [{ id: "main", folderId: "u", kind: "presentation", name: "Presentación" }, { id: "audio", folderId: "u", kind: "audio", name: "Escuchar" }, { id: "historical", folderId: "u", kind: "image", name: "Historia" }];
  const units = unitCatalog(folders, documents, files); assert.equal(units[0].level.name, "KIDS"); assert.equal(units[0].files.length, 2); assert.equal(units[0].version, 3); assert.equal(units[0].state, "Actualización disponible"); assert.equal(units[0].responsible, "");
  assert.deepEqual(catalogMetrics(folders, units), { levels: 2, published: 1, pending: 1, drafts: 2 });
  assert.equal(filterCatalog(units, { search: "escuchar" }).length, 1); assert.equal(filterCatalog(units, { level: "new" })[0].level.name, "Avanzado"); assert.equal(filterCatalog(units, { type: "audio" }).length, 1);
});
test("organizador accede/importa/ordena/procesa sin publicar, equipos ni permisos globales", () => {
  const user = { active: true, role: "collaborator", activeClassroomPermissions: { access: true, editUnits: true, uploadMaterial: true, importDrive: true, orderMaterial: true, processMaterial: true } };
  for (const action of ["access", "editUnits", "uploadMaterial", "importDrive", "orderMaterial", "processMaterial"]) assert.equal(canClassroom(user, action), true);
  for (const action of ["publishVersions", "manageDevices", "manageLevels", "managePermissions"]) assert.equal(canClassroom(user, action), false);
});
