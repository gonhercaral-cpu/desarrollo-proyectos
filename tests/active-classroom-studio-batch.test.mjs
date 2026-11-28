import assert from "node:assert/strict";
import { test } from "node:test";
import { planCanvasFit } from "../src/active-classroom/utils/studioBatch.js";

test("Studio propone ajustes en varias diapositivas conservando el texto y las correcciones previas", () => {
  const layouts = [
    { slideIndex: 0, width: 100, height: 100, elements: [{ id: "1", x: 0, y: 92, width: 120, height: 20 }] },
    { slideIndex: 5, width: 80, height: 100, elements: [{ id: "1", x: -10, y: 0, width: 10, height: 10 }, { id: "2", x: 3, y: 3, width: 6, height: 7 }] },
  ];
  const edits = [{ slideIndex: 0, id: "1", text: "Respuesta" }, { slideIndex: 9, id: "4", x: 8 }];
  const proposal = planCanvasFit(layouts, edits);
  assert.deepEqual(proposal.changes.map(({ slideIndex, before, after }) => ({ slideIndex, before, after })), [
    { slideIndex: 0, before: [0, 92, 120, 20], after: [0, 80, 100, 20] },
    { slideIndex: 5, before: [-10, 0, 10, 10], after: [0, 0, 10, 10] },
  ]);
  assert.equal(proposal.edits[0].text, "Respuesta");
  assert.deepEqual(proposal.edits[1], edits[1]);
  assert.equal(edits[0].x, undefined);
});
