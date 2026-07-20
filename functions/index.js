const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const {
  createPrintRequestWithAssignment: createAssignedPrintRequest,
  normalizePrintRequestAssignments,
  repairAllPrintRequestAssignments,
  repairPrintRequestAssignment,
} = require("./printRequestAssignments");
const {
  PRINT_REQUEST_CALLABLE_CORS,
  createLegacyPublicRequestId,
  createPublicRequestId,
  sanitizePublicPrintRequest,
  selectPublicCertificateTemplate,
  validatePublicCertificateTemplate,
} = require("./publicPrintRequest");
const {
  buildPublicCertificatePeople,
  isActiveCertificateSigner,
  normalizeCertificateSignerType,
} = require("./certificatePeople");
const {
  enterProductionBatchInventory,
  reconcileAllProducts,
  reconcileProductReplenishment,
  reviewProductionBatchQuality,
  updateProductionBatchProgress,
} = require("./productionBatches");

initializeApp();

const db = getFirestore();

const ALLOWED_ROLES = ["admin", "collaborator", "requester"];
const PUBLIC_CERTIFICATE_PEOPLE_COLLECTION = "publicCertificatePeople";

function getPrintshopAssignmentIds() {
  return {
    tonyUserId: process.env.PRINTSHOP_TONY_UID || "",
    ernestoUserId: process.env.PRINTSHOP_ERNESTO_UID || "",
  };
}

async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para realizar esta acción."
    );
  }

  const requesterUid = request.auth.uid;
  const requesterSnapshot = await db.collection("users").doc(requesterUid).get();

  if (!requesterSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Tu usuario no tiene perfil administrativo."
    );
  }

  const requesterProfile = requesterSnapshot.data();

  if (requesterProfile.active !== true || cleanString(requesterProfile.role).toLowerCase() !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Solo un administrador puede realizar esta acción."
    );
  }

  return {
    uid: requesterUid,
    ...requesterProfile,
  };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getProfileDepartmentNames(profile = {}) {
  return [
    profile.area,
    profile.department,
    profile.departmentName,
    ...(Array.isArray(profile.departments) ? profile.departments : []),
    ...(Array.isArray(profile.departmentNames) ? profile.departmentNames : []),
  ]
    .map((value) => cleanString(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
    .filter(Boolean);
}

async function getActiveBatchActor(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión para realizar esta acción.");
  }
  const snapshot = await db.collection("users").doc(request.auth.uid).get();
  if (!snapshot.exists || snapshot.data().active !== true) {
    throw new HttpsError("permission-denied", "Tu perfil no está activo.");
  }
  const profile = snapshot.data();
  const isAdmin = cleanString(profile.role).toLowerCase() === "admin";
  const inPrintshop = getProfileDepartmentNames(profile).some((name) =>
    ["imprenta", "impresion", "soporte tecnico"].includes(name)
      || name.split(" ").includes("imprenta"));
  if (!isAdmin && !inPrintshop) {
    throw new HttpsError("permission-denied", "Tu perfil no tiene acceso a Imprenta.");
  }
  return {
    uid: request.auth.uid,
    name: cleanString(profile.name || profile.displayName || profile.email),
    email: cleanString(profile.email),
    isAdmin,
  };
}

function throwBatchHttpsError(error, fallbackMessage) {
  if (error instanceof HttpsError) throw error;
  const message = error?.message || fallbackMessage;
  const permissionError = /solo |permiso|perfil|auditor|responsable/i.test(message);
  const missingError = /no se encontr/i.test(message);
  throw new HttpsError(
    permissionError ? "permission-denied" : missingError ? "not-found" : "failed-precondition",
    message
  );
}

async function syncPublicCertificatePerson(projectionId, sourceId, data, type) {
  const projectionRef = db.collection(PUBLIC_CERTIFICATE_PEOPLE_COLLECTION).doc(projectionId);
  const name = cleanString(data?.name || data?.displayName || data?.fullName || data?.nombre);
  const active = isActiveCertificateSigner(data);

  if (!active || !name) {
    await projectionRef.delete();
    return;
  }

  await projectionRef.set({
    sourceId,
    name,
    type,
    active: true,
  });
}

exports.syncPublicCertificateRequester = onDocumentWritten(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    // Compatibilidad: elimina la proyecciÃ³n antigua de usuarios generales.
    // Solicitante y director ahora provienen exclusivamente de Firmas.
    await syncPublicCertificatePerson(
      `requester-${event.params.userId}`,
      event.params.userId,
      null,
      "Principal"
    );
  }
);

