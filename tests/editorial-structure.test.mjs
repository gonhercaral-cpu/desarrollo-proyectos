import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEditorialPages } from "../src/editorial/models/editorialStructure.js";
import { calculateEditorialNumbering } from "../src/editorial/utils/editorialNumbering.js";
import { getEditorialSpread } from "../src/editorial/utils/editorialSpreads.js";

describe("estructura editorial", () => {
  it("normaliza páginas legacy sin borrar campos desconocidos", () => {
    const pages = normalizeEditorialPages([
      { id: "b", name: "Dos", position: 1, customData: "conservar" },
      { id: "a", name: "Uno", position: 0 },
    ], { widthIn: 8.5, heightIn: 11, orientation: "portrait" });
    assert.deepEqual(pages.map((page) => page.id), ["a", "b"]);
    assert.equal(pages[1].customData, "conservar");
    assert.equal(pages[0].width, 8.5);
  });

  it("calcula numeración romana y reinicio arábigo", () => {
    const sections = [
      { id: "front", numberingStyle: "roman_lower", numberingMode: "restart", numberingStart: 1 },
      { id: "unit", numberingStyle: "arabic", numberingMode: "restart", numberingStart: 3 },
    ];
    const pages = [
      { id: "p1", sectionId: "front", pageType: "content", numberingEnabled: true },
      { id: "p2", sectionId: "front", pageType: "content", numberingEnabled: true },
      { id: "p3", sectionId: "unit", pageType: "content", numberingEnabled: true },
    ];
    const numbering = calculateEditorialNumbering(pages, sections);
    assert.equal(numbering.get("p1").label, "i");
    assert.equal(numbering.get("p2").label, "ii");
    assert.equal(numbering.get("p3").label, "3");
  });

  it("forma pliegos par izquierda e impar derecha", () => {
    const pages = [1, 2, 3, 4, 5].map((number) => ({ id: `p${number}`, pageType: "content" }));
    const first = getEditorialSpread(pages, "p1", "facing");
    assert.equal(first.left, null);
    assert.equal(first.right.id, "p1");
    const spread = getEditorialSpread(pages, "p3", "facing");
    assert.equal(spread.left.id, "p2");
    assert.equal(spread.right.id, "p3");
  });

  it("respeta inicio de sección en página derecha", () => {
    const pages = [
      { id: "p1", sectionId: "a", pageType: "content" },
      { id: "p2", sectionId: "b", pageType: "content" },
    ];
    const sections = [{ id: "b", startOnRight: true }];
    const spread = getEditorialSpread(pages, "p2", "facing", sections);
    assert.equal(spread.left, null);
    assert.equal(spread.right.id, "p2");
  });
});
