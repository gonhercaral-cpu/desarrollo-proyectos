const { HttpsError } = require("firebase-functions/v2/https");

const PRINTSHOP_DEPARTMENTS = ["imprenta", "impresion", "soporte tecnico"];
const DESTRUCTIVE_STATUSES = ["Impreso", "Entregado", "Publicado", "Distribuido", "Cancelado"];

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeId(value) {
  return cleanText(value);
}

function normalizeStudent(student = {}) {
  const studentId = normalizeId(student.studentId || student.id || student.alumnoId);
  const certificateId = normalizeId(
    student.certificateId || student.certificateRecordId || student.certificateDocumentId
  );
  return {
    ...student,
    id: studentId,
    studentId,
    certificateId,
    certificateRecordId: certificateId,
    name: cleanText(student.name || student.fullName || student.nombre),
    certificateFolio: cleanText(student.certificateFolio || student.folio),
    validationCode: cleanText(student.validationCode || student.codigoValidacion),
    status: cleanText(student.status) || "Pendiente",
  };
}

function getDepartmentNames(profile = {}) {
  return [
    profile.area,
    profile.department,
    profile.departmentName,
    profile.team,
    ...(Array.isArray(profile.departments) ? profile.departments : []),
    ...(Array.isArray(profile.departmentNames) ? profile.departmentNames : []),
  ]
    .map((value) => normalizeName(value))
    .filter(Boolean);
}

function isPrintshopProfile(profile = {}) {
  if (profile.active !== true || profile.deleted === true || profile.archived === true) return false;
  if (normalizeName(profile.role) === "admin") return true;
  return getDepartmentNames(profile).some((department) =>
    PRINTSHOP_DEPARTMENTS.some((allowed) => department === allowed || department.includes(allowed))
  );
}

function isAdmin(profile = {}) {
  return profile.active === true && normalizeName(profile.role) === "admin";
}

function getPrimaryAssignedIds(request = {}) {
  const ids = [
    request.assignedUserId,
    request.responsibleUid,
    request.assignedToUid,
    request.productionAssigneeUid,
    request.responsibleId,
  ];
  return new Set(ids.map(normalizeId).filter(Boolean));
}

function canManageCertificateStudents(requestData = {}, profile = {}, auth = {}) {
  if (!auth?.uid || !isPrintshopProfile(profile)) return false;
  if (isAdmin(profile)) return true;
  const primaryAssignedIds = getPrimaryAssignedIds(requestData);
  if (primaryAssignedIds.has(auth.uid)) return true;
  const actorEmail = cleanText(profile.email).toLowerCase();
  const responsibleEmail = cleanText(requestData.responsibleEmail || requestData.assignedUserEmail).toLowerCase();
  return primaryAssignedIds.size === 0 && Boolean(responsibleEmail) && actorEmail === responsibleEmail;
}

async function assertActor(db, requestId, requestData, auth, { destructive = false } = {}) {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión para administrar certificados.");
  const profileSnapshot = await db.collection("users").doc(auth.uid).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const admin = isAdmin(profile || {});

  if (!profile || !canManageCertificateStudents(requestData, profile, auth)) {
    throw new HttpsError("permission-denied", "No tienes permiso para administrar esta solicitud.");
  }

  if (destructive && DESTRUCTIVE_STATUSES.includes(cleanText(requestData.status)) && !admin) {
    throw new HttpsError(
      "permission-denied",
      "Solo un administrador puede eliminar certificados impresos, entregados, publicados, distribuidos o cancelados."
    );
  }

  return {
    uid: auth.uid,
    name: cleanText(profile.name || profile.displayName || profile.email) || "Usuario",
    email: cleanText(profile.email),
    admin,
  };
}

function assertCertificateRequest(requestId, requestData) {
  if (!requestData || requestData.requestType !== "Certificado" && requestData.requestType !== "Diploma") {
    throw new HttpsError("not-found", `No se encontró una solicitud de certificado: ${requestId}.`);
  }
}

