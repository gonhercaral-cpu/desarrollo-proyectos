export function elementAlignmentLines(element = {}) {
  const x = Number(element.x || 0);
  const y = Number(element.y || 0);
  const width = Math.max(0, Number(element.width || 0));
  const height = Math.max(0, Number(element.height || 0));
  const radians = Number(element.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([pointX, pointY]) => ({
    x: x + pointX * cos - pointY * sin,
    y: y + pointX * sin + pointY * cos,
  }));
  const left = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    x: [
      { position: left, anchor: "left" },
      { position: (left + right) / 2, anchor: "center" },
      { position: right, anchor: "right" },
    ],
    y: [
      { position: top, anchor: "top" },
      { position: (top + bottom) / 2, anchor: "middle" },
      { position: bottom, anchor: "bottom" },
    ],
  };
}

export function buildSmartGuideTargets({ elements = [], movingId = "", pageWidth, pageHeight, margins = {}, safeInset = 12 } = {}) {
  const x = [
    { position: 0, kind: "page-left" },
    { position: Number(pageWidth || 0) / 2, kind: "page-center-x" },
    { position: Number(pageWidth || 0), kind: "page-right" },
    { position: Number(margins.left || 0), kind: "margin-left" },
    { position: Number(pageWidth || 0) - Number(margins.right || 0), kind: "margin-right" },
    { position: Number(margins.left || 0) + safeInset, kind: "safe-left" },
    { position: Number(pageWidth || 0) - Number(margins.right || 0) - safeInset, kind: "safe-right" },
  ];
  const y = [
    { position: 0, kind: "page-top" },
    { position: Number(pageHeight || 0) / 2, kind: "page-center-y" },
    { position: Number(pageHeight || 0), kind: "page-bottom" },
    { position: Number(margins.top || 0), kind: "margin-top" },
    { position: Number(pageHeight || 0) - Number(margins.bottom || 0), kind: "margin-bottom" },
    { position: Number(margins.top || 0) + safeInset, kind: "safe-top" },
    { position: Number(pageHeight || 0) - Number(margins.bottom || 0) - safeInset, kind: "safe-bottom" },
  ];
  elements
    .filter((element) => element.id !== movingId && element.visible !== false && !element.locked)
    .forEach((element) => {
      const lines = elementAlignmentLines(element);
      lines.x.forEach((line) => x.push({ ...line, kind: `element-${line.anchor}`, sourceId: element.id }));
      lines.y.forEach((line) => y.push({ ...line, kind: `element-${line.anchor}`, sourceId: element.id }));
    });
  return { x, y };
}

export function nearestGuide(lines, targets, tolerance) {
  let best = null;
  lines.forEach((line) => targets.forEach((target) => {
    const distance = target.position - line.position;
    if (Math.abs(distance) > tolerance) return;
    if (!best || Math.abs(distance) < Math.abs(best.distance)) best = { distance, line, target };
  }));
  return best;
}
