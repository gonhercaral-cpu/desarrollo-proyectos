const { HttpsError } = require("firebase-functions/v2/https");
const MAX_BUILDS = 50;
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
function normalizeInteraction(slide) {
  const fail = () => { throw new HttpsError("invalid-argument", "Interactividad inválida: revisa pasos, posición y assets."); };
  const mode = slide.interactionMode || slide.interaction?.mode || "static";
  if (!["static", "builds"].includes(mode)) fail();
  if (mode === "static") return { interactionMode: "static", buildCount: 0, interaction: { mode: "static", buildCount: 0, ...(slide.interaction?.source === "manual" ? { source: "manual" } : {}) }, builds: [] };
  if (!Array.isArray(slide.builds) || !slide.builds.length || slide.builds.length > MAX_BUILDS) fail();
  if (slide.builds.reduce((count, step) => count + (step.layers?.length || 0), 0) > 50) fail();
  const builds = slide.builds.map((step, index) => {
    if (slide.interaction?.source === "pptx") {
      if (step.order !== index + 1 || !validId(step.resourceId) || step.layers) fail();
      return { order: index + 1, resourceId: step.resourceId };
    }
    if (step.order !== index + 1 || !Array.isArray(step.layers) || !step.layers.length || step.layers.length > 20) fail();
    return { order: index + 1, layers: step.layers.map((layer) => {
      if (!["text", "answer", "image"].includes(layer.type)) fail();
      const box = {};
      for (const key of ["x", "y", "width", "height"]) {
        const value = layer[key];
        if (!Number.isFinite(value) || value < 0 || value > 100 || (["width", "height"].includes(key) && value === 0)) fail();
        box[key] = value;
      }
      if (box.x + box.width > 100 || box.y + box.height > 100) fail();
      if (layer.type === "image") {
        if (!validId(layer.resourceId)) fail();
        return { type: "image", ...box, resourceId: layer.resourceId };
      }
      if (typeof layer.text !== "string" || !layer.text.trim() || layer.text.length > 2000 || !/^#[a-fA-F0-9]{6}$/.test(layer.color || "#102954") || !Number.isFinite(layer.fontSize || 3) || (layer.fontSize || 3) < 0.5 || (layer.fontSize || 3) > 20) fail();
      return { type: layer.type, ...box, text: layer.text, color: layer.color || "#102954", fontSize: layer.fontSize || 3 };
    }) };
  });
  return { interactionMode: "builds", buildCount: builds.length, interaction: { mode: "builds", buildCount: builds.length, source: slide.interaction?.source === "pptx" ? "pptx" : "manual" }, builds };
}
function interactionResourceIds(slide) {
  return (slide.builds || []).flatMap((step) => (step.layers || []).filter((layer) => layer.type === "image").map((layer) => layer.resourceId));
}
module.exports = { MAX_BUILDS, normalizeInteraction, interactionResourceIds };
