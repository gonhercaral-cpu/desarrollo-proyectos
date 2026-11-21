const LEGACY_CACHE_NAME = "digital-signage-assets-v1";
const SCOPED_CACHE_PREFIX = "digital-signage-assets-v2-";
const CACHEABLE_TYPES = new Set(["image", "video"]);
const ETAG_HEADER = "x-signage-etag";
const SIZE_HEADER = "x-signage-size";

export const SIGNAGE_CACHE_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxConcurrent: 2,
  quotaMargin: 0.2,
  revalidateIntervalMs: 10 * 60 * 1000,
});

const inFlightDownloads = new Map();
const commitLocks = new Map();
const lastRevalidation = new Map();
let activeDownloads = 0;
const downloadWaiters = [];

async function withDownloadSlot(task) {
  if (activeDownloads >= SIGNAGE_CACHE_LIMITS.maxConcurrent) {
    await new Promise((resolve) => downloadWaiters.push(resolve));
  } else activeDownloads += 1;
  try { return await task(); }
  finally {
    const next = downloadWaiters.shift();
    if (next) next();
    else activeDownloads -= 1;
  }
}

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
    return new URL(rawUrl, window.location?.href).href;
  } catch {
    return "";
  }
}

function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Clave corta no reversible: el token del dispositivo nunca se guarda en nombres de cache/storage.
export function getSignageScopeKey(scope) {
  const text = String(scope || "").trim();
  if (!text) return "";
  return fnv1a(text, 0x811c9dc5) + fnv1a(text.split("").reverse().join(""), 0x01000193);
}

export function getSignageCacheName(options = {}) {
  const scopeKey = getSignageScopeKey(options?.scope);
  return scopeKey ? `${SCOPED_CACHE_PREFIX}${scopeKey}` : LEGACY_CACHE_NAME;
}

function getCacheableEntries(items = []) {
  if (!Array.isArray(items)) return [];

  const byUrl = new Map();
  items.forEach((item) => {
    if (!CACHEABLE_TYPES.has(item?.type)) return;
    const url = normalizeUrl(item?.url);
    if (url && !byUrl.has(url)) byUrl.set(url, { url, type: item.type });
  });

  return Array.from(byUrl.values());
}

function parseLength(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cancelBody(response) {
  try {
    const result = response?.body?.cancel?.();
    if (result?.catch) result.catch(() => {});
  } catch {
    // Cuerpo ya consumido o bloqueado.
  }
}

function assertValidResponse(response, type) {
  if (!response || response.type === "opaque" || response.type === "opaqueredirect") {
    throw new Error("Respuesta opaca no cacheable");
  }
  if (!response.ok || response.status !== 200) {
    throw new Error(`Respuesta HTTP ${response.status} no cacheable`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (
    contentType &&
    !contentType.startsWith(`${type}/`) &&
    !contentType.startsWith("application/octet-stream")
  ) {
    throw new Error(`Tipo ${contentType} no coincide con ${type}`);
  }

  const declared = parseLength(response.headers.get("content-length"));
  if (declared !== null && declared > SIGNAGE_CACHE_LIMITS.maxFileBytes) {
    throw new Error("Archivo excede el limite por archivo");
  }
}

async function readBodyLimited(response, maxBytes) {
  const chunks = [];
  let received = 0;

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Archivo excede el limite por archivo");
        }
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Lector ya liberado.
      }
    }
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("Archivo excede el limite por archivo");
    received = buffer.byteLength;
    chunks.push(new Uint8Array(buffer));
  }

  return { chunks, size: received };
}

function getKeyUrl(key) {
  return typeof key === "string" ? key : key?.url || "";
}

async function getEntrySize(response) {
  const stored = parseLength(response.headers.get(SIZE_HEADER));
  if (stored !== null) return stored;
  const declared = parseLength(response.headers.get("content-length"));
  if (declared !== null) return declared;
  return (await response.blob()).size;
}

async function getCacheTotalBytes(cache, excludeUrl = "") {
  const keys = await cache.keys();
  let total = 0;

  for (const key of keys) {
    if (getKeyUrl(key) === excludeUrl) continue;
    const response = await cache.match(key);
    if (response) total += await getEntrySize(response);
  }

  return total;
}

