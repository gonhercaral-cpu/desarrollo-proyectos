import { useRef } from "react";
import { Group, Layer, Rect, Stage } from "react-konva";
import EditorialElementRenderer from "./EditorialElementRenderer";
import EditorialPrintGuides from "./EditorialPrintGuides";
import EditorialSelectionTransformer from "./EditorialSelectionTransformer";

export default function EditorialCanvas({
  metrics,
  zoom,
  elements,
  backgroundElements = [],
  selectedElement,
  selectedIds = [],
  guideSettings,
  background = "#ffffff",
  interactive = true,
  onActivate,
  onSelect,
  onChange,
}) {
  const stageRef = useRef(null);

  function handleStagePointer(event) {
    if (!interactive) {
      onActivate?.();
      return;
    }
    if (event.target === event.target.getStage() || event.target.name() === "page-background") {
      onSelect("");
    }
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
    >
      <Layer>
        <Rect
          name="page-background"
          width={metrics.stageWidth}
          height={metrics.stageHeight}
          fill={background}
          shadowColor="#15283d"
          shadowBlur={9 / zoom}
          shadowOpacity={0.18}
          shadowOffsetY={3 / zoom}
        />
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
              onSelect={onSelect}
              onChange={onChange}
            />
          ))}
          {interactive && <EditorialSelectionTransformer stageRef={stageRef} selectedElement={selectedElement} />}
        </Group>
        <EditorialPrintGuides metrics={metrics} settings={guideSettings} />
      </Layer>
    </Stage>
  );
}
