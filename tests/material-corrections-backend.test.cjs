const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  allRequiredDestinationsCompleted,
  canProfileAccessMaterialCorrections,
  descriptionSimilarity,
  getTijuanaYear,
  hasValidFileSignature,
  safeHashEquals,
  sanitizeClassification,
  sanitizeDistribution,
  tokenHash,
  validateEvidenceDeclaration,
  validateStatusTransition,
} = require("../functions/materialCorrections");

describe("backend de correcciones de material", () => {
  it("genera año de folio con zona America/Tijuana", () => {
    assert.equal(getTijuanaYear(new Date("2027-01-01T07:30:00.000Z")), 2026);
    assert.equal(getTijuanaYear(new Date("2027-01-01T08:30:00.000Z")), 2027);
  });

  it("valida token por hash sin almacenar secreto", () => {
    const token = "token-super-seguro-1234567890";
    const hash = tokenHash(token);
    assert.equal(hash.length, 64);
    assert.equal(safeHashEquals(hash, token), true);
    assert.equal(safeHashEquals(hash, `${token}x`), false);
  });

  it("acepta solo colaborador activo del departamento o admin", () => {
    assert.equal(canProfileAccessMaterialCorrections({
      active: true,
      role: "collaborator",
      area: "Desarrollo de Material",
    }), true);
    assert.equal(canProfileAccessMaterialCorrections({
      active: true,
      role: "collaborator",
      departmentIds: ["desarrollo-de-material"],
    }), true);
    assert.equal(canProfileAccessMaterialCorrections({
      active: true,
      role: "collaborator",
      area: "Imprenta",
    }), false);
    assert.equal(canProfileAccessMaterialCorrections({
      active: false,
      role: "admin",
    }), false);
  });

  it("conserva unidad numérica y rechaza clasificación incompleta", () => {
    const classification = sanitizeClassification({
      levelId: "template-a1",
      levelName: "A1",
      unitNumber: "10",
      materialType: "student_book",
      pageNumber: "24",
    }, { requireCore: true, includeLegacy: false });
    assert.equal(classification.unitNumber, 10);
    assert.equal(classification.levelId, "template-a1");
    assert.equal(Object.hasOwn(classification, "bookName"), false);
    assert.equal(Object.hasOwn(classification, "lessonNumber"), false);
    assert.equal(Object.hasOwn(classification, "materialName"), false);
    assert.equal(Object.hasOwn(classification, "exerciseNumber"), false);
    assert.equal(Object.hasOwn(classification, "questionNumber"), false);
    const slide = sanitizeClassification({
      levelName: "A1",
      unitNumber: 1,
      materialType: "slide",
      pageNumber: "99",
    }, { requireCore: true, includeLegacy: false });
    assert.equal(Object.hasOwn(slide, "pageNumber"), false);
    assert.throws(
      () => sanitizeClassification({
        levelName: "A1",
        materialType: "student_book",
      }, { requireCore: true, includeLegacy: false }),
      /Unidad es obligatoria/
    );
  });

  it("conserva campos heredados solo al leer clasificación histórica", () => {
    const historical = sanitizeClassification({
      levelName: "A1",
      bookName: "Journey",
      unitNumber: 2,
      lessonNumber: 3,
      materialType: "student_book",
      materialName: "Student Book",
      exerciseNumber: "4",
      questionNumber: "5",
    });
    assert.equal(historical.bookName, "Journey");
    assert.equal(historical.lessonNumber, 3);
    assert.equal(historical.materialName, "Student Book");
    assert.equal(historical.exerciseNumber, "4");
    assert.equal(historical.questionNumber, "5");
  });

  it("valida extensión, MIME, tamaño y firma binaria", () => {
    const declaration = validateEvidenceDeclaration({
      name: "captura.JPG",
      contentType: "image/jpeg",
      size: 1024,
    });
    assert.equal(declaration.extension, "jpg");
    assert.equal(hasValidFileSignature(Buffer.from("ffd8ffe000104a46", "hex"), "jpg"), true);
    assert.equal(hasValidFileSignature(Buffer.from("%PDF-1.7"), "pdf"), true);
    assert.equal(hasValidFileSignature(Buffer.from("<script>"), "pdf"), false);
    assert.throws(
      () => validateEvidenceDeclaration({
        name: "video.mp4",
        contentType: "video/mp4",
        size: 101 * 1024 * 1024,
      }),
      /100 MB/
    );
    assert.throws(
      () => validateEvidenceDeclaration({
        name: "archivo.exe",
        contentType: "application/octet-stream",
        size: 100,
      }),
      /Archivo no permitido/
    );
    assert.throws(
      () => validateEvidenceDeclaration({
        name: "fuente.pptx",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: 1024,
      }),
      /Archivo no permitido/
    );
    assert.equal(validateEvidenceDeclaration({
      name: "fuente.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
    }, { internal: true }).policy.category, "source");
    assert.equal(hasValidFileSignature(Buffer.from("PK\u0003\u0004"), "pptx"), true);
  });

  it("impide completar si falta destino requerido", () => {
    const pending = sanitizeDistribution({
      sourceFile: { required: true, status: "completed", link: "https://drive.google.com/a" },
      inPersonDrive: { required: true, status: "pending" },
      onlineDrive: { required: false, status: "not_applicable" },
      platform: { required: false, status: "not_applicable" },
      futurePrint: { required: false, status: "not_applicable" },
    });
    assert.equal(allRequiredDestinationsCompleted(pending), false);
    pending.inPersonDrive.status = "completed";
    assert.equal(allRequiredDestinationsCompleted(pending), true);
    assert.throws(
      () => sanitizeDistribution({
        sourceFile: { required: true, status: "completed", link: "javascript:alert(1)" },
      }),
      /HTTPS/
    );
  });

  it("valida transiciones y reapertura administrativa", () => {
    assert.doesNotThrow(() => validateStatusTransition("reported", "under_review", false, "update"));
    assert.throws(
      () => validateStatusTransition("reported", "completed", false, "update"),
      /No se puede cambiar/
    );
    assert.doesNotThrow(() => validateStatusTransition("completed", "under_review", true, "reopen"));
    assert.throws(
      () => validateStatusTransition("completed", "under_review", false, "reopen"),
      /No se puede cambiar/
    );
  });

  it("calcula similitud básica para posibles duplicados", () => {
    const close = descriptionSimilarity(
      "La respuesta de la pregunta tres está incorrecta",
      "Respuesta incorrecta en pregunta tres"
    );
    const distant = descriptionSimilarity(
      "La respuesta de la pregunta tres está incorrecta",
      "El audio no reproduce"
    );
    assert.ok(close > 0.4);
    assert.ok(distant < close);
  });
});