async function assertStorageQuota(size) {
  const estimate = window.navigator?.storage?.estimate;
  if (typeof estimate !== "function") return;

  const { quota, usage } = (await window.navigator.storage.estimate()) || {};
  if (!Number.isFinite(quota) || quota <= 0) return;

  const available = (quota - (Number(usage) || 0)) * (1 - SIGNAGE_CACHE_LIMITS.quotaMargin);
  if (size > available) throw new Error("Cuota de almacenamiento insuficiente");
}

function withCommitLock(cacheName, task) {
  const previous = commitLocks.get(cacheName) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  commitLocks.set(
    cacheName,
    next.catch(() => {})
  );
  return next;
}

async function storeResponse(cache, cacheName, url, type, response) {
  try { assertValidResponse(response, type); }
  catch (error) { cancelBody(response); throw error; }

  const declared = parseLength(response.headers.get("content-length"));
  if (declared !== null) {
    try { await assertStorageQuota(declared); }
    catch (error) { cancelBody(response); throw error; }
  }
  const encoded = Boolean(response.headers.get("content-encoding"));
  const { chunks, size } = await readBodyLimited(response, SIGNAGE_CACHE_LIMITS.maxFileBytes);

  if (size === 0) throw new Error("Archivo vacio");
  if (declared !== null && !encoded && declared !== size) {
    throw new Error("Tamano descargado no coincide con content-length");
  }

  const contentType = response.headers.get("content-type") || "";
  const etag = response.headers.get("etag") || "";
  const blob = new Blob(chunks, { type: contentType });

  // Solo una respuesta completa y validada llega a cache.put; la entrada previa sobrevive si algo falla.
  await withCommitLock(cacheName, async () => {
    const othersBytes = await getCacheTotalBytes(cache, url);
    if (othersBytes + size > SIGNAGE_CACHE_LIMITS.maxTotalBytes) {
      throw new Error("Cache del dispositivo excede el limite total");
    }
    await assertStorageQuota(size);

    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    if (etag) headers.set(ETAG_HEADER, etag);
    headers.set(SIZE_HEADER, String(size));

    await cache.put(url, new Response(blob, { status: 200, headers }));
  });

  return size;
}

async function cacheEntry(cache, cacheName, entry, options) {
  const { url, type } = entry;
  const fetchOptions = (extra) => ({ ...extra, ...(options.signal ? { signal: options.signal } : {}) });
  const existing = await cache.match(url);

  if (existing) {
    const storedEtag = existing.headers.get(ETAG_HEADER);
    const revalidationKey = `${cacheName}|${url}`;
    const lastCheck = lastRevalidation.get(revalidationKey) || 0;
    const due = Date.now() - lastCheck >= SIGNAGE_CACHE_LIMITS.revalidateIntervalMs;

    if (!due) return { url, status: "cached" };
    lastRevalidation.set(revalidationKey, Date.now());

    try {
      const response = await window.fetch(url, fetchOptions({ cache: "no-cache" }));
      const remoteEtag = response?.headers?.get("etag") || "";

      if (
        !response ||
        response.status === 304 ||
        !response.ok ||
        (remoteEtag && remoteEtag === storedEtag)
      ) {
        cancelBody(response);
        return { url, status: "cached" };
      }

      await storeResponse(cache, cacheName, url, type, response);
      return { url, status: "updated" };
    } catch (error) {
      return { url, status: "cached", reason: error?.message || "revalidacion fallida" };
    }
  }

  try {
    const response = await window.fetch(url, fetchOptions({ cache: "reload" }));
    await storeResponse(cache, cacheName, url, type, response);
    return { url, status: "stored" };
  } catch (error) {
    return { url, status: "failed", reason: error?.message || "descarga fallida" };
  }
}

