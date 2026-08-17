export const DASHBOARD_GRID_COLUMNS = 12;
export const DASHBOARD_GRID_ROW_HEIGHT = 36;
export const DASHBOARD_GRID_GAP = 16;

export function normalizeGridItem(item, columns = DASHBOARD_GRID_COLUMNS) {
  const width = clamp(integer(item.width ?? item.w, columns), 1, columns);
  const height = Math.max(1, integer(item.height ?? item.h, 6));
  return {
    ...item,
    x: clamp(integer(item.x, 0), 0, columns - width),
    y: Math.max(0, integer(item.y, 0)),
    width,
    height,
    w: width,
    h: height,
  };
}

export function packDashboardLayout(layout, priorityId = "", columns = DASHBOARD_GRID_COLUMNS) {
  const normalized = layout.map((item, index) => ({ ...normalizeGridItem(item, columns), __order: index }));
  const sorted = [...normalized].sort((left, right) => {
    if (left.id === priorityId) return -1;
    if (right.id === priorityId) return 1;
    return left.y - right.y || left.x - right.x || left.__order - right.__order;
  });
  const placed = [];

  sorted.forEach((item) => {
    const next = { ...item };
    while (placed.some((candidate) => gridItemsCollide(next, candidate))) next.y += 1;
    if (next.id !== priorityId) {
      while (next.y > 0) {
        const raised = { ...next, y: next.y - 1 };
        if (placed.some((candidate) => gridItemsCollide(raised, candidate))) break;
        next.y -= 1;
      }
    }
    placed.push(next);
  });

  const byId = new Map(placed.map((item) => [item.id, stripInternalFields(item)]));
  return layout.map((item) => byId.get(item.id) || normalizeGridItem(item, columns));
}

export function updateGridItem(layout, id, patch, constraints = {}, columns = DASHBOARD_GRID_COLUMNS) {
  const minWidth = Math.max(1, integer(constraints.minWidth, 1));
  const minHeight = Math.max(1, integer(constraints.minHeight, 1));
  const updated = layout.map((item) => {
    if (item.id !== id) return normalizeGridItem(item, columns);
    const nextWidth = clamp(integer(patch.width ?? item.width ?? item.w, columns), minWidth, columns);
    const nextHeight = Math.max(minHeight, integer(patch.height ?? item.height ?? item.h, minHeight));
    return normalizeGridItem({
      ...item,
      ...patch,
      width: nextWidth,
      height: nextHeight,
      x: clamp(integer(patch.x ?? item.x, 0), 0, columns - nextWidth),
      y: Math.max(0, integer(patch.y ?? item.y, 0)),
    }, columns);
  });
  return packDashboardLayout(updated, id, columns);
}

export function findOpenGridPosition(layout, width, height, columns = DASHBOARD_GRID_COLUMNS) {
  const safeWidth = clamp(integer(width, columns), 1, columns);
  const safeHeight = Math.max(1, integer(height, 1));
  const occupied = layout.map((item) => normalizeGridItem(item, columns));
  const maxY = occupied.reduce((maximum, item) => Math.max(maximum, item.y + item.height), 0);

  for (let y = 0; y <= maxY + safeHeight; y += 1) {
    for (let x = 0; x <= columns - safeWidth; x += 1) {
      const candidate = { x, y, width: safeWidth, height: safeHeight };
      if (!occupied.some((item) => gridItemsCollide(candidate, item))) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

export function gridItemsCollide(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

export function getDashboardGridRows(layout) {
  return layout.reduce((maximum, item) => Math.max(maximum, Number(item.y || 0) + Number(item.height || item.h || 1)), 1);
}

export function sameGridLayout(left, right) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.id === other?.id
      && item.x === other.x
      && item.y === other.y
      && item.width === other.width
      && item.height === other.height;
  });
}

function stripInternalFields(item) {
  const clean = { ...item };
  delete clean.__order;
  return clean;
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
