import test from "node:test";
import assert from "node:assert/strict";
import { buildSignageTeachers } from "../src/utils/digitalSignage/teachers.js";

test("Firmas: usa los maestros activos de todas las sucursales y las convenciones heredadas de Imprenta", () => {
  const teachers = buildSignageTeachers([
    { id: "a", name: "Ana", type: "Teacher", active: true, campus: "Estrella", signatureUrl: "privada" },
    { id: "b", nombre: "Rocío", rol: "Maestra", activo: "Activo", campus: "Sur" },
    { id: "c", name: "Luis", type: "Teacher" },
    { id: "d", name: "Directora", type: "Principal", active: true },
    { id: "e", name: "Inactiva", type: "Teacher", active: false },
    { id: "f", name: "Borrada", type: "Teacher", deleted: true },
    { id: "g", name: "Archivada", role: "Teacher", archived: true },
    { id: "h", name: "Desactivado", type: "Teacher", isActive: false },
  ]);
  assert.deepEqual(teachers.map(teacher => teacher.name), ["Ana", "Luis", "Rocío"]);
  assert.ok(teachers.every(teacher => Object.keys(teacher).every(key => ["id", "name", "campuses"].includes(key))));
});

test("Firmas: deduplica maestros por nombre sin trasladar imágenes o firmas al editor", () => {
  const teachers = buildSignageTeachers([
    { id: "a", name: "  José Pérez ", type: "Teacher", campus: "Estrella", signatureDataUrl: "secreto", notes: "privado" },
    { id: "b", name: "JOSE PEREZ", type: "Teacher", campus: "Sur" },
    { id: "c", name: "", type: "Teacher" },
    { name: "Sin identificador", type: "Teacher" },
  ]);
  assert.deepEqual(teachers, [{ id: "a", name: "José Pérez", campuses: ["Estrella", "Sur"] }]);
});
