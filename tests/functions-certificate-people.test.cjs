const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildPublicCertificatePeople,
  isActiveCertificateSigner,
} = require("../functions/certificatePeople");

describe("fuente publica vigente de firmas", () => {
  it("considera activas firmas historicas sin bandera y excluye bajas explicitas", () => {
    assert.equal(isActiveCertificateSigner({ name: "Histórica" }), true);
    assert.equal(isActiveCertificateSigner({ active: true }), true);
    assert.equal(isActiveCertificateSigner({ activo: "Activo" }), true);
    assert.equal(isActiveCertificateSigner({ active: false }), false);
    assert.equal(isActiveCertificateSigner({ archived: true }), false);
  });

  it("expone solo id, nombre, tipo y estado sin duplicar maestros", () => {
    const people = buildPublicCertificatePeople([
      { id: "teacher-old", nombre: "Ana López", categoria: "Maestra" },
      { id: "teacher-new", name: " ana lopez ", type: "Teacher", active: true },
      { id: "teacher-two", displayName: "Bruno", role: "Docente", active: true, signatureUrl: "privada" },
      { id: "inactive", name: "Fuera", type: "Teacher", active: false },
    ]);

    assert.deepEqual(people, [
      { id: "teacher-old", name: "Ana López", type: "Teacher", active: true },
      { id: "teacher-two", name: "Bruno", type: "Teacher", active: true },
    ]);
    assert.equal("signatureUrl" in people[1], false);
  });
});
