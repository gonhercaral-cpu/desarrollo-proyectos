import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";

const PROJECT_ID = "security-rules-audit";

let testEnv;

function auth(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function storageAuth(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

function unauth() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, "users", "admin"), {
        name: "Admin",
        email: "admin@test.local",
        role: "admin",
        active: true,
        area: "Dirección",
      }),
      setDoc(doc(db, "users", "requester"), {
        name: "Requester",
        email: "requester@test.local",
        role: "requester",
        active: true,
        area: "Académico",
      }),
      setDoc(doc(db, "users", "collab"), {
        name: "Collaborator",
        email: "collab@test.local",
        role: "collaborator",
        active: true,
        area: "Operación",
      }),
      setDoc(doc(db, "users", "tech"), {
        name: "Tech",
        email: "tech@test.local",
        role: "collaborator",
        active: true,
        area: "Soporte Técnico",
      }),
      setDoc(doc(db, "users", "printer"), {
        name: "Printer",
        email: "printer@test.local",
        role: "collaborator",
        active: true,
        area: "Imprenta",
        departments: ["Imprenta"],
      }),
      setDoc(doc(db, "users", "auditor"), {
        name: "Auditor",
        email: "auditor@test.local",
        role: "collaborator",
        active: true,
        area: "Imprenta",
        departments: ["Imprenta"],
      }),
      setDoc(doc(db, "users", "inactive"), {
        name: "Inactive",
        email: "inactive@test.local",
        role: "admin",
        active: false,
        area: "Dirección",
      }),
      setDoc(doc(db, "users", "admin2"), {
        name: "Admin Two",
        email: "admin2@test.local",
        role: "  Admin ",
        active: true,
        area: "Dirección",
      }),
      setDoc(doc(db, "users", "deptmember"), {
        name: "Dept Member",
        email: "deptmember@test.local",
        role: "collaborator",
        active: true,
        area: "Operación",
        departmentIds: ["dept-ops"],
        primaryDepartmentId: "dept-ops",
      }),
      setDoc(doc(db, "users", "outsider"), {
        name: "Outsider",
        email: "outsider@test.local",
        role: "collaborator",
        active: true,
        area: "Otra área",
        departmentIds: ["dept-other"],
        primaryDepartmentId: "dept-other",
      }),
      setDoc(doc(db, "users", "material"), {
        name: "Material",
        email: "material@test.local",
        role: "collaborator",
        active: true,
        area: "Desarrollo de Material",
        departmentIds: ["desarrollo-de-material"],
        primaryDepartmentId: "desarrollo-de-material",
      }),
      setDoc(doc(db, "departments", "dept-ops"), {
        name: "Operación",
        active: true,
      }),
      setDoc(doc(db, "projects", "owned-project"), {
        title: "Owned",
        status: "En proceso",
        assignedToUid: "collab",
        createdByUid: "admin",
        requesterArea: "Operación",
        deleted: false,
      }),
      setDoc(doc(db, "projects", "other-project"), {
        title: "Other",
        status: "En proceso",
        assignedToUid: "someone-else",
        createdByUid: "admin",
        requesterArea: "Otra área",
        deleted: false,
      }),
      setDoc(doc(db, "projects", "collab-project"), {
        title: "Collaboration",
        status: "En proceso",
        assignedToUid: "someone-else",
        collaboratorIds: ["collab"],
        collaboratorUids: ["collab"],
        createdByUid: "admin",
        requesterArea: "Operacion",
        deleted: false,
      }),
      setDoc(doc(db, "purchaseRequests", "own-purchase"), {
        itemName: "Laptop",
        requestedByUid: "requester",
        status: "pending_review",
      }),
      setDoc(doc(db, "purchaseRequests", "other-purchase"), {
        itemName: "Monitor",
        requestedByUid: "collab",
        status: "pending_review",
      }),
      setDoc(doc(db, "technicalAssets", "asset-1"), {
        name: "Router",
        status: "Activo",
      }),
      setDoc(doc(db, "supportTools", "tool-1"), {
        folio: "HER-000001",
        name: "Taladro",
        status: "Disponible",
        active: true,
        createdAt: Timestamp.now(),
      }),
      setDoc(doc(db, "supportTools", "tool-1", "history", "history-1"), {
        type: "created",
        description: "Herramienta registrada",
        actorUid: "tech",
        createdAt: Timestamp.now(),
      }),
      setDoc(doc(db, "notifications", "notification-tech"), {
        recipientId: "tech",
        type: "production_batch_assigned",
        module: "printing",
        title: "Lote asignado",
        message: "Revisar lote IMP-001",
        entityType: "productionBatch",
        entityId: "batch-1",
        read: false,
        acknowledged: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "printRequests", "cert-request-1"), {
        folio: "IMP-2026-0001",
        requestType: "Certificado",
        assignedUserId: "printer",
        assignedUserName: "Printer",
        supportUserId: "collab",
        supportUserName: "Collaborator",
        responsibleUid: "printer",
        responsibleName: "Printer",
        responsibleEmail: "printer@test.local",
        collaboratorUid: "collab",
        collaboratorName: "Collaborator",
        collaboratorEmail: "collab@test.local",
        status: "En producción",
        statusLabel: "En producción",
        requestedQuantity: 1,
        deliveredQuantity: 0,
        deliveryType: "Impresa",
        printedQuantity: 1,
        digitalQuantity: 0,
        students: [],
        deleted: false,
      }),
      setDoc(doc(db, "printProducts", "book-1"), {
        name: "Journey A1",
        category: "Libro",
        productionType: "Producto terminado",
        level: "A1",
        unit: "Libro",
        minStock: 10,
        idealStock: 30,
        requiresPrinting: true,
        requiresBinding: true,
        requiresCutting: true,
        requiresQualityCheck: true,
        requiresSignature: false,
        requiresValidationQr: false,
        active: true,
        notes: "",
      }),
      setDoc(doc(db, "printFinishedInventory", "inventory-book-1"), {
        productId: "book-1",
        productName: "Journey A1",
        category: "Libro",
        level: "A1",
        unit: "Libro",
        currentStock: 10,
        minStock: 10,
        idealStock: 30,
        active: true,
        notes: "",
      }),
      setDoc(doc(db, "printProductionBatches", "batch-1"), validProductionBatch()),
      setDoc(doc(db, "editorialProjects", "editorial-owned"), {
        name: "Libro del colaborador",
        type: "book",
        size: "8x10",
        orientation: "portrait",
        margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
        bleedIn: 0.125,
        ownerUid: "collab",
        collaboratorUids: [],
        archived: false,
        status: "active",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "editorialProjects", "editorial-shared"), {
        name: "Libro compartido",
        type: "teacher_guide",
        size: "letter",
        orientation: "portrait",
        margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
        bleedIn: 0.125,
        ownerUid: "requester",
        collaboratorUids: ["collab"],
        archived: false,
        status: "active",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "editorialProjects", "editorial-perms"), {
        name: "Libro con permisos",
        type: "book",
        size: "8x10",
        orientation: "portrait",
        margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
        bleedIn: 0.125,
        ownerUid: "requester",
        collaboratorUids: ["collab", "deptmember", "tech"],
        editorialPermissions: { users: { collab: "publisher", deptmember: "viewer", tech: "content_editor" } },
        archived: false,
        status: "active",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "materialCorrectionReports", "material-report-1"), {
        folio: "MAT-2026-000001",
        publicTrackingTokenHash: "a".repeat(64),
        reportedBy: {
          name: "Dirección",
          position: "director",
          campus: "Centro",
          contact: "direccion@test.local",
        },
        levelName: "A1",
        bookName: "Journey",
        unitNumber: 1,
        materialType: "student_book",
        errorType: "spelling",
        description: "Error en página",
        priority: "normal",
        status: "reported",
        archived: false,
        deleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "materialCorrectionReports", "material-report-1", "comments", "comment-1"), {
        type: "comment",
        visibility: "internal",
        message: "Comentario interno",
        createdAt: Timestamp.now(),
      }),
      setDoc(doc(db, "publicCertificatePeople", "requester-requester"), {
        sourceId: "requester",
        name: "Requester",
        type: "Requester",
        active: true,
      }),
      setDoc(doc(db, "publicCertificatePeople", "signer-principal"), {
        sourceId: "principal",
        name: "Director Demo",
        type: "Principal",
        active: true,
      }),
      setDoc(doc(db, "publicCertificatePeople", "signer-teacher"), {
        sourceId: "teacher",
        name: "Teacher Demo",
        type: "Teacher",
        active: true,
      }),
      setDoc(doc(db, "publicCertificatePeople", "signer-inactive"), {
        sourceId: "inactive-signer",
        name: "Firmante inactivo",
        type: "Teacher",
        active: false,
      }),
    ]);
  });
}

function validAssignedPublicPrintRequest(overrides = {}) {
  return {
    folio: "CERT-2026-PUBLIC-ASSIGNED",
    productId: "",
    productName: "Certificado A1",
    requestType: "Certificado",
    requesterName: "Solicitante público",
    requesterArea: "Dirección Académica",
    campus: "Plaza Estrella",
    assignedUserId: "printer",
    assignedUserName: "Printer",
    supportUserId: "collab",
    supportUserName: "Collaborator",
    responsibleUid: "printer",
    responsibleName: "Printer",
    responsibleEmail: "printer@test.local",
    collaboratorUid: "collab",
    collaboratorName: "Collaborator",
    collaboratorEmail: "collab@test.local",
    assignmentSource: "agenda:tony",
    priority: "Normal",
    requestedQuantity: 1,
    deliveredQuantity: 0,
    deliveryType: "Impresa",
    status: "Solicitud recibida",
    requestDate: "2026-07-14",
    dueDate: "2026-07-31",
    notes: "",
    level: "A1",
    group: "A1 Journey",
    teacherName: "Teacher",
    schedule: "10:00",
    printedQuantity: 1,
    digitalQuantity: 0,
    students: [],
    publicTrackingEnabled: true,
    publicRequestSource: "certificate-public-form",
    createdByUid: "public-form",
    ...overrides,
  };
}

function validCertificateTemplate(overrides = {}) {
  return {
    name: "Plantilla Smile 6",
    level: "Smile 6",
    programName: "Smile 6",
    audience: "Kids",
    certificateType: "Certificado",
    bodyText: "Certifica que {student} completó {program}.",
    bodySegments: [],
    customTexts: [],
    customImages: [],
    active: true,
    notes: "",
    templateImageUrl: "https://firebasestorage.googleapis.com/template.png",
    templateImageDataUrl: "data:image/png;base64,AA==",
    storagePath: "printshop/certificate-templates/admin/template.png",
    positions: {},
    ...overrides,
  };
}

