// Exercise the real HTTP responses without keeping a Fetch body/reader alive
// throughout video playback. WebKit can otherwise retain prefetched buffers.
export async function probeMediaRanges(source, request = fetch) {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const response = await request(source.url, { headers: { Range: "bytes=0-1" } });
  assert(response.status === 206 && response.headers.get("Accept-Ranges") === "bytes" && response.headers.get("Content-Length") === "2" && response.headers.get("Content-Type") === "video/mp4", "Range probe del WebView falló");
  await response.body?.cancel();
  const abort = new AbortController();
  let reader;
  try {
    const full = await request(source.url, { signal: abort.signal });
    assert(full.status === 200 && Number(full.headers.get("Content-Length")) === source.sizeBytes, "Respuesta sin Range inválida");
    reader = full.body.getReader();
    const chunk = await reader.read();
    assert(chunk.value?.length > 0, "Streaming sin Range vacío");
  } finally {
    // Cancel the native request as well as the JS stream, then release the lock.
    // Merely awaiting reader.cancel() left WebKit's Fetch buffers until GC.
    abort.abort();
    try { await reader?.cancel(); }
    catch (error) { if (error?.name !== "AbortError") throw error; }
    finally { reader?.releaseLock(); }
  }
  const invalid = await request(source.url, { headers: { Range: `bytes=${source.sizeBytes}-` } });
  assert(invalid.status === 416, "Range inválido debe devolver 416");
  await invalid.body?.cancel();
}
