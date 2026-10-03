import type { Manifest, Publication } from "./manifest.ts";

export interface LibraryPublication {
  local?: Manifest;
  remote?: Publication;
  localVersion?: number;
  remoteVersion?: number;
}

// Refresh describes updates; SyncEngine alone verifies and activates files.
export function mergeLibraryPublications(locals: Manifest[], publications: Publication[]): Map<string, LibraryPublication> {
  const result = new Map<string, LibraryPublication>();
  for (const local of locals) {
    const previous = result.get(local.unit.unitId);
    if (!previous?.localVersion || local.version > previous.localVersion) result.set(local.unit.unitId, { ...previous, local, localVersion: local.version });
  }
  for (const remote of publications) {
    const previous = result.get(remote.unitId);
    if (!previous?.remoteVersion || remote.version > previous.remoteVersion) result.set(remote.unitId, { ...previous, remote, remoteVersion: remote.version });
  }
  return result;
}
