import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectFileKind, resolveFileMimeType } from "../src/utils/fileTypes.js";

describe("detección central de archivos", () => {
  it("asigna MIME seguro cuando navegador no reporta tipo", () => {
    assert.equal(resolveFileMimeType("", "script.jsx"), "text/jsx");
    assert.equal(resolveFileMimeType("", "archivo.desconocido"), "application/octet-stream");
  });

  it("detecta formatos del visor por MIME o extensión", () => {
    assert.equal(detectFileKind({ name: "manual.pdf" }), "pdf");
    assert.equal(detectFileKind({ name: "foto.webp" }), "image");
    assert.equal(detectFileKind({ name: "notas.md" }), "text");
    assert.equal(detectFileKind({ name: "audio.mp3" }), "audio");
    assert.equal(detectFileKind({ name: "video.mp4" }), "video");
    assert.equal(detectFileKind({ name: "original.docx" }), "docx");
    assert.equal(detectFileKind({ name: "Documento", mimeType: "application/vnd.google-apps.document" }), "docx");
    assert.equal(detectFileKind({ name: "modelo.bin" }), "unsupported");
  });
});
