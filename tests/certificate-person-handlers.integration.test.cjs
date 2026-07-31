const assert = require("node:assert/strict");
const test = require("node:test");
const { Firestore, FieldValue, Timestamp } = require("../functions/node_modules/@google-cloud/firestore");
const { createCertificatePersonHandlers } = require("../functions/certificatePersonOperations");

const integrationTest = process.env.FIRESTORE_EMULATOR_HOST ? test : test.skip;

integrationTest("alta, QR, edición y fallo mantienen solicitud, historial y validación consistentes", async () => {
  const projectId = `certificate-person-${Date.now()}`;
  const db = new Firestore({ projectId });
  const logger = { info() {}, error() {}, warn() {} };
  const handlers = createCertificatePersonHandlers({
    db,
    FieldValue,
    Timestamp,
    logger,
    bucket: { file: () => ({ delete: async () => {} }) },
  });
  const auth = { uid: "admin-user" };
  const requestId = "delivered-request";

  await db.collection("users").doc(auth.uid).set({
    active: true,
    role: "admin",
    department: "Imprenta",
    email: "admin@example.com",
    name: "Administrador",
  });
  await db.collection("printRequests").doc(requestId).set({
    requestType: "Certificado",
    status: "Entregada",
    folio: "CERT-2026-TEST",
    level: "B1",
    campus: "Plaza Estrella",
    productName: "Certificado B1",
    certificateTemplateId: "template-1",
    certificateTemplateName: "Plantilla B1",
    principalSignerName: "Principal",
    teacherSignerName: "Teacher",
    responsibleUid: "production-user",
    requestedQuantity: 0,
    students: [],
  });

  const first = await handlers.addCertificatePerson({
    auth,
    data: {
      requestId,
      name: "  María   González  ",
      deliveryType: "Impreso",
      operationId: "add-first",
    },
  });
  const firstRetry = await handlers.addCertificatePerson({
    auth,
    data: {
      requestId,
      name: "María González",
      deliveryType: "Impreso",
      operationId: "add-first",
    },
  });
  assert.equal(firstRetry.folio, first.folio);
  assert.equal(firstRetry.certificateId, first.certificateId);

  const concurrent = await Promise.all([
    handlers.addCertificatePerson({
      auth,
      data: { requestId, name: "Ana Concurrente", deliveryType: "Digital", operationId: "add-second" },
    }),
    handlers.addCertificatePerson({
      auth,
      data: { requestId, name: "Luis Concurrente", deliveryType: "Ambos", operationId: "add-third" },
    }),
  ]);
  assert.equal(new Set([first.folio, ...concurrent.map((item) => item.folio)]).size, 3);

  let requestSnapshot = await db.collection("printRequests").doc(requestId).get();
  assert.equal(requestSnapshot.data().students.length, 3);
  assert.equal(requestSnapshot.data().status, "Entregada");
  assert.equal((await db.collection("generatedCertificates").get()).size, 3);
  assert.equal((await db.collection("certificateFolioReservations").get()).size, 3);
  const historyBatch = await db.collection("certificateHistoryBatches").doc(requestId).get();
  assert.equal(historyBatch.data().certificateCount, 3);

  const publicValidation = await db.collection("publicCertificateValidations").doc(first.validationCode).get();
  assert.equal(publicValidation.exists, true);
  assert.equal(publicValidation.data().studentName, "María González");
  assert.equal(publicValidation.data().generationStatus, "pending");

  await handlers.updateCertificatePersonQr({
    auth,
    data: {
      requestId,
      studentId: first.student.studentId,
      certificateId: first.certificateId,
      folio: first.folio,
      validationCode: first.validationCode,
      validationUrl: first.student.validationUrl,
      qrDataUrl: "data:image/png;base64,cXI=",
    },
  });

  const updated = await handlers.updateCertificatePersonName({
    auth,
    data: {
      requestId,
      studentId: first.student.studentId,
      certificateId: first.certificateId,
      folio: first.folio,
      validationCode: first.validationCode,
      newName: "María González Pérez",
    },
  });
  assert.equal(updated.success, true);
  assert.equal(updated.folio, first.folio);
  assert.equal(updated.certificateId, first.certificateId);

  requestSnapshot = await db.collection("printRequests").doc(requestId).get();
  const updatedStudent = requestSnapshot.data().students.find((student) => student.studentId === first.student.studentId);
  assert.equal(updatedStudent.name, "María González Pérez");
  assert.ok(updatedStudent.nameUpdatedAt instanceof Timestamp);
  const updatedCertificate = await db.collection("generatedCertificates").doc(first.certificateId).get();
  assert.equal(updatedCertificate.data().studentName, "María González Pérez");
  assert.equal(updatedCertificate.data().folio, first.folio);
  assert.equal((await db.collection("generatedCertificates").where("folio", "==", first.folio).get()).size, 1);
  assert.equal((await db.collection("publicCertificateValidations").doc(first.validationCode).get()).data().studentName, "María González Pérez");

  const failed = await handlers.markCertificatePersonGenerationFailed({
    auth,
    data: {
      requestId,
      studentId: first.student.studentId,
      certificateId: first.certificateId,
      folio: first.folio,
      failureCode: "pdf-render-failed",
      failureMessage: "No se pudo renderizar el PDF.",
    },
  });
  assert.equal(failed.success, true);
  assert.equal(failed.generationStatus, "generationFailed");
  const failedCertificate = await db.collection("generatedCertificates").doc(first.certificateId).get();
  assert.equal(failedCertificate.data().generationErrorCode, "pdf-render-failed");
  requestSnapshot = await db.collection("printRequests").doc(requestId).get();
  const failedStudent = requestSnapshot.data().students.find((student) => student.studentId === first.student.studentId);
  assert.ok(failedStudent.generationFailedAt instanceof Timestamp);

  await assert.rejects(
    handlers.addCertificatePerson({
      data: { requestId: "request-that-does-not-exist", name: "Sin sesion" },
    }),
    (error) => error.code === "unauthenticated"
  );

  await assert.rejects(
    handlers.updateCertificatePersonName({
      auth: { uid: "unauthorized-user" },
      data: {
        requestId,
        studentId: first.student.studentId,
        certificateId: first.certificateId,
        folio: first.folio,
        newName: "No autorizado",
      },
    }),
    (error) => error.code === "permission-denied"
  );

  await db.terminate();
});
