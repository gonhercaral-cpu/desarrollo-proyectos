const test = require("node:test");
const assert = require("node:assert/strict");

const { canManageCertificateStudents } = require("../functions/certificatePersonOperations");

const deliveredRequest = {
  status: "Entregada",
  responsibleUid: "production-user",
  responsibleEmail: "responsable@example.com",
};

test("administrador administra alumnos aunque la solicitud esté entregada", () => {
  assert.equal(canManageCertificateStudents(
    deliveredRequest,
    { active: true, role: "admin", email: "admin@example.com" },
    { uid: "admin-user" }
  ), true);
});

test("responsable de producción administra únicamente su solicitud entregada", () => {
  const profile = { active: true, role: "collaborator", department: "Imprenta", email: "responsable@example.com" };
  assert.equal(canManageCertificateStudents(deliveredRequest, profile, { uid: "production-user" }), true);
  assert.equal(canManageCertificateStudents(deliveredRequest, profile, { uid: "another-user" }), false);
});

test("colaborador de imprenta no asignado no administra alumnos", () => {
  const profile = { active: true, role: "collaborator", department: "Imprenta", email: "other@example.com" };
  assert.equal(canManageCertificateStudents(deliveredRequest, profile, { uid: "other-user" }), false);
});

test("fallback histórico por correo solo aplica cuando no existe responsable estable", () => {
  const historicalRequest = { status: "Entregada", responsibleEmail: "legacy@example.com" };
  const profile = { active: true, role: "collaborator", department: "Imprenta", email: "legacy@example.com" };
  assert.equal(canManageCertificateStudents(historicalRequest, profile, { uid: "legacy-user" }), true);
  assert.equal(canManageCertificateStudents(deliveredRequest, profile, { uid: "legacy-user" }), false);
});

test("usuario fuera de Imprenta no recibe permiso por coincidencia de UID", () => {
  const profile = { active: true, role: "collaborator", department: "Editorial", email: "responsable@example.com" };
  assert.equal(canManageCertificateStudents(deliveredRequest, profile, { uid: "production-user" }), false);
});
