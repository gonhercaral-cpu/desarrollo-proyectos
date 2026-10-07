const paths = {
  library: '<path d="M12 5v15M12 5C8 2 4 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  levels: '<path d="m12 3 10 5-10 5L2 8 12 3Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  level: '<path d="M5 20v-5m7 5V9m7 11V4" stroke-width="4"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  play: '<path d="m7 3 14 9-14 9V3Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4v16M17 4v16" stroke-width="5"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor" stroke="none"/>',
  settings: '<path d="m10 2-1 3-3 1-3-1-1 4 3 2v2l-3 2 1 4 3-1 3 1 1 3h4l1-3 3-1 3 1 1-4-3-2v-2l3-2-1-4-3 1-3-1-1-3h-4Z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  projector: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  slides: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h1m4 0h5M7 12h1m4 0h5M7 16h1m4 0h5"/>',
  resource: '<path d="m8 13 7-7a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a7 7 0 0 1 10 10l-9 9"/>',
  folder: '<path d="M2 7V4h8l2 3h10v14H2V7Z"/>',
  pdf: '<path d="M14 2H4v20h16V8l-6-6Zm0 0v6h6M7 17c3-4 4-8 4-6s0 6 5 6"/>',
  audio: '<path d="M9 18V5l11-2v13M9 5l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  video: '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="m9 7 7 5-7 5V7Z" fill="currentColor" stroke="none"/>',
  document: '<path d="M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 12h8m-8 4h6"/>',
  image: '<rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m2 18 6-6 4 4 4-6 6 8"/>',
  previous: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  volume: '<path d="M10 5 5 9H2v6h3l5 4V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M10 5 5 9H2v6h3l5 4V5Zm5 4 6 6m0-6-6 6"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  grid: '<path d="M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1m-1 7h1m-1 7h1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m7 12 3 3 7-7" stroke="white"/>',
  download: '<path d="M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 6v7m0 4v.1"/>',
} as const;
export type IconName = keyof typeof paths;
export function icon(name: IconName, className = ""): string {
  return `<svg class="ac-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export function resourceIcon(mime = ""): IconName {
  return mime.includes("pdf") ? "pdf" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "document";
}
export function fileDescription(name: string, mime: string, size?: number): string {
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase() || (mime.includes("pdf") ? "PDF" : mime.split("/")[0].toUpperCase());
  const bytes = size === undefined ? "" : size >= 1048576 ? `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(size / 1048576)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  return [extension, bytes].filter(Boolean).join(" · ");
}
