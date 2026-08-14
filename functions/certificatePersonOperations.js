const { HttpsError } = require("firebase-functions/v2/https");
const certificateValidationConfig = require("./certificateValidation.json");
const { canManagePrintRequest, normalizePrintRequestAssignments } = require("./printRequestAssignments");

const PRINTSHOP_DEPARTMENTS = ["imprenta", "impresion", "soporte tecnico"];

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function removeUndefinedValues(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date || typeof value.toDate === "function") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedValues(item))
      .filter((item) => item !== undefined);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, removeUndefinedValues(item)])
      .filter(([, item]) => item !== undefined)
  );
}

function serializeCallableResult(value) {
  if (value === undefined) return undefined;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => serializeCallableResult(item))
      .filter((item) => item !== undefined);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, serializeCallableResult(item)])
      .filter(([, item]) => item !== undefined)
  );
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

function canManageCertificateStudents(requestData = {}, profile = {}, auth = {}) {
  if (!auth?.uid || !isPrintshopProfile(profile)) return false;
  if (canManagePrintRequest(auth.uid, requestData, isAdmin(profile))) return true;
  const assignments = normalizePrintRequestAssignments(requestData);
  const actorEmail = cleanText(profile.email).toLowerCase();
  const responsibleEmail = cleanText(requestData.responsibleEmail || requestData.assignedUserEmail).toLowerCase();
  return !assignments.assignedUserId
    && assignments.supportUserIds.length === 0
    && Boolean(responsibleEmail)
    && actorEmail === responsibleEmail;
}

