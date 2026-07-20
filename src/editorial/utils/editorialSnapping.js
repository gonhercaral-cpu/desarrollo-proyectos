import { elementAlignmentLines, nearestGuide } from "./editorialSmartGuides.js";

export const DEFAULT_SNAP_TOLERANCE_SCREEN = 6;

export function snapToleranceForZoom(zoom, screenTolerance = DEFAULT_SNAP_TOLERANCE_SCREEN) {
  return Number(screenTolerance) / Math.max(0.01, Number(zoom || 1));
}

export function snapElementPosition({ moving, targets, zoom = 1, enabled = true, ignore = false, screenTolerance = DEFAULT_SNAP_TOLERANCE_SCREEN } = {}) {
  const original = { x: Number(moving?.x || 0), y: Number(moving?.y || 0) };
  if (!enabled || ignore) return { ...original, guides: [] };
  const tolerance = snapToleranceForZoom(zoom, screenTolerance);
  const lines = elementAlignmentLines(moving);
  const matchX = nearestGuide(lines.x, targets?.x || [], tolerance);
  const matchY = nearestGuide(lines.y, targets?.y || [], tolerance);
  return {
    x: original.x + Number(matchX?.distance || 0),
    y: original.y + Number(matchY?.distance || 0),
    guides: [
      ...(matchX ? [{ axis: "x", position: matchX.target.position, kind: matchX.target.kind, sourceId: matchX.target.sourceId || "" }] : []),
      ...(matchY ? [{ axis: "y", position: matchY.target.position, kind: matchY.target.kind, sourceId: matchY.target.sourceId || "" }] : []),
    ],
  };
}

export function snapResizeBox({ box, targets, activeAnchor = "", zoom = 1, enabled = true, ignore = false, screenTolerance = DEFAULT_SNAP_TOLERANCE_SCREEN } = {}) {
  const result = { ...box, guides: [] };
  if (!enabled || ignore) return result;
  const tolerance = snapToleranceForZoom(zoom, screenTolerance);
  const leftActive = activeAnchor.includes("left");
  const rightActive = activeAnchor.includes("right");
  const topActive = activeAnchor.includes("top");
  const bottomActive = activeAnchor.includes("bottom");
  const xLines = leftActive ? [{ position: box.x }] : rightActive ? [{ position: box.x + box.width }] : [];
  const yLines = topActive ? [{ position: box.y }] : bottomActive ? [{ position: box.y + box.height }] : [];
  const matchX = nearestGuide(xLines, targets?.x || [], tolerance);
  const matchY = nearestGuide(yLines, targets?.y || [], tolerance);
  if (matchX) {
    if (leftActive) { result.x += matchX.distance; result.width -= matchX.distance; }
    if (rightActive) result.width += matchX.distance;
    result.guides.push({ axis: "x", position: matchX.target.position, kind: matchX.target.kind });
  }
  if (matchY) {
    if (topActive) { result.y += matchY.distance; result.height -= matchY.distance; }
    if (bottomActive) result.height += matchY.distance;
    result.guides.push({ axis: "y", position: matchY.target.position, kind: matchY.target.kind });
  }
  return result;
}
