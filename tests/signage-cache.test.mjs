import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAGE_CACHE_LIMITS,
  cacheSignageAssets,
  clearOldSignageCache,
  getCachedAssetUrl,
  getSignageCacheName,
  isNetworkTransferVerified,
  resolveAssetOrigin,
} from "../src/utils/signageCache.js";

const MB = 1024 * 1024;
let urlCounter = 0;

function nextUrl(extension = "png") {
  urlCounter += 1;
  return `https://cdn.test/asset-${urlCounter}.${extension}`;
}

function keyUrl(key) {
  return typeof key === "string" ? key : key.url;
}

function installEnvironment({ fetchImpl, quota = 10 * 1024 * MB, usage = 0 } = {}) {
  const stores = new Map();
  const putLog = [];

  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);

    return {
      async match(key) {
        const response = entries.get(keyUrl(key));
        return response ? response.clone() : undefined;
      },
      async put(key, response) {
        putLog.push({ name, url: keyUrl(key) });
        entries.set(keyUrl(key), response);
      },
      async keys() {
        return Array.from(entries.keys()).map((url) => ({ url }));
      },
      async delete(key) {
        return entries.delete(keyUrl(key));
      },
    };
  };

  globalThis.window = {
    caches: { open },
    fetch: fetchImpl,
    URL: { createObjectURL: () => "blob:signage-test" },
    location: { href: "https://player.test/signage/ds2_token" },
    navigator: { storage: { estimate: async () => ({ quota, usage }) } },
  };

  return { stores, putLog };
}

function imageResponse(size, { etag = "", length = true } = {}) {
  const headers = { "content-type": "image/png" };
  if (etag) headers.etag = etag;
  if (length) headers["content-length"] = String(size);
  return new Response(new Uint8Array(size).fill(7), { status: 200, headers });
}

afterEach(() => {
  delete globalThis.window;
});

test("guarda descarga completa en cache con scope del dispositivo, no en la legacy", async () => {
  const url = nextUrl();
  const { stores } = installEnvironment({ fetchImpl: async () => imageResponse(1024, { etag: '"v1"' }) });
  const options = { scope: "ds2_dispositivo_a" };

  const results = await cacheSignageAssets([{ type: "image", url }], options);

  assert.equal(results[0].status, "stored");
  assert.ok(stores.get(getSignageCacheName(options)).has(url));
  assert.equal(stores.has(getSignageCacheName()), false);
  assert.notEqual(getSignageCacheName(options), getSignageCacheName({ scope: "ds2_dispositivo_b" }));
  assert.ok(!getSignageCacheName(options).includes("ds2_dispositivo_a"));
  assert.equal(await getCachedAssetUrl(url, options), "blob:signage-test");
  assert.equal(await getCachedAssetUrl(url, { scope: "ds2_dispositivo_b" }), "");
});

test("rechaza respuestas opacas, no ok, tipo incorrecto y contentLength inconsistente", async () => {
  const urls = [nextUrl(), nextUrl(), nextUrl(), nextUrl()];
  const responses = new Map([
    [urls[0], { ok: true, status: 200, type: "opaque", headers: new Headers(), body: null }],
    [urls[1], new Response("nope", { status: 404 })],
    [urls[2], new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })],
    [
      urls[3],
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "999" },
      }),
    ],
  ]);
  const { stores } = installEnvironment({ fetchImpl: async (url) => responses.get(url) });

  const results = await cacheSignageAssets(urls.map((url) => ({ type: "image", url })));

  assert.deepEqual(results.map((result) => result.status), ["failed", "failed", "failed", "failed"]);
  assert.equal(stores.get(getSignageCacheName())?.size || 0, 0);
});

