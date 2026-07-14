import assert from "node:assert/strict";
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

  it("normaliza campos UID históricos sin usar nombres o correos", () => {
    const request = {
      productionAssigneeUid: "principal-historico",
      supportCollaboratorIds: ["apoyo-historico"],
      responsibleName: "otro-uid",
    };

    assert.deepEqual(normalizePrintRequestAssignments(request), {
      assignedUserId: "principal-historico",
      supportUserId: "apoyo-historico",
      supportUserIds: ["apoyo-historico"],
    });
    assert.equal(canManagePrintRequest("otro-uid", request), false);
    assert.equal(canManagePrintRequest("apoyo-historico", request), true);
  });

  it("mantiene campos canónicos y espejos históricos", () => {
    assert.deepEqual(buildCanonicalPrintRequestAssignment("tony-uid", "ernesto-uid"), {
      assignedUserId: "tony-uid",
      supportUserId: "ernesto-uid",
      responsibleUid: "tony-uid",
      collaboratorUid: "ernesto-uid",
    });
  });
});

describe("reparación backend de apoyo", () => {
  function createShiftDb(onShiftByUserId) {
    return {
      collection(name) {
        if (name === "scheduleAdjustments") {
          return {
            where() {
              return { get: async () => ({ docs: [] }) };
            },
          };
        }
        if (name === "workSchedules") {
          return {
            doc(scheduleId) {
              const userId = scheduleId.startsWith("tony-uid_") ? "tony-uid" : "ernesto-uid";
              const onShift = onShiftByUserId[userId] === true;
              return {
                get: async () => ({
                  exists: true,
                  data: () => onShift
                    ? { isActive: true, isRestDay: false, startTime: "00:00", endTime: "23:59" }
                    : { isActive: true, isRestDay: true, startTime: "00:00", endTime: "23:59" },
                }),
              };
            },
          };
        }
        throw new Error(`Colección inesperada: ${name}`);
      },
    };
  }

  it("asigna apoyo contrario por UID", () => {
    const config = { tonyUserId: "tony-uid", ernestoUserId: "ernesto-uid" };
    assert.equal(backendAssignments.getOppositeSupportUserId("tony-uid", config), "ernesto-uid");
    assert.equal(backendAssignments.getOppositeSupportUserId("ernesto-uid", config), "tony-uid");
    assert.equal(backendAssignments.getOppositeSupportUserId("otro-uid", config), "");
  });

  it("preserva apoyo manual histórico durante normalización", () => {
    const request = {
      responsibleUid: "tony-uid",
      collaboratorUid: "apoyo-manual-uid",
    };
    assert.deepEqual(backendAssignments.normalizePrintRequestAssignments(request), {
      assignedUserId: "tony-uid",
      supportUserId: "apoyo-manual-uid",
      supportUserIds: ["apoyo-manual-uid"],
    });
  });

  it("crea durante turno de Tony con Ernesto de apoyo", async () => {
    const assignment = await backendAssignments.resolveShiftAssignment(
      createShiftDb({ "tony-uid": true, "ernesto-uid": false }),
      { tonyUserId: "tony-uid", ernestoUserId: "ernesto-uid" },
      new Date("2026-07-14T19:00:00.000Z")
    );
    assert.deepEqual(assignment, {
      assignedUserId: "tony-uid",
      supportUserId: "ernesto-uid",
      source: "agenda",
    });
  });

  it("crea durante turno de Ernesto con Tony de apoyo", async () => {
    const assignment = await backendAssignments.resolveShiftAssignment(
      createShiftDb({ "tony-uid": false, "ernesto-uid": true }),
      { tonyUserId: "tony-uid", ernestoUserId: "ernesto-uid" },
      new Date("2026-07-14T19:00:00.000Z")
    );
    assert.deepEqual(assignment, {
      assignedUserId: "ernesto-uid",
      supportUserId: "tony-uid",
      source: "agenda",
    });
  });

  it("repara una sola vez y no sobrescribe apoyo manual", async () => {
    let requestData = { responsibleUid: "tony-uid", collaboratorUid: "" };
    const requestRef = { id: "request-1" };
    const users = {
      "tony-uid": { name: "Tony", email: "tony@test.local" },
      "ernesto-uid": { name: "Ernesto", email: "ernesto@test.local" },
    };
    const fakeDb = {
      collection(name) {
        if (name !== "users") throw new Error(`Colección inesperada: ${name}`);
        return {
          doc(userId) {
            return {
              get: async () => ({ exists: true, data: () => users[userId] }),
            };
          },
        };
      },
      async runTransaction(callback) {
        return callback({
          get: async () => ({ exists: true, data: () => requestData }),
          update: (_ref, update) => {
            requestData = { ...requestData, ...update };
          },
        });
      },
    };
    const fieldValue = { serverTimestamp: () => "server-time" };
    const config = { tonyUserId: "tony-uid", ernestoUserId: "ernesto-uid" };

    assert.equal(await backendAssignments.repairPrintRequestAssignment(
      fakeDb,
      requestRef,
      config,
      fieldValue
    ), true);
    assert.equal(requestData.supportUserId, "ernesto-uid");
    assert.equal(await backendAssignments.repairPrintRequestAssignment(
      fakeDb,
      requestRef,
      config,
      fieldValue
    ), false);

    requestData = { responsibleUid: "tony-uid", collaboratorUid: "manual-uid" };
    users["manual-uid"] = { name: "Manual", email: "manual@test.local" };
    await backendAssignments.repairPrintRequestAssignment(fakeDb, requestRef, config, fieldValue);
    assert.equal(requestData.supportUserId, "manual-uid");
  });
});
