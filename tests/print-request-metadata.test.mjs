import test from "node:test";
import assert from "node:assert/strict";
import {
  getRequestClassSchedule,
  getRequestTeacherName,
} from "../src/utils/printRequestMetadata.js";

test("normaliza maestro y horario canónicos de una solicitud", () => {
  const request = {
    teacherName: "  Ana Torres  ",
    schedule: " Lun/Mié 6:00 pm ",
  };

  assert.equal(getRequestTeacherName(request), "Ana Torres");
  assert.equal(getRequestClassSchedule(request), "Lun/Mié 6:00 pm");
});

test("recupera alias históricos de maestro y horario", () => {
  assert.equal(
    getRequestTeacherName({ teacherSignerName: "Luis Vega" }),
    "Luis Vega"
  );
  assert.equal(
    getRequestTeacherName({ maestroNombre: "María Ruiz" }),
    "María Ruiz"
  );
  assert.equal(
    getRequestClassSchedule({ groupSchedule: "Sáb 9:00 am" }),
    "Sáb 9:00 am"
  );
  assert.equal(
    getRequestClassSchedule({ horario: "Mar/Jue 4:00 pm" }),
    "Mar/Jue 4:00 pm"
  );
});

test("usa valor seguro cuando datos no existen", () => {
  assert.equal(getRequestTeacherName({}), "No especificado");
  assert.equal(getRequestClassSchedule(null), "No especificado");
  assert.equal(getRequestTeacherName({}, "—"), "—");
  assert.equal(getRequestClassSchedule({}, ""), "");
});
