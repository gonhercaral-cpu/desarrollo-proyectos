const assert = require("node:assert/strict");
const test = require("node:test");
const { Firestore, FieldValue, Timestamp } = require("../functions/node_modules/@google-cloud/firestore");
const { createCertificatePersonHandlers } = require("../functions/certificatePersonOperations");

const integrationTest = process.env.FIRESTORE_EMULATOR_HOST ? test : test.skip;

integrationTest("alta, QR, edición y eliminación persisten para admin, responsable y apoyo", async () => {
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
  await db.collection("users").doc("production-user").set({
    active: true,
    role: "collaborator",
    department: "Imprenta",
    email: "responsable@example.com",
    name: "Responsable",
  });
  await db.collection("users").doc("support-user").set({
    active: true,
    role: "collaborator",
    department: "Imprenta",
    email: "apoyo@example.com",
    name: "Apoyo",
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
    supportUserId: "support-user",
    collaboratorUid: "support-user",
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
  assert.equal(
    publicValidation.data().validationUrl,
    `https://sistema-desarrollo-proyectos.web.app/validar-certificado/${first.validationCode}`
  );

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

  const productionUpdated = await handlers.updateCertificatePersonName({
    auth: { uid: "production-user" },
    data: {
      requestId,
      studentId: concurrent[0].student.studentId,
      certificateId: concurrent[0].certificateId,
      folio: concurrent[0].folio,
      validationCode: concurrent[0].validationCode,
      newName: "Ana Responsable",
    },
  });
  assert.equal(productionUpdated.success, true);

  const supportUpdated = await handlers.updateCertificatePersonName({
    auth: { uid: "support-user" },
    data: {
      requestId,
      studentId: concurrent[1].student.studentId,
      certificateId: concurrent[1].certificateId,
      folio: concurrent[1].folio,
      validationCode: concurrent[1].validationCode,
      newName: "Luis Apoyo",
    },
  });
  assert.equal(supportUpdated.success, true);

  requestSnapshot = await db.collection("printRequests").doc(requestId).get();
  assert.deepEqual(
    requestSnapshot.data().students.map((student) => student.name).sort(),
    ["Ana Responsable", "Luis Apoyo", "María González Pérez"].sort()
  );

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

  for (const [deleteAuth, person] of [
    [auth, first],
    [{ uid: "production-user" }, concurrent[0]],
    [{ uid: "support-user" }, concurrent[1]],
  ]) {
    const deleted = await handlers.deleteCertificatePerson({
      auth: deleteAuth,
      data: {
        requestId,
        studentId: person.student.studentId,
        certificateId: person.certificateId,
        folio: person.folio,
        validationCode: person.validationCode,
      },
    });
    assert.equal(deleted.certificateId, person.certificateId);
    assert.equal((await db.collection("generatedCertificates").doc(person.certificateId).get()).data().deleted, true);
    assert.equal((await db.collection("publicCertificateValidations").doc(person.validationCode).get()).data().active, false);
  }

  requestSnapshot = await db.collection("printRequests").doc(requestId).get();
  assert.equal(requestSnapshot.data().students.length, 0);

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
