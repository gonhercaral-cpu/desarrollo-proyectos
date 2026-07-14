import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CERTIFICATE_SIGNER_CAMPUS_OPTIONS,
  getCertificateSignerCampusFormState,
  resolveCertificateSignerCampus,
} from "../src/utils/certificateSignerCampus.js";

describe("plantel de firmantes", () => {
  it("ofrece sólo planteles permitidos y Otro", () => {
    assert.deepEqual(CERTIFICATE_SIGNER_CAMPUS_OPTIONS, [
      "Plaza Estrella",
      "Plaza Bugambilias",
      "Plaza Aranjuez",
      "Online",
      "Otro",
    ]);
    assert.ok(!CERTIFICATE_SIGNER_CAMPUS_OPTIONS.includes("Coffee Beans Factory"));
  });

  it("guarda plantel predefinido sin modificarlo", () => {
    assert.equal(resolveCertificateSignerCampus("Plaza Bugambilias", ""), "Plaza Bugambilias");
    assert.equal(resolveCertificateSignerCampus("Online", ""), "Online");
    assert.deepEqual(getCertificateSignerCampusFormState("Online"), {
      campus: "Online",
      customCampus: "",
    });
  });

  it("exige y guarda nombre personalizado al seleccionar Otro", () => {
    assert.equal(resolveCertificateSignerCampus("Otro", "  Campus Centro  "), "Campus Centro");
    assert.equal(resolveCertificateSignerCampus("Otro", "   "), "");
  });

  it("edita plantel personalizado como Otro conservando nombre", () => {
    assert.deepEqual(getCertificateSignerCampusFormState("Campus Centro"), {
      campus: "Otro",
      customCampus: "Campus Centro",
    });
    assert.deepEqual(getCertificateSignerCampusFormState("Coffee Beans Factory"), {
      campus: "Otro",
      customCampus: "Coffee Beans Factory",
    });
  });

  it("edita plantel predefinido con su opción original", () => {
    assert.deepEqual(getCertificateSignerCampusFormState("Plaza Aranjuez"), {
      campus: "Plaza Aranjuez",
      customCampus: "",
    });
  });
});
