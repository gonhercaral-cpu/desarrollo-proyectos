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
});