function findStudent(students, input = {}) {
  const requestedStudentId = normalizeId(input.studentId || input.id);
  const requestedCertificateId = normalizeId(input.certificateId || input.certificateRecordId);
  const requestedFolio = cleanText(input.folio || input.certificateFolio);
  const requestedName = normalizeName(input.studentName || input.name);
  const matches = students
    .map((student, index) => ({ student: normalizeStudent(student), index }))
    .filter(({ student }) => {
      if (requestedStudentId && (student.studentId === requestedStudentId || student.id === requestedStudentId)) return true;
      if (requestedCertificateId && student.certificateId === requestedCertificateId) return true;
      if (requestedFolio && student.certificateFolio === requestedFolio) return true;
      return false;
    });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new HttpsError("failed-precondition", "La persona seleccionada no es única.");

  if (!requestedStudentId && !requestedCertificateId && !requestedFolio && requestedName) {
    const nameMatches = students
      .map((student, index) => ({ student: normalizeStudent(student), index }))
      .filter(({ student }) => normalizeName(student.name) === requestedName);
    if (nameMatches.length === 1) return nameMatches[0];
  }

  throw new HttpsError("not-found", "No se encontró la persona dentro de la solicitud.");
}

function sanitizeFolioSegment(value, fallback = "GEN") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 12) || fallback;
}

function certificateYear(requestData) {
  const source = cleanText(requestData.certificateIssueDate || requestData.requestDate);
  const match = source.match(/^(\d{4})/);
  return match?.[1] || String(new Date().getFullYear());
}

