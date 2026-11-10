import type { LocalClassroom, RendererSource, ResolvedLayer } from "./types.ts";

export async function preloadAnimationImage(source: RendererSource, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const image = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("animation-load-timeout")), 10000);
      onAbort = () => reject(new Error("animation-load-aborted"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    image.src = source.url;
    await Promise.race([image.decode(), cancelled]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    image.onload = null; image.onerror = null; image.removeAttribute("src");
  }
}

const ANIMATION_CONCURRENCY = 2;

// At most `limit` jobs in flight; results keep input order. Stops claiming jobs once aborted; an error aborts the controller.
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  controller: AbortController,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    while (!controller.signal.aborted && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index]);
      } catch (error) {
        controller.abort();
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

// Optional enhancement: the complete static slide remains available to older clients.
export async function animatedSource(
  classroom: LocalClassroom,
  resourceId: string,
  fallback: RendererSource,
  load: (id: string) => Promise<RendererSource>,
  preload: (source: RendererSource, signal?: AbortSignal) => Promise<void> = preloadAnimationImage,
  signal?: AbortSignal,
): Promise<RendererSource> {
  const animation = classroom.manifest.resources.find(resource => resource.resourceId === resourceId)?.animation;
  if (!animation || signal?.aborted) return fallback;
  const internal = new AbortController();
  const onAbort = () => internal.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const ids = [animation.backgroundResourceId, ...animation.images.map(image => image.resourceId)];
    const sources = await mapLimited(ids, ANIMATION_CONCURRENCY, internal, async id => {
      const source = await load(id);
      if (!internal.signal.aborted) await preload(source, internal.signal);
      return source;
    });
    if (internal.signal.aborted) return fallback;
    const layers: ResolvedLayer[] = animation.images.map((image, index) => ({ type: "image", x: image.x, y: image.y, width: image.width, height: image.height, url: sources[index + 1].url, fit: "fill" }));
    return { ...sources[0], name: fallback.name, layers };
  } catch {
    return fallback;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
