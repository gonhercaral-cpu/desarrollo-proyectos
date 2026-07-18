import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDriveDestinationRecord,
  canonicalDriveFolderId,
  findExistingDestination,
  resolveSaveAction,
  upsertDestination,
} from "../src/editorial/utils/editorialDriveDestination.js";

// Carpeta permitida tal como la devuelve listAllowedDriveDepartmentFolders:
// `id` = id de documento visual, `folderId` = id real de Google Drive.
const allowedFolder = {
  id: "dept-doc-123",
  folderId: "1AbGoogleDriveId",
  name: "Dirección de Desarrollo de Proyectos",
  departmentName: "Desarrollo de Proyectos",
};

test("ID canónico usa folderId (no el id de documento) — mismo criterio que Nube AES", () => {
  assert.equal(canonicalDriveFolderId(allowedFolder), "1AbGoogleDriveId");
  // Compat: si sólo hay id (carpeta creada al vuelo), cae a id.
  assert.equal(canonicalDriveFolderId({ id: "only-id" }), "only-id");
  assert.equal(canonicalDriveFolderId({}), "");
  assert.equal(canonicalDriveFolderId(null), "");
  // Nunca el id de documento cuando existe folderId.
  assert.notEqual(canonicalDriveFolderId(allowedFolder), allowedFolder.id);
});

test("el registro de destino guarda el folderId canónico y nombre legible", () => {
  const record = buildDriveDestinationRecord({
    driveFile: { id: "file-1", name: "libro.pdf", webViewLink: "https://drive/file-1" },
    folder: allowedFolder,
    sourceExportId: "e1",
    user: { uid: "u1", name: "Ana" },
  });
  assert.equal(record.folderId, "1AbGoogleDriveId"); // canónico, no dept-doc-123
  assert.equal(record.folderName, "Dirección de Desarrollo de Proyectos");
  assert.equal(record.sourceExportId, "e1");
  assert.equal(record.fileId, "file-1");
});

test("dedupe/replace usan el mismo folderId canónico (contrato Nube AES)", () => {
  const folderId = canonicalDriveFolderId(allowedFolder);
  const record = buildDriveDestinationRecord({
    driveFile: { id: "file-1", name: "libro.pdf" },
    folder: allowedFolder,
    sourceExportId: "e1",
    user: {},
  });
  const destinations = upsertDestination([], record);
  // La búsqueda por el folderId canónico encuentra el destino existente.
  assert.equal(findExistingDestination(destinations, folderId)?.fileId, "file-1");
  // Buscar por el id de documento visual NO debe encontrarlo (era el bug).
  assert.equal(findExistingDestination(destinations, allowedFolder.id), null);

  assert.equal(resolveSaveAction({ destinations, folderId }).action, "blocked");
  assert.equal(resolveSaveAction({ destinations, folderId, confirmReplace: true }).action, "replace");
  assert.equal(resolveSaveAction({ destinations, folderId: "otra" }).action, "create");
});
