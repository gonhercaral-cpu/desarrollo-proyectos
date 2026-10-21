export const isMusicFile = file => /^audio\//i.test(file.mimeType || file.type || "");
export function addMusicTracks(draft, resources) {
  const existing = draft.backgroundMusic || [];
  const tracks = [...existing, ...resources.filter(isMusicFile).filter(resource => !existing.some(track => track.resourceId === resource.id)).map(resource => ({ id: resource.id, resourceId: resource.id, sourceType: "file", title: resource.name }))].map((track, order) => ({ ...track, order }));
  return { ...draft, backgroundMusic: tracks, excludedResourceIds: (draft.excludedResourceIds || []).filter(id => !tracks.some(track => track.resourceId === id)) };
}
