export function manualInteraction(builds, mode = builds.length ? "builds" : "static", initialResourceId) {
  const steps = mode === "builds" ? builds.map((build, index) => ({ ...build, order: index + 1 })) : [];
  return { interactionMode: mode, buildCount: steps.length, interaction: { mode, buildCount: steps.length, source: "manual", ...(initialResourceId ? { initialResourceId } : {}) }, builds: steps };
}
export function visibleBuildLayers(builds, state) { return builds.slice(0, state).flatMap(build => build.layers || []); }
export function moveBuild(builds, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= builds.length) return builds;
  const next = [...builds]; [next[index], next[target]] = [next[target], next[index]];
  return next.map((step, position) => ({ ...step, order: position + 1 }));
}
