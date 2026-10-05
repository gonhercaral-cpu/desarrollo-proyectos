const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const admin = require("../drive/node_modules/firebase-admin");
const { createGoogleSlidesProcessor, pngDimensions } = require("../drive/activeClassroomSlides");
const { createDocumentProcessing } = require("../drive/activeClassroomProcessing");
const { createUnitHandlers } = require("../drive/activeClassroomUnit");
const { createDesktopHandlers } = require("../drive/activeClassroomDesktop");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Solo emuladores Firestore/Storage.");

test("Google Slides: fallo/reintento, PNG privados, orden, manifest Desktop, cambio original y publicación inmutable", async () => {
  const app = admin.initializeApp({ projectId: "slides-processing-tests", storageBucket: "slides-processing-tests.appspot.com" }, "slides-processing");
  const db = app.firestore(); const bucket = app.storage().bucket();
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const profile = { active: true, role: "admin" };
  const getProfile = async () => profile;
  const source = { id: "native-slides", name: "Songs", mimeType: "application/vnd.google-apps.presentation", version: "1", modifiedTime: "2026-10-05T01:00:00Z" };
  const resolveFile = async () => ({ ...source });
  const bytes = readFileSync(require.resolve("../active-classroom-desktop/public/active-classroom-icon.png"));
  const dimensions = pngDimensions(bytes);
  let pageIds = ["slide_z", "slide_a", "slide_m"]; let failThumbnail = true; let thumbnailCalls = 0;
  const googleSlides = createGoogleSlidesProcessor({ bucket, resolveFile, wait: async () => {}, download: async () => bytes,
    getSlides: async () => ({ presentations: {
      get: async () => ({ data: { revisionId: source.version, slides: pageIds.map((objectId) => ({ objectId })) } }),
      pages: { getThumbnail: async ({ pageObjectId }) => {
        thumbnailCalls++;
        if (failThumbnail && pageObjectId === "slide_a") { const error = new Error("Never expose temporary-url-secret"); error.response = { status: 403 }; throw error; }
        return { data: { ...dimensions, contentUrl: "https://slides.googleusercontent.com/temporary-url-secret" } };
      } },
    } }),
  });
  const unitId = "unit-slides"; const unitRef = db.doc(`activeClassroomUnits/${unitId}`); const mainRef = db.doc("activeClassroomResources/main-slides");
  const processing = createDocumentProcessing({ db, bucket, getProfile, timestamp, googleSlides,
    prepareResource: async () => { throw new Error("Drive export must never run for native Slides"); },
    convert: async () => { throw new Error("Office converter must never run for native Slides"); },
  });
  const units = createUnitHandlers({ db, getProfile, timestamp, resolveFile, prepareResource: processing.prepareDelivery });
  const request = (revision) => ({ auth: { uid: "admin" }, data: { unitId, resourceId: mainRef.id, expectedRevision: revision } });
  try {
    await db.doc("activeClassroomFolders/level-slides").set({ kind: "level", active: true });
    await db.doc(`activeClassroomFolders/${unitId}`).set({ kind: "unit", active: true, parentId: "level-slides" });
    await mainRef.set({ folderId: unitId, source: "drive", kind: "presentation", name: source.name, mimeType: source.mimeType, driveFileId: source.id, driveVersion: source.version, driveModifiedTime: source.modifiedTime });
    const draft = { name: "Unit 01", levelId: "level-slides", status: "active", metadata: { tags: [] }, mainPresentationId: mainRef.id, generalResourceIds: [], slides: [{ slideId: "legacy-slide", index: 0, title: "Inicio", resourceIds: [], metadata: { pageNumber: 1, notes: "Conservar" } }] };
    await units.save({ ...request(0), data: { ...request(0).data, draft } });
    const v1 = { version: 1, manifest: { immutable: "legacy publication" }, contentHash: "old" };
    await unitRef.update({ publishedVersion: 1 }); await unitRef.collection("publications").doc("1").set(v1);
    await assert.rejects(units.publish(request(1)), { code: "failed-precondition" });
    await assert.rejects(processing.process(request(1)), { code: "failed-precondition", message: "No se pudo procesar la presentación de Google Slides" });
    assert.equal((await mainRef.get()).data().processing.state, "failed");
    assert.equal((await bucket.getFiles({ prefix: "active-classroom/publications/files/" }))[0].length, 0);
    failThumbnail = false;
    const ready = await processing.process(request(1));
    assert.equal(ready.state, "ready"); assert.equal(ready.draftRevision, 2);
    assert.deepEqual(ready.draft.slides.map((slide) => slide.metadata.pageObjectId), pageIds);
    assert.equal(ready.draft.slides[0].slideId, "legacy-slide");
    assert.equal((await units.publish(request(2))).version, 2);
    const manifest = (await unitRef.collection("publications").doc("2").get()).data().manifest;
    const { validateManifest } = await import("../active-classroom-desktop/src/offline/manifest.ts");
    const { PlayerController } = await import("../active-classroom-desktop/src/player/controller.ts");
    await validateManifest(manifest);
    assert.doesNotMatch(JSON.stringify(manifest), /contentUrl|temporary-url-secret|googleusercontent/);
    assert.equal(manifest.resources.length, 3); assert.equal(manifest.slides.length, 3);
    const controller = new PlayerController(manifest);
    const desktop = createDesktopHandlers({ db, isDevice: () => true, authorizeDevice: async () => ({ active: true, activeClassroomDevice: true, deviceId: "approved-device", displayName: "Salón 1" }), bucket });
    const identity = { uid: "approved-device", token: { activeClassroomDevice: true } };
    assert.equal((await desktop.list({ auth: identity, data: {} })).publications[0].version, 2);
    assert.deepEqual((await desktop.get({ auth: identity, data: { unitId, version: 2 } })).manifest, manifest);
    for (const [index, slide] of manifest.slides.entries()) {
      const resource = manifest.resources.find((item) => item.resourceId === slide.metadata.presentationResourceId);
      assert.equal(resource.sourceType, "google-slides"); assert.equal(resource.originalMime, source.mimeType); assert.equal(resource.deliveryMime, "image/png");
      assert.equal(resource.original.fileId, source.id); assert.equal(resource.derivative.file.generation, resource.download.generation);
      assert.equal(slide.metadata.size, bytes.length); assert.equal(slide.metadata.width, dimensions.width); assert.equal(slide.metadata.height, dimensions.height);
      assert.equal(slide.metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
      const download = await desktop.resolveDownload({ active: true, activeClassroomDevice: true }, { unitId, version: 2, resourceId: resource.resourceId });
      const [stored] = await bucket.file(download.path, { generation: download.generation }).download();
      assert.deepEqual(stored, bytes); assert.equal(stored.length, download.sizeBytes);
      controller.goSlide(index); assert.equal(controller.selectedResourceId, resource.resourceId);
    }
    const calls = thumbnailCalls;
    const applied = await processing.process(request(2)); // Firestore restoration must not break descriptor equality.
    assert.equal(applied.draftRevision, 3); assert.equal(thumbnailCalls, calls);
    assert.equal((await units.publish(request(3))).unchanged, true);
    source.version = "2"; source.modifiedTime = "2026-10-05T02:00:00Z";
    pageIds = ["slide_m", "slide_z", "slide_new"];
    assert.equal((await units.checkDrive({ ...request(3), data: { unitId, resourceIds: [mainRef.id] } })).results[0].status, "changed");
    await assert.rejects(units.publish(request(3)), { code: "failed-precondition" });
    const refreshed = await units.refreshDrive(request(3)); assert.equal(refreshed.draftRevision, 4);
    await assert.rejects(units.publish(request(4)), { code: "failed-precondition" });
    const changed = await processing.process(request(4)); assert.equal(changed.draftRevision, 5);
    assert.equal(changed.draft.slides[1].slideId, "legacy-slide"); assert.equal(changed.draft.slides[1].metadata.notes, "Conservar");
    assert.equal((await units.publish(request(5))).version, 3);
    const latest = (await unitRef.collection("publications").doc("3").get()).data().manifest;
    assert.notEqual(latest.resources[0].download.path, manifest.resources[0].download.path);
    assert.deepEqual((await unitRef.collection("publications").doc("2").get()).data().manifest, manifest);
    assert.deepEqual((await unitRef.collection("publications").doc("1").get()).data(), v1);
    for (const resource of manifest.resources) assert.deepEqual((await bucket.file(resource.download.path, { generation: resource.download.generation }).download())[0], bytes);
  } finally { await app.delete(); }
});