exports.syncPublicCertificateSigner = onDocumentWritten(
  {
    document: "certificateSigners/{signerId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.after.exists ? event.data.after.data() : null;
    const type = normalizeCertificateSignerType(data);

    await syncPublicCertificatePerson(
      `signer-${event.params.signerId}`,
      event.params.signerId,
      type ? data : null,
      type || "Teacher"
    );
  }
);

exports.listPublicCertificatePeople = onCall(
  {
    region: "us-central1",
    cors: PRINT_REQUEST_CALLABLE_CORS,
    timeoutSeconds: 30,
  },
  async () => {
    const snapshot = await db.collection("certificateSigners").get();
    return {
      people: buildPublicCertificatePeople(
        snapshot.docs.map((signerSnapshot) => ({
          id: signerSnapshot.id,
          ...signerSnapshot.data(),
        }))
      ),
    };
  }
);

async function getActiveCertificateSigner(signerId, expectedType, fieldName) {
  const snapshot = await db.collection("certificateSigners").doc(signerId).get();
  const data = snapshot.exists ? snapshot.data() : null;
  const active = isActiveCertificateSigner(data);
  const type = normalizeCertificateSignerType(data);
  const name = cleanString(data?.name || data?.displayName || data?.fullName || data?.nombre);
  if (!active || type !== expectedType || !name) {
    throw new HttpsError("invalid-argument", `${fieldName} no existe o no está activo.`);
  }
  return { id: signerId, name, type, data };
}

async function resolvePublicCertificateTemplate(requestData) {
  const [templatesSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("certificateTemplates").where("active", "==", true).get(),
    db.collection("systemSettings").doc("printshopCertificates").get(),
  ]);
  const templates = templatesSnapshot.docs.map((templateSnapshot) => ({
    id: templateSnapshot.id,
    ...templateSnapshot.data(),
  }));
  const selectedTemplate = selectPublicCertificateTemplate(
    templates,
    requestData,
    settingsSnapshot.exists ? settingsSnapshot.data() : {}
  );
  validatePublicCertificateTemplate(selectedTemplate, requestData);
  return { id: selectedTemplate.id, data: selectedTemplate };
}

async function buildTrustedPublicPrintRequest(payload, createdAt) {
  const sanitized = sanitizePublicPrintRequest(payload, createdAt);
  const [requester, principal, teacher, template] = await Promise.all([
    getActiveCertificateSigner(sanitized.requesterId, "Principal", "Solicitante"),
    getActiveCertificateSigner(sanitized.principalSignerId, "Principal", "Firmante principal"),
    getActiveCertificateSigner(sanitized.teacherSignerId, "Teacher", "Maestro"),
    resolvePublicCertificateTemplate(sanitized),
  ]);
  const templateData = template.data;
  const principalRole = cleanString(
    principal.data.position || principal.data.title || principal.data.cargo
  ) || "Director";
  const teacherRole = cleanString(
    teacher.data.position || teacher.data.title || teacher.data.cargo
  ) || "Teacher";

  return {
    ...sanitized,
    certificateTemplateId: template.id,
    requesterName: requester.name,
    teacherName: teacher.name,
    certificateTemplateName: cleanString(templateData.name),
    certificateTemplateLevel: cleanString(templateData.level || sanitized.level),
    certificateTemplateProgramName: cleanString(templateData.programName || sanitized.courseProgramName),
    certificateTemplateAudience: cleanString(templateData.audience || sanitized.courseAudience),
    certificateTemplateBodyText: cleanString(templateData.bodyText),
    certificateTemplateBodySegments: Array.isArray(templateData.bodySegments) ? templateData.bodySegments : [],
    certificateTemplateCustomTexts: Array.isArray(templateData.customTexts) ? templateData.customTexts : [],
    certificateTemplateCustomImages: Array.isArray(templateData.customImages) ? templateData.customImages : [],
    certificateTemplateImageUrl: cleanString(templateData.templateImageUrl),
    certificateTemplateImageDataUrl: cleanString(templateData.templateImageDataUrl),
    certificateTemplateStoragePath: cleanString(templateData.storagePath),
    certificateTemplatePositions: templateData.positions && typeof templateData.positions === "object"
      ? templateData.positions
      : {},
    principalSignerName: principal.name,
    principalSignerRole: principalRole,
    principalSignatureUrl: cleanString(principal.data.signatureUrl),
    principalSignatureDataUrl: cleanString(principal.data.signatureDataUrl),
    teacherSignerName: teacher.name,
    teacherSignerRole: teacherRole,
    teacherSignatureUrl: cleanString(teacher.data.signatureUrl),
    teacherSignatureDataUrl: cleanString(teacher.data.signatureDataUrl),
    academicDirector: principal.name,
    certificateDirectorName: principal.name,
    createdBy: "public-certificate-form",
    createdByUid: "public-form",
    createdByName: requester.name,
    createdByEmail: "",
    updatedByUid: "public-form",
    updatedByName: requester.name,
    updatedByEmail: "",
  };
}

