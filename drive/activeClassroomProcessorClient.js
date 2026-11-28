const { HttpsError } = require("firebase-functions/v2/https");
const { descriptor } = require("./activeClassroomFiles");
const { processingTargetPath, rasterTargetPath, PPTX_PROCESSOR_VERSION, sourceTooLargeError, nativeRasterBudgetError } = require("./activeClassroomProcessingModel");
const { validateAnimationPlan, prepareAnimationUploads, attachConvertedAnimations } = require("./activeClassroomAnimations");

function reusableSlides(plan, previous, edited, animationPlan) {
  if (!previous?.pages || previous.pages.length !== plan.slides.length || !edited?.length || edited.length === plan.slides.length || plan.selectiveRaster !== true) return null;
  const selected = new Set(edited);
  let offset = 0;
  for (const slide of plan.slides) {
    const page = previous.pages[slide.index];
    const states = [page, ...(page?.builds || [])];
    const revision = page?.rasterRevision || previous.revision;
    if (states.length !== slide.steps.length + 1 || states.some((state, index) => state?.download?.path !== rasterTargetPath(revision, offset + index))) return null;
    offset += states.length;
    if (selected.has(slide.index)) continue;
    const images = animationPlan.find(item => item.slideIndex === slide.index)?.images || [];
    const saved = page.animation?.images || [];
    if (images.length !== saved.length || images.some((image, index) => image.sha256 !== saved[index].download.checksums.sha256)) return null;
  }
  return selected;
}

