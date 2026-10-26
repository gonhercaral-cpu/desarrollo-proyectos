import type { LocalClassroom, RendererSource, ResolvedLayer } from "./types.ts";

export async function preloadAnimationImage(source: RendererSource): Promise<void> {
  const image = new Image();
  image.src = source.url;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([image.decode(), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("animation-load-timeout")), 10000); })]); }
  finally { clearTimeout(timeout); image.removeAttribute("src"); }
}

// Optional enhancement: the complete static slide remains available to older clients.
export async function animatedSource(
  classroom: LocalClassroom,
  resourceId: string,
  fallback: RendererSource,
  load: (id: string) => Promise<RendererSource>,
  preload = preloadAnimationImage,
): Promise<RendererSource> {
  const animation = classroom.manifest.resources.find(resource => resource.resourceId === resourceId)?.animation;
  if (!animation) return fallback;
  try {
    const sources = await Promise.all([animation.backgroundResourceId, ...animation.images.map(image => image.resourceId)].map(load));
    await Promise.all(sources.map(preload));
    const layers: ResolvedLayer[] = animation.images.map((image, index) => ({ type: "image", x: image.x, y: image.y, width: image.width, height: image.height, url: sources[index + 1].url, fit: "fill" }));
    return { ...sources[0], name: fallback.name, layers };
  } catch {
    return fallback;
  }
}
