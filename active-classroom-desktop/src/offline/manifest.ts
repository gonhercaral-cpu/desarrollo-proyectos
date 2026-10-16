import publicationLimits from "../../../drive/activeClassroomPublicationLimits.json" with { type: "json" };

export interface PublishedResource {
  resourceId: string;
  name: string;
  mimeType: string;
  originalMime?: string;
  deliveryMime?: string;
  sourceType?: string;
  original?: Record<string, unknown>;
  derivative?: { revision: string; processorVersion: string; sourceFingerprint: string; pageCount: number; processedAt: string; textExtraction: null; file: Record<string, unknown> };
  kind: string;
  file: Record<string, unknown>;
  download: { endpoint: string; name: string; mimeType: string; sizeBytes: number; checksums: { sha256: string }; [key: string]: unknown };
}
export interface BuildLayer { type: "text" | "answer" | "image"; x: number; y: number; width: number; height: number; text?: string; color?: string; fontSize?: number; resourceId?: string }
export interface SlideBuild { order: number; resourceId?: string; layers?: BuildLayer[] }
export interface PublishedSlide { slideId: string; index: number; title: string; resourceIds: string[]; metadata: Record<string, unknown>; interactionMode?: "static" | "builds"; buildCount?: number; interaction?: { mode: "static" | "builds"; buildCount: number; source?: string }; builds?: SlideBuild[] }
export interface Manifest {
  schemaVersion: number;
  unit: { unitId: string; name: string; levelId: string; description: string; metadata: Record<string, unknown>; [key: string]: unknown };
  version: number;
  publishedAt: string;
  mainPresentationId: string;
  generalResourceIds: string[];
  slides: PublishedSlide[];
  resources: PublishedResource[];
  integrity: { algorithm: string; contentHash: string };
}
export interface Publication {
  unitId: string; version: number; name: string; levelId: string; contentHash: string; publishedAt: string; schemaVersion: number;
}
export class SyncError extends Error {
  code: string;
  stage?: "manifest" | "download" | "verify" | "cache" | "activate";
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
export const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function validateManifest(input: unknown): Promise<Manifest> {
  function require(condition: unknown): asserts condition {
    if (!condition) throw new SyncError("manifest", "Manifest incompatible o incompleto. Publica una versión nueva desde la web.");
  }
  require(input && typeof input === "object");
  const m = input as Manifest;
  require(new TextEncoder().encode(JSON.stringify(m)).length <= 700000);
  require(m.schemaVersion === 2 && validId(m.unit?.unitId) && validId(m.unit?.levelId));
  require(typeof m.unit.name === "string" && m.unit.name.trim() && Number.isSafeInteger(m.version) && m.version > 0);
  require(typeof m.publishedAt === "string" && Number.isFinite(Date.parse(m.publishedAt)));
  require(Array.isArray(m.resources) && m.resources.length > 0 && m.resources.length <= 200);
  const ids = new Set<string>();
  const sizes = new Map<string, number>();
  for (const r of m.resources) {
    require(r && validId(r.resourceId) && !ids.has(r.resourceId)); ids.add(r.resourceId);
    require(typeof r.name === "string" && typeof r.mimeType === "string" && typeof r.kind === "string");
    require(r.download?.endpoint === "activeClassroomPublicationFile" && validHash(r.download.checksums?.sha256));
    require(typeof r.download.mimeType === "string" && r.download.mimeType.length > 0);
    require(Number.isSafeInteger(r.download.sizeBytes) && r.download.sizeBytes >= 0 && r.download.sizeBytes <= publicationLimits.maxFileBytes);
    const hash = r.download.checksums.sha256;
    require(!sizes.has(hash) || sizes.get(hash) === r.download.sizeBytes); sizes.set(hash, r.download.sizeBytes);
  }
  const associations = (references: unknown): references is string[] => Array.isArray(references) && references.every((id) => ids.has(id)) && new Set(references).size === references.length;
  require(ids.has(m.mainPresentationId) && associations(m.generalResourceIds) && !m.generalResourceIds.includes(m.mainPresentationId));
  require(Array.isArray(m.slides) && m.slides.length > 0 && m.slides.length <= 200);
  const slides = new Set<string>();
  m.slides.forEach((slide, index) => {
    require(slide && validId(slide.slideId) && !slides.has(slide.slideId) && slide.index === index && associations(slide.resourceIds));
    slides.add(slide.slideId);
    const presentationResourceId = slide.metadata?.presentationResourceId;
    require(presentationResourceId == null || (validId(presentationResourceId) && ids.has(presentationResourceId)));
    validateSlideInteraction(slide, (id) => m.resources.find(resource => resource.resourceId === id));
  });
  require(m.integrity?.algorithm === "sha256" && validHash(m.integrity.contentHash));
  const content = Object.fromEntries(Object.entries(m).filter(([key]) => !["version", "publishedAt", "integrity"].includes(key)));
  require(await sha256(new TextEncoder().encode(canonical(content))) === m.integrity.contentHash);
  return m;
}
export function validateSlideInteraction(slide: PublishedSlide, resource: (id: string) => PublishedResource | undefined): void {
  const fail = () => { throw new SyncError("manifest", "Interactividad incompatible o incompleta."); };
  const mode = slide.interaction?.mode || slide.interactionMode || "static";
  if (slide.interactionMode != null && slide.interactionMode !== mode) fail();
  if (!["static", "builds"].includes(mode)) fail();
  const steps = slide.builds || [];
  if (mode === "static") { if (steps.length || slide.buildCount || slide.interaction?.buildCount) fail(); return; }
  if (!steps.length || steps.length > 50 || slide.interaction?.buildCount !== steps.length || slide.buildCount !== steps.length) fail();
  if (steps.reduce((count, step) => count + (step.layers?.length || 0), 0) > 50) fail();
  for (const [index, step] of steps.entries()) {
    if (step.order !== index + 1 || (!!step.resourceId === !!step.layers?.length)) fail();
    if (step.resourceId && resource(step.resourceId)?.download.mimeType !== "image/png") fail();
    if (step.layers && step.layers.length > 20) fail();
    for (const layer of step.layers || []) {
      if (!["text", "answer", "image"].includes(layer.type) || [layer.x, layer.y, layer.width, layer.height].some(value => !Number.isFinite(value) || value < 0 || value > 100) || layer.width <= 0 || layer.height <= 0 || layer.x + layer.width > 100 || layer.y + layer.height > 100) fail();
      if (layer.type === "image") { if (!layer.resourceId || !["image/png", "image/jpeg", "image/webp"].includes(resource(layer.resourceId)?.download.mimeType || "")) fail(); }
      else if (typeof layer.text !== "string" || !layer.text.trim() || layer.text.length > 2000 || !/^#[a-fA-F0-9]{6}$/.test(layer.color || "") || !Number.isFinite(layer.fontSize) || Number(layer.fontSize) < 0.5 || Number(layer.fontSize) > 20) fail();
    }
  }
}
export function localState(local?: Manifest, remote?: Publication): string {
  if (!local) return "No descargada";
  return remote && remote.version > local.version ? "Actualización disponible" : "Actualizada";
}
export function mediaKind(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (/^(image|audio|video)\//.test(mime)) return mime.split("/")[0];
  if (/presentation|powerpoint/.test(mime)) return "presentation";
  return "document";
}