exports.createPrintRequestWithAssignment = onCall(
  {
    region: "us-central1",
    cors: PRINT_REQUEST_CALLABLE_CORS,
    timeoutSeconds: 60,
  },
  async (request) => {
    let isPublicRequest = false;
    try {
      const payload = request.data?.request;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new HttpsError("invalid-argument", "Faltan datos de la solicitud.");
      }

      const createdAt = new Date();
      isPublicRequest = payload.publicRequestSource === "certificate-public-form";
      let creationPayload;
      let requestId;
      if (isPublicRequest) {
        creationPayload = await buildTrustedPublicPrintRequest(payload, createdAt);
        const submissionId = cleanString(request.data?.submissionId);
        const rawRequest = request.rawRequest;
        const clientKey = [
          cleanString(rawRequest?.ip || rawRequest?.socket?.remoteAddress),
          cleanString(rawRequest?.headers?.origin),
          cleanString(rawRequest?.headers?.["user-agent"]),
        ].join("|");
        requestId = submissionId
          ? createPublicRequestId(submissionId)
          : createLegacyPublicRequestId(payload, clientKey, createdAt);
      } else {
        const adminProfile = await assertAdmin(request);
        creationPayload = {
          ...payload,
          createdByUid: request.auth.uid,
          createdByName: cleanString(adminProfile.name || adminProfile.displayName || adminProfile.email),
          createdByEmail: cleanString(adminProfile.email),
          updatedByUid: request.auth.uid,
          updatedByName: cleanString(adminProfile.name || adminProfile.displayName || adminProfile.email),
          updatedByEmail: cleanString(adminProfile.email),
        };
      }

      const result = await createAssignedPrintRequest(db, creationPayload, {
        createdAt,
        configuredIds: getPrintshopAssignmentIds(),
        fieldValue: FieldValue,
        idempotent: isPublicRequest,
        requestId,
      });
      return {
        requestId: result.requestId,
        folio: cleanString(result.requestData.folio),
        assignedUserId: result.assignedUserId,
        assignedUserName: result.assignedUserName,
        supportUserId: result.supportUserId,
        supportUserName: result.supportUserName,
        assignmentSource: result.assignmentSource,
      };
    } catch (error) {
      console.error("[printshop-assignment] No se pudo crear solicitud asignada", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
        publicRequest: isPublicRequest,
        stack: error?.stack || "",
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        "internal",
        "No fue posible registrar la solicitud. Intenta nuevamente."
      );
    }
  }
);

exports.normalizePrintRequestAssignments = onDocumentWritten(
  {
    document: "printRequests/{requestId}",
    region: "us-central1",
    timeoutSeconds: 60,
  },
  async (event) => {
    if (!event.data?.after.exists) return;
    const assignments = normalizePrintRequestAssignments(event.data.after.data());
    if (
      assignments.assignedUserId &&
      assignments.assignedUserName &&
      assignments.supportUserId &&
      assignments.supportUserName
    ) return;
    await repairPrintRequestAssignment(
      db,
      event.data.after.ref,
      getPrintshopAssignmentIds(),
      FieldValue
    );
  }
);

exports.repairPrintRequestAssignments = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 540,
  },
  async (request) => {
    await assertAdmin(request);
    return repairAllPrintRequestAssignments(
      db,
      getPrintshopAssignmentIds(),
      FieldValue
    );
  }
);

