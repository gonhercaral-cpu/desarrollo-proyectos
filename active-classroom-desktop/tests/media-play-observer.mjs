// Native acceptance only: validate what was presented, not just whether the
// engine settled play(). Some WebKit resumes keep that promise pending.
export async function playAndObserve(renderer, { timeoutMs = 8000, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const media = renderer.media;
  if (!media?.requestVideoFrameCallback) throw new Error("Native presented-frame observation unavailable");
  const initialTime = media.currentTime;
  const deadline = now() + timeoutMs;
  let frameTime = initialTime;
  let callback;
  let settled = false;
  let rejected;
  const observe = (_now, metadata) => { frameTime = metadata.mediaTime; callback = media.requestVideoFrameCallback(observe); };
  callback = media.requestVideoFrameCallback(observe);
  const moved = () => !media.paused && !media.seeking && media.currentTime > initialTime + .05 && frameTime > initialTime + .03;
  try {
    Promise.resolve(renderer.command("PLAY_PAUSE")).then(() => { settled = true; }, error => { rejected = error; });
    while (!moved() && !rejected && !media.error && !renderer.state?.error && now() < deadline) await wait(20);
    if (!moved() || rejected || media.error || renderer.state?.error) {
      const buffered = Array.from({ length: media.buffered?.length || 0 }, (_, index) => [media.buffered.start(index), media.buffered.end(index)]);
      throw new Error(`Native playback did not present moving frames: ${JSON.stringify({ initialTime, time: media.currentTime, frameTime, paused: media.paused, seeking: media.seeking, readyState: media.readyState, networkState: media.networkState, code: media.error?.code || 0, buffered, commandSettled: settled, rejected: rejected?.name, rendererError: renderer.state?.error || "" })}`);
    }
    return { initialTime, time: media.currentTime, frameTime, commandSettled: settled };
  } finally { media.cancelVideoFrameCallback(callback); }
}