test("limita por archivo: contentLength declarado y lectura streaming sin contentLength", async () => {
  const declaredUrl = nextUrl("mp4");
  const streamedUrl = nextUrl("mp4");
  const chunk = new Uint8Array(16 * MB);

  const fetchImpl = async (url) => {
    if (url === declaredUrl) {
      return new Response(new Uint8Array(4), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(SIGNAGE_CACHE_LIMITS.maxFileBytes + 1),
        },
      });
    }

    let sent = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (sent >= 6) {
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(chunk);
        },
      }),
      { status: 200, headers: { "content-type": "video/mp4" } }
    );
  };
  const { stores } = installEnvironment({ fetchImpl });

  const results = await cacheSignageAssets([
    { type: "video", url: declaredUrl },
    { type: "video", url: streamedUrl },
  ]);

  assert.deepEqual(results.map((result) => result.status), ["failed", "failed"]);
  assert.equal(stores.get(getSignageCacheName())?.size || 0, 0);
});

test("respeta cuota de navigator.storage con margen del 20%", async () => {
  const url = nextUrl();
  const { stores } = installEnvironment({
    fetchImpl: async () => imageResponse(900),
    quota: 1000,
    usage: 100,
  });

  const [result] = await cacheSignageAssets([{ type: "image", url }]);

  // Disponible 900 * 0.8 = 720 < 900.
  assert.equal(result.status, "failed");
  assert.match(result.reason, /Cuota/);
  assert.equal(stores.get(getSignageCacheName())?.size || 0, 0);
});

test("respeta limite total por dispositivo", async () => {
  const existingUrl = nextUrl("mp4");
  const newUrl = nextUrl("mp4");
  const { stores } = installEnvironment({
    fetchImpl: async () => new Response(new Uint8Array(4), { status: 200, headers: { "content-type": "video/mp4" } }),
  });
  const cache = await globalThis.window.caches.open(getSignageCacheName());
  await cache.put(
    existingUrl,
    new Response(new Uint8Array(4), { headers: { "x-signage-size": String(SIGNAGE_CACHE_LIMITS.maxTotalBytes - 2) } })
  );

  const [result] = await cacheSignageAssets([{ type: "video", url: newUrl }]);

  assert.equal(result.status, "failed");
  assert.match(result.reason, /limite total/);
  assert.equal(stores.get(getSignageCacheName()).has(newUrl), false);
  assert.equal(stores.get(getSignageCacheName()).has(existingUrl), true);
});

test("deduplica descargas en vuelo y limita la concurrencia a 2", async () => {
  const urls = Array.from({ length: 5 }, () => nextUrl());
  const calls = new Map();
  let running = 0;
  let maxRunning = 0;

  const fetchImpl = async (url) => {
    calls.set(url, (calls.get(url) || 0) + 1);
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 15));
    running -= 1;
    return imageResponse(256);
  };
  installEnvironment({ fetchImpl });

  const items = urls.map((url) => ({ type: "image", url }));
  await Promise.all([cacheSignageAssets(items), cacheSignageAssets(items)]);

  assert.ok(maxRunning <= SIGNAGE_CACHE_LIMITS.maxConcurrent);
  urls.forEach((url) => assert.equal(calls.get(url), 1));

  const sequentialUrls = Array.from({ length: 5 }, () => nextUrl());
  running = 0;
  maxRunning = 0;
  await cacheSignageAssets(sequentialUrls.map((url) => ({ type: "image", url })));
  assert.equal(maxRunning, SIGNAGE_CACHE_LIMITS.maxConcurrent);
});

test("descarga interrumpida no reemplaza ni corrompe la entrada previa", async () => {
  const url = nextUrl();
  const { stores, putLog } = installEnvironment({
    fetchImpl: async () => {
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new Uint8Array(100));
              return;
            }
            controller.error(new Error("red interrumpida"));
          },
        }),
        { status: 200, headers: { "content-type": "image/png", etag: '"v2"' } }
      );
    },
  });
  const cache = await globalThis.window.caches.open(getSignageCacheName());
  await cache.put(
    url,
    new Response(new Uint8Array(8).fill(1), {
      headers: { "content-type": "image/png", "x-signage-etag": '"v1"', "x-signage-size": "8" },
    })
  );
  putLog.length = 0;

  const [result] = await cacheSignageAssets([{ type: "image", url }]);

  assert.equal(result.status, "cached");
  assert.equal(putLog.length, 0);
  const kept = await stores.get(getSignageCacheName()).get(url).clone().arrayBuffer();
  assert.equal(kept.byteLength, 8);
});