function validBugReport(overrides = {}) {
  return {
    id: "bug-1",
    title: "Error en vista",
    module: "Dashboard",
    description: "La pantalla muestra error.",
    priority: "media",
    status: "nuevo",
    evidenceFiles: [],
    reporterUid: "requester",
    reporterName: "Requester",
    reporterEmail: "requester@test.local",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    lastActivityAt: Timestamp.now(),
    ...overrides,
  };
}

function validIdea(overrides = {}) {
  return {
    title: "Mejor flujo",
    area: "Operación",
    currentProblem: "Muchos pasos manuales.",
    proposedIdea: "Automatizar revisión.",
    implementationSuggestion: "Probar con un equipo pequeño.",
    expectedBenefit: "Menos errores.",
    priority: "media",
    impact: "medio",
    evidenceFiles: [],
    evidenceCount: 0,
    status: "nueva",
    createdByUid: "requester",
    createdByName: "Requester",
    createdByEmail: "requester@test.local",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    updatedByUid: "requester",
    updatedByName: "Requester",
    updatedByEmail: "requester@test.local",
    reviewedAt: null,
    reviewedByUid: "",
    reviewedByName: "",
    reviewedByEmail: "",
    convertedProjectId: null,
    ...overrides,
  };
}

function validPrintProduct(actorUid, overrides = {}) {
  return {
    name: "Smile Workbook",
    category: "Libro",
    productionType: "Producto terminado",
    level: "Smile 1",
    unit: "Libro",
    minStock: 5,
    idealStock: 15,
    requiresPrinting: true,
    requiresBinding: true,
    requiresCutting: true,
    requiresQualityCheck: true,
    requiresSignature: false,
    requiresValidationQr: false,
    productionRecipe: [],
    active: true,
    notes: "",
    createdAt: Timestamp.now(),
    createdByUid: actorUid,
    createdByName: actorUid,
    createdByEmail: `${actorUid}@test.local`,
    updatedAt: Timestamp.now(),
    updatedByUid: actorUid,
    updatedByName: actorUid,
    updatedByEmail: `${actorUid}@test.local`,
    ...overrides,
  };
}

function validProductionBatch(overrides = {}) {
  const checklistIds = [
    "cover", "level", "pagesComplete", "pageOrder", "printQuality",
    "cleanPrint", "cutting", "binding", "quantityMatches", "approvedRejectedRegistered",
  ];
  return {
    folio: "LOT-2026-001",
    productId: "book-1",
    productName: "Journey A1",
    category: "Libro",
    level: "A1",
    unit: "Libro",
    plannedQuantity: 20,
    producedQuantity: 0,
    approvedQuantity: 0,
    rejectedQuantity: 0,
    status: "Planeado",
    progress: 10,
    responsible: "Printer",
    responsibleUid: "printer",
    responsibleName: "Printer",
    responsibleEmail: "printer@test.local",
    auditorUid: "auditor",
    auditorName: "Auditor",
    auditorEmail: "auditor@test.local",
    startDate: "2026-07-20",
    dueDate: "2026-07-25",
    notes: "",
    qualityChecklist: checklistIds.map((id) => ({ id, label: id, checked: false })),
    qualityStatus: "Pendiente",
    qualityResult: "Pendiente",
    qualityNotes: "",
    qualityCompleted: false,
    inventoryApplied: false,
    inventoryId: "",
    inventoryMovementId: "",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    updatedByUid: "admin",
    updatedByName: "Admin",
    updatedByEmail: "admin@test.local",
    ...overrides,
  };
}

function validStandaloneCertificate(overrides = {}) {
  return {
    folio: "CERT-2026-IND-00001",
    validationCode: "CERT-2026-IND-00001-DEMO",
    validationUrl: "https://active.test/validar-certificado/CERT-2026-IND-00001-DEMO",
    studentId: "individual-student-1",
    studentName: "Alumno Demo",
    studentDeliveryType: "Digital",
    campus: "Plaza Estrella",
    group: "",
    requestId: "",
    requestFolio: "IND-2026-00001",
    generationMode: "individual",
    requestType: "Certificado",
    productId: "",
    productName: "Certificado individual",
    responsibleUid: "printer",
    responsibleName: "Printer",
    responsibleEmail: "printer@test.local",
    level: "A1",
    programName: "Journey",
    templateId: "template-1",
    templateName: "Certificado Journey",
    issueDate: "2026-06-30",
    issueYear: "2026",
    generatedYear: "2026",
    principalName: "Principal Demo",
    teacherName: "Teacher Demo",
    status: "Generado",
    pdfFileName: "CERT-2026-IND-00001.pdf",
    pdfUrl: "",
    pdfStoragePath: "",
    generatedAt: Timestamp.now(),
    generatedByUid: "printer",
    generatedByName: "Printer",
    generatedByEmail: "printer@test.local",
    updatedAt: Timestamp.now(),
    updatedByUid: "printer",
    updatedByName: "Printer",
    updatedByEmail: "printer@test.local",
    ...overrides,
  };
}

function validStandaloneCertificateValidation(overrides = {}) {
  const certificate = validStandaloneCertificate();

  return {
    validationCode: certificate.validationCode,
    folio: certificate.folio,
    validationUrl: certificate.validationUrl,
    studentName: certificate.studentName,
    level: certificate.level,
    programName: certificate.programName,
    requestType: certificate.requestType,
    productName: certificate.productName,
    templateName: certificate.templateName,
    issueDate: certificate.issueDate,
    issueYear: certificate.issueYear,
    campus: certificate.campus,
    teacherName: certificate.teacherName,
    status: certificate.status,
    institution: "Active English School",
    requestId: "",
    generationMode: "individual",
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function validGeneratedCertificate(overrides = {}) {
  return {
    folio: "CERT-2026-A1-0001-001",
    validationCode: "CERT-2026-A1-0001-001-ABC123",
    validationUrl: "https://sistema-desarrollo-proyectos.web.app/validar-certificado/CERT-2026-A1-0001-001-ABC123",
    studentId: "student-1",
    studentName: "Alumno Prueba",
    studentDeliveryType: "Digital",
    campus: "Plaza Estrella",
    group: "Grupo Teacher",
    requestId: "cert-request-1",
    requestFolio: "IMP-2026-0001",
    requestType: "Certificado",
    productId: "",
    productName: "Certificado A1",
    responsibleUid: "printer",
    responsibleName: "Printer",
    responsibleEmail: "printer@test.local",
    level: "A1",
    programName: "Journey",
    templateId: "template-1",
    templateName: "Plantilla A1",
    issueDate: "2026-06-30",
    issueYear: "2026",
    generatedYear: "2026",
    principalName: "Principal",
    teacherName: "Teacher",
    status: "Generado",
    pdfFileName: "certificado.pdf",
    pdfUrl: "",
    pdfStoragePath: "",
    generatedAt: Timestamp.now(),
    generatedByUid: "printer",
    generatedByName: "Printer",
    generatedByEmail: "printer@test.local",
    updatedAt: Timestamp.now(),
    updatedByUid: "printer",
    updatedByName: "Printer",
    updatedByEmail: "printer@test.local",
    ...overrides,
  };
}

function validPublicCertificateValidation(overrides = {}) {
  return {
    validationCode: "CERT-2026-A1-0001-001-ABC123",
    folio: "CERT-2026-A1-0001-001",
    validationUrl: "https://sistema-desarrollo-proyectos.web.app/validar-certificado/CERT-2026-A1-0001-001-ABC123",
    studentName: "Alumno Prueba",
    level: "A1",
    programName: "Journey",
    requestType: "Certificado",
    productName: "Certificado A1",
    templateName: "Plantilla A1",
    issueDate: "2026-06-30",
    issueYear: "2026",
    campus: "Plaza Estrella",
    teacherName: "Teacher",
    status: "Generado",
    institution: "Active English School",
    requestId: "cert-request-1",
    updatedAt: Timestamp.now(),
    publishedAt: Timestamp.now(),
    ...overrides,
  };
}

function validDepartmentMessage(overrides = {}) {
  return {
    departmentId: "dept-ops",
    departmentName: "Operación",
    fromUserId: "deptmember",
    fromUserName: "Dept Member",
    fromUserEmail: "deptmember@test.local",
    message: "Hola equipo",
    attachments: [],
    replyToMessageId: "",
    replyToFromUserId: "",
    replyToFromUserName: "",
    replyToMessage: "",
    memberIds: ["deptmember"],
    readBy: { deptmember: Timestamp.now() },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function validInternalMessage(overrides = {}) {
  return {
    fromUserId: "collab",
    fromUserName: "Collaborator",
    fromUserEmail: "collab@test.local",
    toUserId: "requester",
    toUserName: "Requester",
    toUserEmail: "requester@test.local",
    subject: "Conversación de prueba",
    message: "Hola",
    attachments: [],
    replyToMessageId: "",
    replyToFromUserId: "",
    replyToFromUserName: "",
    replyToMessage: "",
    read: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function validActiveClassroomFolder(overrides = {}) {
  return {
    name: "Nivel 1",
    parentId: null,
    kind: "level",
    position: 1,
    active: true,
    createdAt: Timestamp.now(),
    createdByUid: "admin",
    updatedAt: Timestamp.now(),
    updatedByUid: "admin",
    ...overrides,
  };
}

function validActiveClassroomResource(resourceId, overrides = {}) {
  return {
    folderId: "level-1-unit-01",
    name: "guia.pdf",
    kind: "document",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    storagePath: `active-classroom/resources/${resourceId}/guia.pdf`,
    published: false,
    archived: false,
    createdAt: Timestamp.now(),
    createdByUid: "admin",
    createdByName: "Admin",
    updatedAt: Timestamp.now(),
    updatedByUid: "admin",
    updatedByName: "Admin",
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedBaseData();
});

after(async () => {
  await testEnv.cleanup();
});

describe("roles y perfiles", () => {
  it("bloquea usuario no autenticado", async () => {
    await assertFails(getDoc(doc(unauth(), "projects", "owned-project")));
  });

  it("bloquea usuario inactivo aunque tenga role admin", async () => {
    const db = auth("inactive");
    await assertFails(getDocs(collection(db, "projects")));
  });
});

describe("Active Classroom", () => {
  it("permite administrar carpetas solo a admin y leerlas a perfiles activos", async () => {
    await assertSucceeds(setDoc(
      doc(auth("admin"), "activeClassroomFolders", "level-1"),
      validActiveClassroomFolder()
    ));
    await assertSucceeds(getDoc(doc(auth("collab"), "activeClassroomFolders", "level-1")));
    await assertFails(setDoc(
      doc(auth("collab"), "activeClassroomFolders", "level-2"),
      validActiveClassroomFolder({
        name: "Nivel 2",
        position: 2,
        createdByUid: "collab",
        updatedByUid: "collab",
      })
    ));
  });

  it("admite inicialización segmentada de 16 Units por Nivel", async () => {
    const db = auth("admin");
    await assertSucceeds(setDoc(
      doc(db, "activeClassroomFolders", "level-1"),
      validActiveClassroomFolder()
    ));

    const batch = writeBatch(db);
    for (let unitNumber = 1; unitNumber <= 16; unitNumber += 1) {
      const unitSuffix = String(unitNumber).padStart(2, "0");
      batch.set(
        doc(db, "activeClassroomFolders", `level-1-unit-${unitSuffix}`),
        validActiveClassroomFolder({
          name: `Unit ${unitSuffix}`,
          parentId: "level-1",
          kind: "unit",
          position: unitNumber,
        })
      );
    }

    await assertSucceeds(batch.commit());
  });

  it("expone a perfiles activos solo recursos publicados", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "activeClassroomResources", "published-resource"),
          validActiveClassroomResource("published-resource", { published: true })
        ),
        setDoc(
          doc(db, "activeClassroomResources", "draft-resource"),
          validActiveClassroomResource("draft-resource")
        ),
      ]);
    });

    await assertSucceeds(getDoc(
      doc(auth("collab"), "activeClassroomResources", "published-resource")
    ));
    await assertFails(getDoc(
      doc(auth("collab"), "activeClassroomResources", "draft-resource")
    ));
    await assertSucceeds(getDoc(
      doc(auth("admin"), "activeClassroomResources", "draft-resource")
    ));
    await assertSucceeds(getDocs(query(
      collection(auth("collab"), "activeClassroomResources"),
      where("published", "==", true)
    )));
    await assertFails(getDocs(collection(
      auth("collab"),
      "activeClassroomResources"
    )));
  });

  it("permite crear y publicar recursos solo a admin", async () => {
    await assertSucceeds(setDoc(
      doc(auth("admin"), "activeClassroomFolders", "level-1"),
      validActiveClassroomFolder()
    ));
    await assertSucceeds(setDoc(
      doc(auth("admin"), "activeClassroomFolders", "level-1-unit-01"),
      validActiveClassroomFolder({
        name: "Unit 01",
        parentId: "level-1",
        kind: "unit",
      })
    ));
    const resourceRef = doc(auth("admin"), "activeClassroomResources", "admin-resource");
    await assertSucceeds(setDoc(
      resourceRef,
      validActiveClassroomResource("admin-resource")
    ));
    await assertSucceeds(updateDoc(resourceRef, {
      published: true,
      updatedAt: Timestamp.now(),
      updatedByUid: "admin",
      updatedByName: "Admin",
    }));
    await assertFails(setDoc(
      doc(auth("collab"), "activeClassroomResources", "collab-resource"),
      validActiveClassroomResource("collab-resource", {
        createdByUid: "collab",
        updatedByUid: "collab",
        createdByName: "Collaborator",
        updatedByName: "Collaborator",
      })
    ));
  });
});

