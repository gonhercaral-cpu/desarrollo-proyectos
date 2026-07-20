import { useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage } from "react-konva";
import EditorialElementRenderer from "./EditorialElementRenderer";
import EditorialBackgroundNode from "./EditorialBackgroundNode";
import EditorialPrintGuides from "./EditorialPrintGuides";
import EditorialSelectionTransformer from "./EditorialSelectionTransformer";
import { buildSmartGuideTargets } from "../../utils/editorialSmartGuides";
import { snapElementPosition, snapResizeBox } from "../../utils/editorialSnapping";
import { normalizeEditorialBackground } from "../../models/editorialBackground";

export default function EditorialCanvas({
  metrics,
  zoom,
  elements,
  backgroundElements = [],
  backgroundImage = null,
  selectedElement,
  selectedIds = [],
  guideSettings,
  background = "#ffffff",
  interactive = true,
  editingId = "",
  onActivate,
  onSelect,
  onChange,
  onStartEdit,
}) {
  const stageRef = useRef(null);
  const [smartGuides, setSmartGuides] = useState([]);
  const settings = guideSettings || {};
  const pageBackground = normalizeEditorialBackground(background, backgroundImage);
  const guideTargets = useMemo(() => buildSmartGuideTargets({
    elements,
    pageWidth: metrics.trimWidth,
    pageHeight: metrics.trimHeight,
    margins: metrics.margins,
  }), [elements, metrics.margins, metrics.trimHeight, metrics.trimWidth]);

  function targetsFor(elementId) {
    if (!elementId) return guideTargets;
    return buildSmartGuideTargets({
      elements,
      movingId: elementId,
      pageWidth: metrics.trimWidth,
      pageHeight: metrics.trimHeight,
      margins: metrics.margins,
    });
  }

  function handleElementDrag(element, event) {
    const node = event.target;
    const parent = node.getParent();
    const box = node.getClientRect({ relativeTo: parent, skipShadow: true, skipStroke: true });
    const result = snapElementPosition({
      moving: box,
      targets: targetsFor(element.id),
      zoom,
      enabled: settings.snapping !== false,
      ignore: Boolean(event.evt?.altKey),
    });
    node.x(node.x() + result.x - box.x);
    node.y(node.y() + result.y - box.y);
    setSmartGuides(settings.smartGuides === false ? [] : result.guides);
  }

  function handleElementTransform(element, event) {
    const node = event.target;
    if (Math.abs(node.rotation() % 90) > 0.01) {
      setSmartGuides([]);
      return;
    }
    const transformer = stageRef.current?.findOne("Transformer");
    const activeAnchor = transformer?.getActiveAnchor?.() || "";
    const box = {
      x: node.x(),
      y: node.y(),
      width: element.width * node.scaleX(),
      height: element.height * node.scaleY(),
    };
    const result = snapResizeBox({
      box,
      targets: targetsFor(element.id),
      activeAnchor,
      zoom,
      enabled: settings.snapping !== false,
      ignore: Boolean(event.evt?.altKey),
    });
    if (result.width >= 10) node.scaleX(result.width / element.width);
    if (result.height >= 10) node.scaleY(result.height / element.height);
    node.x(result.x);
    node.y(result.y);
    setSmartGuides(settings.smartGuides === false ? [] : result.guides);
  }

  function clearSmartGuides() {
    setSmartGuides([]);
  }

  function handleStagePointer(event) {
    if (!interactive) {
      onActivate?.();
      return;
    }
    if (event.target === event.target.getStage() || event.target.name() === "page-background") {
      onSelect("");
    }
  }

  function handleStageDoublePointer(event) {
    if (!interactive || !onStartEdit) return;
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const documentPoint = stage.getAbsoluteTransform().copy().invert().point(pointer);
    const textElement = [...elements].reverse().find((element) => {
      if (element.type !== "text" || element.locked || element.visible === false) return false;
      const node = stage.findOne(`#editorial-element-${element.id}`);
      if (!node) return false;
      const box = node.getClientRect({ relativeTo: stage, skipShadow: true, skipStroke: true });
      return documentPoint.x >= box.x && documentPoint.x <= box.x + box.width
        && documentPoint.y >= box.y && documentPoint.y <= box.y + box.height;
    });
    if (!textElement) return;
    event.cancelBubble = true;
    onStartEdit(textElement.id);
  }

  return (
    <Stage
      ref={stageRef}
      width={metrics.stageWidth * zoom}
      height={metrics.stageHeight * zoom}
      scaleX={zoom}
      scaleY={zoom}
      onMouseDown={handleStagePointer}
      onTouchStart={handleStagePointer}
      onDblClick={handleStageDoublePointer}
      onDblTap={handleStageDoublePointer}
    >
      <Layer>
        <Rect
          name="page-background"
          width={metrics.stageWidth}
          height={metrics.stageHeight}
          fill={pageBackground.type === "none" ? "transparent" : pageBackground.color}
          opacity={pageBackground.opacity}
          shadowColor="#15283d"
          shadowBlur={9 / zoom}
          shadowOpacity={0.18}
          shadowOffsetY={3 / zoom}
        />
        {pageBackground.type === "image" && pageBackground.image && (
          <EditorialBackgroundNode
            backgroundImage={{
              ...pageBackground.image,
              opacity: pageBackground.image.opacity * pageBackground.opacity,
            }}
            width={metrics.stageWidth}
            height={metrics.stageHeight}
          />
        )}
        <Group x={metrics.bleed} y={metrics.bleed}>
          {backgroundElements.map((element) => (
            <EditorialElementRenderer
              key={element.id}
              element={element}
              selected={false}
              interactive={false}
              onSelect={() => {}}
              onChange={() => {}}
            />
          ))}
          {elements.map((element) => (
            <EditorialElementRenderer
              key={element.id}
              element={element}
              selected={interactive && selectedIds.includes(element.id)}
              interactive={interactive}
              editing={editingId === element.id}
              onSelect={onSelect}
              onChange={onChange}
              onStartEdit={onStartEdit}
              onDragMove={handleElementDrag}
              onDragFinished={clearSmartGuides}
              onTransformMove={handleElementTransform}
              onTransformFinished={clearSmartGuides}
            />
          ))}
          {smartGuides.map((guide) => (
            <Line
              key={`${guide.axis}-${guide.position}-${guide.kind}`}
              points={guide.axis === "x"
                ? [guide.position, 0, guide.position, metrics.trimHeight]
                : [0, guide.position, metrics.trimWidth, guide.position]}
              stroke="#d21c87"
              strokeWidth={1 / zoom}
              dash={[5 / zoom, 3 / zoom]}
              listening={false}
            />
          ))}
          {interactive && <EditorialSelectionTransformer stageRef={stageRef} selectedElement={selectedElement} />}
        </Group>
        <EditorialPrintGuides metrics={metrics} settings={settings} />
      </Layer>
    </Stage>
  );
}
