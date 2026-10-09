const { randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { contentHash, snapshotResource } = require("./activeClassroomUnit");
const { transferTimeoutSeconds, taskTimeoutSeconds } = require("./activeClassroomPublicationLimits.json");

// Each task prepares one resource. Only the final transaction activates a version.
// Task payloads contain IDs, never files, manifests, credentials or access profiles.
function createPublicationJobs({ db, units, getProfile, prepareResource, verifyDownload, enqueue, clock = Date.now }) {
  const jobs = db.collection("activeClassroomPublicationJobs");
  const unitRef = (unitId) => db.collection("activeClassroomUnits").doc(unitId);
  const fingerprint = (resources) => contentHash(resources.map((resource) => snapshotResource(resource.id, resource)));
  async function start(request) {
    const resources = await units.preparePublish(request);
    const { unitId, expectedRevision } = request.data;
    const attemptId = randomUUID();
    const job = await db.runTransaction(async (transaction) => {
      const ref = unitRef(unitId);
      const stored = (await transaction.get(ref)).data();
      if (stored.draftRevision !== expectedRevision) throw new HttpsError("aborted", "El borrador cambió. Recarga antes de publicar.");
      if (["pending", "publishing"].includes(stored.publicationJob?.state)) {
        const existing = (await transaction.get(jobs.doc(stored.publicationJob.jobId))).data();
        if (existing) return existing;
      }
      const value = { jobId: attemptId, unitId, expectedRevision, requestedByUid: request.auth.uid, resources, downloads: {}, step: 0, state: "pending", requestedAt: new Date(clock()).toISOString() };
      if (Buffer.byteLength(JSON.stringify(value)) > 700000) throw new HttpsError("resource-exhausted", "La solicitud de publicación supera 700 KB.");
      transaction.create(jobs.doc(attemptId), value);
      transaction.update(ref, { publicationJob: { jobId: attemptId, state: "pending", completedResources: 0, totalResources: resources.length } });
      return value;
    });
    try { await enqueue({ jobId: job.jobId, step: job.step }); }
    catch {
      const message = "No se pudo encolar la publicación. Reintenta; el borrador permanece guardado.";
      await db.runTransaction(async (transaction) => {
        const ref = jobs.doc(job.jobId);
        const latest = (await transaction.get(ref)).data();
        const unit = (await transaction.get(unitRef(job.unitId))).data();
        // If dispatch already started, it owns the job. Otherwise expose retry.
        if (latest.state !== "pending") return;
        transaction.update(ref, { state: "failed", errorCode: "unavailable", error: message });
        if (unit.publicationJob?.jobId === job.jobId) transaction.update(unitRef(job.unitId), { "publicationJob.state": "failed", "publicationJob.error": message });
      });
      throw new HttpsError("unavailable", message);
    }
    return { jobId: job.jobId, state: job.state };
  }

  async function work({ data }) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(data?.jobId || "") || !Number.isSafeInteger(data.step) || data.step < 0) throw new HttpsError("invalid-argument", "Job inválido.");
    const ref = jobs.doc(data.jobId);
    const token = randomUUID();
    const job = await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(ref)).data();
      if (!current || ["ready", "failed"].includes(current.state)) return null;
      if (data.step !== current.step) return current;
      if (current.leaseUntil > clock()) throw new HttpsError("unavailable", "Transferencia ya en curso.");
      transaction.update(ref, { state: "publishing", token, leaseUntil: clock() + taskTimeoutSeconds * 1000 });
      transaction.update(unitRef(current.unitId), { "publicationJob.state": "publishing" });
      return { ...current, token };
    });
    if (!job) return;
    if (data.step !== job.step) { await enqueue({ jobId: job.jobId, step: job.step }); return; }
    // Reserve two minutes for cleanup and state persistence before the task deadline.
    const signal = AbortSignal.timeout(transferTimeoutSeconds * 1000);
    try {
      const profile = await getProfile(job.requestedByUid);
      if (profile?.active !== true || profile.role !== "admin") throw new HttpsError("permission-denied", "Solo administradores activos pueden publicar Units.");
      const request = { auth: { uid: job.requestedByUid }, data: { unitId: job.unitId, expectedRevision: job.expectedRevision } };
      const current = await units.preparePublish(request);
      if (fingerprint(current) !== fingerprint(job.resources)) throw new HttpsError("aborted", "Los recursos cambiaron durante la publicación. Reintenta.");
      if (job.step < job.resources.length) {
        const resource = job.resources[job.step];
        const download = await prepareResource(profile, resource, { signal, snapshotId: `${job.jobId}:${job.step}` });
        await verifyDownload(download);
        await db.runTransaction(async (transaction) => {
          const latest = (await transaction.get(ref)).data();
          if (latest.token !== token || latest.step !== job.step) throw new HttpsError("aborted", "Transferencia reemplazada.");
          transaction.update(ref, { [`downloads.${resource.id}`]: download, step: job.step + 1, leaseUntil: 0 });
          transaction.update(unitRef(job.unitId), { "publicationJob.completedResources": job.step + 1 });
        });
      } else {
        // Recheck every delivered generation, including exact processed page files.
        for (const resource of job.resources) {
          await verifyDownload(job.downloads[resource.id]);
          for (const page of resource.processing?.pages || []) {
            await verifyDownload(page.download);
            for (const build of page.builds || []) await verifyDownload(build.download);
          }
        }
        await units.publish(request, { preparedFiles: job.downloads, expectedResources: job.resources, jobId: job.jobId });
        return;
      }
    } catch (error) {
      const safe = error instanceof HttpsError ? error : new HttpsError(error.name === "AbortError" || signal.aborted ? "deadline-exceeded" : "unavailable", signal.aborted ? "La transferencia superó 28 minutos por recurso. Reintenta." : "No se pudo copiar o verificar un recurso. Reintenta.");
      await db.runTransaction(async (transaction) => {
        const latest = (await transaction.get(ref)).data();
        const unit = (await transaction.get(unitRef(job.unitId))).data();
        // A transaction may have committed despite a lost acknowledgement.
        if (latest.state === "ready" || latest.token !== token) return;
        transaction.update(ref, { state: "failed", errorCode: safe.code, error: safe.message, leaseUntil: 0 });
        if (unit.publicationJob?.jobId === job.jobId) transaction.update(unitRef(job.unitId), { "publicationJob.state": "failed", "publicationJob.error": safe.message });
      });
      return;
    }
    // Enqueue outside the failure handler: delivery failures must retry the task.
    // Replayed old steps enqueue the durable next step without copying twice.
    await enqueue({ jobId: job.jobId, step: job.step + 1 });
  }
  return { start, work };
}
module.exports = { createPublicationJobs };
