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
const CREATED_AT = new Date("2026-07-14T19:00:00.000Z"); // 12:00, America/Tijuana.

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
    assert.match(publicSource, /createPrintRequestWithAssignment\(\{/);
    assert.match(internalSource, /createPrintRequestWithAssignment\(creationPayload\)/);
    assert.doesNotMatch(publicSource, /addDoc\(collection\(db,\s*"printRequests"/);
    assert.doesNotMatch(internalSource, /addDoc\(collection\(db,\s*"printRequests"/);
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
