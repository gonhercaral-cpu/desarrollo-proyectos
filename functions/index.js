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

function normalizeCertificatePersonText(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeCertificateSignerType(data) {
  const candidates = [
    data?.type,
    data?.signerType,
    data?.category,
    data?.categoria,
    data?.role,
    data?.rol,
    data?.cargo,
  ].map(normalizeCertificatePersonText).filter(Boolean);

  if (candidates.some((value) => /(^|\s)(principal|director|directora)(\s|$)/.test(value))) {
    return "Principal";
  }
  if (candidates.some((value) => /(^|\s)(teacher|maestr[oa]|docente|profesor[ae]?|instructor[ae]?)(\s|$)/.test(value))) {
    return "Teacher";
  }
  return "";
}

async function syncPublicCertificatePerson(projectionId, sourceId, data, type) {
  const projectionRef = db.collection(PUBLIC_CERTIFICATE_PEOPLE_COLLECTION).doc(projectionId);
  const name = cleanString(data?.name || data?.displayName || data?.fullName || data?.nombre);
  const activeValue = data?.active ?? data?.isActive ?? data?.activo;
  const active = (activeValue === true || cleanString(activeValue).toLowerCase() === "activo") &&
    data?.deleted !== true && data?.isDeleted !== true && data?.archived !== true;

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

const PUBLIC_PRINT_REQUEST_FIELDS = [
  "folio", "productId", "productName", "requestType", "requesterName", "requesterId",
  "requesterArea", "campus", "priority", "requestedQuantity", "deliveredQuantity",
  "deliveryType", "status", "statusLabel", "requestDate", "dueDate", "requestedDeliveryDate",
  "certificateIssueDate", "certificateTemplateId", "certificateTemplateName",
  "certificateTemplateLevel", "certificateTemplateProgramName", "certificateTemplateAudience",
  "certificateTemplateBodyText", "certificateTemplateBodySegments", "certificateTemplateCustomTexts",
  "certificateTemplateCustomImages", "certificateTemplateImageUrl", "certificateTemplateImageDataUrl",
  "certificateTemplateStoragePath", "certificateTemplatePositions", "notes", "level", "group",
  "courseProgramName", "courseAudience", "teacherName", "schedule", "printedQuantity",
  "digitalQuantity", "principalSignerId", "principalSignerName", "principalSignerRole",
  "principalSignatureUrl", "principalSignatureDataUrl", "teacherSignerId", "teacherSignerName",
  "teacherSignerRole", "teacherSignatureUrl", "teacherSignatureDataUrl", "students",
  "publicTrackingEnabled", "publicRequestSource", "academicDirector", "certificateDirectorName",
  "courseLevel",
];

function sanitizePublicPrintRequest(payload) {
  const requestedQuantity = payload.requestedQuantity;
  const printedQuantity = payload.printedQuantity;
  const digitalQuantity = payload.digitalQuantity;
  const students = Array.isArray(payload.students) ? payload.students : [];
  const valid =
    cleanString(payload.folio).length > 0 &&
    cleanString(payload.folio).length <= 80 &&
    payload.publicTrackingEnabled === true &&
    payload.publicRequestSource === "certificate-public-form" &&
    payload.requestType === "Certificado" &&
    payload.status === "Solicitud recibida" &&
    payload.statusLabel === "Solicitud recibida" &&
    payload.deliveredQuantity === 0 &&
    ["Baja", "Normal", "Alta", "Urgente"].includes(payload.priority) &&
    cleanString(payload.requesterName).length > 0 &&
    payload.requesterArea === "Dirección Académica" &&
    ["Plaza Estrella", "Plaza Bugambilias", "Plaza Aranjuez", "Online"].includes(payload.campus) &&
    Number.isInteger(requestedQuantity) && requestedQuantity > 0 && requestedQuantity <= 150 &&
    Number.isInteger(printedQuantity) && printedQuantity >= 0 &&
    Number.isInteger(digitalQuantity) && digitalQuantity >= 0 &&
    printedQuantity + digitalQuantity === requestedQuantity &&
    ["Impresa", "Digital", "Ambas"].includes(payload.deliveryType) &&
    students.length === requestedQuantity &&
    students.every((student) =>
      cleanString(student?.id).length > 0 &&
      cleanString(student?.name).length > 0 &&
      ["Impreso", "Digital"].includes(student?.deliveryType)
    );

  if (!valid) {
    throw new HttpsError("invalid-argument", "La solicitud pública contiene datos inválidos.");
  }

  return Object.fromEntries(
    PUBLIC_PRINT_REQUEST_FIELDS
      .filter((field) => payload[field] !== undefined)
      .map((field) => [field, payload[field]])
  );
}

exports.createPrintRequestWithAssignment = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 60,
  },
  async (request) => {
    const payload = request.data?.request;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new HttpsError("invalid-argument", "Faltan datos de la solicitud.");
    }

    const isPublicRequest = payload.publicRequestSource === "certificate-public-form";
    let creationPayload;
    if (isPublicRequest) {
      creationPayload = {
        ...sanitizePublicPrintRequest(payload),
        createdBy: "public-certificate-form",
        createdByUid: "public-form",
        createdByName: cleanString(payload.requesterName),
        createdByEmail: "",
        updatedByUid: "public-form",
        updatedByName: cleanString(payload.requesterName),
        updatedByEmail: "",
      };
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

    try {
      const result = await createAssignedPrintRequest(db, creationPayload, {
        createdAt: new Date(),
        configuredIds: getPrintshopAssignmentIds(),
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
        message: error?.message || String(error),
        publicRequest: isPublicRequest,
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        "failed-precondition",
        "No fue posible resolver responsable y apoyo. La solicitud no fue creada."
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
