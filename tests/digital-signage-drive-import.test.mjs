import test from "node:test";
import assert from "node:assert/strict";

import {
  DRIVE_IMPORT_CALLABLE_TIMEOUT_MS,
  runDriveImportBatch,
} from "../src/utils/digitalSignage/driveImport.js";

test("timeout cliente cubre copias grandes observadas en producción", () => {
  assert.equal(DRIVE_IMPORT_CALLABLE_TIMEOUT_MS, 540000);
  assert.ok(DRIVE_IMPORT_CALLABLE_TIMEOUT_MS > 137000);
});

test("importa un MP4 sin exigir duración", async () => {
  const calls = [];
  const result = await runDriveImportBatch({
    files: [{ id: "video-1", name: "Video institucional.mp4", mimeType: "video/mp4", size: 5000 }],
    data: { title: "Video institucional", plantel: "Tijuana" },
    importFile: async (file, data) => {
      calls.push({ file, data });
      return { id: "asset-1", sourceFileId: file.id };
    },
  });

  assert.equal(result.imported.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(calls[0].data.title, "Video institucional");
  assert.equal(Object.hasOwn(calls[0].data, "durationSeconds"), false);
});

test("importa varios videos grandes con espacios y acentos en orden", async () => {
  const importedNames = [];
  const progress = [];
  const files = [
    { id: "video-a", name: "Campaña Agosto 2026.mp4", mimeType: "video/mp4", size: 900_000_000 },
    { id: "video-b", name: "Información Dirección.mp4", mimeType: "video/mp4", size: 1_200_000_000 },
  ];
  const result = await runDriveImportBatch({
    files,
    data: { title: "No debe duplicarse", plantel: "Tijuana", category: "institucional" },
    onProgress: (value) => progress.push(value),
    importFile: async (file, data) => {
      importedNames.push(file.name);
      assert.equal(data.title, "");
      assert.equal(Object.hasOwn(data, "durationSeconds"), false);
      return { id: `asset-${file.id}`, sourceFileId: file.id };
    },
  });

  assert.deepEqual(importedNames, files.map((file) => file.name));
  assert.equal(result.imported.length, 2);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(progress.map(({ completed, total }) => [completed, total]), [
    [0, 2], [1, 2], [1, 2], [2, 2],
  ]);
});

test("continúa lote y reporta archivo exacto cuando uno falla", async () => {
  const result = await runDriveImportBatch({
    files: [
      { id: "ok-1", name: "Primero.mp4" },
      { id: "fail-2", name: "Vídeo dañado.mp4" },
      { id: "ok-3", name: "Tercero.mp4" },
    ],
    data: { plantel: "Tijuana" },
    importFile: async (file) => {
      if (file.id === "fail-2") {
        const error = new Error("Drive interrumpió la descarga.");
        error.code = "functions/internal";
        throw error;
      }
      return { id: `asset-${file.id}` };
    },
  });

  assert.deepEqual(result.imported.map((asset) => asset.id), ["asset-ok-1", "asset-ok-3"]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].file.name, "Vídeo dañado.mp4");
  assert.equal(result.failed[0].code, "internal");
  assert.equal(result.failed[0].message, "Drive interrumpió la descarga.");
});