describe("catálogo de productos de Imprenta", () => {
  it("permite crear a administrador y colaborador activo de Imprenta", async () => {
    await assertSucceeds(setDoc(
      doc(auth("admin"), "printProducts", "admin-product"),
      validPrintProduct("admin")
    ));
    await assertSucceeds(setDoc(
      doc(auth("printer"), "printProducts", "printer-product"),
      validPrintProduct("printer")
    ));
  });

  it("bloquea creación fuera de rol, departamento o estado autorizados", async () => {
    await assertFails(setDoc(
      doc(auth("collab"), "printProducts", "outsider-product"),
      validPrintProduct("collab")
    ));
    await assertFails(setDoc(
      doc(auth("tech"), "printProducts", "tech-product"),
      validPrintProduct("tech")
    ));
    await assertFails(setDoc(
      doc(auth("inactive"), "printProducts", "inactive-product"),
      validPrintProduct("inactive")
    ));
  });

  it("permite edición operativa a Imprenta y reserva estado/eliminación al administrador", async () => {
    await assertSucceeds(updateDoc(doc(auth("printer"), "printProducts", "book-1"), {
      name: "Journey A1 operativo",
      description: "Descripción actualizada por Imprenta.",
      imageUrl: "https://example.test/journey-a1.jpg",
      productionRecipe: [{
        id: "recipe-1",
        supplyId: "paper-1",
        supplyName: "Papel",
        quantityPerUnit: 40,
        unit: "Hoja",
        notes: "",
        active: true,
      }],
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    }));
    await assertFails(updateDoc(doc(auth("printer"), "printProducts", "book-1"), {
      active: false,
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    }));
    await assertFails(updateDoc(doc(auth("collab"), "printProducts", "book-1"), {
      name: "Cambio sin acceso",
      updatedAt: Timestamp.now(),
      updatedByUid: "collab",
      updatedByName: "Collaborator",
      updatedByEmail: "collab@test.local",
    }));
    await assertFails(deleteDoc(doc(auth("printer"), "printProducts", "book-1")));
    await assertSucceeds(updateDoc(doc(auth("admin"), "printProducts", "book-1"), {
      name: "Journey A1 actualizado",
      updatedAt: Timestamp.now(),
      updatedByUid: "admin",
      updatedByName: "Admin",
      updatedByEmail: "admin@test.local",
    }));
  });
});

describe("lotes de producción", () => {
  it("acepta fallback automático de una persona solo cuando queda explícito", async () => {
    const db = auth("admin");
    await assertSucceeds(setDoc(
      doc(db, "printProductionBatches", "batch-single-fallback"),
      validProductionBatch({
        folio: "LOT-2026-FALLBACK",
        auditorUid: "printer",
        auditorName: "Printer",
        auditorEmail: "printer@test.local",
        assignmentSource: "automatic",
        assignmentSinglePersonFallback: true,
      })
    ));
    await assertFails(setDoc(
      doc(db, "printProductionBatches", "batch-invalid-same-person"),
      validProductionBatch({
        folio: "LOT-2026-INVALID",
        auditorUid: "printer",
        auditorName: "Printer",
        auditorEmail: "printer@test.local",
      })
    ));
  });

  it("permite al administrador crear y exige Function para editar", async () => {
    const db = auth("admin");
    await assertSucceeds(setDoc(
      doc(db, "printProductionBatches", "batch-manual"),
      validProductionBatch({ folio: "LOT-2026-002", plannedQuantity: 12 })
    ));
    await assertFails(updateDoc(doc(db, "printProductionBatches", "batch-manual"), {
      plannedQuantity: 15,
      dueDate: "2026-07-28",
      updatedAt: Timestamp.now(),
      updatedByUid: "admin",
      updatedByName: "Admin",
      updatedByEmail: "admin@test.local",
    }));
  });

  it("reserva avance e historial a Cloud Functions", async () => {
    const batchRef = doc(auth("printer"), "printProductionBatches", "batch-1");
    await assertFails(updateDoc(batchRef, {
      status: "En impresión",
      producedQuantity: 5,
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    }));
    await assertFails(updateDoc(batchRef, {
      status: "En revisión de calidad",
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    }));
    await assertFails(updateDoc(batchRef, {
      plannedQuantity: 99,
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    }));
  });

  it("reserva revisión y cierre al servidor", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "printProductionBatches", "batch-1"), {
        status: "En revisión de calidad",
        producedQuantity: 20,
        progress: 75,
      });
    });
    const batchRef = doc(auth("auditor"), "printProductionBatches", "batch-1");
    await assertFails(updateDoc(batchRef, {
      qualityStatus: "En revisión",
      updatedAt: Timestamp.now(),
      updatedByUid: "auditor",
      updatedByName: "Auditor",
      updatedByEmail: "auditor@test.local",
    }));
    await assertFails(updateDoc(batchRef, {
      status: "Aprobado",
      progress: 100,
      qualityStatus: "Aprobado",
      qualityResult: "Aprobado",
      qualityCompleted: true,
      updatedAt: Timestamp.now(),
      updatedByUid: "auditor",
      updatedByName: "Auditor",
      updatedByEmail: "auditor@test.local",
    }));
  });

  it("bloquea ingreso directo y cambios críticos incluso con escrituras agrupadas", async () => {
    const printerDb = auth("printer");
    const batch = writeBatch(printerDb);
    batch.update(doc(printerDb, "printFinishedInventory", "inventory-book-1"), {
      currentStock: 30,
      lastBatchId: "batch-1",
      lastBatchFolio: "LOT-2026-001",
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    });
    batch.update(doc(printerDb, "printProductionBatches", "batch-1"), {
      status: "Ingresado a inventario",
      progress: 100,
      inventoryApplied: true,
      inventoryId: "inventory-book-1",
      inventoryMovementId: "forged",
      updatedAt: Timestamp.now(),
      updatedByUid: "printer",
      updatedByName: "Printer",
      updatedByEmail: "printer@test.local",
    });
    await assertFails(batch.commit());

    await assertFails(updateDoc(doc(auth("admin"), "printProductionBatches", "batch-1"), {
      status: "Ingresado a inventario",
      progress: 100,
      inventoryApplied: true,
      inventoryId: "inventory-book-1",
      inventoryMovementId: "forged-admin",
      updatedAt: Timestamp.now(),
      updatedByUid: "admin",
      updatedByName: "Admin",
      updatedByEmail: "admin@test.local",
    }));
  });
  it("reserva la eliminación del último lote a la función protegida", async () => {
    await assertFails(deleteDoc(doc(auth("printer"), "printProductionBatches", "batch-1")));
    await assertFails(deleteDoc(doc(auth("admin"), "printProductionBatches", "batch-1")));
    await assertFails(updateDoc(doc(auth("admin"), "printProductionBatches", "batch-1"), {
      active: false,
      deleted: true,
      deletedAt: Timestamp.now(),
      deletedByUid: "admin",
      deletedByName: "Admin",
      deletedByEmail: "admin@test.local",
      updatedAt: Timestamp.now(),
      updatedByUid: "admin",
      updatedByName: "Admin",
      updatedByEmail: "admin@test.local",
    }));
  });

  it("solo expone supresiones de reposición al administrador", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "printProductionReplenishment", "book-1"), {
        productId: "book-1",
        suppressed: true,
        suppressedCurrentStock: 20,
        suppressedMinimumStock: 10,
        suppressedIdealStock: 50,
      });
    });
    await assertSucceeds(getDoc(doc(auth("admin"), "printProductionReplenishment", "book-1")));
    await assertFails(getDoc(doc(auth("printer"), "printProductionReplenishment", "book-1")));
  });

  it("expone historial de lote solo a usuarios de Imprenta", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(
        context.firestore(),
        "printProductionBatches",
        "batch-1",
        "history",
        "event-1"
      ), {
        type: "stage_changed",
        performedAt: Timestamp.now(),
        performedByUid: "printer",
      });
    });
    await assertSucceeds(getDocs(collection(
      auth("printer"),
      "printProductionBatches",
      "batch-1",
      "history"
    )));
    await assertFails(getDocs(collection(
      auth("collab"),
      "printProductionBatches",
      "batch-1",
      "history"
    )));
  });

  it("permite consultar inventario a Imprenta pero bloquea salidas directas", async () => {
    const printerDb = auth("printer");
    await assertSucceeds(getDoc(doc(printerDb, "printFinishedInventory", "inventory-book-1")));
    await assertFails(setDoc(doc(printerDb, "printInventoryMovements", "forged-output"), {
      inventoryId: "inventory-book-1",
      productId: "book-1",
      productName: "Libro Uno",
      type: "Salida",
      quantity: 1,
      reason: "Entrega",
      previousStock: 20,
      newStock: 19,
      createdAt: Timestamp.now(),
      createdByUid: "printer",
      createdByName: "Printer",
      createdByEmail: "printer@test.local",
    }));
  });
});

