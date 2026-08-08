const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  DOCX_MIME_TYPE,
  detectFileType,
  getDriveContentDescriptor,
  getDriveContentHeaders,
  mapDriveContentError,
} = require("../drive/fileContent");

describe("contrato de contenido de Nube AES", () => {
  it("mantiene bytes y metadatos de DOCX binario", () => {
    const descriptor = getDriveContentDescriptor({
      id: "docx-1",
      name: "manual.docx",
      mimeType: DOCX_MIME_TYPE,
      size: "2048",
      capabilities: { canDownload: true, canEdit: true },
    });

    assert.equal(descriptor.exported, false);
    assert.equal(descriptor.deliveredName, "manual.docx");
    assert.equal(descriptor.deliveredMimeType, DOCX_MIME_TYPE);
    assert.equal(descriptor.fileType, "docx");
    assert.equal(descriptor.size, 2048);
    assert.equal(descriptor.previewable, true);
    assert.equal(descriptor.editable, true);
  });

  it("exporta Google Docs como DOCX sin cambiar MIME original", () => {
    const descriptor = getDriveContentDescriptor({
      id: "google-doc-1",
      name: "Minuta semanal",
      mimeType: "application/vnd.google-apps.document",
      capabilities: { canDownload: true, canEdit: false },
    });

    assert.equal(descriptor.exported, true);
    assert.equal(descriptor.originalMimeType, "application/vnd.google-apps.document");
    assert.equal(descriptor.deliveredMimeType, DOCX_MIME_TYPE);
    assert.equal(descriptor.deliveredName, "Minuta semanal.docx");
    assert.equal(descriptor.previewable, true);
    assert.equal(descriptor.editable, true);
  });

  it("clasifica PDF, imagen y texto para vista previa", () => {
    assert.equal(detectFileType("application/pdf", "archivo"), "pdf");
    assert.equal(detectFileType("image/png", "captura"), "image");
    assert.equal(detectFileType("text/plain", "notas"), "text");
  });

  it("rechaza exportación nativa no soportada con código estable", () => {
    assert.throws(
      () => getDriveContentDescriptor({ name: "Mapa", mimeType: "application/vnd.google-apps.map" }),
      (error) => error.code === "unsupported-export" && error.status === 415
    );
  });

  it("expone nombre, MIME y capacidades del contenido entregado", () => {
    const descriptor = getDriveContentDescriptor({
      name: "Documento de prueba",
      mimeType: "application/vnd.google-apps.document",
    });
    const headers = getDriveContentHeaders(descriptor, 4096);

    assert.equal(headers["Content-Type"], DOCX_MIME_TYPE);
    assert.equal(headers["Content-Length"], "4096");
    assert.equal(headers["X-Nube-Exported"], "true");
    assert.equal(decodeURIComponent(headers["X-Nube-File-Name"]), "Documento de prueba.docx");
  });

  it("distingue archivo inexistente, exportación y error de Drive", () => {
    assert.deepEqual(mapDriveContentError({ response: { status: 404 } }), {
      status: 404,
      code: "not-found",
      message: "El archivo no existe o ya no está disponible.",
    });
    assert.equal(mapDriveContentError({ contentOperation: "export" }).code, "export-failed");
    assert.equal(mapDriveContentError(new Error("fallo interno")).code, "drive-error");
  });
});
