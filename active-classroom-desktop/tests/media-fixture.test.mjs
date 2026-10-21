import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEncodedFixture } from "./media-fixture.mjs";

const fixture = () => ({ streams: [{ codec_type: "video", codec_name: "h264", profile: "Constrained Baseline", pix_fmt: "yuv420p", width: 1280, height: 720, level: 51, bit_rate: "171792327" }, { codec_type: "audio", codec_name: "aac" }], format: { size: "607162300", duration: "28.263" } });
test("fixture de 607 MB conserva resolución y bitrate con un nivel H.264 válido", () => {
  assert.deepEqual(validateEncodedFixture(fixture()), { size: 607162300, duration: 28.263, level: 51, bitrate: 171792327, maxBitrate: 240000000, width: 1280, height: 720, pixelFormat: "yuv420p" });
});
test("rechaza el fixture anterior: 171.8 Mb/s declarado como nivel 3.1", () => {
  const probe = fixture(); probe.streams[0].level = 31;
  assert.throws(() => validateEncodedFixture(probe), /excede el nivel declarado/);
});
test("no admite reducir tamaño, resolución ni eliminar audio para pasar aceptación", () => {
  for (const mutate of [p => { p.format.size = String(500 * 1024 * 1024); }, p => { p.streams[0].width = 640; }, p => { p.streams.pop(); }, p => { delete p.streams[0].bit_rate; }, p => { p.streams[0].bit_rate = "10000000"; }]) {
    const probe = fixture(); mutate(probe); assert.throws(() => validateEncodedFixture(probe));
  }
});
