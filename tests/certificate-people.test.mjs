import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActiveCertificatePeople,
  dedupeCertificatePeople,
  isActiveCertificatePerson,
  normalizeCertificatePersonText,
  normalizeCertificateSignerType,
} from "../src/utils/certificatePeople.js";
import { readFileSync } from "node:fs";

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

test("construye maestros activos desde firmas nuevas e historicas sin duplicarlos", () => {
  const people = buildActiveCertificatePeople([
    { id: "teacher-new", name: "María Ruiz", type: "Teacher", active: true },
    { id: "teacher-old", nombre: "José López", categoria: "Maestro", activo: "Activo" },
    { id: "teacher-duplicate", name: " maria ruiz ", role: "Docente", active: true },
    { id: "teacher-inactive", name: "Inactivo", type: "Teacher", active: false },
    { id: "principal-one", name: "Directora", role: "Directora académica", active: true },
  ]);

  assert.deepEqual(
    people.map((person) => ({ id: person.id, name: person.name, type: person.type })),
    [
      { id: "principal-one", name: "Directora", type: "Principal" },
      { id: "teacher-old", name: "José López", type: "Teacher" },
      { id: "teacher-new", name: "María Ruiz", type: "Teacher" },
    ]
  );
});

test("formulario publico consulta directamente firmas activas vigentes", () => {
  const clientSource = readFileSync("src/services/publicCertificatePeopleService.js", "utf8");
  const backendSource = readFileSync("functions/index.js", "utf8");

  assert.match(clientSource, /httpsCallable\(functions, "listPublicCertificatePeople"\)/);
  assert.match(backendSource, /db\.collection\("certificateSigners"\)\.get\(\)/);
  assert.doesNotMatch(clientSource, /PUBLIC_CERTIFICATE_PEOPLE_COLLECTION = "publicCertificatePeople"/);
});
