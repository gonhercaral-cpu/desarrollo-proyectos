import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { playerMarkup } from "../src/ui/player-view.ts";
import { TeacherWorkspace } from "../src/ui/TeacherWorkspace.ts";

const createTestMarkup = playerMarkup;

describe("TeacherWorkspace Unit & Integration Tests", () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    dom = new JSDOM(createTestMarkup(), { url: "http://localhost" });
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
    global.HTMLElement = window.HTMLElement;
    global.KeyboardEvent = window.KeyboardEvent;
    global.MouseEvent = window.MouseEvent;
    global.localStorage = window.localStorage;
    global.localStorage.clear();
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.window;
    delete global.HTMLElement;
    delete global.KeyboardEvent;
    delete global.MouseEvent;
    delete global.localStorage;
  });

  test("reloj usa hora local, avanza al minuto y limpia el temporizador al cerrar", t => {
    const start = new Date(2026, 10, 17, 10, 42, 30).getTime();
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
    const root = document.querySelector(".classroom-player");
    const clockEl = document.querySelector("[data-teacher-clock]");
    assert.ok(clockEl, "Clock element exists");

    const workspace = new TeacherWorkspace(root);
    assert.ok(clockEl.textContent && clockEl.textContent.trim().length > 0, "Clock displays current time");
    assert.match(clockEl.textContent, /\d{1,2}:\d{2}/, "Clock matches hour:minute format");

    const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    assert.equal(clockEl.textContent, formatter.format(new Date(start)));
    t.mock.timers.tick(30100);
    assert.equal(clockEl.textContent, formatter.format(new Date(start + 30100)));
    const displayed = clockEl.textContent;
    workspace.destroy();
    t.mock.timers.tick(60000);
    assert.equal(clockEl.textContent, displayed, "el reloj cerrado deja de trabajar");
    assert.equal(workspace["clockTimer"], null, "Clock timer cleaned on dispose");
  });

  test("pestañas conservan sus nodos y selección dentro de la sesión", () => {
    const root = document.querySelector(".classroom-player");
    const workspace1 = new TeacherWorkspace(root);

    workspace1.selectTab(2);
    assert.equal(workspace1.getActiveTabIndex(), 2);
    workspace1.destroy();

    const workspace2 = new TeacherWorkspace(root);
    assert.equal(workspace2.getActiveTabIndex(), 2, "Restores persisted active tab from storage");
    const tab2 = document.getElementById("tab-general");
    const panel2 = document.getElementById("panel-general");
    assert.equal(tab2.getAttribute("aria-selected"), "true");
    assert.equal(panel2.hasAttribute("hidden"), false);
    workspace2.destroy();
  });

  test("keys: roving tabindex with arrows, Home, End and stopPropagation", () => {
    const root = document.querySelector(".classroom-player");
    const workspace = new TeacherWorkspace(root);
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

    let stopPropagationCalled = false;
    const rightEvent = new window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    rightEvent.stopPropagation = () => {
      stopPropagationCalled = true;
    };

    tabs[0].dispatchEvent(rightEvent);
    assert.equal(stopPropagationCalled, true, "stopPropagation must be called to protect slide navigation");
    assert.equal(rightEvent.defaultPrevented, true);
    assert.equal(workspace.getActiveTabIndex(), 1, "ArrowRight advances to next tab");
    assert.equal(tabs[1].getAttribute("aria-selected"), "true");
    assert.equal(tabs[1].tabIndex, 0);
    assert.equal(tabs[0].tabIndex, -1);

    const endEvent = new window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    tabs[1].dispatchEvent(endEvent);
    assert.equal(workspace.getActiveTabIndex(), 3, "End key moves to last tab");

    const homeEvent = new window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    tabs[3].dispatchEvent(homeEvent);
    assert.equal(workspace.getActiveTabIndex(), 0, "Home key moves to first tab");

    const leftEvent = new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    tabs[0].dispatchEvent(leftEvent);
    assert.equal(workspace.getActiveTabIndex(), 3, "ArrowLeft on first tab wraps to last tab");

    workspace.destroy();
  });

  test("audio node identity: [data-background-music] is never recreated or relocated across tab switches", () => {
    const root = document.querySelector(".classroom-player");
    const workspace = new TeacherWorkspace(root);

    const musicNodeBefore = document.querySelector("[data-background-music]");
    assert.ok(musicNodeBefore, "Music node exists in initial DOM");

    workspace.selectTab(0);
    workspace.selectTab(1);
    workspace.selectTab(2);
    workspace.selectTab(3);
    workspace.selectTab(0);

    const musicNodeAfter = document.querySelector("[data-background-music]");
    assert.strictEqual(musicNodeAfter, musicNodeBefore, "Background music node reference strictly preserved");
    assert.ok(musicNodeAfter.closest("#panel-music"));

    workspace.destroy();
  });
});
