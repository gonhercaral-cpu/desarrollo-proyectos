import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { staticAnimationResources } from "../src/active-classroom/utils/staticAnimationWarnings.js";

const require = createRequire(import.meta.url);
const { failureDetails } = require("../drive/activeClassroomProcessing");
const attempt = { jobId: "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab", resourceId: "res_1", unitId: "unit-1", fileId: "1AbC_dEf-GhI", processorVersion: "google-slides-builds-png-v2" };
const SECRET = "ya29a0AfH6SMBsecretToken123";

describe("failureDetails allowlists", () => {
  it("drops alphanumeric remote reason and stage that are not known", () => {
    const error = Object.assign(new Error(`boom ${SECRET}`), { response: { status: 403, data: { error: { errors: [{ reason: SECRET }] } } }, details: { reason: SECRET } });
    const { details } = failureDetails(error, true, SECRET, attempt);
    assert.equal(details.reason, "");
    assert.equal(details.stage, "");
    assert.ok(!JSON.stringify(details).includes(SECRET));
  });

  it("keeps known Google, API and processor reasons and every real stage label", () => {
    for (const reason of ["exportSizeLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "downloadQuotaExceeded", "notFound", "forbidden", "insufficientPermissions", "backendError"]) {
      const { details } = failureDetails({ response: { status: 403, data: { error: { errors: [{ reason }] } } } }, true, "export-download", attempt);
      assert.equal(details.reason, reason);
    }
    assert.equal(failureDetails({ details: { reason: "processorSourceSizeLimit" } }, true, "export-download", attempt).details.reason, "processorSourceSizeLimit");
    for (const stage of ["planning", "converting", "verifying", "original", "original-check", "presentation-read", "presentation-recheck", "export-download", "export-processor-auth", "export-storage-sign", "export-planning", "export-converting", "export-verifying", "processor-auth", "storage-sign", "thumbnail-fallback", "thumbnail-fetch", "thumbnail-storage", "verify-derivative", "commit"]) {
      assert.equal(failureDetails(new Error("x"), false, stage, attempt).details.stage, stage);
    }
  });

  it("validates ids by pattern and HTTP status by range", () => {
    const bad = { jobId: `id with spaces ${SECRET}`, resourceId: "../path", unitId: "a".repeat(201), fileId: "file?token=1", processorVersion: "v" };
    const { details } = failureDetails(new Error("x"), false, "commit", bad);
    assert.deepEqual([details.jobId, details.resourceId, details.unitId, details.fileId], [null, null, null, null]);
    assert.deepEqual(failureDetails(new Error("x"), false, "commit", attempt).details.fileId, attempt.fileId);
    for (const [status, expected] of [[99, null], [600, null], [404, 404], ["500", null], [200.5, null], [599, 599], [100, 100]]) {
      assert.equal(failureDetails({ response: { status } }, false, "commit", attempt).details.upstreamStatus, expected);
    }
  });

  it("records only a valid thumbnail position and never content", () => {
    const error = Object.assign(new Error("x"), { contentUrl: "https://lh3.googleusercontent.com/secret", body: "texto de la diapositiva" });
    const { details } = failureDetails(error, true, "thumbnail-fetch", attempt, { slideIndex: 104, pageObjectId: "g1a2b_3", contentUrl: "https://lh3.googleusercontent.com/secret" });
    assert.deepEqual([details.slideIndex, details.pageObjectId], [104, "g1a2b_3"]);
    assert.ok(!JSON.stringify(details).includes("googleusercontent") && !JSON.stringify(details).includes("diapositiva"));
    for (const fine of [{ slideIndex: 200, pageObjectId: "bad id" }, { slideIndex: -1, pageObjectId: `x/${SECRET}` }, { slideIndex: 1.5, pageObjectId: null }, null]) {
      const result = failureDetails(error, true, "thumbnail-fetch", attempt, fine).details;
      assert.deepEqual([result.slideIndex, result.pageObjectId], [null, null]);
    }
  });
});

describe("staticAnimationResources", () => {
  const ready = (id, warnings, extra = {}) => ({ id, name: `Recurso ${id}`, folderId: "u1", processing: { state: "ready", pages: [{ warnings: [] }, { warnings }] }, ...extra });
  it("lists only completed resources with a matching static-fallback warning", () => {
    const resources = [
      ready("a", ["animation-export-too-large-manual"]),
      ready("b", ["gif-static-fallback"]),
      ready("c", ["animation-export-unavailable-manual"]),
      ready("h", ["gif-static:gif-not-top-suffix"]),
      ready("i", ["states-limit-static"]),
      ready("j", ["animation-export-complexity-manual"]),
      ready("d", ["gif-static-fallback"], { folderId: "u2" }),
      ready("e", ["gif-static-fallback"], { archived: true }),
      { ...ready("f", ["gif-static-fallback"]), processing: { state: "failed", pages: [{ warnings: ["gif-static-fallback"] }] } },
      { id: "g", folderId: "u1" },
    ];
    assert.deepEqual(staticAnimationResources(resources, "u1"), ["Recurso a", "Recurso b", "Recurso c", "Recurso h", "Recurso i", "Recurso j"]);
    assert.deepEqual(staticAnimationResources(undefined, "u1"), []);
  });
});
