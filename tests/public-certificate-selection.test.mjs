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
        { level: "A1", courseAudience: "Adultos" }
      ),
      /no corresponde al nivel/
    );
    assert.throws(
      () => publicPrintRequest.validatePublicCertificateTemplate(
        { certificateType: "Certificado", level: "A1", audience: "Kids" },
        { level: "A1", courseAudience: "Adultos" }
      ),
      /no corresponde al público/
    );
    assert.equal(
      publicPrintRequest.validatePublicCertificateTemplate(
        { certificateType: "Certificado", level: "A1", audience: "Adultos" },
        { level: "A1", courseAudience: "Adultos" }
      ),
      true
    );
  });
});