function createProcessorClient({ bucket, getUrl, getClient, clock = Date.now }) {
  async function send(data, { onStage = async () => {}, nativeSlidesFallback = false, slideIndex, previous, editedSlides } = {}) {
    // The processor's request validation rejects originals above its cap (HTTP 422) before it downloads anything;
    // the snapshot itself was already downloaded upstream by Functions. Check the measured size first so
    // no capability is signed and no processor call is made.
    const tooLarge = sourceTooLargeError(data.original?.sizeBytes);
    if (tooLarge) throw tooLarge;
    const url = getUrl();
    if (!/^https:\/\/[a-zA-Z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/.test(url)) throw new HttpsError("failed-precondition", "Configura el procesador privado de documentos antes de continuar.");
    await onStage("processor-auth");
    const client = await getClient(url);
    const path = processingTargetPath(data.revision); const target = bucket.file(path);
    const expires = clock() + 10 * 60 * 1000;
    await onStage("storage-sign");
    // Capabilities stay inside the private backend. Converter has no cloud data roles.
    const [sourceUrl] = await bucket.file(data.original.path).getSignedUrl({ version: "v4", action: "read", expires, queryParams: { generation: data.original.generation } });
    const [uploadUrl] = await target.getSignedUrl({ version: "v4", action: "write", expires, contentType: "application/pdf", extensionHeaders: { "x-goog-if-generation-match": "0" } });
    if (slideIndex !== undefined) {
      const response = await client.request({ url: `${url}/studio/inspect`, method: "POST", data: { ...data, sourceUrl, uploadUrl, slideIndex }, timeout: 90000 });
      return response.data;
    }
    if (data.processorVersion === PPTX_PROCESSOR_VERSION) {
      const request = { ...data, sourceUrl, uploadUrl };
      await onStage("planning");
      const plan = (await client.request({ url: `${url}/plan`, method: "POST", data: request, timeout: 90000 })).data;
      if (!Array.isArray(plan?.slides) || !plan.slides.length || plan.slides.length > 200 || !Number.isInteger(plan.stateCount) || plan.stateCount > 200 || plan.stateCount !== plan.slides.reduce((count, slide, index) => count + (slide.index === index && Array.isArray(slide.steps) && slide.steps.length <= 50 ? slide.steps.length + 1 : NaN), 0)) throw new HttpsError("data-loss", "Plan PPTX inválido.");
      // Opt-in (native Google Slides only): reject a validated plan above the measured budget before any PNG capability or /convert.
      const overBudget = nativeSlidesFallback === true ? nativeRasterBudgetError(plan.stateCount) : null;
      if (overBudget) throw overBudget;
      let animationPlan = [];
      try {
        animationPlan = validateAnimationPlan(plan.animationPlan, plan.slides);
        if (plan.stateCount + animationPlan.reduce((count, item) => count + 1 + item.images.length, 0) > 200) animationPlan = [];
      } catch { /* An optional enhancement cannot prevent a complete static import. */ }
      const selective = reusableSlides(plan, previous, editedSlides, animationPlan);
      if (selective) animationPlan = animationPlan.filter(item => selective.has(item.slideIndex));
      let globalIndex = 0;
      const targets = plan.slides.flatMap(slide => Array.from({ length: slide.steps.length + 1 }, () => {
        const index = globalIndex++;
        return !selective || selective.has(slide.index) ? bucket.file(rasterTargetPath(data.revision, index)) : null;
      }));
      let animationUploads = { targets: [], uploads: [] };
      let complete = false;
      try {
        const stateUploadUrls = await Promise.all(targets.map(async file => file ? (await file.getSignedUrl({ version: "v4", action: "write", expires, contentType: "image/png", extensionHeaders: { "x-goog-if-generation-match": "0" } }))[0] : null));
        try { animationUploads = await prepareAnimationUploads(bucket, data.revision, animationPlan); }
        catch { animationPlan = []; }
        await onStage("converting");
        const result = (await client.request({ url: `${url}/convert`, method: "POST", data: { ...request, stateUploadUrls, ...(selective ? { studioRenderSlides: [...selective] } : {}), ...(animationUploads.uploads.length ? { animationUploadUrls: animationUploads.uploads } : {}) }, timeout: 420000 })).data;
        await onStage("verifying");
        if (result.revision !== data.revision || result.processorVersion !== PPTX_PROCESSOR_VERSION || result.pageCount !== plan.slides.length || JSON.stringify(result.slides) !== JSON.stringify(plan.slides) || !Array.isArray(result.states) || result.states.length !== targets.length) throw new HttpsError("data-loss", "Estados PPTX inválidos.");
        const states = [];
        for (const [index, state] of result.states.entries()) {
          if (!targets[index] && state === null) { states.push(null); continue; }
          if (!targets[index] || !state || !/^[a-f0-9]{64}$/.test(state.sha256 || "") || !Number.isSafeInteger(state.sizeBytes) || state.sizeBytes < 24 || state.sizeBytes > 250 * 1024 * 1024 || !Number.isInteger(state.width) || state.width < 1 || state.width > 1600 || !Number.isInteger(state.height) || state.height < 1 || state.height > 1600) throw new HttpsError("data-loss", "Integridad PNG inválida.");
          await targets[index].setMetadata({ cacheControl: "private, no-store", metadata: { sha256: state.sha256, deliveredName: `estado-${index}.png`, capturedAt: new Date(clock()).toISOString(), processingRevision: data.revision } });
          const [metadata] = await targets[index].getMetadata();
          if (metadata.contentType !== "image/png" || Number(metadata.size) !== state.sizeBytes) throw new HttpsError("data-loss", "PNG incompleto.");
          states.push({ download: descriptor(rasterTargetPath(data.revision, index), metadata), width: state.width, height: state.height });
        }
        let offset = 0;
        const pages = plan.slides.map((slide, index) => {
          if (selective && !selective.has(index)) {
            offset += slide.steps.length + 1;
            const saved = previous.pages[index];
            return { ...saved, rasterRevision: saved.rasterRevision || previous.revision };
          }
          const base = states[offset++];
          const builds = slide.steps.map((_step, buildIndex) => ({ order: buildIndex + 1, ...states[offset++] }));
          return { pageObjectId: `pptx-${index}`, index, ...base, builds, warnings: slide.warnings, storagePath: base.download.path, size: base.download.sizeBytes, sha256: base.download.checksums.sha256 };
        });
        try { await attachConvertedAnimations(bucket, data.revision, pages, animationPlan, result.animations || []); }
        catch {
          for (const page of pages) if (!page.rasterRevision) { delete page.animation; page.warnings = [...(page.warnings || []), "gif-static-fallback"]; }
        }
        const candidates = new Set((Array.isArray(plan.animationPlan) ? plan.animationPlan : []).map(item => item?.slideIndex));
        for (const [index, page] of pages.entries()) if (!page.rasterRevision && candidates.has(index) && !page.animation) page.warnings = [...new Set([...(page.warnings || []), "gif-static-fallback"])];
        const retained = new Set(pages.flatMap(page => page.animation ? [page.animation.background.download.path, ...page.animation.images.map(image => image.download.path)] : []));
        await Promise.allSettled(animationUploads.targets.filter(file => !retained.has(file.name)).map(file => file.delete({ ignoreNotFound: true })));
        complete = true;
        return { processorVersion: PPTX_PROCESSOR_VERSION, revision: data.revision, pageCount: pages.length, pages, download: pages[0].download };
      } finally {
        if (!complete) await Promise.allSettled([...targets.filter(Boolean), ...animationUploads.targets].map(file => file.delete({ ignoreNotFound: true })));
      }
    }
    await onStage("converting");
    const response = await client.request({ url: `${url}/convert`, method: "POST", data: { ...data, sourceUrl, uploadUrl }, timeout: 420000 });
    await onStage("verifying");
    const result = response.data;
    if (!/^[a-f0-9]{64}$/.test(result?.sha256 || "") || result.revision !== data.revision || result.processorVersion !== data.processorVersion || !Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 200 || !Number.isSafeInteger(result.sizeBytes) || result.sizeBytes < 5 || result.sizeBytes > 250 * 1024 * 1024) throw new HttpsError("data-loss", "Resultado del procesador inválido.");
    await target.setMetadata({ cacheControl: "private, no-store", metadata: { sha256: result.sha256, deliveredName: `${data.original.name.replace(/\.[^.]+$/, "").slice(0, 140)}.pdf`, capturedAt: new Date(clock()).toISOString(), processingRevision: data.revision, pageCount: String(result.pageCount) } });
    const [metadata] = await target.getMetadata();
    if (Number(metadata.size) !== result.sizeBytes) throw new HttpsError("data-loss", "Tamaño del PDF procesado inválido.");
    return { ...result, download: descriptor(path, metadata) };
  }
  send.inspect = async (original, slideIndex) => send(
    { original, revision: require("node:crypto").randomUUID(), processorVersion: PPTX_PROCESSOR_VERSION, extension: "pptx" },
    { slideIndex },
  );
  return send;
}
module.exports = { createProcessorClient, reusableSlides };
