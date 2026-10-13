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
    const before = { memory: await invoke("fixture_memory"), streams: await invoke("fixture_metrics") };
    const click = performance.now(); const playing = new Promise(resolve => media.addEventListener("playing", () => resolve(performance.now() - click), { once: true }));
    await player.dispatch("PLAY_PAUSE"); const firstPlayMs = await playing;
    await wait(20000); check(!media.paused && media.currentTime > 15, "Video did not play 20 seconds");
    const seeks = [];
    for (const command of ["SEEK_FORWARD", "SEEK_BACKWARD", "SEEK_FORWARD"]) {
      const started = performance.now(); let seekEvents = 0; const seeking = () => seekEvents++; media.addEventListener("seeking", seeking);
      for (let index = 0; index < 10; index++) { await player.dispatch(command); await wait(10); }
      await until(() => !renderer.state.seeking && !media.seeking); await until(() => !media.paused && media.readyState >= 2);
      seeks.push({ command, elapsedMs: performance.now() - started, seekingEvents: seekEvents, currentTime: media.currentTime, streams: await invoke("fixture_metrics") }); media.removeEventListener("seeking", seeking);
    }
    const progress = []; const start = performance.now();
    for (let index = 0; index < 60; index++) { await wait(1000); progress.push({ time: media.currentTime, readyState: media.readyState, seeking: media.seeking, paused: media.paused }); check(host.querySelector("video") === original, "Video remounted during playback"); }
    check(progress.at(-1).time - progress[0].time > 55, "Video stalled during continuous 60 seconds");
    check(progress.every(sample => !sample.paused && sample.readyState >= 2), "Playback lost continuity");
    const audience = await invoke("fixture_audience_state"); check(audience.videos === 1 && audience.audio === 0 && !audience.error, "Projection duplicated audio or failed");
    const after = { memory: await invoke("fixture_memory"), streams: await invoke("fixture_metrics") };
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
    return { firstPlayMs, events, seeks, mounts, structuralMutations, durationMs: performance.now() - start, continuousSamples: progress.length, before, after, closed, settings };
  } finally { observer.disconnect(); player.destroy(); host.remove(); window.removeEventListener("classroom-media-diagnostic", diagnostic); }
}
