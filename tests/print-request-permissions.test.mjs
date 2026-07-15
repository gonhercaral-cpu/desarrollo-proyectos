import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  buildCanonicalPrintRequestAssignment,
  canManagePrintRequest,
  getPrintRequestMemberRole,
  normalizePrintRequestAssignments,
} from "../src/utils/printRequestPermissions.js";

const require = createRequire(import.meta.url);
const backendAssignments = require("../functions/printRequestAssignments.js");
const publicPrintRequest = require("../functions/publicPrintRequest.js");
const CREATED_AT = new Date("2026-07-14T19:00:00.000Z"); // 12:00, America/Tijuana.

function validPublicPayload(overrides = {}) {
  return {
    requesterId: "principal-requester",
    principalSignerId: "principal-director",
    teacherSignerId: "teacher-one",
    campus: "Plaza Estrella",
    requestedDeliveryDate: "2026-07-21",
    courseLevel: "A1 Journey",
    schedule: "Lunes 10:00",
    notes: "Entrega en recepción",
    students: [
      { name: "Ana Pérez", deliveryType: "Impreso", notes: "" },
      { name: "Luis López", deliveryType: "Digital", notes: "" },
    ],
    publicRequestSource: "certificate-public-form",
    ...overrides,
  };
}

function createSnapshot(id, data) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function createFakeDb(seed = {}) {
  const stores = new Map(
    Object.entries(seed).map(([name, documents]) => [name, new Map(Object.entries(documents || {}))])
  );
  let nextId = 1;

  function getStore(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  function queryApi(name, filters = [], maximum = Infinity) {
    return {
      where(field, operator, value) {
        assert.equal(operator, "==");
        return queryApi(name, [...filters, { field, value }], maximum);
      },
      limit(value) {
        return queryApi(name, filters, value);
      },
      async get() {
        const docs = [...getStore(name).entries()]
          .filter(([, data]) => filters.every((filter) => data?.[filter.field] === filter.value))
          .slice(0, maximum)
          .map(([id, data]) => createSnapshot(id, data));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  const db = {
    stores,
    collection(name) {
      return {
        ...queryApi(name),
        doc(id) {
          return {
            id,
            collectionName: name,
            async create(data) {
              if (getStore(name).has(id)) {
                const error = new Error("Document already exists");
                error.code = 6;
                throw error;
              }
              getStore(name).set(id, data);
            },
            async get() {
              return createSnapshot(id, getStore(name).get(id));
            },
          };
        },
        async add(data) {
          const id = `created-${nextId++}`;
          getStore(name).set(id, data);
          return { id };
        },
      };
    },
    async runTransaction(callback) {
      return callback({
        get: (reference) => reference.get(),
        update(reference, update) {
          const store = getStore(reference.collectionName);
          store.set(reference.id, { ...store.get(reference.id), ...update });
        },
      });
    },
  };
  return db;
}

function createAgendaSeed({ tonySchedule, ernestoSchedule, adjustments = {} } = {}) {
  return {
    systemSettings: {},
    users: {
      "collaborator-tony": {
        uid: "tony-auth-uid",
        name: "Antonio ‘Tony’ Campos",
        email: "tony@test.local",
        active: true,
      },
      "collaborator-ernesto": {
        uid: "ernesto-auth-uid",
        name: "Ernesto López",
        email: "ernesto@test.local",
        active: true,
      },
    },
    workSchedules: {
      "tony-auth-uid_tuesday": {
        userId: "tony-auth-uid",
        userName: "Tony C.",
        dayOfWeek: "tuesday",
        isActive: true,
        ...(tonySchedule || { startTime: "08:00", endTime: "17:00", isRestDay: false }),
      },
      "ernesto-auth-uid_tuesday": {
        userId: "ernesto-auth-uid",
        userName: "Ernesto",
        dayOfWeek: "tuesday",
        isActive: true,
        ...(ernestoSchedule || { startTime: "", endTime: "", isRestDay: true }),
      },
    },
    scheduleAdjustments: adjustments,
    printRequests: {},
  };
}

describe("permisos de solicitudes de Imprenta", () => {
  it("maneja solicitudes null sin bloquear la vista ni conceder permisos", () => {
    assert.deepEqual(normalizePrintRequestAssignments(null), {
      assignedUserId: "",
      assignedUserName: "",
      supportUserId: "",
      supportUserName: "",
      supportUserIds: [],
    });
    assert.equal(canManagePrintRequest("tony-uid", null), false);
    assert.equal(getPrintRequestMemberRole("tony-uid", null), "viewer");
  });

  it("ignora valores de asignación incompletos y conserva UIDs válidos", () => {
    const request = {
      assignedUserId: null,
      assignedUserName: null,
      responsibleUid: "tony-uid",
      supportUserId: undefined,
      supportCollaborators: [null, {}, { uid: "ernesto-uid" }],
      collaboratorName: "Ernesto",
    };

    assert.deepEqual(normalizePrintRequestAssignments(request), {
      assignedUserId: "tony-uid",
      assignedUserName: "",
      supportUserId: "ernesto-uid",
      supportUserName: "Ernesto",
      supportUserIds: ["ernesto-uid"],
    });
    assert.equal(getPrintRequestMemberRole("tony-uid", request), "responsible");
    assert.equal(getPrintRequestMemberRole("ernesto-uid", request), "collaborator");
    assert.equal(getPrintRequestMemberRole("otro-uid", request), "viewer");
  });

  it("autoriza admin, responsable y apoyo solo por UID", () => {
    const request = {
      assignedUserId: "tony-uid",
      supportUserId: "ernesto-uid",
      responsibleName: "Nombre duplicado",
      collaboratorEmail: "duplicado@test.local",
    };

    assert.equal(canManagePrintRequest("tony-uid", request), true);
    assert.equal(canManagePrintRequest("ernesto-uid", request), true);
    assert.equal(canManagePrintRequest("otro-uid", request), false);
    assert.equal(canManagePrintRequest("otro-uid", request, true), true);
    assert.equal(getPrintRequestMemberRole("tony-uid", request), "responsible");
    assert.equal(getPrintRequestMemberRole("ernesto-uid", request), "collaborator");
  });

  it("normaliza UIDs y snapshots históricos sin autorizar por nombre", () => {
    const request = {
      productionAssigneeUid: "principal-historico",
      supportCollaboratorIds: ["apoyo-historico"],
      responsibleName: "otro-uid",
    };

    assert.deepEqual(normalizePrintRequestAssignments(request), {
      assignedUserId: "principal-historico",
      assignedUserName: "otro-uid",
      supportUserId: "apoyo-historico",
      supportUserName: "",
      supportUserIds: ["apoyo-historico"],
    });
    assert.equal(canManagePrintRequest("otro-uid", request), false);
    assert.equal(canManagePrintRequest("apoyo-historico", request), true);
  });

  it("construye campos canónicos, snapshots y espejos históricos", () => {
    assert.deepEqual(
      buildCanonicalPrintRequestAssignment("tony-uid", "ernesto-uid", "Tony", "Ernesto"),
      {
        assignedUserId: "tony-uid",
        assignedUserName: "Tony",
        supportUserId: "ernesto-uid",
        supportUserName: "Ernesto",
        responsibleUid: "tony-uid",
        collaboratorUid: "ernesto-uid",
      }
    );
  });
});

describe("entrada pública confiable de certificados", () => {
  it("acepta Smile 6 y conserva sus campos canónicos", () => {
    const result = publicPrintRequest.sanitizePublicPrintRequest(
      validPublicPayload({ courseLevel: "Smile 6" }),
      CREATED_AT
    );

    assert.equal(result.courseLevel, "Smile 6");
    assert.equal(result.level, "Smile 6");
    assert.equal(result.group, "Smile 6");
    assert.equal(result.courseProgramName, "Smile 6");
    assert.equal(result.courseAudience, "Kids");
  });

  it("calcula en servidor folio, estado, cantidades y campos internos", () => {
    const result = publicPrintRequest.sanitizePublicPrintRequest(validPublicPayload(), CREATED_AT);
    assert.match(result.folio, /^CERT-2026-[A-F0-9]{10}$/);
    assert.equal(result.status, "Solicitud recibida");
    assert.equal(result.requestedQuantity, 2);
    assert.equal(result.printedQuantity, 1);
    assert.equal(result.digitalQuantity, 1);
    assert.equal(result.deliveryType, "Ambas");
    assert.equal(result.requestDate, "2026-07-14");
    assert.equal(result.students[0].certificateFolio, "");
    assert.match(result.students[0].id, /^student-/);
  });

  it("ignora folio, estado, asignaciones y plantilla enviados por cliente", () => {
    const result = publicPrintRequest.sanitizePublicPrintRequest(validPublicPayload({
      folio: "FOLIO-CLIENTE",
      status: "Entregada",
      assignedUserId: "uid-inventado",
      supportUserId: "uid-inventado-2",
      assignmentSource: "cliente",
      certificateTemplateId: "template-inventada",
      certificateTemplateName: "Plantilla manipulada",
      templateId: "otra-template",
    }), CREATED_AT);
    assert.notEqual(result.folio, "FOLIO-CLIENTE");
    assert.equal(result.status, "Solicitud recibida");
    assert.equal(result.assignedUserId, undefined);
    assert.equal(result.supportUserId, undefined);
    assert.equal(result.assignmentSource, undefined);
    assert.equal(result.certificateTemplateId, undefined);
    assert.equal(result.certificateTemplateName, undefined);
    assert.equal(result.templateId, undefined);
  });

  it("limita alumnos, valores e identificadores", () => {
    assert.throws(
      () => publicPrintRequest.sanitizePublicPrintRequest(
        validPublicPayload({ students: Array.from({ length: 151 }, () => ({ name: "Alumno", deliveryType: "Impreso" })) }),
        CREATED_AT
      ),
      /Cantidad de alumnos/
    );
    assert.throws(
      () => publicPrintRequest.sanitizePublicPrintRequest(validPublicPayload({ campus: "Inventado" }), CREATED_AT),
      /Plantel inválido/
    );
    assert.throws(
      () => publicPrintRequest.sanitizePublicPrintRequest(validPublicPayload({ teacherSignerId: "../teacher" }), CREATED_AT),
      /Maestro no es válido/
    );
    assert.throws(
      () => publicPrintRequest.sanitizePublicPrintRequest(validPublicPayload({ ignoredPadding: "x".repeat(300000) }), CREATED_AT),
      /tamaño permitido/
    );
  });

  it("deriva un document ID idempotente del mismo envío", () => {
    const submissionId = "12345678-1234-4123-8123-123456789abc";
    const first = publicPrintRequest.createPublicRequestId(submissionId);
    const second = publicPrintRequest.createPublicRequestId(submissionId);
    assert.equal(first, second);
    assert.match(first, /^public-[a-f0-9]{40}$/);
  });

  it("deduplica doble clic del cliente anterior durante la misma ventana", () => {
    const clientKey = "127.0.0.1|https://sistema-desarrollo-proyectos.web.app|browser";
    const first = publicPrintRequest.createLegacyPublicRequestId(validPublicPayload(), clientKey, CREATED_AT);
    const second = publicPrintRequest.createLegacyPublicRequestId(validPublicPayload({
      folio: "otro-folio-generado-por-cliente",
      assignedUserId: "otro-uid",
    }), clientKey, new Date(CREATED_AT.getTime() + 1000));
    const changed = publicPrintRequest.createLegacyPublicRequestId(validPublicPayload({
      students: [{ name: "Alumno distinto", deliveryType: "Impreso" }],
    }), clientKey, CREATED_AT);
    assert.equal(first, second);
    assert.notEqual(first, changed);
    assert.match(first, /^public-legacy-[a-f0-9]{40}$/);
  });
});

describe("resolver único de Agenda y persistencia", () => {
  it("calcula fecha y hora exactas en America/Tijuana", () => {
    assert.deepEqual(
      backendAssignments.getLocalDateParts(new Date("2026-07-15T06:30:00.000Z")),
      { dateValue: "2026-07-14", dayKey: "tuesday", minute: 23 * 60 + 30 }
    );
  });

  it("flujos público e interno usan creación server-side única", () => {
    const publicSource = readFileSync("src/pages/PublicCertificateRequest.jsx", "utf8");
    const internalSource = readFileSync("src/pages/printshop.jsx", "utf8");
    assert.match(publicSource, /createPrintRequestWithAssignment\(publicRequestPayload/);
    assert.match(internalSource, /createPrintRequestWithAssignment\(creationPayload\)/);
    assert.doesNotMatch(publicSource, /addDoc\(collection\(db,\s*"printRequests"/);
    assert.doesNotMatch(internalSource, /addDoc\(collection\(db,\s*"printRequests"/);
    assert.doesNotMatch(publicSource, /certificateTemplateId|templateId|templateName/);
    assert.doesNotMatch(publicSource, /Plantilla (?:del|de) certificado/);
    assert.match(publicSource, /Enviar nueva solicitud/);
    assert.match(publicSource, /Copiar enlace de seguimiento/);
  });

  it("resuelve variantes de nombre y diferencia docId del UID de Auth", async () => {
    const result = await backendAssignments.resolvePrintshopAssignees(
      createFakeDb(createAgendaSeed()),
      CREATED_AT
    );
    assert.deepEqual(result, {
      assignedUserId: "tony-auth-uid",
      assignedUserName: "Antonio ‘Tony’ Campos",
      supportUserId: "ernesto-auth-uid",
      supportUserName: "Ernesto López",
      assignmentSource: "agenda:tony",
      assignmentFallbackReason: "",
    });
  });

  it("asigna Ernesto durante su turno y Tony como apoyo", async () => {
    const db = createFakeDb(createAgendaSeed({
      tonySchedule: { startTime: "", endTime: "", isRestDay: true },
      ernestoSchedule: { startTime: "08:00", endTime: "17:00", isRestDay: false },
    }));
    const result = await backendAssignments.resolvePrintshopAssignees(db, CREATED_AT);
    assert.equal(result.assignedUserId, "ernesto-auth-uid");
    assert.equal(result.supportUserId, "tony-auth-uid");
    assert.equal(result.assignmentSource, "agenda:ernesto");
  });

  it("respeta cambio temporal y ausencia sobre horario base", async () => {
    const db = createFakeDb(createAgendaSeed({
      adjustments: {
        "tony-absence": {
          userId: "tony-auth-uid",
          startDate: "2026-07-14",
          endDate: "2026-07-14",
          publicStatus: "absence",
          isActive: true,
        },
        "ernesto-change": {
          userId: "ernesto-auth-uid",
          startDate: "2026-07-14",
          endDate: "2026-07-14",
          publicStatus: "scheduleChange",
          startTime: "10:00",
          endTime: "18:00",
          isActive: true,
        },
      },
    }));
    const result = await backendAssignments.resolvePrintshopAssignees(db, CREATED_AT);
    assert.equal(result.assignedUserId, "ernesto-auth-uid");
    assert.equal(result.assignmentSource, "agenda:ernesto");
  });

  it("usa fallback consistente y registra motivo cuando no hay turno", async () => {
    const db = createFakeDb(createAgendaSeed({
      tonySchedule: { startTime: "", endTime: "", isRestDay: true },
      ernestoSchedule: { startTime: "", endTime: "", isRestDay: true },
    }));
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const result = await backendAssignments.resolvePrintshopAssignees(db, CREATED_AT);
      assert.equal(result.assignedUserId, "tony-auth-uid");
      assert.equal(result.supportUserId, "ernesto-auth-uid");
      assert.equal(result.assignmentSource, "fallback:tony-default");
      assert.match(result.assignmentFallbackReason, /no detectó turno activo/i);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  for (const source of ["certificate-public-form", "internal-admin"]) {
    it(`guarda solicitud ${source} con asignación completa desde creación`, async () => {
      const db = createFakeDb(createAgendaSeed());
      const result = await backendAssignments.createPrintRequestWithAssignment(
        db,
        {
          folio: `FOLIO-${source}`,
          publicRequestSource: source,
          assignedUserId: "spoofed",
          supportUserId: "spoofed",
          optionalUndefined: undefined,
          nested: { kept: true, removed: undefined },
        },
        { createdAt: CREATED_AT }
      );
      const stored = db.stores.get("printRequests").get(result.requestId);
      assert.equal(stored.assignedUserId, "tony-auth-uid");
      assert.equal(stored.assignedUserName, "Antonio ‘Tony’ Campos");
      assert.equal(stored.supportUserId, "ernesto-auth-uid");
      assert.equal(stored.supportUserName, "Ernesto López");
      assert.equal(stored.responsibleUid, "tony-auth-uid");
      assert.equal(stored.collaboratorUid, "ernesto-auth-uid");
      assert.equal(stored.optionalUndefined, undefined);
      assert.deepEqual(stored.nested, { kept: true });
      assert.equal(stored.createdAt, CREATED_AT);
    });
  }

  it("reutiliza la misma solicitud ante doble envío", async () => {
    const db = createFakeDb(createAgendaSeed());
    const options = {
      createdAt: CREATED_AT,
      idempotent: true,
      requestId: "public-idempotent-request",
    };
    const first = await backendAssignments.createPrintRequestWithAssignment(
      db,
      { folio: "CERT-2026-IDEMPOTENT" },
      options
    );
    const second = await backendAssignments.createPrintRequestWithAssignment(
      db,
      { folio: "CERT-2026-IDEMPOTENT" },
      options
    );
    assert.equal(first.requestId, second.requestId);
    assert.equal(second.duplicate, true);
    assert.equal(db.stores.get("printRequests").size, 1);
  });

  it("rechaza creación si no puede resolver ambos UIDs", async () => {
    const db = createFakeDb({ systemSettings: {}, users: {}, workSchedules: {}, scheduleAdjustments: {} });
    await assert.rejects(
      backendAssignments.createPrintRequestWithAssignment(db, { folio: "NO-CREATE" }, { createdAt: CREATED_AT }),
      /UIDs estables/
    );
    assert.equal(db.stores.get("printRequests")?.size || 0, 0);
  });

  it("repara faltantes una vez y conserva reasignación manual", async () => {
    const seed = createAgendaSeed();
    seed.printRequests = {
      "request-1": { responsibleUid: "collaborator-tony", collaboratorUid: "" },
    };
    const db = createFakeDb(seed);
    const requestRef = db.collection("printRequests").doc("request-1");
    const fieldValue = { serverTimestamp: () => "server-time" };

    assert.equal(await backendAssignments.repairPrintRequestAssignment(db, requestRef, {}, fieldValue), true);
    let stored = db.stores.get("printRequests").get("request-1");
    assert.equal(stored.assignedUserId, "tony-auth-uid");
    assert.equal(stored.supportUserId, "ernesto-auth-uid");
    assert.equal(stored.supportUserName, "Ernesto López");
    assert.equal(await backendAssignments.repairPrintRequestAssignment(db, requestRef, {}, fieldValue), false);

    db.stores.get("printRequests").set("request-1", {
      assignedUserId: "tony-auth-uid",
      assignedUserName: "Tony",
      supportUserId: "manual-auth-uid",
      supportUserName: "Apoyo manual",
      responsibleUid: "tony-auth-uid",
      responsibleName: "Tony",
      responsibleEmail: "tony@test.local",
      collaboratorUid: "manual-auth-uid",
      collaboratorName: "Apoyo manual",
    });
    assert.equal(await backendAssignments.repairPrintRequestAssignment(db, requestRef, {}, fieldValue), false);
    stored = db.stores.get("printRequests").get("request-1");
    assert.equal(stored.supportUserId, "manual-auth-uid");
  });
});
