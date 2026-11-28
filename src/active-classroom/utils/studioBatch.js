const elementKey = ({ slideIndex, id }) => `${slideIndex}:${id}`;

export function planCanvasFit(layouts, edits) {
  const next = new Map(edits.map(edit => [elementKey(edit), edit]));
  const changes = [];
  for (const { slideIndex, width: canvasWidth, height: canvasHeight, elements } of layouts) {
    for (const original of elements) {
      const key = elementKey({ slideIndex, id: original.id });
      const element = { ...original, ...next.get(key) };
      const width = Math.min(element.width, canvasWidth);
      const height = Math.min(element.height, canvasHeight);
      const x = Math.min(Math.max(0, element.x), canvasWidth - width);
      const y = Math.min(Math.max(0, element.y), canvasHeight - height);
      if (x === element.x && y === element.y && width === element.width && height === element.height) continue;
      const patch = { ...next.get(key), slideIndex, id: element.id, x, y, width, height };
      next.set(key, patch);
      changes.push({ slideIndex, id: element.id, before: [element.x, element.y, element.width, element.height], after: [x, y, width, height] });
    }
  }
  return { edits: [...next.values()], changes };
}
