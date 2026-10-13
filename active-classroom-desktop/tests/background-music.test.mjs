import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { BackgroundMusic } from "../src/player/BackgroundMusic.ts";
import { assignShortcut, shortcutFor } from "../src/player/shortcuts.ts";
function environment(t) {
  const dom = new JSDOM('<div id="music"></div><div id="audience"></div>', { url: "https://desktop.test" });
  const old = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage });
  t.after(() => { dom.window.close(); Object.assign(globalThis, old); });
  const proto = dom.window.HTMLMediaElement.prototype;
  t.mock.method(proto, "load", () => {});
  t.mock.method(proto, "play", function () { Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new dom.window.Event("play")); return Promise.resolve(); });
  t.mock.method(proto, "pause", function () { Object.defineProperty(this, "paused", { configurable: true, value: true }); this.dispatchEvent(new dom.window.Event("pause")); });
  return dom;
}
const manifest = { backgroundMusic: ["a", "b"].map((id, order) => ({ id, resourceId: id, sourceType: "file", title: `Pista ${id}`, order })) };
const source = async id => ({ url: `http://127.0.0.1:5000/media/${id.repeat(64)}`, mimeType: "audio/mpeg", name: id, sizeBytes: 6000000 });
test("música offline: play/pause, siguiente/anterior, un único audio y volumen independiente", async t => {
  environment(t); const released = [];
  const music = new BackgroundMusic(document.querySelector("#music"), manifest, source, () => true, file => released.push(file)); t.after(() => music.destroy());
  await music.toggle(); assert.equal(music.audio.paused, false);
  const audio = music.audio; music.setVolume(.2); assert.equal(audio.volume, .2);
  document.querySelector("#audience").textContent = "Otra diapositiva / build";
  assert.equal(music.audio, audio); assert.equal(audio.paused, false); assert.equal(document.querySelectorAll("audio").length, 1); assert.equal(document.querySelector("#audience audio"), null);
  await music.move(1); assert.equal(music.index, 1); assert.equal(music.audio.paused, false); assert.equal(music.volume, .2); assert.equal(released.length, 1);
  await music.move(-1); assert.equal(music.index, 0);
  await music.toggle(); assert.equal(music.audio.paused, true); assert.equal(music.pauseReason, "manual");
  music.destroy(); assert.equal(audio.getAttribute("src"), null); assert.equal(document.querySelectorAll("audio").length, 0);
});
test("pausa automática conserva intención manual; no reanuda tras cerrar recurso", async t => {
  environment(t); let allowed = true;
  const music = new BackgroundMusic(document.querySelector("#music"), manifest, source, () => allowed); t.after(() => music.destroy());
  await music.toggle(); allowed = false; music.pause("class-media"); assert.equal(music.pauseReason, "class-media"); assert.equal(music.audio.paused, true);
  allowed = true; assert.equal(music.audio.paused, true); await music.toggle(); assert.equal(music.audio.paused, false);
  music.pause("manual"); music.pause("class-media"); assert.equal(music.pauseReason, "manual"); assert.equal(music.audio.paused, true);
});
test("Unit antigua sin música y atajo configurable sin conflicto con valores predeterminados", async t => {
  const dom = environment(t); const music = new BackgroundMusic(document.querySelector("#music"), {}, source); t.after(() => music.destroy());
  await music.toggle(); assert.match(document.querySelector("#music").textContent, /Sin música configurada/); assert.equal(document.querySelectorAll("audio").length, 0);
  assert.deepEqual(assignShortcut("BACKGROUND_MUSIC_PLAY_PAUSE", "Ctrl+k"), {});
  assert.equal(shortcutFor(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true }), true), "BACKGROUND_MUSIC_PLAY_PAUSE");
  assert.deepEqual(assignShortcut("BACKGROUND_MUSIC_NEXT", "f"), { conflict: "FULLSCREEN" });
});
test("cancelación durante verificación libera grant, impide reproducción tardía", async t => {
  environment(t); let resolve; const releases = [];
  const music = new BackgroundMusic(document.querySelector("#music"), manifest, () => new Promise(done => { resolve = done; }), () => true, file => releases.push(file));
  const pending = music.toggle(); music.destroy(); resolve(await source("a")); await pending;
  assert.equal(music.audio.paused, true); assert.equal(releases.length, 1);
});
test("play pendiente de pista anterior no pausa una pista nueva", async t => {
  const dom = environment(t); let finishPrevious; let calls = 0;
  const music = new BackgroundMusic(document.querySelector("#music"), manifest, source); t.after(() => music.destroy());
  t.mock.method(music.audio, "play", function () {
    Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new dom.window.Event("play"));
    return ++calls === 1 ? new Promise(resolve => { finishPrevious = resolve; }) : Promise.resolve();
  });
  const previous = music.toggle(); await new Promise(resolve => setImmediate(resolve));
  await music.move(1); assert.equal(music.audio.paused, false); assert.equal(music.index, 1);
  finishPrevious(); await previous; assert.equal(music.audio.paused, false); assert.equal(music.index, 1);
});
