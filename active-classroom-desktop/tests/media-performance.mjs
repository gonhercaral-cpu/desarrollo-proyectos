import { invoke } from "@tauri-apps/api/core";
import { ClassroomPlayer } from "../src/player/ClassroomPlayer.ts";
import { VideoRenderer } from "../src/player/renderers/VideoRenderer.ts";
import { DesktopSettingsPanel } from "../src/settings/panel.ts";
import { ProgramUpdater } from "../src/updater/controller.ts";
import { StartupPreferences } from "../src/startup/controller.ts";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate, seconds = 10) { const deadline = performance.now() + seconds * 1000; while (!predicate() && performance.now() < deadline) await wait(20); check(predicate(), "Performance media state timeout"); }
export async function mediaPerformance(fixture) {
  localStorage.setItem("active-classroom-media-diagnostics", "true");
  const events = []; const diagnostic = event => events.push(event.detail); window.addEventListener("classroom-media-diagnostic", diagnostic);
  const host = document.createElement("div"); document.body.append(host);
  const manifest = structuredClone(fixture.manifest); manifest.resources[0].download.mimeType = "video/mp4"; manifest.resources[0].kind = "video";
  let mounts = 0; const snapshots = [];
  const bridge = { async status() { return { monitors: [{ id: "one", name: "Primary", primary: true, width: 1920, height: 1080, x: 0, y: 0 }, { id: "two", name: "Secondary", primary: false, width: 1920, height: 1080, x: 1920, y: 0 }], projecting: true, message: "Connected" }; }, async show() {}, async hide() { await invoke("fixture_project", { snapshot: null }); }, async publish(snapshot) { snapshots.push(snapshot.revision); await invoke("fixture_project", { snapshot }); } };
  const renderer = new VideoRenderer(); const originalMount = renderer.mount.bind(renderer); renderer.mount = (...args) => { mounts++; return originalMount(...args); };
  const player = new ClassroomPlayer(host, { manifest, resolveResource() { return { path: "/cache/fixture", mimeType: "video/mp4", name: "Performance video", kind: "video" }; } }, () => {}, { verifyResource: async () => true, prepareMediaSource: async () => fixture.performanceSource, createRenderer: async () => renderer, projectionBridge: bridge });
  let structuralMutations = 0;
  const observer = new MutationObserver(records => { structuralMutations += records.filter(record => record.type === "childList" && !record.target.closest?.("[data-media],[data-time],[data-status]" )).length; });
  observer.observe(host, { subtree: true, childList: true });
  try {
    await until(() => host.querySelector("video")?.readyState >= 3 && !renderer.state.loading);
    const media = host.querySelector("video"); const original = media;
    const measurementStarted = performance.now();
    const before = { memory: await invoke("fixture_memory"), streams: await invoke("fixture_metrics") };
    const click = performance.now(); const playing = new Promise(resolve => media.addEventListener("playing", () => resolve(performance.now() - click), { once: true }));
    await player.dispatch("PLAY_PAUSE"); const firstPlayMs = await playing;
    await wait(30000); check(!media.paused && media.currentTime > 25, "Video did not play 30 seconds");
    const seeks = [];
    for (const command of ["SEEK_FORWARD", "SEEK_BACKWARD", "SEEK_FORWARD"]) {
      const started = performance.now(); const target = Math.max(0, Math.min(media.duration, media.currentTime + (command === "SEEK_FORWARD" ? 100 : -100))); let seekEvents = 0; const seeking = () => seekEvents++; media.addEventListener("seeking", seeking);
      for (let index = 0; index < 10; index++) { await player.dispatch(command); await wait(10); }
      await until(() => !renderer.state.seeking && !media.seeking); await until(() => !media.paused && media.readyState >= 2);
      check(Math.abs(media.currentTime - target) < 1, "Last coalesced seek missed its target");
      await wait(1000);
      seeks.push({ command, target, elapsedMs: performance.now() - started, seekingEvents: seekEvents, currentTime: media.currentTime, streams: await invoke("fixture_metrics") }); media.removeEventListener("seeking", seeking);
    }
    const progress = []; const start = performance.now();
    for (let index = 0; index < 120; index++) {
      await wait(1000); const audience = await invoke("fixture_audience_state"); const quality = media.getVideoPlaybackQuality?.();
      progress.push({ time: media.currentTime, readyState: media.readyState, seeking: media.seeking, paused: media.paused, audienceTime: audience.time, audiencePaused: audience.paused, audienceFrames: audience.frames, audienceDroppedFrames: audience.droppedFrames, frames: quality?.totalVideoFrames, droppedFrames: quality?.droppedVideoFrames });
      check(host.querySelector("video") === original, "Video remounted during playback");
      check(audience.videos === 1 && !audience.paused && Math.abs(audience.time - media.currentTime) < 1, `Projector stopped or lost playback synchronization: ${JSON.stringify({ audience, teacher: { time: media.currentTime, paused: media.paused, seeking: renderer.state.seeking, buffering: renderer.state.buffering } })}`);
    }
    check(progress.at(-1).time - progress[0].time > 115, "Video stalled during continuous 120 seconds");
    check(progress.every(sample => !sample.paused && sample.readyState >= 2), "Playback lost continuity");
    if (progress.every(sample => Number.isFinite(sample.frames))) check(progress.slice(1).every((sample,index) => sample.frames - progress[index].frames >= 5), "Decoder reduced playback to isolated frames");
    if (progress.every(sample => Number.isFinite(sample.audienceFrames))) check(progress.slice(1).every((sample,index) => sample.audienceFrames - progress[index].audienceFrames >= 5), "Projector decoder reduced playback to isolated frames");
    check(!events.some(event => event.event === "error" && event.mediaErrorCode), "Fatal MediaError during stress");
    const audience = await invoke("fixture_audience_state"); check(audience.videos === 1 && audience.audio === 0 && !audience.error, "Projection duplicated audio or failed");
    const after = { memory: await invoke("fixture_memory"), streams: await invoke("fixture_metrics") };
    const measurementMs = performance.now() - measurementStarted;
    player.destroy(); await wait(1000);
    const closed = await invoke("fixture_metrics");
    const updater = new ProgramUpdater({ async action() { return updater.status; }, async listen() { return () => {}; } }, () => {});
    const preferences = new StartupPreferences(async () => ({ autostart: true, kiosk: true, kioskActive: false, launchedAutomatically: false }), () => {});
    const panel = new DesktopSettingsPanel(updater, preferences); updater.status = { phase: "downloading", currentVersion: "1.0.14", newVersion: "1.0.15", downloaded: 0, total: 100, message: "Downloading" }; panel.open("about"); await wait(30);
    const dialog = document.querySelector("[data-settings-dialog]"); const navigation = dialog.querySelector("nav"); const scroll = dialog.querySelector(".settings-content"); let replacements = 0;
    for (let index = 1; index <= 100; index++) { updater.status.downloaded = index; panel.refresh(); if (document.querySelector("[data-settings-dialog]") !== dialog) replacements++; }
    const settings = { progressEvents: 100, replacements, navigationStable: document.querySelector("[data-settings-dialog] nav") === navigation, contentStable: document.querySelector(".settings-content") === scroll }; panel.destroy();
    check(settings.replacements === 0 && settings.navigationStable && settings.contentStable, "Updater remounted Settings during progress");
    check(mounts === 1 && structuralMutations < 100, "Playback rebuilt structural UI");
    check(seeks.every(seek => seek.seekingEvents <= 3), "Keyboard burst queued uncoalesced seeks");
    check(closed.active === 0, "Closed playback left abandoned streams");
    check(after.streams.opened - before.streams.opened === (after.streams.completed - before.streams.completed) + (after.streams.cancelled - before.streams.cancelled) + after.streams.active - before.streams.active, "Range streams leaked");
    return { firstPlayMs, events, seeks, mounts, structuralMutations, measurementMs, durationMs: performance.now() - start, continuousSamples: progress.length, playbackSamples: progress, before, after, closed, settings };
  } finally { observer.disconnect(); player.destroy(); host.remove(); window.removeEventListener("classroom-media-diagnostic", diagnostic); }
}