exports.repairPrintRequestAssignmentsDaily = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "America/Tijuana",
    region: "us-central1",
    timeoutSeconds: 540,
  },
  async () => {
    await repairAllPrintRequestAssignments(
      db,
      getPrintshopAssignmentIds(),
      FieldValue
    );
  }
);

exports.reviewProductionBatchQuality = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      const actor = await getActiveBatchActor(request);
      const batchId = cleanString(request.data?.batchId);
      const review = request.data?.review;
      if (!batchId || !review || typeof review !== "object" || Array.isArray(review)) {
        throw new HttpsError("invalid-argument", "Faltan lote o datos de revisión.");
      }
      return await reviewProductionBatchQuality(db, batchId, review, actor, FieldValue);
    } catch (error) {
      console.error("[production-batches] No se pudo guardar calidad", error);
      throwBatchHttpsError(error, "No se pudo guardar la revisión de calidad.");
    }
  }
);

exports.updateProductionBatchProgress = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      const actor = await getActiveBatchActor(request);
      const batchId = cleanString(request.data?.batchId);
      const update = request.data?.update;
      if (!batchId || !update || typeof update !== "object" || Array.isArray(update)) {
        throw new HttpsError("invalid-argument", "Faltan lote o datos de producción.");
      }
      return await updateProductionBatchProgress(db, batchId, update, actor, FieldValue);
    } catch (error) {
      console.error("[production-batches] No se pudo actualizar producción", error);
      throwBatchHttpsError(error, "No se pudo actualizar el avance de producción.");
    }
  }
);

exports.enterProductionBatchInventory = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      const actor = await getActiveBatchActor(request);
      const batchId = cleanString(request.data?.batchId);
      if (!batchId) throw new HttpsError("invalid-argument", "Falta el lote de producción.");
      return await enterProductionBatchInventory(db, batchId, actor, FieldValue);
    } catch (error) {
      console.error("[production-batches] No se pudo ingresar inventario", error);
      throwBatchHttpsError(error, "No se pudo ingresar el lote al inventario.");
    }
  }
);

async function reconcileProductFromEvent(event, fallbackProductId = "") {
  const beforeProductId = cleanString(event.data?.before.exists ? event.data.before.data()?.productId : "");
  const afterProductId = cleanString(event.data?.after.exists ? event.data.after.data()?.productId : "");
  const productIds = [...new Set([fallbackProductId, beforeProductId, afterProductId].filter(Boolean))];
  for (const productId of productIds) {
    await reconcileProductReplenishment(db, productId, { fieldValue: FieldValue });
  }
}

exports.reconcileProductionBatchFromProduct = onDocumentWritten(
  {
    document: "printProducts/{productId}",
    region: "us-central1",
    timeoutSeconds: 120,
  },
  async (event) => reconcileProductFromEvent(event, event.params.productId)
);

exports.reconcileProductionBatchFromInventory = onDocumentWritten(
  {
    document: "printFinishedInventory/{inventoryId}",
    region: "us-central1",
    timeoutSeconds: 120,
  },
  reconcileProductFromEvent
);

exports.reconcileProductionBatchFromMovement = onDocumentWritten(
  {
    document: "printInventoryMovements/{movementId}",
    region: "us-central1",
    timeoutSeconds: 120,
  },
  reconcileProductFromEvent
);

exports.reconcileProductionBatchFromBatch = onDocumentWritten(
  {
    document: "printProductionBatches/{batchId}",
    region: "us-central1",
    timeoutSeconds: 120,
  },
  reconcileProductFromEvent
);

exports.reconcileProductionBatchesHourly = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/Tijuana",
    region: "us-central1",
    timeoutSeconds: 540,
  },
  async () => reconcileAllProducts(db, { fieldValue: FieldValue })
);

function createTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "@#$%&*";
  const all = upper + lower + numbers + symbols;

  function pick(source) {
    return source[Math.floor(Math.random() * source.length)];
  }

  let password =
    pick(upper) + pick(lower) + pick(numbers) + pick(symbols);

  for (let index = 0; index < 8; index += 1) {
    password += pick(all);
  }

  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