describe("acceso horizontal", () => {
  it("impide listar todos los usuarios a collaborator/requester", async () => {
    await assertFails(getDocs(collection(auth("collab"), "users")));
    await assertSucceeds(getDocs(collection(auth("admin"), "users")));
  });

  it("impide leer perfil ajeno por id", async () => {
    await assertFails(getDoc(doc(auth("collab"), "users", "requester")));
    await assertSucceeds(getDoc(doc(auth("collab"), "users", "collab")));
  });

  it("impide listar todos los proyectos a collaborator no admin", async () => {
    await assertFails(getDocs(collection(auth("collab"), "projects")));
  });

  it("permite query de proyectos asignados al collaborator", async () => {
    const q = query(
      collection(auth("collab"), "projects"),
      where("assignedToUid", "==", "collab")
    );

    await assertSucceeds(getDocs(q));
  });

  it("impide listar solicitudes de compra ajenas", async () => {
    await assertFails(getDocs(collection(auth("requester"), "purchaseRequests")));
  });

  it("permite query de solicitudes propias", async () => {
    const q = query(
      collection(auth("requester"), "purchaseRequests"),
      where("requestedByUid", "==", "requester")
    );

    await assertSucceeds(getDocs(q));
  });
});

describe("acceso vertical", () => {
  it("impide que requester cambie su role/active/departments", async () => {
    await assertFails(
      updateDoc(doc(auth("requester"), "users", "requester"), {
        role: "admin",
        active: true,
        departments: ["Dirección"],
      })
    );
  });

  it("impide leer soporte técnico si usuario no pertenece a soporte", async () => {
    await assertFails(getDoc(doc(auth("requester"), "technicalAssets", "asset-1")));
    await assertSucceeds(getDoc(doc(auth("tech"), "technicalAssets", "asset-1")));
  });
});

describe("herramientas de soporte", () => {
  it("limita catalogo e historial al personal autorizado", async () => {
    await assertSucceeds(getDoc(doc(auth("tech"), "supportTools", "tool-1")));
    await assertSucceeds(getDoc(doc(auth("admin"), "supportTools", "tool-1")));
    await assertFails(getDoc(doc(auth("requester"), "supportTools", "tool-1")));
    await assertSucceeds(getDoc(doc(auth("tech"), "supportTools", "tool-1", "history", "history-1")));
    await assertFails(getDoc(doc(auth("requester"), "supportTools", "tool-1", "history", "history-1")));
  });

  it("bloquea escrituras directas y exige Functions transaccionales", async () => {
    await assertFails(updateDoc(doc(auth("tech"), "supportTools", "tool-1"), { status: "Prestada" }));
    await assertFails(updateDoc(doc(auth("admin"), "supportTools", "tool-1"), { status: "Baja" }));
    await assertFails(setDoc(doc(auth("tech"), "supportTools", "tool-direct"), { name: "Directa" }));
  });
});

describe("notificaciones operativas", () => {
  it("permite al destinatario leer y confirmar su notificacion", async () => {
    const notificationRef = doc(auth("tech"), "notifications", "notification-tech");
    await assertSucceeds(getDoc(notificationRef));
    await assertSucceeds(updateDoc(notificationRef, {
      read: true,
      readAt: Timestamp.now(),
      acknowledged: true,
      acknowledgedAt: Timestamp.now(),
    }));
  });

  it("impide leer ajenas, crear desde cliente o alterar contenido", async () => {
    await assertFails(getDoc(doc(auth("requester"), "notifications", "notification-tech")));
    await assertFails(setDoc(doc(auth("tech"), "notifications", "client-created"), {
      recipientId: "tech",
      read: false,
      createdAt: Timestamp.now(),
    }));
    await assertFails(updateDoc(doc(auth("tech"), "notifications", "notification-tech"), {
      title: "Contenido alterado",
    }));
  });
});

describe("proyectos y reportes", () => {
  it("permite query de proyectos por collaboratorIds al colaborador asignado", async () => {
    const q = query(
      collection(auth("collab"), "projects"),
      where("collaboratorIds", "array-contains", "collab")
    );

    await assertSucceeds(getDocs(q));
  });

  it("permite a colaborador crear su propio bug report con campos del formulario", async () => {
    await assertSucceeds(
      setDoc(doc(auth("requester"), "bugReports", "bug-own"), validBugReport({
        steps: "Abrir Mis proyectos y subir evidencia.",
        evidenceCount: 1,
        imageEvidenceCount: 1,
        videoEvidenceCount: 0,
        adminComment: "",
        adminHistory: [],
        searchableText: "dashboard error requester",
      }))
    );
  });

  it("bloquea suplantar reporterUid en bug report", async () => {
    await assertFails(
      setDoc(doc(auth("requester"), "bugReports", "bug-spoof"), validBugReport({
        reporterUid: "collab",
      }))
    );
  });
});

describe("mass assignment", () => {
  it("rechaza campos administrativos en bugReports create", async () => {
    await assertFails(
      setDoc(doc(auth("requester"), "bugReports", "bug-1"), {
        ...validBugReport(),
        internalNotes: "oculto",
        deleted: true,
        isAdmin: true,
      })
    );
  });

  it("rechaza campos administrativos en ideas create", async () => {
    await assertFails(
      addDoc(collection(auth("requester"), "ideas"), {
        ...validIdea(),
        approvedBy: "requester",
        deleted: true,
      })
    );
  });
});

describe("incubadora de ideas", () => {
  it("permite al colaborador crear una idea con el esquema actual", async () => {
    await assertSucceeds(
      addDoc(collection(auth("collab"), "ideas"), validIdea({
        createdByUid: "collab",
        createdByName: "Collaborator",
        createdByEmail: "collab@test.local",
        updatedByUid: "collab",
        updatedByName: "Collaborator",
        updatedByEmail: "collab@test.local",
      }))
    );
  });

  it("bloquea al colaborador que suplanta autor o revisor", async () => {
    await assertFails(
      addDoc(collection(auth("collab"), "ideas"), validIdea({
        createdByUid: "requester",
        updatedByUid: "requester",
      }))
    );
    await assertFails(
      addDoc(collection(auth("collab"), "ideas"), validIdea({
        createdByUid: "collab",
        updatedByUid: "collab",
        reviewedByUid: "admin",
      }))
    );
  });
});

describe("certificados individuales", () => {
  it("permite registrar historial y validacion publica sin solicitud", async () => {
    const db = auth("printer");
    const certificateId = "CERT-2026-IND-00001-DEMO";

    await assertSucceeds(
      setDoc(
        doc(db, "generatedCertificates", certificateId),
        validStandaloneCertificate()
      )
    );

    await assertSucceeds(
      setDoc(
        doc(db, "publicCertificateValidations", certificateId),
        validStandaloneCertificateValidation()
      )
    );

    await assertSucceeds(
      getDoc(doc(unauth(), "publicCertificateValidations", certificateId))
    );
  });

  it("rechaza certificado individual sin generationMode", async () => {
    const db = auth("printer");

    await assertFails(
      setDoc(
        doc(db, "generatedCertificates", "missing-generation-mode"),
        validStandaloneCertificate({ generationMode: "" })
      )
    );
  });
});

describe("personas publicas de certificados", () => {
  it("permite consultar solo firmantes activos por categoria", async () => {
    const principalQuery = query(
      collection(unauth(), "publicCertificatePeople"),
      where("active", "==", true),
      where("type", "==", "Principal")
    );
    const teacherQuery = query(
      collection(unauth(), "publicCertificatePeople"),
      where("active", "==", true),
      where("type", "==", "Teacher")
    );

    await assertSucceeds(getDocs(principalQuery));
    await assertSucceeds(getDocs(teacherQuery));
  });

  it("bloquea listar sin filtros, usuarios generales e inactivos", async () => {
    await assertFails(getDocs(collection(unauth(), "publicCertificatePeople")));
    await assertFails(getDoc(doc(unauth(), "publicCertificatePeople", "requester-requester")));
    await assertFails(getDoc(doc(unauth(), "publicCertificatePeople", "signer-inactive")));
  });

  it("bloquea escrituras cliente sobre la proyeccion publica", async () => {
    await assertFails(
      setDoc(doc(auth("admin"), "publicCertificatePeople", "manual"), {
        sourceId: "manual",
        name: "No permitido",
        type: "Requester",
        active: true,
      })
    );
  });
});

describe("plantillas de certificados", () => {
  for (const level of [
    "Smile 1",
    "Smile 2",
    "Smile 3",
    "Smile 4",
    "Smile 5",
    "Smile 6",
    "Mega Flash",
  ]) {
    it(`permite a admin guardar plantilla activa de ${level}`, async () => {
      await assertSucceeds(
        setDoc(
          doc(auth("admin"), "certificateTemplates", `template-${level.replace(" ", "-").toLowerCase()}`),
          validCertificateTemplate({
            name: `Plantilla ${level}`,
            level,
            programName: level,
          })
        )
      );
    });
  }

  it("bloquea guardar plantilla a usuario no administrador", async () => {
    await assertFails(
      setDoc(
        doc(auth("printer"), "certificateTemplates", "template-smile-6-printer"),
        validCertificateTemplate()
      )
    );
  });
});

