import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPrintRequestCreatedAt,
  PRINT_REQUEST_TIME_ZONE,
} from "../src/utils/printRequestDateTime.js";

describe("fecha de creación de solicitudes de Imprenta", () => {
  it("muestra timestamp real en America/Tijuana y no requestDate UTC", () => {
    const result = formatPrintRequestCreatedAt({
      createdAt: { toDate: () => new Date("2026-07-14T21:00:00.000Z") },
      requestDate: "2026-07-14",
    });

    assert.equal(PRINT_REQUEST_TIME_ZONE, "America/Tijuana");
    assert.match(result, /14 jul 2026/);
    assert.match(result, /2:00 p\.\s*m\./);
    assert.doesNotMatch(result, /13 jul/);
  });

  it("funciona con timestamp ISO de solicitudes públicas e internas", () => {
    assert.match(
      formatPrintRequestCreatedAt({ createdAt: "2026-12-15T22:30:00.000Z" }),
      /15 dic 2026, 2:30 p\.\s*m\./
    );
  });

  it("usa assignmentEvaluatedAt para solicitudes históricas sin createdAt", () => {
    assert.match(
      formatPrintRequestCreatedAt({
        assignmentEvaluatedAt: "2026-07-14T21:00:00.000Z",
        requestDate: "2026-07-14",
      }),
      /14 jul 2026, 2:00 p\.\s*m\./
    );
  });

  it("no convierte fecha calendario histórica a día anterior", () => {
    assert.equal(
      formatPrintRequestCreatedAt({
        createdAt: "2026-07-14",
        requestDate: "2026-07-14",
      }),
      "14 jul 2026"
    );
  });
});
