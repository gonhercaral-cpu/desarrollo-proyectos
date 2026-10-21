import assert from "node:assert/strict";

// x264 common/tables.c: Baseline MaxBR is 14 Mb/s for 3.1, 240 Mb/s for 5.1.
// https://github.com/mirror/x264/blob/master/common/tables.c
// A large encoded file must not falsely advertise the much smaller level.
// This validates only the two levels used by native acceptance fixtures.
export function validateEncodedFixture(probe) {
  const video = probe.streams?.find(stream => stream.codec_type === "video");
  const audio = probe.streams?.find(stream => stream.codec_type === "audio");
  assert.equal(video?.codec_name, "h264");
  assert.equal(video.profile, "Constrained Baseline");
  assert.equal(video.pix_fmt, "yuv420p");
  assert.equal(video.width, 1280); assert.equal(video.height, 720);
  assert.equal(audio?.codec_name, "aac");
  const maxBitrate = new Map([[31, 14000000], [51, 240000000]]).get(video.level);
  const bitrate = Number(video.bit_rate);
  assert.ok(maxBitrate && Number.isFinite(bitrate) && bitrate > 0 && bitrate <= maxBitrate, "Fixture H.264 excede el nivel declarado");
  assert.ok(bitrate >= 150000000, "No reducir bitrate del fixture de estrés para pasar aceptación");
  const size = Number(probe.format?.size); const duration = Number(probe.format?.duration);
  assert.ok(Number.isSafeInteger(size) && size > 500 * 1024 * 1024, "Fixture codificado debe superar 500 MiB");
  assert.ok(Number.isFinite(duration) && duration > 20, "Duración del fixture inválida");
  return { size, duration, level: video.level, bitrate, maxBitrate, width: video.width, height: video.height, pixelFormat: video.pix_fmt };
}
