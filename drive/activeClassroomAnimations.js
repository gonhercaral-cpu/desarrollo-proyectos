const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const MAX_GIF_BYTES = 15 * 1024 * 1024;
const animationTargetPath = (revision, slideIndex, asset) => `active-classroom/publications/files/${createHash("sha256").update(`${revision}:animation:${slideIndex}:${asset}`).digest("hex")}`;
const animationResourceId = (resourceId, asset) => `gif-${createHash("sha256").update(`${resourceId}:${asset}`).digest("hex").slice(0, 40)}`;
const boundsValid = (image) => ["x", "y", "width", "height"].every(key => Number.isFinite(image[key]) && image[key] >= 0 && image[key] <= 100) && image.width > 0 && image.height > 0 && image.x + image.width <= 100 && image.y + image.height <= 100;
const fail = () => { throw new HttpsError("data-loss", "Recursos animados inválidos."); };

function validateAnimationPlan(plan, slides) {
  if (plan == null) return [];
  if (!Array.isArray(plan) || plan.length > 32) fail();
  let images = 0; let bytes = 0;
  const seen = new Set();
  for (const item of plan) {
    if (!Number.isInteger(item.slideIndex) || item.slideIndex < 0 || item.slideIndex >= slides.length || seen.has(item.slideIndex) || slides[item.slideIndex].steps.length || !Array.isArray(item.images) || !item.images.length || item.images.length > 8) fail();
    seen.add(item.slideIndex);
    for (const image of item.images) {
      if (!boundsValid(image) || !/^[a-f0-9]{64}$/.test(image.sha256 || "") || !Number.isSafeInteger(image.sizeBytes) || image.sizeBytes < 14 || image.sizeBytes > MAX_GIF_BYTES) fail();
      images++; bytes += image.sizeBytes;
    }
  }
  if (images > 32 || bytes > 64 * 1024 * 1024) fail();
  return plan;
}

function animationDownloads(page) {
  return page.animation ? [page.animation.background.download, ...page.animation.images.map(image => image.download)] : [];
}

async function discardAnimation(bucket, animation, revision, slideIndex) {
  if (!animation) return;
  const downloads = [animation.background?.download, ...(animation.images || []).map(image => image.download)];
  await Promise.allSettled(downloads.map((download, index) => download?.path === animationTargetPath(revision, slideIndex, index ? `gif-${index - 1}` : "background") ? bucket.file(download.path).delete({ ignoreNotFound: true }) : Promise.resolve()));
}

async function prepareAnimationUploads(bucket, revision, plan) {
  const targets = [];
  const uploads = [];
  for (const item of plan) {
    const grant = async (asset, mimeType) => {
      const file = bucket.file(animationTargetPath(revision, item.slideIndex, asset));
      targets.push(file);
      return (await file.getSignedUrl({ version: "v4", action: "write", expires: Date.now() + 10 * 60 * 1000, contentType: mimeType, extensionHeaders: { "x-goog-if-generation-match": "0" } }))[0];
    };
    uploads.push({ slideIndex: item.slideIndex, backgroundUrl: await grant("background", "image/png"), imageUrls: await Promise.all(item.images.map((_image, index) => grant(`gif-${index}`, "image/gif"))) });
  }
  return { targets, uploads };
}

async function attachConvertedAnimations(bucket, revision, pages, plan, converted) {
  if (!Array.isArray(converted) || converted.length > plan.length) fail();
  const completed = new Set();
  for (const item of converted) {
    const expected = plan.find(candidate => candidate.slideIndex === item.slideIndex);
    if (!expected || completed.has(item.slideIndex) || !Array.isArray(item.images) || item.images.length !== expected.images.length) fail();
    completed.add(item.slideIndex);
    const page = pages[item.slideIndex];
    const freeze = async (state, asset, mimeType, expectedHash) => {
      if (!state || !/^[a-f0-9]{64}$/.test(state.sha256 || "") || (expectedHash && state.sha256 !== expectedHash) || !Number.isSafeInteger(state.sizeBytes) || state.sizeBytes < 14 || state.sizeBytes > (expectedHash ? MAX_GIF_BYTES : 20 * 1024 * 1024)) fail();
      const path = animationTargetPath(revision, item.slideIndex, asset); const file = bucket.file(path);
      const [before] = await file.getMetadata();
      if (before.contentType !== mimeType || Number(before.size) !== state.sizeBytes) fail();
      await file.setMetadata({ cacheControl: "private, no-store", metadata: { sha256: state.sha256, deliveredName: `${asset}.${expectedHash ? "gif" : "png"}`, capturedAt: new Date().toISOString(), processingRevision: revision } });
      const [metadata] = await file.getMetadata();
      return require("./activeClassroomFiles").descriptor(path, metadata);
    };
    if (item.background?.width !== page.width || item.background?.height !== page.height) fail();
    const background = { download: await freeze(item.background, "background", "image/png"), width: page.width, height: page.height };
    const images = [];
    for (const [index, image] of item.images.entries()) {
      const source = expected.images[index];
      if (image.sizeBytes !== source.sizeBytes) fail();
      images.push({ x: source.x, y: source.y, width: source.width, height: source.height, download: await freeze(image, `gif-${index}`, "image/gif", source.sha256) });
    }
    page.animation = { background, images };
    await verifyAnimation(bucket, page.animation, revision, item.slideIndex, page, true);
  }
  return completed;
}

