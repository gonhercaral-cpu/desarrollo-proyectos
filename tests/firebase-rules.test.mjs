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
    category: "Proceso",
    currentProblem: "Muchos pasos manuales.",
    proposedIdea: "Automatizar revisión.",
    expectedBenefit: "Menos errores.",
    evidenceFiles: [],
    evidenceCount: 0,
    status: "nueva",
    createdByUid: "requester",
    createdByName: "Requester",
    createdByEmail: "requester@test.local",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
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
    validationUrl: "https://active-english-school.web.app/validar-certificado/CERT-2026-A1-0001-001-ABC123",
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
    validationUrl: "https://active-english-school.web.app/validar-certificado/CERT-2026-A1-0001-001-ABC123",
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
          validationUrl: `https://active-english-school.web.app/validar-certificado/${certificateId}`,
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
          validationUrl: `https://active-english-school.web.app/validar-certificado/${certificateId}`,
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
      setDoc(doc(auth("deptmember"), "departmentMessages", "msg-member"), validDepartmentMessage())
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

describe("storage", () => {
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
});