describe("certificados de imprenta", () => {
  it("bloquea creación pública directa para exigir asignación server-side", async () => {
    await assertFails(setDoc(
      doc(unauth(), "printRequests", "public-direct"),
      validAssignedPublicPrintRequest({
        assignedUserId: "uid-inventado",
        supportUserId: "uid-inventado-2",
      })
    ));
  });

  it("usa validPublicPrintRequestCreate para escritura pública confiable", async () => {
    await assertSucceeds(setDoc(
      doc(auth("admin"), "printRequests", "public-trusted"),
      validAssignedPublicPrintRequest()
    ));
  });

  it("permite registrar certificado ligado a solicitud y su validacion publica", async () => {
    const db = auth("printer");
    const certificateId = "CERT-2026-A1-0001-001-ABC123";

    await assertSucceeds(
      setDoc(doc(db, "generatedCertificates", certificateId), validGeneratedCertificate())
    );

    await assertSucceeds(
      setDoc(doc(db, "publicCertificateValidations", certificateId), validPublicCertificateValidation())
    );

    await assertSucceeds(getDoc(doc(unauth(), "publicCertificateValidations", certificateId)));
  });

  it("permite al colaborador de apoyo guardar folios, certificado y validacion publica", async () => {
    const db = auth("collab");
    const certificateId = "CERT-2026-A1-0001-002-APOYO";

    await assertSucceeds(
      updateDoc(doc(db, "printRequests", "cert-request-1"), {
        students: [
          {
            id: "student-2",
            name: "Alumno Apoyo",
            deliveryType: "Digital",
            status: "Folio generado",
            certificateFolio: "CERT-2026-A1-0001-002",
            validationCode: certificateId,
          },
        ],
        updatedAt: Timestamp.now(),
        updatedByUid: "collab",
        updatedByName: "Collaborator",
        updatedByEmail: "collab@test.local",
      })
    );

    await assertSucceeds(
      setDoc(
        doc(db, "generatedCertificates", certificateId),
        validGeneratedCertificate({
          folio: "CERT-2026-A1-0001-002",
          validationCode: certificateId,
          studentId: "student-2",
          studentName: "Alumno Apoyo",
          generatedByUid: "collab",
          generatedByName: "Collaborator",
          generatedByEmail: "collab@test.local",
          updatedByUid: "collab",
          updatedByName: "Collaborator",
          updatedByEmail: "collab@test.local",
        })
      )
    );

    await assertSucceeds(
      setDoc(
        doc(db, "publicCertificateValidations", certificateId),
        validPublicCertificateValidation({
          folio: "CERT-2026-A1-0001-002",
          validationCode: certificateId,
          studentName: "Alumno Apoyo",
        })
      )
    );

    await assertSucceeds(
      setDoc(doc(db, "certificateHistoryBatches", "cert-request-1"), {
        requestId: "cert-request-1",
        loteId: "cert-request-1",
        requestFolio: "IMP-2026-0001",
        certificateIds: [certificateId],
        certificateCount: 1,
        status: "Generado",
        updatedAt: Timestamp.now(),
        updatedByUid: "collab",
        updatedByName: "Collaborator",
        updatedByEmail: "collab@test.local",
      })
    );
  });

  it("permite al principal y apoyo cambiar cualquier estado permitido", async () => {
    const allowedStatuses = [
      "Solicitud recibida",
      "Datos incompletos",
      "En revisión",
      "Aprobada",
      "En producción",
      "En revisión de calidad",
      "Lista para entrega",
      "Entregada",
      "Cancelada",
    ];

    for (const [index, status] of allowedStatuses.entries()) {
      const uid = index % 2 === 0 ? "printer" : "collab";
      const db = auth(uid);
      await assertSucceeds(
        updateDoc(doc(db, "printRequests", "cert-request-1"), {
          status,
          statusLabel: status,
          updatedAt: Timestamp.now(),
          updatedByUid: uid,
          updatedByName: uid === "printer" ? "Printer" : "Collaborator",
          updatedByEmail: `${uid}@test.local`,
        })
      );
    }
  });

  it("permite al apoyo editar alumnos, entrega, plantilla, fechas, firmantes y producción", async () => {
    const db = auth("collab");

    await assertSucceeds(
      updateDoc(doc(db, "printRequests", "cert-request-1"), {
        requestedQuantity: 1,
        deliveredQuantity: 0,
        deliveryType: "Digital",
        dueDate: "2026-08-15",
        certificateIssueDate: "2026-08-14",
        certificateTemplateId: "template-2",
        certificateTemplateName: "Plantilla corregida",
        certificateTemplateLevel: "A1",
        certificateTemplateProgramName: "Journey",
        certificateTemplateAudience: "Adultos",
        certificateTemplateBodyText: "Texto",
        certificateTemplateBodySegments: [],
        certificateTemplateCustomTexts: [],
        certificateTemplateCustomImages: [],
        certificateTemplateImageUrl: "https://example.test/template.png",
        certificateTemplateImageDataUrl: "data:image/png;base64,AA==",
        certificateTemplateStoragePath: "printshop/templates/template-2.png",
        certificateTemplatePositions: {},
        level: "A1",
        group: "Grupo A1",
        teacherName: "Teacher Demo",
        schedule: "Lun 18:00",
        printedQuantity: 0,
        digitalQuantity: 1,
        principalSignerId: "principal-2",
        principalSignerName: "Principal Demo",
        principalSignerRole: "Principal",
        principalSignatureUrl: "https://example.test/principal.png",
        principalSignatureDataUrl: "data:image/png;base64,AA==",
        teacherSignerId: "teacher-2",
        teacherSignerName: "Teacher Demo",
        teacherSignerRole: "Teacher",
        teacherSignatureUrl: "https://example.test/teacher.png",
        teacherSignatureDataUrl: "data:image/png;base64,AA==",
        students: [{ id: "student-1", name: "Alumno Corregido", deliveryType: "Digital", status: "Pendiente" }],
        updatedAt: Timestamp.now(),
        updatedByUid: "collab",
        updatedByName: "Collaborator",
        updatedByEmail: "collab@test.local",
      })
    );
  });

  it("mantiene al usuario no asignado en solo lectura", async () => {
    const db = auth("requester");

    await assertFails(
      updateDoc(doc(db, "printRequests", "cert-request-1"), {
        status: "Entregada",
        statusLabel: "Entregada",
        updatedAt: Timestamp.now(),
        updatedByUid: "requester",
        updatedByName: "Requester",
        updatedByEmail: "requester@test.local",
      })
    );
  });

  it("sincroniza Entregada atómicamente en solicitud, lote, certificado y QR", async () => {
    const db = auth("collab");
    const certificateId = "CERT-2026-A1-ENTREGADO-001";
    const student = {
      id: "student-delivered",
      name: "Alumno Entregado",
      deliveryType: "Impreso",
      status: "Entregado",
      certificateFolio: "CERT-2026-A1-ENTREGADO",
      validationCode: certificateId,
    };

    await assertSucceeds(setDoc(
      doc(db, "generatedCertificates", certificateId),
      validGeneratedCertificate({
        folio: student.certificateFolio,
        validationCode: certificateId,
        studentId: student.id,
        studentName: student.name,
        generatedByUid: "collab",
        generatedByName: "Collaborator",
        generatedByEmail: "collab@test.local",
        updatedByUid: "collab",
        updatedByName: "Collaborator",
        updatedByEmail: "collab@test.local",
      })
    ));
    await assertSucceeds(setDoc(
      doc(db, "publicCertificateValidations", certificateId),
      validPublicCertificateValidation({
        folio: student.certificateFolio,
        validationCode: certificateId,
        studentName: student.name,
      })
    ));
    await assertSucceeds(setDoc(doc(db, "certificateHistoryBatches", "cert-request-1"), {
      requestId: "cert-request-1",
      loteId: "cert-request-1",
      status: "Generado",
    }));

    const batch = writeBatch(db);
    batch.update(doc(db, "printRequests", "cert-request-1"), {
      status: "Entregada",
      statusLabel: "Entregada",
      deliveredQuantity: 1,
      students: [student],
      updatedAt: Timestamp.now(),
      updatedByUid: "collab",
      updatedByName: "Collaborator",
      updatedByEmail: "collab@test.local",
    });
    batch.set(doc(db, "certificateHistoryBatches", "cert-request-1"), {
      requestId: "cert-request-1",
      loteId: "cert-request-1",
      status: "Entregado",
      updatedAt: Timestamp.now(),
      updatedByUid: "collab",
      updatedByName: "Collaborator",
      updatedByEmail: "collab@test.local",
    }, { merge: true });
    batch.update(doc(db, "generatedCertificates", certificateId), {
      status: "Entregado",
      deliveredByUid: "collab",
      deliveredByName: "Collaborator",
      deliveredByEmail: "collab@test.local",
      updatedByUid: "collab",
      updatedByName: "Collaborator",
      updatedByEmail: "collab@test.local",
    });
    batch.set(doc(db, "publicCertificateValidations", certificateId), {
      status: "Entregado",
    }, { merge: true });

    await assertSucceeds(batch.commit());
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const verificationDb = context.firestore();
      assert.equal((await getDoc(doc(verificationDb, "printRequests", "cert-request-1"))).data().status, "Entregada");
      assert.equal((await getDoc(doc(verificationDb, "certificateHistoryBatches", "cert-request-1"))).data().status, "Entregado");
      assert.equal((await getDoc(doc(verificationDb, "generatedCertificates", certificateId))).data().status, "Entregado");
      assert.equal((await getDoc(doc(verificationDb, "publicCertificateValidations", certificateId))).data().status, "Entregado");
    });
  });

  it("bloquea generar certificados de solicitud a colaborador no asignado", async () => {
    const db = auth("requester");

    await assertFails(
      setDoc(
        doc(db, "generatedCertificates", "CERT-2026-A1-0001-003-NO-ASIGNADO"),
        validGeneratedCertificate({
          folio: "CERT-2026-A1-0001-003",
          validationCode: "CERT-2026-A1-0001-003-NO-ASIGNADO",
          generatedByUid: "requester",
          generatedByName: "Requester",
          generatedByEmail: "requester@test.local",
          updatedByUid: "requester",
          updatedByName: "Requester",
          updatedByEmail: "requester@test.local",
        })
      )
    );

    await assertFails(
      setDoc(doc(db, "certificateHistoryBatches", "cert-request-1"), {
        requestId: "cert-request-1",
        loteId: "cert-request-1",
        status: "Generado",
      })
    );
  });

  it("permite registrar certificado individual sin solicitud y validarlo por QR", async () => {
    const db = auth("printer");
    const certificateId = "CERT-2026-A1-IND-001-XYZ789";

    await assertSucceeds(
      setDoc(
        doc(db, "generatedCertificates", certificateId),
        validGeneratedCertificate({
          folio: "CERT-2026-A1-IND-001",
          validationCode: certificateId,
          validationUrl: `https://sistema-desarrollo-proyectos.web.app/validar-certificado/${certificateId}`,
          studentId: "individual-student-1",
          requestId: "",
          requestFolio: "Individual",
          generationMode: "individual",
          productName: "Certificado individual",
        })
      )
    );

    await assertSucceeds(
      setDoc(
        doc(db, "publicCertificateValidations", certificateId),
        validPublicCertificateValidation({
          folio: "CERT-2026-A1-IND-001",
          validationCode: certificateId,
          validationUrl: `https://sistema-desarrollo-proyectos.web.app/validar-certificado/${certificateId}`,
          requestId: "",
          generationMode: "individual",
          productName: "Certificado individual",
        })
      )
    );

    await assertSucceeds(getDoc(doc(unauth(), "publicCertificateValidations", certificateId)));
  });

  it("bloquea certificado individual a usuario sin acceso a imprenta", async () => {
    const db = auth("collab");

    await assertFails(
      setDoc(
        doc(db, "generatedCertificates", "CERT-2026-A1-IND-002-XYZ789"),
        validGeneratedCertificate({
          folio: "CERT-2026-A1-IND-002",
          validationCode: "CERT-2026-A1-IND-002-XYZ789",
          requestId: "",
          requestFolio: "Individual",
          generationMode: "individual",
          productName: "Certificado individual",
        })
      )
    );
  });
});

