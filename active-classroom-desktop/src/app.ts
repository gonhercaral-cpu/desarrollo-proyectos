import { mountOfflineLibrary } from "./offline/library";

export async function mountDesktopApp(root: HTMLDivElement): Promise<void> {
  mountOfflineLibrary(root);
}
