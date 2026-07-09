import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getStorage, ref, uploadString } from "firebase/storage";

const PROJECT_ID = "security-rules-audit";

let testEnv;

function auth(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function storageAuth(uid) {
  return getStorage(testEnv.authenticatedContext(uid).app);
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
        responsibleUid: "printer",
        responsibleName: "Printer",
        responsibleEmail: "printer@test.local",
        collaboratorUid: "collab",
        collaboratorName: "Collaborator",
        collaboratorEmail: "collab@test.local",
        status: "En producciÃ³n",
        students: [],
        deleted: false,
      }),
    ]);
  });
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

describe("certificados de imprenta", () => {
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

describe("storage", () => {
  it("impide subir evidencia a proyecto ajeno", async () => {
    const storage = storageAuth("requester");
    const fileRef = ref(storage, "evidence/other-project/requester/proof.txt");

    await assertFails(uploadString(fileRef, "proof", "raw", { contentType: "text/plain" }));
  });

  it("permite subir evidencia a proyecto asignado", async () => {
    const storage = storageAuth("collab");
    const fileRef = ref(storage, "evidence/owned-project/collab/proof.txt");

    await assertSucceeds(uploadString(fileRef, "proof", "raw", { contentType: "text/plain" }));
  });

  it("permite al colaborador de apoyo subir PDF de certificado", async () => {
    const storage = storageAuth("collab");
    const fileRef = ref(storage, "printshop/generated-certificates/cert-request-1/2026/certificado-apoyo.pdf");

    await assertSucceeds(uploadString(fileRef, "%PDF-1.4", "raw", { contentType: "application/pdf" }));
  });

  it("bloquea subir PDF de certificado a colaborador no asignado", async () => {
    const storage = storageAuth("requester");
    const fileRef = ref(storage, "printshop/generated-certificates/cert-request-1/2026/certificado-ajeno.pdf");

    await assertFails(uploadString(fileRef, "%PDF-1.4", "raw", { contentType: "application/pdf" }));
  });
});