async function verifyAnimation(bucket, animation, revision, slideIndex, dimensions, full = false) {
  if (!animation || !animation.background || !Array.isArray(animation.images) || !animation.images.length || animation.images.length > 8) fail();
  const states = [{ ...animation.background, type: "background" }, ...animation.images.map((image, index) => ({ ...image, type: `gif-${index}` }))];
  for (const [index, state] of states.entries()) {
    const download = state.download;
    const mime = index ? "image/gif" : "image/png";
    if (index && !boundsValid(state)) fail();
    if (!index && (state.width !== dimensions.width || state.height !== dimensions.height)) fail();
    if (download?.path !== animationTargetPath(revision, slideIndex, state.type) || download.provider !== "storage" || download.endpoint !== "activeClassroomPublicationFile" || !/^\d+$/.test(download.generation || "") || download.mimeType !== mime || !/^[a-f0-9]{64}$/.test(download.checksums?.sha256 || "") || !Number.isSafeInteger(download.sizeBytes) || download.sizeBytes < 14 || download.sizeBytes > (index ? MAX_GIF_BYTES : 20 * 1024 * 1024)) fail();
    const file = bucket.file(download.path, { generation: download.generation });
    const [metadata] = await file.getMetadata();
    if (String(metadata.generation) !== download.generation || Number(metadata.size) !== download.sizeBytes || metadata.contentType !== mime || metadata.metadata?.sha256 !== download.checksums.sha256 || metadata.metadata?.processingRevision !== revision) fail();
    if (!full) continue;
    let size = 0; let header = Buffer.alloc(0); const hash = createHash("sha256");
    for await (const chunk of file.createReadStream()) {
      size += chunk.length;
      if (size > download.sizeBytes) fail();
      hash.update(chunk);
      if (header.length < 24) header = Buffer.concat([header, chunk.subarray(0, 24 - header.length)]);
    }
    if (size !== download.sizeBytes || hash.digest("hex") !== download.checksums.sha256) fail();
    if (index ? !["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6)) : header.length < 24 || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || header.readUInt32BE(16) !== dimensions.width || header.readUInt32BE(20) !== dimensions.height) fail();
  }
}

// Keep the complete PNG as the default. Desktop 1.0.18 ignores this optional field.
function addPublishedAnimations(resources, candidates, maxResources = 200) {
  const result = [...resources];
  for (const { resourceId, animation } of candidates) {
    const baseIndex = result.findIndex(resource => resource.resourceId === resourceId);
    if (baseIndex < 0) continue;
    const base = result[baseIndex];
    if (result.length + 1 + animation.images.length > maxResources) {
      result[baseIndex] = { ...base, animationWarning: "GIF estático: límite de recursos de la publicación." };
      continue;
    }
    const append = (asset, download) => {
      const id = animationResourceId(resourceId, asset);
      result.push({ ...base, resourceId: id, name: `${base.name} · ${asset}`, mimeType: download.mimeType, originalMime: download.mimeType, deliveryMime: download.mimeType, kind: "image", download, derivative: { ...base.derivative, file: download } });
      return id;
    };
    const backgroundResourceId = append("background", animation.background.download);
    const images = animation.images.map((image, index) => ({ x: image.x, y: image.y, width: image.width, height: image.height, resourceId: append(`gif-${index}`, image.download) }));
    result[baseIndex] = { ...base, animation: { backgroundResourceId, images } };
  }
  return result;
}

module.exports = { MAX_GIF_BYTES, animationTargetPath, boundsValid, validateAnimationPlan, animationDownloads, discardAnimation, verifyAnimation, addPublishedAnimations, prepareAnimationUploads, attachConvertedAnimations };
