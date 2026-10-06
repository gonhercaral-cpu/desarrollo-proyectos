import { mountOfflineLibrary } from "./offline/library";
import { mountProgramUpdater } from "./updater/mount";

export async function mountDesktopApp(root: HTMLDivElement): Promise<void> {
  mountOfflineLibrary(root);
  mountProgramUpdater();
}
