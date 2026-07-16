import { useRef } from "react";
import { Group, Layer, Rect, Stage } from "react-konva";
import EditorialElementRenderer from "./EditorialElementRenderer";
import EditorialPrintGuides from "./EditorialPrintGuides";
import EditorialSelectionTransformer from "./EditorialSelectionTransformer";

export default function EditorialCanvas({
  metrics,
  zoom,
  elements,
  selectedElement,
  guideSettings,
  interactive = true,
  onSelect,
  onChange,
}) {
  const stageRef = useRef(null);

  function handleStagePointer(event) {
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
      onMouseDown={interactive ? handleStagePointer : undefined}
      onTouchStart={interactive ? handleStagePointer : undefined}
    >
      <Layer>
        <Rect
          name="page-background"
          width={metrics.stageWidth}
          height={metrics.stageHeight}
          fill="#ffffff"
          shadowColor="#15283d"
          shadowBlur={9 / zoom}
          shadowOpacity={0.18}
          shadowOffsetY={3 / zoom}
        />
        {interactive && (
          <Group x={metrics.bleed} y={metrics.bleed}>
            {elements.map((element) => (
              <EditorialElementRenderer
                key={element.id}
                element={element}
                selected={selectedElement?.id === element.id}
                onSelect={onSelect}
                onChange={onChange}
              />
            ))}
            <EditorialSelectionTransformer stageRef={stageRef} selectedElement={selectedElement} />
          </Group>
        )}
        <EditorialPrintGuides metrics={metrics} settings={guideSettings} />
      </Layer>
    </Stage>
  );
}
