import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditorial,
  highestLevel,
  levelCan,
  resolveEditorialLevel,
} from "../src/editorial/models/editorialPermissions.js";
import {
  buildPrintAutofill,
  buildPrintRequestPayload,
  EDITORIAL_PRINT_REQUEST_TYPE,
  isPrintableExport,
} from "../src/editorial/utils/editorialPrintPayload.js";
import {
  buildDriveDestinationRecord,
  findExistingDestination,
  resolveSaveAction,
  upsertDestination,
} from "../src/editorial/utils/editorialDriveDestination.js";
import {
  buildDedupeKey,
  collectEditorialRecipients,
  dedupeRecipients,
} from "../src/editorial/utils/editorialNotifications.js";

const project = {
  id: "p1",
  ownerUid: "owner",
  collaboratorUids: ["colab", "pubuser", "deptuser"],
  editorialPermissions: {
    users: { pubuser: "publisher", locked: "viewer" },
    departments: { dev: "reviewer" },
  },
};

test("nivel efectivo respeta admin, propietario, explícito y departamento", () => {
  assert.equal(resolveEditorialLevel({ project, user: { uid: "x" }, isAdmin: true }), "manager");
  assert.equal(resolveEditorialLevel({ project, user: { uid: "owner" } }), "manager");
  assert.equal(resolveEditorialLevel({ project, user: { uid: "pubuser" } }), "publisher");
  // Departamento eleva a reviewer aunque el colaborador tenga default menor.
  assert.equal(
    resolveEditorialLevel({ project, user: { uid: "deptuser" }, userDepartmentIds: ["dev"] }),
    "reviewer"
  );
  // Colaborador sin permiso explícito conserva default (compatibilidad Fases 1–6).
  assert.equal(resolveEditorialLevel({ project, user: { uid: "colab" } }), "content_editor");
  // Permiso explícito puede bajar a viewer.
  assert.equal(resolveEditorialLevel({ project, user: { uid: "locked" } }), "viewer");
  // Sin relación con el proyecto: sin acceso.
  assert.equal(resolveEditorialLevel({ project, user: { uid: "extraño" } }), null);
});

test("capacidades por nivel", () => {
  assert.equal(levelCan("viewer", "view"), true);
  assert.equal(levelCan("viewer", "download"), true);
  assert.equal(levelCan("viewer", "edit_content"), false);
  assert.equal(levelCan("publisher", "publish"), true);
  assert.equal(levelCan("reviewer", "publish"), false);
  assert.equal(levelCan("manager", "manage"), true);
  assert.equal(highestLevel(["viewer", "reviewer", "commenter"]), "reviewer");
  assert.equal(
    canEditorial({ project, user: { uid: "pubuser" } }, "publish"),
    true
  );
  assert.equal(canEditorial({ project, user: { uid: "colab" } }, "publish"), false);
});

const printExport = {
  id: "e9",
  type: "print",
  variant: "print",
  status: "completed",
  storagePath: "editorial/p/exports/u/e9.pdf",
  downloadUrl: "https://files/e9.pdf",
  pageCount: 24,
};

test("payload de imprenta autocompleta y mantiene certificados separados", () => {
  const autofill = buildPrintAutofill({
    project: { id: "p1", name: "Libro 3", size: "8x10" },
    document: { id: "doc1", title: "Unidad 1" },
    exportItem: printExport,
    user: { name: "Ana" },
  });
  assert.equal(autofill.pages, 24);
  const payload = buildPrintRequestPayload({
    project: { id: "p1", name: "Libro 3", size: "8x10" },
    document: { id: "doc1", title: "Unidad 1" },
    exportItem: printExport,
    autofill,
    form: { requestedQuantity: 30, campus: "Central", color: "Color", sides: "Doble cara" },
    user: { name: "Ana" },
  });
  assert.equal(payload.requestType, EDITORIAL_PRINT_REQUEST_TYPE);
  assert.notEqual(payload.requestType, "Certificado");
  assert.equal(payload.editorialExportId, "e9");
  assert.equal(payload.attachmentUrl, "https://files/e9.pdf");
  assert.equal(payload.requestedQuantity, 30);
  assert.equal(payload.sourceModule, "editorial");
  assert.equal(isPrintableExport(printExport), true);
  assert.equal(isPrintableExport({ ...printExport, type: "review" }), false);
});

test("payload de imprenta rechaza certificado, export incompleto y datos faltantes", () => {
  const base = {
    project: { id: "p1", name: "Libro" },
    document: { id: "d" },
    exportItem: printExport,
    autofill: {},
    user: {},
  };
  // requestType certificado se degrada al genérico, nunca contamina el flujo.
  const forced = buildPrintRequestPayload({ ...base, form: { requestedQuantity: 5, campus: "X", requestType: "Certificado" } });
  assert.equal(forced.requestType, EDITORIAL_PRINT_REQUEST_TYPE);
  assert.throws(() => buildPrintRequestPayload({ ...base, form: { requestedQuantity: 0, campus: "X" } }));
  assert.throws(() => buildPrintRequestPayload({ ...base, form: { requestedQuantity: 5, campus: "" } }));
  assert.throws(() =>
    buildPrintRequestPayload({ ...base, exportItem: { ...printExport, status: "processing" }, form: { requestedQuantity: 5, campus: "X" } })
  );
});

test("destino Drive evita duplicaciones y reemplaza sólo con confirmación", () => {
  const record = buildDriveDestinationRecord({
    driveFile: { id: "f1", name: "e9.pdf", webViewLink: "https://drive/f1" },
    folder: { id: "fold1", name: "Publicados" },
    sourceExportId: "e9",
    user: { uid: "u1", name: "Ana" },
  });
  assert.equal(record.fileId, "f1");
  assert.equal(record.url, "https://drive/f1");
  assert.equal(record.sourceExportId, "e9");
  const list = upsertDestination([], record);
  assert.equal(findExistingDestination(list, "fold1").fileId, "f1");
  assert.equal(resolveSaveAction({ destinations: list, folderId: "fold1" }).action, "blocked");
  assert.equal(resolveSaveAction({ destinations: list, folderId: "fold1", confirmReplace: true }).action, "replace");
  assert.equal(resolveSaveAction({ destinations: list, folderId: "fold2" }).action, "create");
  assert.throws(() => buildDriveDestinationRecord({ driveFile: {}, folder: {} }));
});

test("notificaciones editoriales sin duplicados", () => {
  const recipients = collectEditorialRecipients({ project, actorUid: "owner" });
  assert.equal(recipients.includes("owner"), false);
  assert.equal(recipients.includes("colab"), true);
  assert.equal(recipients.includes("pubuser"), true);
  const key = buildDedupeKey({ type: "EDITORIAL_PUBLISHED", editorialProjectId: "p1", editorialDocumentId: "doc1" });
  const existing = [{ recipientId: "colab", dedupeKey: key }];
  const pending = dedupeRecipients({ recipients, dedupeKey: key, existing });
  assert.equal(pending.includes("colab"), false);
  assert.equal(pending.includes("pubuser"), true);
  // Sin duplicados internos aunque el uid venga repetido.
  assert.equal(dedupeRecipients({ recipients: ["a", "a", "b"], dedupeKey: key, existing: [] }).length, 2);
});
