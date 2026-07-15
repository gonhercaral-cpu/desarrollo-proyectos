import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessDepartmentMessage,
  filterVisibleDepartmentMessages,
  getUserDepartmentLabels,
  getUserExplicitDepartmentIds,
} from "../src/utils/departmentMembership.js";

const operationsMessage = {
  id: "operations-message",
  departmentId: "dept-operations",
  departmentName: "Operaciones",
};
const printshopMessage = {
  id: "printshop-message",
  departmentId: "dept-printshop",
  departmentName: "Imprenta",
};

describe("visibilidad vigente de chats departamentales", () => {
  it("conserva departamento principal y acceso temporal activo", () => {
    const profile = {
      active: true,
      primaryDepartmentId: "dept-operations",
      departmentIds: ["dept-operations", "dept-printshop"],
      departmentNames: ["Operaciones", "Imprenta"],
      area: "Operaciones",
    };

    assert.deepEqual(getUserExplicitDepartmentIds(profile), ["dept-operations", "dept-printshop"]);
    assert.equal(canAccessDepartmentMessage(profile, operationsMessage), true);
    assert.equal(canAccessDepartmentMessage(profile, printshopMessage), true);
  });

  it("elimina inmediatamente mensajes del acceso revocado", () => {
    const revokedProfile = {
      active: true,
      primaryDepartmentId: "dept-operations",
      departmentIds: ["dept-operations"],
      departmentNames: ["Operaciones"],
      area: "Operaciones",
    };

    assert.deepEqual(
      filterVisibleDepartmentMessages(
        [operationsMessage, printshopMessage],
        revokedProfile
      ).map((message) => message.id),
      ["operations-message"]
    );
  });

  it("mantiene compatibilidad con perfiles historicos por nombre", () => {
    const legacyProfile = { active: true, area: "Imprenta" };

    assert.deepEqual(getUserExplicitDepartmentIds(legacyProfile), []);
    assert.deepEqual(getUserDepartmentLabels(legacyProfile), ["Imprenta"]);
    assert.equal(canAccessDepartmentMessage(legacyProfile, printshopMessage), true);
    assert.equal(canAccessDepartmentMessage(legacyProfile, operationsMessage), false);
  });
});
