import { mountOfflineLibrary } from "./offline/library";
import { mountProgramUpdater } from "./updater/mount";
import { StartupUpdate } from "./startup/controller";

export async function mountDesktopApp(root: HTMLDivElement): Promise<void> {
  root.innerHTML = '<main class="desktop-loading"><strong>Active Classroom</strong><span>Preparando inicio…</span></main>';
  const controls = await mountProgramUpdater();
  if (controls) {
    await controls.preferences.run("initialize");
    await new StartupUpdate().run(controls.updater, controls.preferences, { online: navigator.onLine, canUpdate: () => !root.querySelector(".classroom-player") });
    // Library owns activation/cache restoration; observe readiness without changing it.
    const observer = new MutationObserver(() => {
      if (!root.querySelector(".offline-shell")) return;
      observer.disconnect();
      void (async () => {
        await controls.preferences.run("initialize");
        await controls.preferences.run("library-ready");
      })();
    });
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  }
  mountOfflineLibrary(root);
}
