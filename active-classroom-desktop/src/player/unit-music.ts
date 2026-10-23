import type { Manifest } from "../offline/manifest.ts";
type Tracks = NonNullable<Manifest["backgroundMusic"]>;
export function selectUnitMusic(manifest: Manifest, ambient?: { tracks: Tracks; defaultTrackIds?: string[] }): { tracks: Tracks; global: boolean } {
  const config = manifest.unitMusic;
  if (config?.mode === "none") return { tracks: [], global: false };
  if (config?.mode === "custom") return { tracks: manifest.backgroundMusic || [], global: false };
  if (ambient) {
    if (!config) return { tracks: ambient.tracks, global: true };
    const ids = ambient.defaultTrackIds;
    if (ids !== undefined) return { tracks: ambient.tracks.filter(track => ids.includes(track.id)), global: true };
    if (config?.mode === "inherit") return { tracks: ambient.tracks.slice(0, 1), global: true };
    return { tracks: ambient.tracks, global: true };
  }
  return { tracks: manifest.backgroundMusic || [], global: false };
}
