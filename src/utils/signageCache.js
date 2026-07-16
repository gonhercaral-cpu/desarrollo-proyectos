const SIGNAGE_ASSET_CACHE_NAME = "digital-signage-assets-v1";
const CACHEABLE_TYPES = new Set(["image", "video"]);

function canUseAssetCache() {
  return (
    typeof window !== "undefined" &&
    typeof window.caches !== "undefined" &&
    typeof window.fetch === "function" &&
    typeof window.URL?.createObjectURL === "function"
  );
}

function normalizeUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";

  try {
    return new URL(rawUrl, window.location.href).href;
  } catch {
    return "";
  }
}

function getCacheableUrls(items = []) {
  if (!Array.isArray(items)) return [];

  return Array.from(
    new Set(
      items
        .filter((item) => CACHEABLE_TYPES.has(item?.type))
        .map((item) => normalizeUrl(item?.url))
        .filter(Boolean)
    )
  );
}

export async function cacheSignageAssets(items = []) {
  if (!canUseAssetCache()) return;

  const urls = getCacheableUrls(items);
  if (!urls.length) return;

  try {
    const cache = await window.caches.open(SIGNAGE_ASSET_CACHE_NAME);

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const cachedResponse = await cache.match(url);
          if (cachedResponse) return;

          const response = await window.fetch(url, { cache: "reload" });
          if (!response?.ok) {
            console.warn("No se pudo cachear asset de Digital Signage.", url);
            return;
          }

          await cache.put(url, response.clone());
        } catch (error) {
          console.warn("No se pudo cachear asset de Digital Signage.", error);
        }
      })
    );
  } catch (error) {
    console.warn("No se pudo abrir cache de Digital Signage.", error);
  }
}

export async function getCachedAssetUrl(url) {
  if (!canUseAssetCache()) return "";

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return "";

  try {
    const cache = await window.caches.open(SIGNAGE_ASSET_CACHE_NAME);
    const response = await cache.match(normalizedUrl);
    if (!response) return "";

    const blob = await response.blob();
    if (!blob.size) return "";

    return window.URL.createObjectURL(blob);
  } catch (error) {
    console.warn("No se pudo leer asset cacheado de Digital Signage.", error);
    return "";
  }
}

export async function clearOldSignageCache(validUrls = []) {
  if (!canUseAssetCache()) return;

  const validUrlSet = new Set(validUrls.map(normalizeUrl).filter(Boolean));

  try {
    const cache = await window.caches.open(SIGNAGE_ASSET_CACHE_NAME);
    const cachedRequests = await cache.keys();

    await Promise.allSettled(
      cachedRequests.map((request) => {
        if (validUrlSet.has(request.url)) return Promise.resolve(false);
        return cache.delete(request);
      })
    );
  } catch (error) {
    console.warn("No se pudo limpiar cache de Digital Signage.", error);
  }
}