exports.createUserByAdmin = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const adminProfile = await assertAdmin(request);

    const data = request.data || {};

    const name = cleanString(data.name);
    const email = cleanString(data.email).toLowerCase();
    const area = cleanString(data.area);
    const role = cleanString(data.role) || "collaborator";
    const notes = cleanString(data.notes);
    const active = data.active !== false;
    const temporaryPassword =
      cleanString(data.temporaryPassword) || createTemporaryPassword();

    if (!name) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre del usuario es obligatorio."
      );
    }

    if (!email || !email.includes("@")) {
      throw new HttpsError(
        "invalid-argument",
        "El correo electrónico no es válido."
      );
    }

    if (!ALLOWED_ROLES.includes(role)) {
      throw new HttpsError(
        "invalid-argument",
        "El privilegio seleccionado no es válido."
      );
    }

    if (temporaryPassword.length < 8) {
      throw new HttpsError(
        "invalid-argument",
        "La contraseña temporal debe tener al menos 8 caracteres."
      );
    }

    let createdAuthUser = null;

    try {
      createdAuthUser = await getAuth().createUser({
        email,
        password: temporaryPassword,
        displayName: name,
        disabled: !active,
        emailVerified: false,
      });

      const userDocRef = db.collection("users").doc(createdAuthUser.uid);

      await userDocRef.set({
        name,
        email,
        area,
        role,
        privilege: role,
        active,
        deleted: false,
        notes,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: adminProfile.uid,
        createdByName: adminProfile.name || "",
        createdByEmail: adminProfile.email || "",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: adminProfile.uid,
        updatedByName: adminProfile.name || "",
        updatedByEmail: adminProfile.email || "",
      });

      return {
        ok: true,
        uid: createdAuthUser.uid,
        email,
        temporaryPassword,
        message: "Usuario creado correctamente.",
      };
    } catch (error) {
      if (createdAuthUser?.uid) {
        try {
          await getAuth().deleteUser(createdAuthUser.uid);
        } catch (rollbackError) {
          console.error("No se pudo revertir el usuario creado:", rollbackError);
        }
      }

      console.error("Error creando usuario:", error);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Ya existe un usuario con ese correo electrónico."
        );
      }

      throw new HttpsError(
        "internal",
        error.message || "No se pudo crear el usuario."
      );
    }
  }
);

exports.updateUserByAdmin = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const adminProfile = await assertAdmin(request);
    const data = request.data || {};

    const uid = cleanString(data.uid);
    const name = cleanString(data.name);
    const email = cleanString(data.email).toLowerCase();
    const area = cleanString(data.area);
    const role = cleanString(data.role) || "collaborator";
    const privilege = cleanString(data.privilege) || role;
    const notes = cleanString(data.notes);
    const active = data.active !== false;
    const department = cleanString(data.department);
    const departmentName = cleanString(data.departmentName);
    const primaryDepartmentId = cleanString(data.primaryDepartmentId);
    const departmentIds = Array.isArray(data.departmentIds)
      ? data.departmentIds.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];
    const departmentNames = Array.isArray(data.departmentNames)
      ? data.departmentNames.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];

    if (!uid) {
      throw new HttpsError(
        "invalid-argument",
        "Falta el ID del usuario."
      );
    }

    if (!name) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre del usuario es obligatorio."
      );
    }

    if (!email || !email.includes("@")) {
      throw new HttpsError(
        "invalid-argument",
        "El correo electrÃ³nico no es vÃ¡lido."
      );
    }

    if (!ALLOWED_ROLES.includes(role) || !ALLOWED_ROLES.includes(privilege)) {
      throw new HttpsError(
        "invalid-argument",
        "El privilegio seleccionado no es vÃ¡lido."
      );
    }

    try {
      await getAuth().updateUser(uid, {
        email,
        displayName: name,
        disabled: !active,
      });

      await db.collection("users").doc(uid).update({
        name,
        email,
        area,
        department,
        departmentName,
        departmentIds,
        departmentNames,
        primaryDepartmentId,
        role,
        privilege,
        active,
        notes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: adminProfile.uid,
        updatedByName: adminProfile.name || "",
        updatedByEmail: adminProfile.email || "",
      });

      return {
        ok: true,
        uid,
        email,
        message: "Usuario actualizado correctamente.",
      };
    } catch (error) {
      console.error("Error actualizando usuario:", error);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Ya existe un usuario con ese correo electrÃ³nico."
        );
      }

      if (error.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "No existe este usuario en Firebase Authentication."
        );
      }

      throw new HttpsError(
        "internal",
        error.message || "No se pudo actualizar el usuario."
      );
    }
  }
);
