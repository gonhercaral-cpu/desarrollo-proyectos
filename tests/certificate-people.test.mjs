import test from "node:test";
import assert from "node:assert/strict";

import {
  dedupeCertificatePeople,
  isActiveCertificatePerson,
  normalizeCertificatePersonText,
  normalizeCertificateSignerType,
} from "../src/utils/certificatePeople.js";

test("normaliza categorias historicas de Firmas", () => {
  assert.equal(normalizeCertificateSignerType("PRINCIPAL"), "Principal");
  assert.equal(normalizeCertificateSignerType("Directora acad\u00e9mica"), "Principal");
  assert.equal(normalizeCertificateSignerType("teacher"), "Teacher");
  assert.equal(normalizeCertificateSignerType("Maestra"), "Teacher");
  assert.equal(normalizeCertificateSignerType("Colaborador"), "");
});

test("excluye inactivos, eliminados y archivados", () => {
  assert.equal(isActiveCertificatePerson({ active: true }), true);
  assert.equal(isActiveCertificatePerson({ activo: "Activo" }), true);
  assert.equal(isActiveCertificatePerson({ active: false }), false);
  assert.equal(isActiveCertificatePerson({ active: true, deleted: true }), false);
  assert.equal(isActiveCertificatePerson({ active: true, archived: true }), false);
});

test("elimina duplicados por id y por nombre normalizado dentro de la categoria", () => {
  const people = dedupeCertificatePeople([
    { id: "principal-1", name: "Ana L\u00f3pez", type: "Principal" },
    { id: "principal-1", name: "Ana L\u00f3pez duplicada", type: "Principal" },
    { id: "principal-2", name: "  ana lopez ", type: "Director" },
    { id: "teacher-1", name: "Ana L\u00f3pez", type: "Teacher" },
  ]);

  assert.deepEqual(people.map((person) => person.id), ["principal-1", "teacher-1"]);
  assert.equal(normalizeCertificatePersonText(" \u00c1NA/L\u00d3PEZ "), "ana lopez");
});
