const assert = require("node:assert/strict");
const test = require("node:test");
const { Firestore, FieldValue, Timestamp } = require("../functions/node_modules/@google-cloud/firestore");
const {
  normalizeName,
  buildFolio,
  removeUndefinedValues,
  serializeCallableResult,
} = require("../functions/certificatePersonOperations");

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

test("usa Timestamp real dentro del arreglo students y rechaza transforms anidados", () => {
  const firestore = new Firestore({ projectId: "certificate-person-tests" });
  const requestRef = firestore.doc("printRequests/request-1");

  assert.doesNotThrow(() => {
    firestore.batch().update(requestRef, {
      students: [{ nameUpdatedAt: Timestamp.now() }],
    });
  });
  assert.throws(() => {
    firestore.batch().update(requestRef, {
      students: [{ nameUpdatedAt: FieldValue.serverTimestamp() }],
    });
  }, /cannot be used inside of an array/);
});

test("elimina undefined recursivo sin convertir campos opcionales a texto vacio", () => {
  const cleaned = removeUndefinedValues({
    studentId: "student-1",
    optional: undefined,
    nested: { pdfUrl: undefined, status: "pending" },
    values: ["folio", undefined, null],
  });

  assert.deepEqual(cleaned, {
    studentId: "student-1",
    nested: { status: "pending" },
    values: ["folio", null],
  });
});

test("serializa respuestas callable sin Timestamp, Date, Buffer ni undefined", () => {
  const timestamp = Timestamp.fromDate(new Date("2026-07-31T12:00:00.000Z"));
  const result = serializeCallableResult({
    success: true,
    generatedAt: timestamp,
    updatedAt: new Date("2026-07-31T13:00:00.000Z"),
    ignored: undefined,
    binary: Buffer.from("pdf"),
  });

  assert.deepEqual(result, {
    success: true,
    generatedAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T13:00:00.000Z",
  });
});
