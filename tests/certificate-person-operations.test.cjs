const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeName, buildFolio } = require("../functions/certificatePersonOperations");

test("normaliza nombres para detectar duplicados sin depender de acentos o mayúsculas", () => {
  assert.equal(normalizeName("  María   González "), "maria gonzalez");
  assert.equal(normalizeName("MARIA GONZALEZ"), "maria gonzalez");
});

test("conserva formato de folio actual y acepta secuencia server-side", () => {
  const folio = buildFolio("request-1", {
    requestType: "Certificado",
    level: "A1",
    folio: "IMP-CERT-2026-00123",
    requestDate: "2026-07-31",
  }, 7);

  assert.match(folio, /^CERT-2026-A1-2026-00123-007$/);
});
