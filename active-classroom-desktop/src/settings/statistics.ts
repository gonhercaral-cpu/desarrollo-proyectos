import type { Manifest } from "../offline/manifest.ts";
let current = { units: 0, bytes: 0, levels: {} as Record<string, string> };
export function setCacheStatistics(manifests: Manifest[], levels: Record<string, string>): void {
  const files = new Map<string, number>(); for (const manifest of manifests) for (const resource of manifest.resources || []) files.set(resource.download.checksums.sha256, resource.download.sizeBytes);
  current = { units: manifests.length, bytes: [...files.values()].reduce((sum, size) => sum + size, 0), levels };
}
export function cacheStatistics(): typeof current { return current; }
