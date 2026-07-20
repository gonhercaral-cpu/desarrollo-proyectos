export function createEditorialViewportGeometry({ workspaceRect, pageRect, scale = 1, scrollX = 0, scrollY = 0, panX = 0, panY = 0 } = {}) {
  const viewportX = Number(workspaceRect?.left || 0);
  const viewportY = Number(workspaceRect?.top || 0);
  const pageX = Number(pageRect?.left || 0) + Number(panX || 0);
  const pageY = Number(pageRect?.top || 0) + Number(panY || 0);
  return {
    pageX,
    pageY,
    pageWidthPx: Number(pageRect?.width || 0),
    pageHeightPx: Number(pageRect?.height || 0),
    scale: Number(scale || 1),
    viewportX,
    viewportY,
    viewportWidth: Number(workspaceRect?.width || 0),
    viewportHeight: Number(workspaceRect?.height || 0),
    scrollX: Number(scrollX || 0),
    scrollY: Number(scrollY || 0),
    pageOffsetX: pageX - viewportX,
    pageOffsetY: pageY - viewportY,
  };
}

export function measureEditorialViewport({ workspace, page, scale = 1, panX = 0, panY = 0 } = {}) {
  if (!workspace || !page) return null;
  return createEditorialViewportGeometry({
    workspaceRect: workspace.getBoundingClientRect(),
    pageRect: page.getBoundingClientRect(),
    scale,
    scrollX: workspace.scrollLeft,
    scrollY: workspace.scrollTop,
    panX,
    panY,
  });
}