async function assertActor(db, requestId, requestData, auth) {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión para administrar certificados.");
  const profileSnapshot = await db.collection("users").doc(auth.uid).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const admin = isAdmin(profile || {});

  if (!profile || !canManageCertificateStudents(requestData, profile, auth)) {
    throw new HttpsError("permission-denied", "No tienes permiso para administrar esta solicitud.");
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
  return `${certificateValidationConfig.baseUrl}/validar-certificado/${encodeURIComponent(validationCode)}`;
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
    status: pending ? "Pendiente" : "Generado",
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

async function findCertificateRecord(transaction, db, requestId, student, payload = {}) {
  const requestedCertificateId = cleanText(
    payload.certificateId || payload.certificateRecordId || student.certificateId || student.certificateRecordId
  );
  const studentFolio = cleanText(student.certificateFolio || student.folio);
  const requestedFolio = cleanText(payload.folio || payload.certificateFolio);
  const studentValidationCode = cleanText(student.validationCode);
  const requestedValidationCode = cleanText(payload.validationCode);
  if (studentFolio && requestedFolio && studentFolio !== requestedFolio) {
    throw new HttpsError("failed-precondition", "El folio no corresponde a la persona seleccionada.");
  }
  if (studentValidationCode && requestedValidationCode && studentValidationCode !== requestedValidationCode) {
    throw new HttpsError("failed-precondition", "El codigo de validacion no corresponde a la persona seleccionada.");
  }
  const folio = studentFolio || requestedFolio;
  const validationCode = studentValidationCode || requestedValidationCode;
  const stableStudentId = normalizeId(student.studentId || student.id || payload.studentId);

  if (requestedCertificateId) {
    const directRef = db.collection("generatedCertificates").doc(requestedCertificateId);
    const directSnapshot = await transaction.get(directRef);
    if (directSnapshot.exists) {
      const data = directSnapshot.data();
      if (data.requestId !== requestId) {
        throw new HttpsError("failed-precondition", "El certificado no pertenece a esta solicitud.");
      }
      if (folio && cleanText(data.folio) && cleanText(data.folio) !== folio) {
        throw new HttpsError("failed-precondition", "El folio no corresponde al certificado seleccionado.");
      }
      if (stableStudentId && cleanText(data.studentId) && cleanText(data.studentId) !== stableStudentId) {
        throw new HttpsError("failed-precondition", "El certificado no corresponde a la persona seleccionada.");
      }
      const identityMatches = folio && cleanText(data.folio) === folio
        || validationCode && cleanText(data.validationCode) === validationCode
        || stableStudentId && cleanText(data.studentId) === stableStudentId;
      if (!identityMatches) {
        throw new HttpsError("failed-precondition", "No fue posible comprobar la relacion entre la persona y el certificado.");
      }
      return { ref: directRef, snapshot: directSnapshot };
    }
  }

  if (!folio && !validationCode) return null;
  const requestCertificates = await transaction.get(
    db.collection("generatedCertificates").where("requestId", "==", requestId)
  );
  const matches = requestCertificates.docs.filter((snapshot) => {
    const data = snapshot.data();
    return folio && cleanText(data.folio) === folio
      || validationCode && cleanText(data.validationCode) === validationCode;
  });
  if (matches.length > 1) {
    throw new HttpsError("failed-precondition", "Existe mas de un certificado para la identidad indicada.");
  }
  return matches.length === 1 ? { ref: matches[0].ref, snapshot: matches[0] } : null;
}

function createCertificatePersonHandlers({ db, FieldValue, Timestamp, bucket, logger = console }) {
  const serverTimestamp = () => FieldValue.serverTimestamp();
  const embeddedTimestamp = () => Timestamp?.now ? Timestamp.now() : new Date();
  const firestoreData = (value) => removeUndefinedValues(value);
  const assertAuthenticated = (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion para administrar certificados.");
    }
  };
  const logStage = (operation, step, requestId, request, payload = {}, extra = {}) => {
    logger.info("certificate-person-operation", {
      operation,
      step,
      requestId,
      uid: request.auth?.uid || "",
      studentId: cleanText(payload.studentId || payload.id),
      certificateId: cleanText(payload.certificateId || payload.certificateRecordId),
      folio: cleanText(payload.folio || payload.certificateFolio),
      ...extra,
    });
  };

  async function addCertificatePerson(request) {
    assertAuthenticated(request);
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const name = cleanText(payload.name).replace(/\s+/g, " ");
    if (!requestId || !name) throw new HttpsError("invalid-argument", "El nombre y la solicitud son obligatorios.");
    if (name.length > 160) throw new HttpsError("invalid-argument", "El nombre es demasiado largo.");

    const requestRef = db.collection("printRequests").doc(requestId);
    const operationId = cleanText(payload.operationId);
    const operationRef = operationId ? db.collection("certificatePersonOperations").doc(operationId) : null;
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      logStage("addCertificatePerson", "authorized", requestId, request, payload);
      if (operationRef) {
        const operationSnapshot = await transaction.get(operationRef);
        if (operationSnapshot.exists) {
          const operationData = operationSnapshot.data();
          if (operationData.requestId !== requestId || operationData.type !== "add") {
            throw new HttpsError("failed-precondition", "El identificador de operacion pertenece a otra alta.");
          }
          return operationData.result;
        }
      }
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
        qrGenerated: false,
        generationStatus: "pending",
        addedAfterCreation: true,
        addedAfterCreationAt: embeddedTimestamp(),
        addedAfterCreationByUid: actor.uid,
        addedAfterCreationByName: actor.name,
        addedAfterCreationByEmail: actor.email,
      };
      const nextStudents = [...students, student];
      const certificateRef = db.collection("generatedCertificates").doc(certificateId);
      const publicValidationRef = db.collection("publicCertificateValidations").doc(validationCode);
      const batchRef = db.collection("certificateHistoryBatches").doc(requestId);
      const batchSnapshot = await transaction.get(batchRef);
      const previousBatch = batchSnapshot.exists ? batchSnapshot.data() : {};
      const certificateIds = [...new Set([...(Array.isArray(previousBatch.certificateIds) ? previousBatch.certificateIds : []), certificateId])];
      const printedQuantity = nextStudents.filter((item) => ["Impreso", "Ambos"].includes(item.deliveryType)).length;
      const digitalQuantity = nextStudents.filter((item) => ["Digital", "Ambos"].includes(item.deliveryType)).length;
      transaction.update(requestRef, firestoreData({
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
      }));
      const generatedCertificate = buildGeneratedCertificate(requestId, requestData, student, actor);
      transaction.set(certificateRef, firestoreData(generatedCertificate), { merge: true });
      transaction.set(publicValidationRef, firestoreData({
        validationCode,
        folio,
        validationUrl: student.validationUrl,
        studentName: name,
        level: generatedCertificate.level,
        programName: generatedCertificate.programName,
        requestType: generatedCertificate.requestType,
        productName: generatedCertificate.productName,
        templateName: generatedCertificate.templateName,
        issueDate: generatedCertificate.issueDate,
        issueYear: generatedCertificate.issueYear,
        campus: generatedCertificate.campus,
        teacherName: generatedCertificate.teacherName,
        status: "Pendiente",
        generationStatus: "pending",
        active: true,
        deleted: false,
        institution: "Active English School",
        requestId,
        generationMode: "request",
        updatedAt: serverTimestamp(),
      }), { merge: true });
      transaction.set(reservationRef, firestoreData({
        folio,
        requestId,
        studentId,
        certificateId,
        createdAt: serverTimestamp(),
      }), { merge: false });
      transaction.set(batchRef, firestoreData({
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
      }), { merge: true });
      const response = { requestId, student, certificateId, folio, validationCode };
      if (operationRef) transaction.set(operationRef, firestoreData({ type: "add", requestId, result: response, createdAt: serverTimestamp() }));
      return response;
    });
    logStage("addCertificatePerson", "committed", requestId, request, result.student || payload, {
      certificateId: result.certificateId,
      folio: result.folio,
    });
    return result;
  }

  async function updateCertificatePersonName(request) {
    assertAuthenticated(request);
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
      const stableStudentId = current.studentId || current.id || normalizeId(payload.studentId);
      const certificateRecord = await findCertificateRecord(transaction, db, requestId, current, payload);
      if (!certificateRecord) {
        throw new HttpsError("not-found", "No se encontro el certificado asociado a esta persona.");
      }
      const certificateId = certificateRecord.ref.id;
      const nextStudent = {
        ...current,
        id: stableStudentId,
        studentId: stableStudentId,
        certificateId,
        certificateRecordId: certificateId,
        name: newName,
        generationStatus: "generating",
        generationError: "",
        generationFailedAt: null,
        nameUpdatedAt: embeddedTimestamp(),
        nameUpdatedByUid: actor.uid,
        nameUpdatedByName: actor.name,
      };
      const nextStudents = students.map((student, index) => index === match.index ? nextStudent : student);
      const validationIds = [...new Set([cleanText(current.validationCode), cleanText(current.certificateFolio), cleanText(payload.validationCode)].filter(Boolean))];
      const validationSnapshots = [];
      for (const validationId of validationIds) {
        const validationRef = db.collection("publicCertificateValidations").doc(validationId);
        const validationSnapshot = await transaction.get(validationRef);
        validationSnapshots.push({ ref: validationRef, snapshot: validationSnapshot });
      }
      transaction.update(requestRef, firestoreData({ students: nextStudents, updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email }));
      transaction.update(certificateRecord.ref, firestoreData({ studentId: stableStudentId, studentName: newName, previousStudentName: current.name, generationStatus: "generating", generationError: "", generationFailedAt: null, lastNameCorrectionAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email }));
      validationSnapshots.forEach(({ ref, snapshot }) => {
        if (snapshot.exists && snapshot.data().requestId === requestId) transaction.update(ref, firestoreData({ studentName: newName, updatedAt: serverTimestamp() }));
      });
      const response = { success: true, requestId, studentId: stableStudentId, certificateId, folio: current.certificateFolio, validationCode: current.validationCode, previousName: current.name, newName, normalizedName: newName };
      return { response, audit: { actor, requestData, certificateId, studentId: response.studentId, folio: response.folio, studentName: newName, previousStudentName: current.name } };
    });
    await buildAudit(db, requestId, result.audit.requestData, result.audit.actor, "CERTIFICATE_NAME_CORRECTED", { ...result.audit, title: "Nombre de certificado corregido", description: `Se corrigió nombre de ${result.audit.previousStudentName} a ${result.audit.studentName}.` });
    await updatePublicDocumentsByIdentity(
      db,
      requestId,
      [result.response.folio, result.response.validationCode],
      firestoreData({ studentName: result.response.newName, generationStatus: "generating", updatedAt: serverTimestamp() })
    );
    logStage("updateCertificatePersonName", "committed", requestId, request, payload, {
      certificateId: result.response.certificateId,
      folio: result.response.folio,
    });
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
      const actor = await assertActor(db, requestId, requestData, request.auth);
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
    assertAuthenticated(request);
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const qrDataUrl = cleanText(payload.qrDataUrl);
    if (!requestId || !qrDataUrl) throw new HttpsError("invalid-argument", "Faltan datos del QR.");
    const requestRef = db.collection("printRequests").doc(requestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      logStage("updateCertificatePersonQr", "authorized", requestId, request, payload);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const certificateRecord = await findCertificateRecord(transaction, db, requestId, match.student, payload);
      if (!certificateRecord) {
        throw new HttpsError("not-found", "No se encontro el certificado asociado a esta persona.");
      }
      const nextStudents = students.map((student, index) => index === match.index
        ? { ...student, certificateId: certificateRecord.ref.id, certificateRecordId: certificateRecord.ref.id, validationUrl: cleanText(payload.validationUrl || student.validationUrl), qrDataUrl, qrGenerated: true, updatedAt: embeddedTimestamp() }
        : student);
      transaction.update(requestRef, firestoreData({ students: nextStudents, updatedAt: serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name, updatedByEmail: actor.email }));
      transaction.update(certificateRecord.ref, firestoreData({
        validationUrl: cleanText(payload.validationUrl || match.student.validationUrl),
        qrGenerated: true,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedByEmail: actor.email,
      }));
      return { success: true, requestId, studentId: match.student.studentId || match.student.id, certificateId: certificateRecord.ref.id, qrGenerated: true };
    });
    logStage("updateCertificatePersonQr", "committed", requestId, request, payload, {
      certificateId: result.certificateId,
    });
    return result;
  }

  async function markCertificatePersonGenerationFailed(request) {
    assertAuthenticated(request);
    const payload = request.data || {};
    const requestId = cleanText(payload.requestId);
    const errorMessage = cleanText(payload.failureMessage || payload.errorMessage).slice(0, 500) || "Falló la generación del PDF.";
    const errorCode = cleanText(payload.failureCode || payload.errorCode).slice(0, 80) || "generation-failed";
    if (!requestId) throw new HttpsError("invalid-argument", "Falta la solicitud.");
    const requestRef = db.collection("printRequests").doc(requestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "No se encontró la solicitud.");
      const requestData = requestSnapshot.data();
      assertCertificateRequest(requestId, requestData);
      const actor = await assertActor(db, requestId, requestData, request.auth);
      logStage("markCertificatePersonGenerationFailed", "authorized", requestId, request, payload);
      const students = Array.isArray(requestData.students) ? requestData.students : [];
      const match = findStudent(students, payload);
      const current = match.student;
      const stableStudentId = current.studentId || current.id || normalizeId(payload.studentId);
      const certificateRecord = await findCertificateRecord(transaction, db, requestId, current, payload);
      const certificateId = certificateRecord?.ref.id || cleanText(payload.certificateId || current.certificateId || current.certificateRecordId);
      if (certificateRecord) {
        transaction.update(certificateRecord.ref, firestoreData({
          studentId: stableStudentId,
          generationStatus: "generationFailed",
          generationError: errorMessage,
          generationErrorCode: errorCode,
          generationFailedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedByUid: actor.uid,
          updatedByName: actor.name,
        }));
      }
      const nextStudents = students.map((student, index) => index === match.index
        ? { ...student, id: stableStudentId, studentId: stableStudentId, ...(certificateId ? { certificateId, certificateRecordId: certificateId } : {}), generationStatus: "generationFailed", generationError: errorMessage, generationErrorCode: errorCode, generationFailedAt: embeddedTimestamp() }
        : student);
      transaction.update(requestRef, firestoreData({
        students: nextStudents,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedByEmail: actor.email,
      }));
      return {
        response: { success: true, requestId, studentId: stableStudentId, certificateId, generationStatus: "generationFailed", certificateFound: Boolean(certificateRecord) },
        folio: cleanText(current.certificateFolio || payload.folio),
        validationCode: cleanText(current.validationCode || payload.validationCode),
      };
    });
    await updatePublicDocumentsByIdentity(
      db,
      requestId,
      [result.folio, result.validationCode],
      firestoreData({ generationStatus: "generationFailed", generationErrorCode: errorCode, updatedAt: serverTimestamp() })
    );
    logStage("markCertificatePersonGenerationFailed", "committed", requestId, request, payload, {
      certificateId: result.response.certificateId,
      folio: result.folio,
    });
    return result.response;
  }

  return { addCertificatePerson, updateCertificatePersonName, deleteCertificatePerson, updateCertificatePersonQr, markCertificatePersonGenerationFailed };
}

module.exports = {
  createCertificatePersonHandlers,
  normalizeName,
  buildFolio,
  buildValidationUrl,
  canManageCertificateStudents,
  removeUndefinedValues,
  serializeCallableResult,
};