describe("configuracion de Nube AES", () => {
  it("permite a admin guardar y leer rootFolderId", async () => {
    const db = auth("admin");
    const settingsRef = doc(db, "systemSettings", "drive");

    await assertSucceeds(
      setDoc(settingsRef, {
        rootFolderId: "drive-root-folder",
        updatedAt: Timestamp.now(),
      })
    );

    await assertSucceeds(getDoc(settingsRef));
  });

  it("bloquea systemSettings/drive a colaborador", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "systemSettings", "drive"), {
        rootFolderId: "drive-root-folder",
        updatedAt: Timestamp.now(),
      });
    });

    const db = auth("collab");

    await assertFails(getDoc(doc(db, "systemSettings", "drive")));
    await assertFails(
      setDoc(doc(db, "systemSettings", "drive"), {
        rootFolderId: "other-root-folder",
        updatedAt: Timestamp.now(),
      })
    );
  });

  it("permite systemSettings/drive a usuario con role admin aunque active no sea true", async () => {
    const db = auth("inactive");
    const settingsRef = doc(db, "systemSettings", "drive");

    await assertSucceeds(
      setDoc(settingsRef, {
        rootFolderId: "drive-root-folder",
        updatedAt: Timestamp.now(),
      })
    );

    await assertSucceeds(getDoc(settingsRef));
  });

  it("permite a admin leer mapa de carpeta por departamento", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "driveDepartmentFolders", "operations"), {
        departmentId: "operations",
        departmentName: "Operacion",
        folderId: "drive-folder-operations",
        folderName: "Operacion",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });

    await assertSucceeds(getDoc(doc(auth("admin"), "driveDepartmentFolders", "operations")));
  });

  it("bloquea mapa de carpeta por departamento a colaborador", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "driveDepartmentFolders", "operations"), {
        departmentId: "operations",
        departmentName: "Operacion",
        folderId: "drive-folder-operations",
        folderName: "Operacion",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });

    await assertFails(getDoc(doc(auth("collab"), "driveDepartmentFolders", "operations")));
  });
});

describe("mensajeria departamental", () => {
  it("permite a un miembro del departamento enviar mensaje", async () => {
    await assertSucceeds(
      setDoc(doc(auth("deptmember"), "departmentMessages", "msg-member"), validDepartmentMessage({
        message: "Archivo adjunto",
        attachments: [{
          name: "manual.pdf",
          url: "https://firebasestorage.googleapis.com/manual.pdf",
          path: "dashboard/departmentMessages/dept-ops/deptmember/msg-member/manual.pdf",
          contentType: "application/pdf",
          size: 1024,
          type: "document",
          source: "",
        }],
      }))
    );
  });

  it("permite al administrador principal enviar mensaje aunque no pertenezca al departamento", async () => {
    await assertSucceeds(
      setDoc(
        doc(auth("admin"), "departmentMessages", "msg-admin"),
        validDepartmentMessage({
          fromUserId: "admin",
          fromUserName: "Admin",
          fromUserEmail: "admin@test.local",
          memberIds: ["admin"],
          readBy: { admin: Timestamp.now() },
        })
      )
    );
  });

  it("permite a un segundo admin con role mal formateado (mayusculas/espacios) enviar mensaje", async () => {
    await assertSucceeds(
      setDoc(
        doc(auth("admin2"), "departmentMessages", "msg-admin2"),
        validDepartmentMessage({
          fromUserId: "admin2",
          fromUserName: "Admin Two",
          fromUserEmail: "admin2@test.local",
          memberIds: ["admin2"],
          readBy: { admin2: Timestamp.now() },
        })
      )
    );
  });

  it("bloquea a un colaborador ajeno al departamento", async () => {
    await assertFails(
      setDoc(
        doc(auth("outsider"), "departmentMessages", "msg-outsider"),
        validDepartmentMessage({
          fromUserId: "outsider",
          fromUserName: "Outsider",
          fromUserEmail: "outsider@test.local",
          memberIds: ["outsider"],
          readBy: { outsider: Timestamp.now() },
        })
      )
    );
  });

  it("bloquea leer mensajes de un departamento ajeno, permite a miembro y a admin", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "departmentMessages", "msg-seeded"), validDepartmentMessage());
    });

    await assertFails(getDoc(doc(auth("outsider"), "departmentMessages", "msg-seeded")));
    await assertSucceeds(getDoc(doc(auth("deptmember"), "departmentMessages", "msg-seeded")));
    await assertSucceeds(getDoc(doc(auth("admin"), "departmentMessages", "msg-seeded")));
  });

  it("revoca lectura inmediatamente aunque el UID permanezca en mensajes historicos", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "departmentMessages", "msg-revoked"), validDepartmentMessage());
    });

    const activeMembershipQuery = query(
      collection(auth("deptmember"), "departmentMessages"),
      where("memberIds", "array-contains", "deptmember"),
      where("departmentId", "==", "dept-ops")
    );
    await assertSucceeds(getDocs(activeMembershipQuery));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "users", "deptmember"), {
        area: "Otra área",
        department: "Otra área",
        departmentName: "Otra área",
        departmentIds: ["dept-other"],
        departmentNames: ["Otra área"],
        primaryDepartmentId: "dept-other",
      });
    });

    await assertFails(getDoc(doc(auth("deptmember"), "departmentMessages", "msg-revoked")));
    await assertFails(getDocs(activeMembershipQuery));
    await assertSucceeds(getDoc(doc(auth("admin"), "departmentMessages", "msg-revoked")));
  });

  it("bloquea a un usuario inactivo aunque tenga role admin", async () => {
    await assertFails(
      setDoc(
        doc(auth("inactive"), "departmentMessages", "msg-inactive"),
        validDepartmentMessage({
          fromUserId: "inactive",
          fromUserName: "Inactive",
          fromUserEmail: "inactive@test.local",
          memberIds: ["inactive"],
          readBy: { inactive: Timestamp.now() },
        })
      )
    );
  });
});

describe("eliminacion global de mensajes", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "internalMessages", "msg-direct-delete"), validInternalMessage()),
        setDoc(doc(db, "departmentMessages", "msg-department-delete"), validDepartmentMessage()),
      ]);
    });
  });

  it("permite a admin eliminar mensajes directos y departamentales", async () => {
    await assertSucceeds(deleteDoc(doc(auth("admin"), "internalMessages", "msg-direct-delete")));
    await assertSucceeds(deleteDoc(doc(auth("admin"), "departmentMessages", "msg-department-delete")));
  });

  it("bloquea a no admin eliminar mensajes propios o ajenos", async () => {
    await assertFails(deleteDoc(doc(auth("collab"), "internalMessages", "msg-direct-delete")));
    await assertFails(deleteDoc(doc(auth("requester"), "internalMessages", "msg-direct-delete")));
    await assertFails(deleteDoc(doc(auth("deptmember"), "departmentMessages", "msg-department-delete")));
  });

  it("bloquea a admin inactivo", async () => {
    await assertFails(deleteDoc(doc(auth("inactive"), "internalMessages", "msg-direct-delete")));
  });
});