function nextSequence(students) {
  return students.reduce((max, rawStudent) => {
    const folio = cleanText(rawStudent?.certificateFolio || rawStudent?.folio);
    const match = folio.match(/-(\d{3,})$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0) + 1;
}

function buildFolio(requestId, requestData, sequence) {
  const prefix = requestData.requestType === "Diploma" ? "DIPL" : "CERT";
  const level = sanitizeFolioSegment(requestData.level || "NA", "NA").slice(0, 8);
  const rawRequestCode = cleanText(requestData.folio || requestId)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  const requestCode = (rawRequestCode || "REQ")
    .replace(/^IMP-?/, "")
    .slice(-10);
  return `${prefix}-${certificateYear(requestData)}-${level}-${requestCode}-${String(sequence).padStart(3, "0")}`;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function buildValidationCode(folio) {
  return `${folio}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function buildValidationUrl(validationCode) {
  return `https://active-english-school.web.app/validar-certificado/${encodeURIComponent(validationCode)}`;
}

function buildPdfPath(requestId, requestData, validationCode) {
  return `printshop/generated-certificates/${requestId}/${certificateYear(requestData)}/${validationCode}.pdf`;
}

function buildGeneratedCertificate(requestId, requestData, student, actor, { pending = true } = {}) {
  return {
    folio: student.certificateFolio,
    validationCode: student.validationCode,
    validationUrl: cleanText(student.validationUrl) || buildValidationUrl(student.validationCode),
    studentId: student.studentId,
    studentName: student.name,
    studentDeliveryType: cleanText(student.deliveryType) || "Impreso",
    campus: cleanText(requestData.campus) || "Sin plantel",
    group: cleanText(requestData.group),
    requestId,
    requestFolio: cleanText(requestData.folio),
    generationMode: "request",
    generationStatus: pending ? "pending" : "ready",
    active: true,
    deleted: false,
    requestType: cleanText(requestData.requestType) || "Certificado",
    productId: cleanText(requestData.productId),
    productName: cleanText(requestData.productName),
    responsibleUid: cleanText(requestData.responsibleUid || requestData.assignedUserId),
    responsibleName: cleanText(requestData.responsibleName || requestData.assignedUserName),
    responsibleEmail: cleanText(requestData.responsibleEmail),
    level: cleanText(requestData.level) || "No aplica",
    programName: cleanText(requestData.certificateTemplateProgramName || requestData.level),
    templateId: cleanText(requestData.certificateTemplateId),
    templateName: cleanText(requestData.certificateTemplateName),
    issueDate: cleanText(requestData.certificateIssueDate || requestData.requestDate),
    issueYear: certificateYear(requestData),
    generatedYear: certificateYear(requestData),
    principalName: cleanText(requestData.principalSignerName),
    teacherName: cleanText(requestData.teacherSignerName || requestData.teacherName),
    status: "Generado",
    pdfFileName: "",
    pdfStoragePath: buildPdfPath(requestId, requestData, student.validationCode),
    generatedAt: new Date(),
    generatedByUid: actor.uid,
    generatedByName: actor.name,
    generatedByEmail: actor.email,
    updatedAt: new Date(),
    updatedByUid: actor.uid,
    updatedByName: actor.name,
    updatedByEmail: actor.email,
  };
}

function buildAudit(db, requestId, requestData, actor, action, details) {
  return db.collection("printshopLogs").doc().set({
    type: action,
    module: "certificates",
    title: details.title,
    description: details.description,
    referenceType: "certificate",
    referenceId: details.certificateId || details.studentId || requestId,
    requestId,
    requestFolio: cleanText(requestData.folio),
    certificateId: details.certificateId || "",
    certificateFolio: details.folio || "",
    validationCode: details.validationCode || "",
    studentName: details.studentName || "",
    previousStudentName: details.previousStudentName || "",
    productId: cleanText(requestData.productId),
    productName: cleanText(requestData.productName),
    campus: cleanText(requestData.campus),
    level: cleanText(requestData.level),
    performedByUid: actor.uid,
    performedByName: actor.name,
    performedByEmail: actor.email,
    createdAt: new Date(),
  });
}

async function updatePublicDocumentsByIdentity(db, requestId, identities, patch) {
  const normalizedIdentities = new Set((identities || []).map(cleanText).filter(Boolean));
  if (!requestId || normalizedIdentities.size === 0) return;
  const snapshot = await db.collection("publicCertificateValidations").where("requestId", "==", requestId).get();
  const batch = db.batch();
  let changed = 0;
  snapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    if (!normalizedIdentities.has(cleanText(data.folio)) && !normalizedIdentities.has(cleanText(data.validationCode))) return;
    batch.set(documentSnapshot.ref, patch, { merge: true });
    changed += 1;
  });
  if (changed > 0) await batch.commit();
}

function createCertificatePersonHandlers({ db, FieldValue, bucket }) {
  const serverTimestamp = () => FieldValue.serverTimestamp();

  async function addCertificatePerson(request) {
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const name = cleanText(payload.name).replace(/\s+/g, " ");
    if (!requestId || !name) throw new HttpsError("invalid-argument", "El nombre y la solicitud son obligatorios.");
    if (name.length > 160) throw new HttpsError("invalid-argument", "El nombre es demasiado largo.");

    const requestRef = db.collection("printRequests").doc(requestId);
    const operationId = cleanText(payload.operationId);
    const operationRef = operationId ? db.collection("certificatePersonOperations").doc(operationId) : null;
    const result = await db.runTransaction(async (transaction) => {
      if (operationRef) {
        const operationSnapshot = await transaction.get(operationRef);
        if (operationSnapshot.exists) return operationSnapshot.data().result;
      }
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const duplicate = students.some((student) => normalizeName(student?.name || student?.nombre) === normalizeName(name));
      if (duplicate && payload.allowDuplicate !== true) {
        throw new HttpsError("already-exists", "Ya existe una persona con ese nombre. Confirma para agregarla de todos modos.", { duplicateName: true });
      }
      const studentId = createId("student");
      const certificateId = createId("certificate");
      let sequence = nextSequence(students);
      let folio = buildFolio(requestId, requestData, sequence);
      let reservationRef = db.collection("certificateFolioReservations").doc(folio.replace(/[^a-zA-Z0-9_-]/g, "-"));
      let reservationSnapshot = await transaction.get(reservationRef);
      while (reservationSnapshot.exists) {
        sequence += 1;
        folio = buildFolio(requestId, requestData, sequence);
        reservationRef = db.collection("certificateFolioReservations").doc(folio.replace(/[^a-zA-Z0-9_-]/g, "-"));
        // Transaction reads all candidate reservations before any write.
        reservationSnapshot = await transaction.get(reservationRef);
      }
      const validationCode = buildValidationCode(folio);
      const student = {
        id: studentId,
        studentId,
        name,
        deliveryType: cleanText(payload.deliveryType) || "Impreso",
        status: "Pendiente",
        certificateId,
        certificateRecordId: certificateId,
        certificateFolio: folio,
        folio,
        validationCode,
        validationUrl: cleanText(payload.validationUrl) || buildValidationUrl(validationCode),
        qrGenerated: true,
        generationStatus: "pending",
        addedAfterCreation: true,
        addedAfterCreationAt: new Date(),
        addedAfterCreationByUid: actor.uid,
        addedAfterCreationByName: actor.name,
        addedAfterCreationByEmail: actor.email,
      };
      const nextStudents = [...students, student];
      const certificateRef = db.collection("generatedCertificates").doc(certificateId);
      const batchRef = db.collection("certificateHistoryBatches").doc(requestId);
      const batchSnapshot = await transaction.get(batchRef);
      const previousBatch = batchSnapshot.exists ? batchSnapshot.data() : {};
      const certificateIds = [...new Set([...(Array.isArray(previousBatch.certificateIds) ? previousBatch.certificateIds : []), certificateId])];
      const printedQuantity = nextStudents.filter((item) => ["Impreso", "Ambos"].includes(item.deliveryType)).length;
      const digitalQuantity = nextStudents.filter((item) => ["Digital", "Ambos"].includes(item.deliveryType)).length;
      transaction.update(requestRef, {
        students: nextStudents,
        requestedQuantity: nextStudents.length,
        printedQuantity,
        digitalQuantity,
        deliveryType: printedQuantity > 0 && digitalQuantity > 0 ? "Ambas" : digitalQuantity > 0 ? "Digital" : "Impresa",
        certificateFolioSequence: sequence,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedByEmail: actor.email,
      });
      transaction.set(certificateRef, buildGeneratedCertificate(requestId, requestData, student, actor), { merge: true });
      transaction.set(reservationRef, {
        folio,
        requestId,
        studentId,
        certificateId,
        createdAt: serverTimestamp(),
      }, { merge: false });
      transaction.set(batchRef, {
        requestId,
        loteId: requestId,
        requestFolio: cleanText(requestData.folio),
        certificateIds,
        certificateCount: certificateIds.length,
        status: "Generado",
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedByEmail: actor.email,
      }, { merge: true });
      const response = { requestId, student, certificateId, folio, validationCode };
      if (operationRef) transaction.set(operationRef, { type: "add", requestId, result: response, createdAt: serverTimestamp() });
      return response;
    });
    return result;
  }

  async function updateCertificatePersonName(request) {
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const newName = cleanText(payload.newName).replace(/\s+/g, " ");
    if (!requestId || !newName) throw new HttpsError("invalid-argument", "El nombre es obligatorio.");
    const requestRef = db.collection("printRequests").doc(requestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const duplicate = students.some((student, index) => index !== match.index && normalizeName(student?.name) === normalizeName(newName));
      if (duplicate && payload.allowDuplicate !== true) throw new HttpsError("already-exists", "Ya existe una persona con ese nombre. Confirma para conservar el duplicado.", { duplicateName: true });
      const current = match.student;
      const nextStudent = { ...current, id: current.studentId || current.id, studentId: current.studentId || current.id, name: newName, nameUpdatedAt: serverTimestamp(), nameUpdatedByUid: actor.uid, nameUpdatedByName: actor.name };
      const nextStudents = students.map((student, index) => index === match.index ? nextStudent : student);
      const certificateId = cleanText(payload.certificateId || current.certificateId || current.certificateRecordId);
      let certificateSnapshot = null;
      if (certificateId) {
        const certificateRef = db.collection("generatedCertificates").doc(certificateId);
        certificateSnapshot = await transaction.get(certificateRef);
      }
      const validationIds = [...new Set([cleanText(current.validationCode), cleanText(current.certificateFolio), cleanText(payload.validationCode)].filter(Boolean))];
      const validationSnapshots = [];
      for (const validationId of validationIds) {
        const validationRef = db.collection("publicCertificateValidations").doc(validationId);
        const validationSnapshot = await transaction.get(validationRef);
        validationSnapshots.push({ ref: validationRef, snapshot: validationSnapshot });
      }
      transaction.update(requestRef, { students: nextStudents, updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email });
      if (certificateSnapshot?.exists && certificateSnapshot.data().requestId === requestId && certificateSnapshot.data().studentId === (current.studentId || current.id)) {
        transaction.update(db.collection("generatedCertificates").doc(certificateId), { studentName: newName, previousStudentName: current.name, lastNameCorrectionAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email });
      }
      validationSnapshots.forEach(({ ref, snapshot }) => {
        if (snapshot.exists && snapshot.data().requestId === requestId) transaction.update(ref, { studentName: newName, updatedAt: serverTimestamp() });
      });
      const response = { requestId, studentId: current.studentId || current.id, certificateId, folio: current.certificateFolio, validationCode: current.validationCode, previousName: current.name, newName };
      return { response, audit: { actor, requestData, certificateId, studentId: response.studentId, folio: response.folio, studentName: newName, previousStudentName: current.name } };
    });
    await buildAudit(db, requestId, result.audit.requestData, result.audit.actor, "CERTIFICATE_NAME_CORRECTED", { ...result.audit, title: "Nombre de certificado corregido", description: `Se corrigió nombre de ${result.audit.previousStudentName} a ${result.audit.studentName}.` });
    await updatePublicDocumentsByIdentity(
      db,
      requestId,
      [result.response.folio, result.response.validationCode],
      { studentName: result.response.newName, updatedAt: serverTimestamp() }
    );
    return result.response;
  }

  async function deleteCertificatePerson(request) {
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    if (!requestId) throw new HttpsError("invalid-argument", "Falta la solicitud.");
    const requestRef = db.collection("printRequests").doc(requestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth, { destructive: true });
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const current = match.student;
      const certificateId = cleanText(payload.certificateId || current.certificateId || current.certificateRecordId);
      const certificateRef = certificateId ? db.collection("generatedCertificates").doc(certificateId) : null;
      const certificateSnapshot = certificateRef ? await transaction.get(certificateRef) : null;
      const validationIds = [...new Set([cleanText(current.validationCode), cleanText(current.certificateFolio), cleanText(payload.validationCode)].filter(Boolean))];
      const validationSnapshots = [];
      for (const validationId of validationIds) {
        const validationRef = db.collection("publicCertificateValidations").doc(validationId);
        validationSnapshots.push({ ref: validationRef, snapshot: await transaction.get(validationRef) });
      }
      const batchRef = db.collection("certificateHistoryBatches").doc(requestId);
      const batchSnapshot = await transaction.get(batchRef);
      if (certificateSnapshot?.exists) {
        const certificateData = certificateSnapshot.data();
        if (certificateData.requestId !== requestId || certificateData.studentId !== (current.studentId || current.id)) throw new HttpsError("failed-precondition", "El certificado no corresponde a esta persona y solicitud.");
        transaction.update(certificateRef, { active: false, deleted: true, status: "Cancelado", deletedAt: serverTimestamp(), deletedByUid: actor.uid, deletedByName: actor.name, deletedByEmail: actor.email, updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email });
      }
      validationSnapshots.forEach(({ ref, snapshot }) => {
        if (snapshot.exists && snapshot.data().requestId === requestId) transaction.update(ref, { active: false, deleted: true, status: "Cancelado", updatedAt: serverTimestamp() });
      });
      const nextStudents = students.filter((_, index) => index !== match.index);
      const printedQuantity = nextStudents.filter((item) => ["Impreso", "Ambos"].includes(item.deliveryType)).length;
      const digitalQuantity = nextStudents.filter((item) => ["Digital", "Ambos"].includes(item.deliveryType)).length;
      if (batchSnapshot.exists) {
        const batchData = batchSnapshot.data();
        const certificateIds = (Array.isArray(batchData.certificateIds) ? batchData.certificateIds : []).filter((id) => id !== certificateId);
        transaction.update(batchRef, { certificateIds, certificateCount: certificateIds.length, status: certificateIds.length ? "Mixto" : "Cancelado", updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email });
      }
      transaction.update(requestRef, {
        students: nextStudents,
        requestedQuantity: nextStudents.length,
        printedQuantity,
        digitalQuantity,
        deliveryType: printedQuantity > 0 && digitalQuantity > 0 ? "Ambas" : digitalQuantity > 0 ? "Digital" : "Impresa",
        updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email,
      });
      return { requestId, certificateId, folio: current.certificateFolio, validationCode: current.validationCode, studentId: current.studentId || current.id, studentName: current.name, pdfStoragePath: cleanText(payload.pdfStoragePath || current.pdfStoragePath || certificateSnapshot?.data()?.pdfStoragePath), actor, requestData };
    });
    const paths = [result.pdfStoragePath].filter(Boolean);
    for (const path of paths) {
      try { await bucket.file(path).delete({ ignoreNotFound: true }); } catch (error) { console.error("[certificate-delete] Storage cleanup pending", { path, message: error.message }); }
    }
    await buildAudit(db, requestId, result.requestData, result.actor, "CERTIFICATE_DELETED", { ...result, title: "Persona y certificado eliminados", description: `Se eliminó ${result.studentName}; folio ${result.folio} quedó inválido.` });
    await updatePublicDocumentsByIdentity(
      db,
      requestId,
      [result.folio, result.validationCode],
      { active: false, deleted: true, status: "Cancelado", updatedAt: serverTimestamp() }
    );
    return { requestId, certificateId: result.certificateId, folio: result.folio, studentId: result.studentId };
  }

  async function updateCertificatePersonQr(request) {
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const qrDataUrl = cleanText(payload.qrDataUrl);
    if (!requestId || !qrDataUrl) throw new HttpsError("invalid-argument", "Faltan datos del QR.");
    const requestRef = db.collection("printRequests").doc(requestId);
    return db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const nextStudents = students.map((student, index) => index === match.index
        ? { ...student, validationUrl: cleanText(payload.validationUrl || student.validationUrl), qrDataUrl, qrGenerated: true, updatedAt: serverTimestamp() }
        : student);
      transaction.update(requestRef, { students: nextStudents, updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email });
      return { requestId, studentId: match.student.studentId || match.student.id, qrGenerated: true };
    });
  }

  async function markCertificatePersonGenerationFailed(request) {
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const errorMessage = cleanText(payload.errorMessage).slice(0, 500) || "Falló la generación del PDF.";
    if (!requestId) throw new HttpsError("invalid-argument", "Falta la solicitud.");
    const requestRef = db.collection("printRequests").doc(requestId);
    return db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const current = match.student;
      const certificateId = cleanText(payload.certificateId || current.certificateId || current.certificateRecordId);
      const certificateRef = certificateId ? db.collection("generatedCertificates").doc(certificateId) : null;
      const certificateSnapshot = certificateRef ? await transaction.get(certificateRef) : null;
      if (certificateSnapshot?.exists) {
        const certificateData = certificateSnapshot.data();
        if (certificateData.requestId !== requestId || certificateData.studentId !== (current.studentId || current.id)) {
          throw new HttpsError("failed-precondition", "El certificado no corresponde a esta persona y solicitud.");
        }
        transaction.update(certificateRef, {
          generationStatus: "generationFailed",
          generationError: errorMessage,
          generationFailedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedByUid: actor.uid,
          updatedByName: actor.name,
        });
      }
      const nextStudents = students.map((student, index) => index === match.index
        ? { ...student, generationStatus: "generationFailed", generationError: errorMessage, generationFailedAt: serverTimestamp() }
        : student);
      transaction.update(requestRef, {
        students: nextStudents,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedByEmail: actor.email,
      });
      return { requestId, studentId: current.studentId || current.id, certificateId, generationStatus: "generationFailed" };
    });
  }

  return { addCertificatePerson, updateCertificatePersonName, deleteCertificatePerson, updateCertificatePersonQr, markCertificatePersonGenerationFailed };
}

module.exports = {
  createCertificatePersonHandlers,
  normalizeName,
  buildFolio,
  canManageCertificateStudents,
};
