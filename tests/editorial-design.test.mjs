import assert from "node:assert/strict";
import test from "node:test";
import { cloneDesignElements } from "../src/editorial/models/editorialDesign.js";
import { createMasterOverride, detachMasterElement, resolveLocalElements, resolveMasterElements } from "../src/editorial/utils/editorialInheritance.js";
import { buildEditorialVariableValues, resolveEditorialVariables } from "../src/editorial/utils/editorialVariables.js";

const textElement = {
  id: "text-1", name: "Título", type: "text", x: 10, y: 20, width: 200, height: 50,
  rotation: 0, opacity: 1, zIndex: 0, locked: false, visible: true,
  content: "Unidad {{unit.number}} · {{page.number}} · {{custom.level}}",
  style: { fontFamily: "Arial", fontSize: 20, fill: "#111111" },
};

test("resuelve variables sin reemplazar el contenido fuente", () => {
  const numbering = new Map([["page-1", { value: 7, label: "7" }]]);
  const section = { id: "unit-2", name: "Animales", type: "unit" };
  const values = buildEditorialVariableValues({
    project: { name: "Libro A", type: "book" }, document: { name: "Alumno" },
    page: { id: "page-1" }, section, sections: [{ id: "unit-1", type: "unit" }, section],
    numbering, customVariables: [{ key: "custom.level", value: "A2" }],
  });
  const resolved = resolveEditorialVariables(textElement.content, values);
  assert.equal(resolved, "Unidad 2 · 7 · A2");
  assert.match(textElement.content, /\{\{unit\.number\}\}/);
  assert.match(resolveEditorialVariables("{{missing.value}}", {}), /sin valor/);
});

test("combina componente, estilo global y overrides locales", () => {
  const componentsById = new Map([["component-1", { id: "component-1", elements: [{ ...textElement, x: 25, width: 300 }] }]]);
  const stylesById = new Map([["style-1", { id: "style-1", properties: { fontSize: 32, fill: "#0055aa" } }]]);
  const [resolved] = resolveLocalElements([{
    ...textElement,
    id: "instance-1",
    x: 100,
    componentId: "component-1",
    componentInstanceId: "instance-group",
    componentElementId: "text-1",
    componentBase: { x: 10, y: 20, width: 200, height: 50, rotation: 0, opacity: 1 },
    componentOverrides: { content: "Página {{page.label}}" },
    styleId: "style-1",
    styleOverrides: { fill: "#ff0000" },
  }], { componentsById, stylesById, variables: { "page.label": "iv" } });
  assert.equal(resolved.x, 115);
  assert.equal(resolved.width, 300);
  assert.equal(resolved.content, "Página {{page.label}}");
  assert.equal(resolved.resolvedContent, "Página iv");
  assert.equal(resolved.style.fontSize, 32);
  assert.equal(resolved.style.fill, "#ff0000");
});

test("persiste solo diferencias de maestra y permite restaurar o desvincular", () => {
  const override = createMasterOverride({}, { hidden: false, content: "Título local", style: { fill: "#00aa66" } });
  const [resolved] = resolveMasterElements([textElement], { "text-1": override }, { variables: {} });
  assert.equal(resolved.content, "Título local");
  assert.equal(resolved.style.fill, "#00aa66");
  assert.equal(resolved.locked, true);
  assert.equal(resolveMasterElements([textElement], { "text-1": { hidden: true } }).length, 0);
  const detached = detachMasterElement(textElement, override, 4);
  assert.notEqual(detached.id, textElement.id);
  assert.equal(detached.locked, false);
  assert.equal(detached.zIndex, 4);
});

test("clona plantillas con IDs nuevos y sin vínculos destructivos", () => {
  const source = [{ ...textElement, componentId: "component-1", componentInstanceId: "group-1", styleId: "style-1" }];
  const [clone] = cloneDesignElements(source);
  assert.notEqual(clone.id, source[0].id);
  assert.equal(clone.componentId, undefined);
  assert.equal(clone.componentInstanceId, undefined);
  assert.equal(clone.styleId, undefined);
  assert.equal(clone.content, source[0].content);
});
