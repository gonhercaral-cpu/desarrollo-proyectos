import assert from "node:assert/strict";
import { test } from "node:test";
import { playAndObserve } from "./media-play-observer.mjs";

function fixture({ promisePending = false, clock = true, frames = true, fatal = false } = {}) {
  let now = 0; let callback; let cancelled = false;
  const media = { currentTime: 1, paused: true, seeking: false, readyState: 4, networkState: 1, buffered: { length: 1, start: () => 0, end: () => 8 }, requestVideoFrameCallback(value) { callback = value; return 1; }, cancelVideoFrameCallback() { cancelled = true; } };
  const renderer = { media, state: {}, command() { media.paused = false; return promisePending ? new Promise(() => {}) : Promise.resolve(); } };
  const options = { timeoutMs: 100, now: () => now, async wait(ms) { now += ms; if (clock) media.currentTime += .04; if (fatal) media.error = { code: 3 }; if (frames) callback(now, { mediaTime: media.currentTime }); } };
  return { renderer, options, cancelled: () => cancelled };
}

test("reanudar exige reloj e imagen real aunque play() siga pendiente", async () => {
  const fixtureValue = fixture({ promisePending: true });
  const result = await playAndObserve(fixtureValue.renderer, fixtureValue.options);
  assert.equal(result.commandSettled, false); assert.ok(result.frameTime > 1.05); assert.equal(fixtureValue.cancelled(), true);
});

test("resolver play() sin reloj o sin imagen nunca aprueba reproducción", async () => {
  for (const options of [{ clock: false }, { frames: false }, { fatal: true }]) {
    const fixtureValue = fixture(options);
    await assert.rejects(playAndObserve(fixtureValue.renderer, fixtureValue.options), /did not present moving frames/);
    assert.equal(fixtureValue.cancelled(), true);
  }
});

test("reproducción y frames no ocultan rechazo del motor ni errores del renderer", async () => {
  const value = fixture(); value.renderer.command = () => Promise.reject(new Error("Blocked"));
  await assert.rejects(playAndObserve(value.renderer, value.options), /did not present moving frames/);
  const second = fixture(); second.renderer.state.error = "Read failed";
  await assert.rejects(playAndObserve(second.renderer, second.options), /Read failed/);
  const third = fixture(); delete third.renderer.media.requestVideoFrameCallback;
  await assert.rejects(playAndObserve(third.renderer, third.options), /observation unavailable/);
});
