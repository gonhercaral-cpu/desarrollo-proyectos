import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  findStrictMatchingCertificateTemplates,
} from "../src/utils/certificateTemplateMatching.js";
import { normalizeId } from "../src/utils/normalizeId.js";

const require = createRequire(import.meta.url);
const publicPrintRequest = require("../functions/publicPrintRequest.js");

const activeTemplate = {
  active: true,
  audience: "Adultos",
  certificateType: "Certificado",
};
const a1Request = {
  requestType: "Certificado",
  level: "A1",
  courseLevel: "A1 Journey",
  courseProgramName: "Journey",
  courseAudience: "Adultos",
};

describe("selección pública de firmas y plantillas", () => {
  it("normaliza strings y estructuras comunes a un ID estable", () => {
    assert.equal(normalizeId(" signer-1 "), "signer-1");
    assert.equal(normalizeId({ id: "doc-1" }), "doc-1");
    assert.equal(normalizeId({ value: "option-1" }), "option-1");
    assert.equal(normalizeId({ signatureId: "signature-1" }), "signature-1");
    assert.equal(normalizeId({ templateId: "template-1" }), "template-1");
    assert.equal(normalizeId({ uid: "uid-1" }), "uid-1");
    assert.equal(normalizeId({ label: "Solo nombre" }), "");
  });

  it("no acepta programa coincidente cuando nivel explícito contradice", () => {
    const templates = [
      { ...activeTemplate, id: "a2-journey-mal-configurada", level: "A2", programName: "Journey", name: "Explore" },
      { ...activeTemplate, id: "a1-journey", level: "A1", programName: "Journey", name: "Journey" },
    ];
    const matches = findStrictMatchingCertificateTemplates(templates, {
      level: "A1",
      certificateTemplateProgramName: "Journey",
      certificateTemplateAudience: "Adultos",
      requestType: "Certificado",
    });
    assert.deepEqual(matches.map((template) => template.id), ["a1-journey"]);
  });

  it("backend rechaza plantilla activa de nivel o público incompatible", () => {
    assert.throws(
      () => publicPrintRequest.validatePublicCertificateTemplate(
        { certificateType: "Certificado", level: "A2", audience: "Adultos" },
        { requestType: "Certificado", level: "A1", courseAudience: "Adultos" }
      ),
      /no corresponde al nivel/
    );
    assert.throws(
      () => publicPrintRequest.validatePublicCertificateTemplate(
        { certificateType: "Certificado", level: "A1", audience: "Kids" },
        { requestType: "Certificado", level: "A1", courseAudience: "Adultos" }
      ),
      /no corresponde al público/
    );
  });

  it("backend resuelve la única plantilla activa compatible sin ID del cliente", () => {
    const selected = publicPrintRequest.selectPublicCertificateTemplate([
      { ...activeTemplate, id: "a2", name: "Explore", level: "A2", programName: "Journey" },
      { ...activeTemplate, id: "a1", name: "Journey", level: "A1", programName: "Journey" },
    ], a1Request);

    assert.equal(selected.id, "a1");
  });

  for (const level of [
    "Smile 1",
    "Smile 2",
    "Smile 3",
    "Smile 4",
    "Smile 5",
    "Smile 6",
    "Mega Flash",
  ]) {
    it(`backend asocia ${level} solo con su plantilla activa`, () => {
      const request = {
        requestType: "Certificado",
        level,
        courseLevel: level,
        courseProgramName: level,
        courseAudience: "Kids",
      };
      const selected = publicPrintRequest.selectPublicCertificateTemplate([
        { ...activeTemplate, id: "journey", name: "Journey", level: "A1", programName: "Journey" },
        {
          ...activeTemplate,
          id: `template-${level.replace(" ", "-").toLowerCase()}`,
          name: `Plantilla ${level}`,
          level,
          programName: level,
          audience: "Kids",
        },
      ], request);

      assert.equal(selected.level, level);
      assert.equal(selected.programName, level);
    });
  }

  it("backend aplica la plantilla predeterminada configurada si hay varias válidas", () => {
    const templates = [
      { ...activeTemplate, id: "a1-blue", name: "Journey azul", level: "A1", programName: "Journey" },
      { ...activeTemplate, id: "a1-green", name: "Journey verde", level: "A1", programName: "Journey" },
    ];
    const selected = publicPrintRequest.selectPublicCertificateTemplate(
      templates,
      a1Request,
      { defaultCertificateTemplateIds: { "A1 Journey": "a1-green" } }
    );

    assert.equal(selected.id, "a1-green");
  });

  it("backend no crea una solicitud incompleta cuando falta plantilla compatible", () => {
    assert.throws(
      () => publicPrintRequest.selectPublicCertificateTemplate([
        { ...activeTemplate, id: "a2", name: "Explore", level: "A2", programName: "Explore" },
      ], a1Request),
      /No hay una plantilla activa configurada para A1 Journey/
    );
  });

  it("backend exige una predeterminada cuando el resultado es ambiguo", () => {
    assert.throws(
      () => publicPrintRequest.selectPublicCertificateTemplate([
        { ...activeTemplate, id: "one", name: "Journey 1", level: "A1", programName: "Journey" },
        { ...activeTemplate, id: "two", name: "Journey 2", level: "A1", programName: "Journey" },
      ], a1Request),
      /configura una como predeterminada/
    );
  });
});
