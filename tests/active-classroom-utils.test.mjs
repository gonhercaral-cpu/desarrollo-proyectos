import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectResourceKind,
  formatFileSize,
  getFileExtension,
  getResourceKindLabel,
  isPreviewablePdf,
  sortFolders,
} from "../src/active-classroom/utils/resourceTypes.js";

describe("utilidades Active Classroom", () => {
  it("clasifica recursos por extensión y MIME", () => {
    assert.equal(detectResourceKind("clase.pptx"), "presentation");
    assert.equal(detectResourceKind("audio.MP3"), "audio");
    assert.equal(detectResourceKind("video.mov"), "video");
    assert.equal(detectResourceKind({ name: "portada", type: "image/webp" }), "image");
    assert.equal(detectResourceKind("guia.pdf"), "document");
  });

  it("formatea y etiqueta documentos", () => {
    assert.equal(getFileExtension("GUIA.PDF"), "pdf");
    assert.equal(getResourceKindLabel("document", "guia.pdf"), "PDF");
    assert.equal(formatFileSize(1536), "2 KB");
    assert.equal(isPreviewablePdf({ name: "guia.PDF" }), true);
  });

  it("ordena carpetas por posición", () => {
    const folders = [
      { name: "Unit 10", position: 10 },
      { name: "Unit 02", position: 2 },
    ];
    assert.deepEqual(folders.sort(sortFolders).map(({ name }) => name), ["Unit 02", "Unit 10"]);
  });
});
