import { test } from "node:test";
import assert from "node:assert/strict";
import { probeMediaRanges } from "./media-range-probe.mjs";

const source = { url: "http://127.0.0.1:1234/media/test", sizeBytes: 1024 * 1024 * 1024 };
function fixture({ fullStatus = 200, fullLength = source.sizeBytes, readError, empty = false, rangeStatus = 206, invalidStatus = 416 } = {}) {
  const events = []; let signal;
  const body = label => ({ async cancel() { events.push(label); } });
  const request = async (_url, options) => {
    if (options.headers?.Range === "bytes=0-1") return { status: rangeStatus, headers: new Headers({ "Accept-Ranges": "bytes", "Content-Length": "2", "Content-Type": "video/mp4" }), body: body("range-cancel") };
    if (options.headers?.Range) return { status: invalidStatus, body: body("invalid-cancel") };
    signal = options.signal;
    signal.addEventListener("abort", () => events.push("abort"), { once: true });
    return { status: fullStatus, headers: new Headers({ "Content-Length": String(fullLength) }), body: { getReader() { return {
      async read() { events.push("read"); if (readError) throw readError; return { value: new Uint8Array(empty ? 0 : 64 * 1024) }; },
      async cancel() { events.push("reader-cancel"); },
      releaseLock() { events.push("release-lock"); },
    }; } } };
  };
  return { request, events, signal: () => signal };
}

test("sonda 200 lee un chunk, aborta transporte, cancela y libera el reader antes de salir", async () => {
  const f = fixture(); await probeMediaRanges(source, f.request);
  assert.equal(f.signal().aborted, true);
  assert.deepEqual(f.events, ["range-cancel", "read", "abort", "reader-cancel", "release-lock", "invalid-cancel"]);
});

test("fallo de lectura también aborta y libera sin ocultar el error", async () => {
  const failure = new Error("read failed"); const f = fixture({ readError: failure });
  await assert.rejects(probeMediaRanges(source, f.request), error => error === failure);
  assert.deepEqual(f.events.slice(-3), ["abort", "reader-cancel", "release-lock"]);
});

test("conserva comprobaciones estrictas de 206, 200, tamaño, bytes y 416", async () => {
  for (const options of [{ rangeStatus: 200 }, { fullStatus: 206 }, { fullLength: 0 }, { empty: true }, { invalidStatus: 200 }]) {
    const f = fixture(options); await assert.rejects(probeMediaRanges(source, f.request));
    if (f.signal()) assert.equal(f.signal().aborted, true);
  }
});
