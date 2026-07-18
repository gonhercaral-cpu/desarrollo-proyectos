import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicationPayload,
  canPublishReviewStatus,
  canTransitionPublication,
  findImmutableViolations,
  isPublishableExport,
  isPublishableVersion,
  nextPublicationRevision,
} from "../src/editorial/models/editorialPublication.js";
import {
  canDeleteExport,
  canDeleteVersion,
  publicationsUsingVersion,
} from "../src/editorial/utils/editorialDependencies.js";
import {
  buildEditorialLinkRecord,
  deriveEditorialMetrics,
  isLinked,
  removeLink,
} from "../src/editorial/utils/editorialProjectLink.js";

const readyVersion = { id: "v3", number: 3, status: "ready", storagePath: "editorial/p/versions/v3", pageCount: 12 };
const completedExport = {
  id: "e1",
  type: "student",
  variant: "student",
  status: "completed",
  storagePath: "editorial/p/exports/u/e1.pdf",
  downloadUrl: "https://files/e1.pdf",
  sizeBytes: 2048,
  versionId: "v3",
};

test("sólo documentos aprobados o listos para imprenta se publican", () => {
  assert.equal(canPublishReviewStatus("approved"), true);
  assert.equal(canPublishReviewStatus("ready_for_print"), true);
  assert.equal(canPublishReviewStatus("draft"), false);
  assert.equal(canPublishReviewStatus("content_review"), false);
});

test("versión y export publicables requieren archivo terminado", () => {
  assert.equal(isPublishableVersion(readyVersion), true);
  assert.equal(isPublishableVersion({ ...readyVersion, status: "uploading" }), false);
  assert.equal(isPublishableExport(completedExport), true);
  assert.equal(isPublishableExport({ ...completedExport, status: "processing" }), false);
  assert.equal(isPublishableExport({ ...completedExport, storagePath: "" }), false);
});

test("publicación congela snapshot y exportaciones (inmutable)", () => {
  const payload = buildPublicationPayload({
    documentId: "doc1",
    version: readyVersion,
    exports: [completedExport],
    variant: "student",
    revision: 1,
    reviewStatus: "approved",
    user: { uid: "u1", name: "Ana" },
  });
  assert.equal(payload.versionId, "v3");
  assert.equal(payload.versionStoragePath, readyVersion.storagePath);
  assert.equal(payload.pageCount, 12);
  assert.equal(payload.exports.length, 1);
  assert.equal(payload.exports[0].exportId, "e1");
  assert.equal(payload.exports[0].downloadUrl, "https://files/e1.pdf");
  // Mutar el export original no altera la publicación (copia, no puntero).
  completedExport.storagePath = "hackeado";
  assert.equal(payload.exports[0].storagePath, "editorial/p/exports/u/e1.pdf");
  completedExport.storagePath = "editorial/p/exports/u/e1.pdf";
});

test("publicar rechaza documento no aprobado o sin export terminado", () => {
  assert.throws(() =>
    buildPublicationPayload({ documentId: "d", version: readyVersion, exports: [completedExport], reviewStatus: "draft" })
  );
  assert.throws(() =>
    buildPublicationPayload({ documentId: "d", version: readyVersion, exports: [], reviewStatus: "approved" })
  );
});

test("campos inmutables no pueden cambiar tras publicar", () => {
  const prev = { versionId: "v3", revision: 1, exports: [{ exportId: "e1" }], documentId: "d" };
  assert.deepEqual(findImmutableViolations(prev, { status: "archived", notes: "x" }), []);
  assert.deepEqual(findImmutableViolations(prev, { versionId: "v9" }), ["versionId"]);
  assert.deepEqual(findImmutableViolations(prev, { exports: [{ exportId: "e2" }] }), ["exports"]);
});

test("transiciones de estado válidas", () => {
  assert.equal(canTransitionPublication("published", "unpublished_after_release"), true);
  assert.equal(canTransitionPublication("published", "archived"), true);
  assert.equal(canTransitionPublication("archived", "published"), false);
  assert.equal(canTransitionPublication("unpublished", "archived"), false);
});

test("revisión publicada incrementa", () => {
  assert.equal(nextPublicationRevision([]), 1);
  assert.equal(nextPublicationRevision([{ documentId: "d", revision: 1 }, { documentId: "d", revision: 3 }]), 4);
});

test("dependencias protegen versión y export usados por publicación", () => {
  const publications = [
    { id: "pub1", status: "published", revision: 1, versionId: "v3", exports: [{ exportId: "e1" }] },
  ];
  assert.equal(publicationsUsingVersion(publications, "v3").length, 1);
  assert.equal(canDeleteVersion(publications, "v3").allowed, false);
  assert.equal(canDeleteVersion(publications, "v9").allowed, true);
  assert.equal(canDeleteExport(publications, "e1").allowed, false);
  assert.equal(canDeleteExport(publications, "e2").allowed, true);
  // Archivada sigue protegiendo (conserva historial).
  const archived = [{ id: "pub1", status: "archived", versionId: "v3", exports: [{ exportId: "e1" }] }];
  assert.equal(canDeleteVersion(archived, "v3").allowed, false);
});

test("vínculo con proyecto: link, unlink y métricas derivadas", () => {
  const record = buildEditorialLinkRecord({
    project: { id: "p1", name: "Libro 3" },
    document: { id: "doc1", title: "Unidad 1" },
    user: { uid: "u1", name: "Ana" },
  });
  assert.equal(record.editorialDocumentId, "doc1");
  const links = [record];
  assert.equal(isLinked(links, "doc1"), true);
  assert.equal(removeLink(links, "doc1").length, 0);

  const metrics = deriveEditorialMetrics({
    document: { reviewState: { status: "approved" }, currentVersionNumber: 3, preflightSummary: { error: 0 } },
    pages: [{ id: "a" }, { id: "b" }],
    publications: [{ status: "published", revision: 2 }, { status: "unpublished_after_release", revision: 1 }],
  });
  assert.equal(metrics.pageCount, 2);
  assert.equal(metrics.isPublished, true);
  assert.equal(metrics.latestPublishedRevision, 2);
  assert.equal(metrics.publicationCount, 2);
});
