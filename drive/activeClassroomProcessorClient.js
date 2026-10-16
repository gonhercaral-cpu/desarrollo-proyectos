const { HttpsError } = require("firebase-functions/v2/https");
const { descriptor } = require("./activeClassroomFiles");
const { processingTargetPath, rasterTargetPath, PPTX_PROCESSOR_VERSION } = require("./activeClassroomProcessingModel");

function createProcessorClient({ bucket, getUrl, getClient, clock = Date.now }) {
  return async (data) => {
    const url = getUrl();
    if (!/^https:\/\/[a-zA-Z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/.test(url)) throw new HttpsError("failed-precondition", "Configura el procesador privado de documentos antes de continuar.");
    const client = await getClient(url);
    const path = processingTargetPath(data.revision); const target = bucket.file(path);
    const expires = clock() + 10 * 60 * 1000;
    // Capabilities stay inside the private backend. Converter has no cloud data roles.
    const [sourceUrl] = await bucket.file(data.original.path).getSignedUrl({ version: "v4", action: "read", expires, queryParams: { generation: data.original.generation } });
    const [uploadUrl] = await target.getSignedUrl({ version: "v4", action: "write", expires, contentType: "application/pdf", extensionHeaders: { "x-goog-if-generation-match": "0" } });
    if (data.processorVersion === PPTX_PROCESSOR_VERSION) {
      const request = { ...data, sourceUrl, uploadUrl };
      const plan = (await client.request({ url: `${url}/plan`, method: "POST", data: request, timeout: 90000 })).data;
      if (!Array.isArray(plan?.slides) || !plan.slides.length || plan.slides.length > 200 || !Number.isInteger(plan.stateCount) || plan.stateCount > 200 || plan.stateCount !== plan.slides.reduce((count, slide, index) => count + (slide.index === index && Array.isArray(slide.steps) && slide.steps.length <= 50 ? slide.steps.length + 1 : NaN), 0)) throw new HttpsError("data-loss", "Plan PPTX inválido.");
      const targets = Array.from({ length: plan.stateCount }, (_value, index) => bucket.file(rasterTargetPath(data.revision, index)));
      let complete = false;
      try {
        const stateUploadUrls = await Promise.all(targets.map(async file => (await file.getSignedUrl({ version: "v4", action: "write", expires, contentType: "image/png", extensionHeaders: { "x-goog-if-generation-match": "0" } }))[0]));
        const result = (await client.request({ url: `${url}/convert`, method: "POST", data: { ...request, stateUploadUrls }, timeout: 420000 })).data;
        if (result.revision !== data.revision || result.processorVersion !== PPTX_PROCESSOR_VERSION || result.pageCount !== plan.slides.length || JSON.stringify(result.slides) !== JSON.stringify(plan.slides) || !Array.isArray(result.states) || result.states.length !== targets.length) throw new HttpsError("data-loss", "Estados PPTX inválidos.");
        const states = [];
        for (const [index, state] of result.states.entries()) {
          if (!/^[a-f0-9]{64}$/.test(state.sha256 || "") || !Number.isSafeInteger(state.sizeBytes) || state.sizeBytes < 24 || state.sizeBytes > 250 * 1024 * 1024 || !Number.isInteger(state.width) || state.width < 1 || state.width > 1600 || !Number.isInteger(state.height) || state.height < 1 || state.height > 1600) throw new HttpsError("data-loss", "Integridad PNG inválida.");
          await targets[index].setMetadata({ cacheControl: "private, no-store", metadata: { sha256: state.sha256, deliveredName: `estado-${index}.png`, capturedAt: new Date(clock()).toISOString(), processingRevision: data.revision } });
          const [metadata] = await targets[index].getMetadata();
          if (metadata.contentType !== "image/png" || Number(metadata.size) !== state.sizeBytes) throw new HttpsError("data-loss", "PNG incompleto.");
          states.push({ download: descriptor(rasterTargetPath(data.revision, index), metadata), width: state.width, height: state.height });
        }
        let offset = 0;
        const pages = plan.slides.map((slide, index) => {
          const base = states[offset++];
          const builds = slide.steps.map((_step, buildIndex) => ({ order: buildIndex + 1, ...states[offset++] }));
          return { pageObjectId: `pptx-${index}`, index, ...base, builds, warnings: slide.warnings, storagePath: base.download.path, size: base.download.sizeBytes, sha256: base.download.checksums.sha256 };
        });
        complete = true;
        return { processorVersion: PPTX_PROCESSOR_VERSION, revision: data.revision, pageCount: pages.length, pages, download: pages[0].download };
      } finally {
        if (!complete) await Promise.allSettled(targets.map(file => file.delete({ ignoreNotFound: true })));
      }
    }
    const response = await client.request({ url: `${url}/convert`, method: "POST", data: { ...data, sourceUrl, uploadUrl }, timeout: 420000 });
    const result = response.data;
    if (!/^[a-f0-9]{64}$/.test(result?.sha256 || "") || result.revision !== data.revision || result.processorVersion !== data.processorVersion || !Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 200 || !Number.isSafeInteger(result.sizeBytes) || result.sizeBytes < 5 || result.sizeBytes > 250 * 1024 * 1024) throw new HttpsError("data-loss", "Resultado del procesador inválido.");
    await target.setMetadata({ cacheControl: "private, no-store", metadata: { sha256: result.sha256, deliveredName: `${data.original.name.replace(/\.[^.]+$/, "").slice(0, 140)}.pdf`, capturedAt: new Date(clock()).toISOString(), processingRevision: data.revision, pageCount: String(result.pageCount) } });
    const [metadata] = await target.getMetadata();
    if (Number(metadata.size) !== result.sizeBytes) throw new HttpsError("data-loss", "Tamaño del PDF procesado inválido.");
    return { ...result, download: descriptor(path, metadata) };
  };
}
module.exports = { createProcessorClient };