test("ETag igual conserva entrada; ETag distinto la reemplaza atomicamente", async () => {
  const sameUrl = nextUrl();
  const changedUrl = nextUrl();
  const seenCacheModes = [];
  const { putLog } = installEnvironment({
    fetchImpl: async (url, init) => {
      seenCacheModes.push(init.cache);
      return url === sameUrl ? imageResponse(8, { etag: '"v1"' }) : imageResponse(16, { etag: '"v2"' });
    },
  });
  const cache = await globalThis.window.caches.open(getSignageCacheName());
  for (const url of [sameUrl, changedUrl]) {
    await cache.put(
      url,
      new Response(new Uint8Array(8), { headers: { "x-signage-etag": '"v1"', "x-signage-size": "8" } })
    );
  }
  putLog.length = 0;

  const results = await cacheSignageAssets([
    { type: "image", url: sameUrl },
    { type: "image", url: changedUrl },
  ]);

  const statusByUrl = Object.fromEntries(results.map((result) => [result.url, result.status]));
  assert.deepEqual(statusByUrl, { [sameUrl]: "cached", [changedUrl]: "updated" });
  assert.deepEqual(putLog.map((entry) => entry.url), [changedUrl]);
  assert.deepEqual(seenCacheModes, ["no-cache", "no-cache"]);
});

test("clearOldSignageCache solo limpia el cache propio del dispositivo", async () => {
  const keepUrl = nextUrl();
  const staleUrl = nextUrl();
  const { stores } = installEnvironment({ fetchImpl: async () => imageResponse(8) });
  const scoped = { scope: "ds2_dispositivo_a" };
  const scopedCache = await globalThis.window.caches.open(getSignageCacheName(scoped));
  const legacyCache = await globalThis.window.caches.open(getSignageCacheName());

  await scopedCache.put(keepUrl, imageResponse(8));
  await scopedCache.put(staleUrl, imageResponse(8));
  await legacyCache.put(staleUrl, imageResponse(8));

  await clearOldSignageCache([keepUrl], scoped);

  assert.equal(stores.get(getSignageCacheName(scoped)).has(keepUrl), true);
  assert.equal(stores.get(getSignageCacheName(scoped)).has(staleUrl), false);
  assert.equal(stores.get(getSignageCacheName()).has(staleUrl), true);
});

test("origen: cache solo con blob persistido, stream solo con bytes de red verificados", () => {
  assert.equal(resolveAssetOrigin(["cache"]), "cache");
  assert.equal(resolveAssetOrigin(["network"]), "stream");
  assert.equal(resolveAssetOrigin(["cache", "network"]), "mixed");
  assert.equal(resolveAssetOrigin(["cache", "unverified"]), "unknown");
  assert.equal(resolveAssetOrigin(["unverified"]), "unknown");
  assert.equal(resolveAssetOrigin([]), "unknown");

  globalThis.window = { location: { href: "https://player.test/" } };
  const url = "https://cdn.test/a.png";
  const performanceRef = {
    getEntriesByName: (name) => (name === url ? [{ transferSize: 0 }, { transferSize: 2048 }] : [{ transferSize: 0 }]),
  };

  assert.equal(isNetworkTransferVerified(url, performanceRef), true);
  assert.equal(isNetworkTransferVerified(url, { getEntriesByName: () => [{ transferSize: 2048 }, { transferSize: 0 }] }), false);
  assert.equal(isNetworkTransferVerified(url, { getEntriesByName: () => [{ transferSize: 2048, initiatorType: "fetch" }] }, "img"), false);
  assert.equal(isNetworkTransferVerified("https://cdn.test/b.png", performanceRef), false);
  assert.equal(isNetworkTransferVerified(url, {}), false);
});