describe("editor editorial", () => {
  it("permite crear proyecto con documento y página inicial en un batch", async () => {
    const db = auth("collab");
    const projectRef = doc(db, "editorialProjects", "editorial-new");
    const documentRef = doc(projectRef, "documents", "document-main");
    const pageRef = doc(documentRef, "pages", "page-1");
    const batch = writeBatch(db);

    batch.set(projectRef, {
      name: "Explore A2",
      type: "book",
      size: "8x10",
      orientation: "portrait",
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
      bleedIn: 0.125,
      widthIn: 8,
      heightIn: 10,
      ownerUid: "collab",
      collaboratorUids: [],
      archived: false,
      status: "active",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    batch.set(documentRef, {
      name: "Documento principal",
      position: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    batch.set(pageRef, {
      name: "Página 1",
      number: 1,
      position: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await assertSucceeds(batch.commit());
  });

  it("limita lectura y listado a dueño, colaborador y admin", async () => {
    await assertSucceeds(getDoc(doc(auth("collab"), "editorialProjects", "editorial-owned")));
    await assertSucceeds(getDoc(doc(auth("collab"), "editorialProjects", "editorial-shared")));
    await assertSucceeds(getDoc(doc(auth("admin"), "editorialProjects", "editorial-owned")));
    await assertFails(getDoc(doc(auth("outsider"), "editorialProjects", "editorial-owned")));

    await assertSucceeds(
      getDocs(query(collection(auth("collab"), "editorialProjects"), where("ownerUid", "==", "collab")))
    );
    await assertSucceeds(
      getDocs(query(collection(auth("collab"), "editorialProjects"), where("collaboratorUids", "array-contains", "collab")))
    );
    await assertFails(getDocs(collection(auth("collab"), "editorialProjects")));
    await assertSucceeds(getDocs(collection(auth("admin"), "editorialProjects")));
  });

  it("permite actualizar al miembro pero eliminar solo a dueño o admin", async () => {
    await assertSucceeds(
      updateDoc(doc(auth("collab"), "editorialProjects", "editorial-shared"), {
        name: "Guía compartida actualizada",
        academicType: "teacher_guide",
        seriesId: "explore",
        levelId: "a2",
        bookId: "student-book",
        unitNumber: 3,
        lessonNumber: 2,
        academicMetadata: { seriesId: "explore", levelId: "a2", bookId: "student-book", unitNumber: 3, lessonNumber: 2 },
        updatedAt: Timestamp.now(),
      })
    );
    await assertFails(deleteDoc(doc(auth("collab"), "editorialProjects", "editorial-shared")));
    await assertSucceeds(deleteDoc(doc(auth("collab"), "editorialProjects", "editorial-owned")));
  });

  it("bloquea crear a usuario inactivo o suplantar ownerUid", async () => {
    const payload = {
      name: "Proyecto inválido",
      type: "book",
      size: "8x10",
      orientation: "portrait",
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
      bleedIn: 0.125,
      ownerUid: "admin",
      collaboratorUids: [],
      archived: false,
      status: "active",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await assertFails(setDoc(doc(auth("inactive"), "editorialProjects", "inactive-create"), payload));
    await assertFails(setDoc(doc(auth("collab"), "editorialProjects", "spoofed-owner"), payload));
  });

  it("protege documentos, páginas y elementos por membresía del proyecto", async () => {
    const pageRef = doc(auth("collab"), "editorialProjects", "editorial-owned", "documents", "doc-1", "pages", "page-1");
    await assertSucceeds(setDoc(pageRef, { name: "Página 1", number: 1, position: 0 }));
    await assertSucceeds(setDoc(doc(pageRef, "elements", "element-1"), {
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: false,
      visible: true,
      visibilityMode: "teacher",
      content: "Título",
      academicGroupId: "exercise-1",
      exerciseData: { type: "multiple_choice", options: ["A", "B"], correctOption: 1 },
      answerData: { type: "multiple_choice", value: "B", acceptedValues: [], explanation: "" },
      style: {},
    }));
    await assertFails(getDoc(doc(auth("outsider"), "editorialProjects", "editorial-owned", "documents", "doc-1", "pages", "page-1")));
  });

  it("Fase 7: publicar requiere capacidad publisher/manager/propietario/admin", async () => {
    const publication = {
      documentId: "doc-1",
      status: "published",
      revision: 1,
      variant: "student",
      versionId: "v1",
      versionStoragePath: "editorial/editorial-perms/versions/collab/doc-1-v1.json",
      pageCount: 4,
      exports: [{ exportId: "e1", storagePath: "editorial/editorial-perms/exports/collab/e1.pdf", downloadUrl: "https://x/e1.pdf" }],
      publishedByUid: "collab",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    const pubPath = ["editorialProjects", "editorial-perms", "documents", "doc-1", "publications", "pub-1"];
    // publisher y propietario pueden publicar
    await assertSucceeds(setDoc(doc(auth("collab"), ...pubPath), publication));
    await assertSucceeds(setDoc(doc(auth("requester"), ...pubPath), { ...publication, publishedByUid: "requester" }));
    // viewer y content_editor NO pueden publicar
    await assertFails(setDoc(doc(auth("deptmember"), ...pubPath), { ...publication, publishedByUid: "deptmember" }));
    await assertFails(setDoc(doc(auth("tech"), ...pubPath), { ...publication, publishedByUid: "tech" }));
    // lectura permitida a cualquier miembro; delete bloqueado (inmutable)
    await assertSucceeds(getDoc(doc(auth("deptmember"), ...pubPath)));
    await assertFails(deleteDoc(doc(auth("collab"), ...pubPath)));
  });

  it("Fase 7: viewer no puede escribir contenido; content_editor sí", async () => {
    const viewerPage = doc(auth("deptmember"), "editorialProjects", "editorial-perms", "documents", "doc-1", "pages", "vp-1");
    const editorPage = doc(auth("tech"), "editorialProjects", "editorial-perms", "documents", "doc-1", "pages", "ep-1");
    await assertFails(setDoc(viewerPage, { name: "P", number: 1, position: 0 }));
    await assertSucceeds(setDoc(editorPage, { name: "P", number: 1, position: 0 }));
    // viewer puede leer y descargar (lectura permitida)
    await assertSucceeds(getDoc(doc(auth("deptmember"), "editorialProjects", "editorial-perms")));
  });

  it("protege secciones editoriales por membresía del proyecto", async () => {
    const sectionRef = doc(auth("collab"), "editorialProjects", "editorial-owned", "documents", "doc-1", "sections", "section-1");
    await assertSucceeds(setDoc(sectionRef, {
      name: "Unidad 1",
      type: "unit",
      order: 0,
      numberingStyle: "arabic",
      numberingStart: 1,
      startOnRight: true,
      collapsed: false,
    }));
    await assertFails(getDoc(doc(auth("outsider"), "editorialProjects", "editorial-owned", "documents", "doc-1", "sections", "section-1")));
  });

  it("protege maestras, componentes, estilos y variables editoriales", async () => {
    const ownerDb = auth("collab");
    const masterRef = doc(ownerDb, "editorialProjects", "editorial-owned", "documents", "doc-1", "masterPages", "master-1");
    await assertSucceeds(setDoc(masterRef, { name: "Maestra izquierda", side: "left", order: 0 }));
    await assertSucceeds(setDoc(doc(masterRef, "elements", "element-1"), { type: "text", content: "{{page.number}}", style: {} }));
    const componentRef = doc(ownerDb, "editorialProjects", "editorial-owned", "components", "component-1");
    await assertSucceeds(setDoc(componentRef, { name: "Encabezado", category: "General" }));
    await assertSucceeds(setDoc(doc(componentRef, "elements", "element-1"), { type: "shape", style: {} }));
    await assertSucceeds(setDoc(doc(ownerDb, "editorialProjects", "editorial-owned", "styles", "style-1"), { name: "Título", type: "text", properties: {} }));
    await assertSucceeds(setDoc(doc(ownerDb, "editorialProjects", "editorial-owned", "variables", "variable-1"), { key: "custom.level", value: "A2" }));
    await assertFails(getDoc(doc(auth("outsider"), "editorialProjects", "editorial-owned", "components", "component-1")));
  });

  it("protege comentarios, versiones y exportaciones editoriales", async () => {
    const ownerDb = auth("collab");
    const base = ["editorialProjects", "editorial-owned", "documents", "doc-1"];
    await assertSucceeds(setDoc(doc(ownerDb, ...base, "comments", "comment-1"), { pageId: "page-1", message: "Revisar", status: "open" }));
    await assertSucceeds(setDoc(doc(ownerDb, ...base, "versions", "version-1"), { name: "v1", versionNumber: 1, storagePath: "editorial/editorial-owned/versions/collab/v1.json" }));
    await assertSucceeds(setDoc(doc(ownerDb, ...base, "exports", "export-1"), { type: "review", variant: "student", status: "processing" }));
    await assertFails(getDoc(doc(auth("outsider"), ...base, "comments", "comment-1")));
    await assertFails(setDoc(doc(auth("outsider"), ...base, "exports", "external"), { type: "review" }));
  });

  it("permite plantillas privadas al proyecto e institucionales solo a admin", async () => {
    const privateRef = doc(auth("collab"), "editorialTemplates", "private-template");
    await assertSucceeds(setDoc(privateRef, { name: "Unidad", visibility: "project", projectId: "editorial-owned", ownerUid: "collab" }));
    await assertSucceeds(setDoc(doc(privateRef, "pages", "page-1"), { name: "Página", order: 0 }));
    await assertFails(getDoc(doc(auth("outsider"), "editorialTemplates", "private-template")));
    const institutionalRef = doc(auth("admin"), "editorialTemplates", "institutional-template");
    await assertSucceeds(setDoc(institutionalRef, { name: "Institucional", visibility: "institutional", projectId: "editorial-owned", ownerUid: "admin" }));
    await assertSucceeds(getDoc(doc(auth("outsider"), "editorialTemplates", "institutional-template")));
    await assertFails(updateDoc(privateRef, { visibility: "institutional" }));
  });
});

describe("correcciones de material", () => {
  it("solo admin y Desarrollo de Material pueden leer bandeja y subcolecciones", async () => {
    await assertSucceeds(getDoc(doc(auth("admin"), "materialCorrectionReports", "material-report-1")));
    await assertSucceeds(getDoc(doc(auth("material"), "materialCorrectionReports", "material-report-1")));
    await assertSucceeds(getDoc(doc(
      auth("material"),
      "materialCorrectionReports",
      "material-report-1",
      "comments",
      "comment-1"
    )));
    await assertFails(getDoc(doc(auth("outsider"), "materialCorrectionReports", "material-report-1")));
    await assertFails(getDoc(doc(unauth(), "materialCorrectionReports", "material-report-1")));
  });

  it("bloquea escrituras directas incluso a admin y colaborador autorizado", async () => {
    await assertFails(updateDoc(
      doc(auth("admin"), "materialCorrectionReports", "material-report-1"),
      { status: "completed" }
    ));
    await assertFails(updateDoc(
      doc(auth("material"), "materialCorrectionReports", "material-report-1"),
      { priority: "urgent" }
    ));
    await assertFails(setDoc(
      doc(auth("material"), "materialCorrectionReports", "material-report-1", "comments", "direct"),
      { message: "Sin función" }
    ));
    await assertFails(deleteDoc(
      doc(auth("admin"), "materialCorrectionReports", "material-report-1")
    ));
    await assertFails(deleteDoc(
      doc(auth("material"), "materialCorrectionReports", "material-report-1")
    ));
  });

  it("protege contadores y rate limits contra lectura o escritura cliente", async () => {
    await assertFails(getDoc(doc(auth("admin"), "materialCorrectionCounters", "2026")));
    await assertFails(setDoc(doc(auth("admin"), "materialCorrectionCounters", "2026"), {
      lastSequence: 9,
    }));
    await assertFails(getDoc(doc(auth("material"), "materialCorrectionRateLimits", "rate")));
  });
});

describe("preferencias del dashboard ejecutivo", () => {
  const layout = [{ id: "kpi-overview", type: "kpi", w: 12, settings: {} }];

  it("permite guardar y leer únicamente el diseño propio", async () => {
    const ownRef = doc(auth("admin"), "userDashboardPreferences", "admin");
    await assertSucceeds(setDoc(ownRef, {
      ownerUid: "admin",
      version: 1,
      layout,
      updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(getDoc(ownRef));
    await assertFails(getDoc(doc(auth("collab"), "userDashboardPreferences", "admin")));
  });

  it("bloquea escribir preferencias ajenas o cambiar propietario", async () => {
    await assertFails(setDoc(doc(auth("collab"), "userDashboardPreferences", "admin"), {
      ownerUid: "admin",
      version: 1,
      layout,
      updatedAt: Timestamp.now(),
    }));
    const ownRef = doc(auth("admin"), "userDashboardPreferences", "admin");
    await assertSucceeds(setDoc(ownRef, {
      ownerUid: "admin",
      version: 1,
      layout,
      updatedAt: Timestamp.now(),
    }));
    await assertFails(updateDoc(ownRef, {
      ownerUid: "collab",
      updatedAt: Timestamp.now(),
    }));
  });
});

describe("storage", () => {
  it("permite adjunto departamental con MIME genérico solo al miembro autenticado", async () => {
    const memberFile = storageAuth("deptmember").ref(
      "dashboard/departmentMessages/dept-ops/deptmember/message-generic/source.bin"
    );
    await assertSucceeds(memberFile.putString("contenido", "raw", {
      contentType: "application/octet-stream",
      customMetadata: { uploadedBy: "deptmember", originalName: "source.bin" },
    }));
    await assertSucceeds(memberFile.getDownloadURL());
    await assertFails(
      storageAuth("outsider").ref(
        "dashboard/departmentMessages/dept-ops/outsider/message-outsider/source.bin"
      ).putString("contenido", "raw", {
        contentType: "application/octet-stream",
        customMetadata: { uploadedBy: "outsider", originalName: "source.bin" },
      })
    );
    await assertFails(
      storageAuth("deptmember").ref(
        "dashboard/departmentMessages/dept-other/deptmember/message-other/source.bin"
      ).putString("contenido", "raw", {
        contentType: "application/octet-stream",
        customMetadata: { uploadedBy: "deptmember", originalName: "source.bin" },
      })
    );
  });

  it("bloquea UID de metadata distinto al usuario autenticado", async () => {
    await assertFails(
      storageAuth("deptmember").ref(
        "dashboard/departmentMessages/dept-ops/deptmember/message-spoof/source.bin"
      ).putString("contenido", "raw", {
        contentType: "application/octet-stream",
        customMetadata: { uploadedBy: "outsider", originalName: "source.bin" },
      })
    );
  });

  it("protege lectura del adjunto y revoca acceso al salir del departamento", async () => {
    const path = "dashboard/departmentMessages/dept-ops/deptmember/message-protected/manual.pdf";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "departmentMessages", "message-protected"),
        validDepartmentMessage({ memberIds: ["deptmember", "outsider"] })
      );
      await context.storage().ref(path).putString("%PDF-1.4", "raw", {
        contentType: "application/pdf",
        customMetadata: { uploadedBy: "deptmember", originalName: "manual.pdf" },
      });
    });

    await assertSucceeds(storageAuth("deptmember").ref(path).getDownloadURL());
    await assertFails(storageAuth("outsider").ref(path).getDownloadURL());

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "users", "deptmember"), {
        area: "Otra área",
        departmentIds: ["dept-other"],
        primaryDepartmentId: "dept-other",
      });
    });
    await assertFails(storageAuth("deptmember").ref(path).getDownloadURL());
  });

  it("protege archivos Active Classroom por rol y publicación", async () => {
    const resourceId = "storage-resource";
    const path = `active-classroom/resources/${resourceId}/guia.pdf`;
    const adminFile = storageAuth("admin").ref(path);

    await assertSucceeds(
      adminFile.putString("%PDF-1.4", "raw", { contentType: "application/pdf" })
    );
    await assertFails(
      storageAuth("collab").ref(`active-classroom/resources/forged/recurso.pdf`)
        .putString("%PDF-1.4", "raw", { contentType: "application/pdf" })
    );
    await assertFails(storageAuth("collab").ref(path).getDownloadURL());

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "activeClassroomResources", resourceId),
        validActiveClassroomResource(resourceId, { published: true })
      );
    });

    await assertSucceeds(storageAuth("collab").ref(path).getDownloadURL());
    await assertFails(storageAuth("inactive").ref(path).getDownloadURL());
  });

  it("bloquea extensiones no permitidas en Active Classroom", async () => {
    await assertFails(
      storageAuth("admin").ref("active-classroom/resources/code/script.exe")
        .putString("binary", "raw", { contentType: "application/octet-stream" })
    );
  });

  it("protege evidencias de correcciones y bloquea toda escritura directa", async () => {
    const path = "public-material-corrections/material-report-1/evidences/evidence-1.pdf";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(path).putString("%PDF-1.4", "raw", {
        contentType: "application/pdf",
      });
    });

    await assertSucceeds(storageAuth("material").ref(path).getDownloadURL());
    await assertSucceeds(storageAuth("admin").ref(path).getDownloadURL());
    await assertFails(storageAuth("outsider").ref(path).getDownloadURL());
    await assertFails(
      storageAuth("material").ref(
        "public-material-corrections/material-report-1/evidences/direct.pdf"
      ).putString("%PDF-1.4", "raw", { contentType: "application/pdf" })
    );
  });

  it("permite fuentes editoriales autorizadas solo a editores del proyecto", async () => {
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-owned/fonts/collab/aes-sans.woff2")
        .putString("font", "raw", { contentType: "font/woff2" })
    );
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-owned/fonts/collab/aes-serif.ttf")
        .putString("font", "raw", { contentType: "application/octet-stream" })
    );
    await assertFails(
      storageAuth("outsider").ref("editorial/editorial-owned/fonts/outsider/ajena.ttf")
        .putString("font", "raw", { contentType: "font/ttf" })
    );
    await assertFails(
      storageAuth("collab").ref("editorial/editorial-owned/fonts/collab/falsa.exe")
        .putString("code", "raw", { contentType: "font/ttf" })
    );
  });

  it("protege recursos editoriales por membresía y tipo de archivo", async () => {
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-owned/images/collab/portada.png")
        .putString("image", "raw", { contentType: "image/png" })
    );
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-shared/resources/collab/guia.pdf")
        .putString("%PDF", "raw", { contentType: "application/pdf" })
    );
    await assertFails(
      storageAuth("outsider").ref("editorial/editorial-owned/images/outsider/ajena.png")
        .putString("image", "raw", { contentType: "image/png" })
    );
    await assertFails(
      storageAuth("collab").ref("editorial/editorial-owned/scripts/collab/recurso.js")
        .putString("code", "raw", { contentType: "text/javascript" })
    );
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-owned/exports/collab/revision.pdf")
        .putString("%PDF", "raw", { contentType: "application/pdf" })
    );
    await assertSucceeds(
      storageAuth("collab").ref("editorial/editorial-owned/versions/collab/version.json")
        .putString("{}", "raw", { contentType: "application/json" })
    );
    await assertFails(
      storageAuth("outsider").ref("editorial/editorial-owned/versions/outsider/version.json")
        .putString("{}", "raw", { contentType: "application/json" })
    );
  });

  it("protege imágenes independientes de plantillas editoriales", async () => {
    await assertSucceeds(setDoc(doc(auth("collab"), "editorialTemplates", "storage-template"), {
      name: "Plantilla privada", visibility: "project", projectId: "editorial-owned", ownerUid: "collab",
    }));
    await assertSucceeds(
      storageAuth("collab").ref("editorialTemplates/storage-template/collab/imagen.png")
        .putString("image", "raw", { contentType: "image/png" })
    );
    await assertFails(
      storageAuth("outsider").ref("editorialTemplates/storage-template/outsider/imagen.png")
        .putString("image", "raw", { contentType: "image/png" })
    );
  });

  it("permite a admin subir imagen base de plantilla de certificado", async () => {
    const fileRef = storageAuth("admin").ref(
      "printshop/certificate-templates/admin/smile-6.png"
    );

    await assertSucceeds(
      fileRef.putString("template", "raw", { contentType: "image/png" })
    );
  });

  it("bloquea subir imagen base de plantilla a usuario no administrador", async () => {
    const fileRef = storageAuth("printer").ref(
      "printshop/certificate-templates/printer/smile-6.png"
    );

    await assertFails(
      fileRef.putString("template", "raw", { contentType: "image/png" })
    );
  });

  it("permite administrar fotografía WebP de insumo con permisos de Imprenta", async () => {
    const fileRef = storageAuth("printer").ref(
      "printshop/supplies/supply-1/product-image.webp"
    );

    await assertSucceeds(
      fileRef.putString("webp", "raw", { contentType: "image/webp" })
    );
    await assertSucceeds(fileRef.getDownloadURL());
    await assertSucceeds(fileRef.delete());
  });

  it("bloquea fotografías de insumos con formato, ruta o permisos inválidos", async () => {
    await assertFails(
      storageAuth("printer").ref("printshop/supplies/supply-1/product-image.webp")
        .putString("png", "raw", { contentType: "image/png" })
    );
    await assertFails(
      storageAuth("printer").ref("printshop/supplies/supply-1/otra-imagen.webp")
        .putString("webp", "raw", { contentType: "image/webp" })
    );
    await assertFails(
      storageAuth("tech").ref("printshop/supplies/supply-1/product-image.webp")
        .putString("webp", "raw", { contentType: "image/webp" })
    );
    await assertFails(
      storageAuth("outsider").ref("printshop/supplies/supply-1/product-image.webp")
        .putString("webp", "raw", { contentType: "image/webp" })
    );
  });

  it("impide subir evidencia a proyecto ajeno", async () => {
    const storage = storageAuth("requester");
    const fileRef = storage.ref("evidence/other-project/requester/proof.txt");

    await assertFails(fileRef.putString("proof", "raw", { contentType: "text/plain" }));
  });

  it("permite subir evidencia a proyecto asignado", async () => {
    const storage = storageAuth("collab");
    const fileRef = storage.ref("evidence/owned-project/collab/proof.txt");

    await assertSucceeds(fileRef.putString("proof", "raw", { contentType: "text/plain" }));
  });

  it("permite subir TXT con MIME generico a proyecto asignado", async () => {
    const storage = storageAuth("collab");
    const fileRef = storage.ref("evidence/owned-project/collab/notas.txt");

    await assertSucceeds(fileRef.putString("notas", "raw", { contentType: "application/octet-stream" }));
  });

  it("permite subir audio y video a proyecto asignado", async () => {
    const storage = storageAuth("collab");

    await assertSucceeds(
      storage.ref("evidence/owned-project/collab/avance.webm")
        .putString("audio", "raw", { contentType: "audio/webm" })
    );
    await assertSucceeds(
      storage.ref("evidence/owned-project/collab/avance.mp4")
        .putString("video", "raw", { contentType: "video/mp4" })
    );
  });

  it("bloquea multimedia con extension o MIME no permitido", async () => {
    const storage = storageAuth("collab");

    await assertFails(
      storage.ref("evidence/owned-project/collab/avance.exe")
        .putString("audio", "raw", { contentType: "audio/webm" })
    );
    await assertFails(
      storage.ref("evidence/owned-project/collab/avance.mp4")
        .putString("script", "raw", { contentType: "application/javascript" })
    );
  });

  it("bloquea extension no permitida como evidencia de proyecto", async () => {
    const storage = storageAuth("collab");
    const fileRef = storage.ref("evidence/owned-project/collab/proof.exe");

    await assertFails(fileRef.putString("proof", "raw", { contentType: "application/octet-stream" }));
  });

  it("permite al colaborador de apoyo subir PDF de certificado", async () => {
    const storage = storageAuth("collab");
    const fileRef = storage.ref("printshop/generated-certificates/cert-request-1/2026/certificado-apoyo.pdf");

    await assertSucceeds(fileRef.putString("%PDF-1.4", "raw", { contentType: "application/pdf" }));
  });

  it("bloquea subir PDF de certificado a colaborador no asignado", async () => {
    const storage = storageAuth("requester");
    const fileRef = storage.ref("printshop/generated-certificates/cert-request-1/2026/certificado-ajeno.pdf");

    await assertFails(fileRef.putString("%PDF-1.4", "raw", { contentType: "application/pdf" }));
  });

  it("protege las imagenes de herramientas por area, tipo y ruta", async () => {
    const toolImage = storageAuth("tech").ref("support/tools/tool-1/main-image/tool.webp");
    await assertSucceeds(toolImage.putString("webp", "raw", { contentType: "image/webp" }));
    await assertSucceeds(toolImage.getDownloadURL());
    await assertFails(
      storageAuth("requester").ref("support/tools/tool-1/main-image/other.webp")
        .putString("webp", "raw", { contentType: "image/webp" })
    );
    await assertFails(
      storageAuth("tech").ref("support/tools/tool-1/main-image/tool.exe")
        .putString("binary", "raw", { contentType: "application/octet-stream" })
    );
    await assertSucceeds(toolImage.delete());
  });
});