function cacheEntryDeduped(cache, cacheName, entry, options) {
  const key = `${cacheName}|${entry.url}`;
  const running = inFlightDownloads.get(key);
  if (running) {
    if (running.signal?.aborted && !options.signal?.aborted) {
      return running.promise.then(() => cacheEntryDeduped(cache, cacheName, entry, options));
    }
    return running.promise;
  }

  const promise = withDownloadSlot(() => {
    if (options.signal?.aborted) return { url: entry.url, status: "failed", reason: "Descarga cancelada" };
    return cacheEntry(cache, cacheName, entry, options);
  })
    .catch((error) => ({ url: entry.url, status: "failed", reason: error?.message || "error" }))
    .finally(() => inFlightDownloads.delete(key));

  inFlightDownloads.set(key, { promise, signal: options.signal });
  return promise;
}

export async function cacheSignageAssets(items = [], options = {}) {
  const results = [];
  if (!canUseAssetCache()) return results;

  const entries = getCacheableEntries(items);
  if (!entries.length) return results;

  try {
    const cacheName = getSignageCacheName(options);
    const cache = await window.caches.open(cacheName);
    const queue = [...entries];
    const workerCount = Math.min(SIGNAGE_CACHE_LIMITS.maxConcurrent, queue.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length && !options.signal?.aborted) {
          const result = await cacheEntryDeduped(cache, cacheName, queue.shift(), options);
          if (result.status === "failed") {
            console.warn("No se pudo cachear asset de Digital Signage.", result.url, result.reason);
          }
          results.push(result);
        }
      })
    );
  } catch (error) {
    console.warn("No se pudo abrir cache de Digital Signage.", error);
  }

  return results;
}

export async function getCachedAssetUrl(url, options = {}) {
  if (!canUseAssetCache()) return "";

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return "";

  try {
    const cache = await window.caches.open(getSignageCacheName(options));
    const response = await cache.match(normalizedUrl);
    if (!response) return "";

    const declaredSize = parseLength(response.headers.get(SIZE_HEADER) || response.headers.get("content-length"));
    if (declaredSize !== null && declaredSize > SIGNAGE_CACHE_LIMITS.maxFileBytes) return "";
    const { chunks, size } = await readBodyLimited(response, SIGNAGE_CACHE_LIMITS.maxFileBytes);
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "" });
    if (size > SIGNAGE_CACHE_LIMITS.maxFileBytes) return "";
    if (!blob.size) return "";

    const expectedSize = parseLength(response.headers.get(SIZE_HEADER));
    if (expectedSize !== null && expectedSize !== blob.size) return "";

    return window.URL.createObjectURL(blob);
  } catch (error) {
    console.warn("No se pudo leer asset cacheado de Digital Signage.", error);
    return "";
  }
}

export async function clearOldSignageCache(validUrls = [], options = {}) {
  if (!canUseAssetCache()) return;

  const validUrlSet = new Set(validUrls.map(normalizeUrl).filter(Boolean));

  try {
    const cache = await window.caches.open(getSignageCacheName(options));
    const cachedRequests = await cache.keys();

    await Promise.allSettled(
      cachedRequests.map((request) => {
        if (validUrlSet.has(getKeyUrl(request))) return Promise.resolve(false);
        return cache.delete(request);
      })
    );
  } catch (error) {
    console.warn("No se pudo limpiar cache de Digital Signage.", error);
  }
}

// Bytes realmente transferidos por red (performance); cache HTTP del navegador no cuenta como verificado.
export function isNetworkTransferVerified(url, performanceRef = globalThis.performance, initiatorType) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl || typeof performanceRef?.getEntriesByName !== "function") return false;

  const entries = performanceRef.getEntriesByName(normalizedUrl)
    .filter((entry) => !initiatorType || entry.initiatorType === initiatorType);
  return Number(entries.at(-1)?.transferSize) > 0;
}

// sources: "cache" (blob persistido), "network" (bytes verificados) o "unverified".
export function resolveAssetOrigin(sources = []) {
  if (!Array.isArray(sources) || sources.length === 0) return "unknown";
  if (sources.some((source) => source !== "cache" && source !== "network")) return "unknown";

  const hasCache = sources.includes("cache");
  const hasNetwork = sources.includes("network");
  if (hasCache && hasNetwork) return "mixed";
  return hasCache ? "cache" : "stream";
}
