import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";

export default function EditorialSelectionTransformer({ stageRef, selectedElement }) {
  const transformerRef = useRef(null);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage || !selectedElement?.visible) return;
    const node = stage.findOne(`#editorial-element-${selectedElement.id}`);
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedElement, stageRef]);

  if (!selectedElement?.visible) return null;

  return (
    <Transformer
      ref={transformerRef}
      rotateEnabled={!selectedElement.locked}
      resizeEnabled={!selectedElement.locked}
      keepRatio={selectedElement.type === "image" && selectedElement.style?.maintainAspect !== false}
      borderStroke={selectedElement.locked ? "#f0a228" : "#1677eb"}
      borderDash={selectedElement.locked ? [5, 4] : []}
      anchorStroke="#1677eb"
      anchorFill="#ffffff"
      anchorSize={8}
      boundBoxFunc={(oldBox, nextBox) => (
        Math.abs(nextBox.width) < 10 || Math.abs(nextBox.height) < 10 ? oldBox : nextBox
      )}
    />
  );
}
