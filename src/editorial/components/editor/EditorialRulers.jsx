export default function EditorialRulers({ metrics, zoom, facing }) {
  const horizontalLength = metrics.stageWidth * zoom * (facing ? 2 : 1) + (facing ? 18 : 0);
  const verticalLength = metrics.stageHeight * zoom;
  const horizontalMarks = Array.from({ length: Math.floor(horizontalLength / (96 * zoom)) + 1 });
  const verticalMarks = Array.from({ length: Math.floor(verticalLength / (96 * zoom)) + 1 });

  return (
    <>
      <div className="editorial-canvas-ruler horizontal" style={{ width: horizontalLength }}>
        {horizontalMarks.map((_, index) => <span key={index} style={{ left: index * 96 * zoom }}>{index}</span>)}
      </div>
      <div className="editorial-canvas-ruler vertical" style={{ height: verticalLength }}>
        {verticalMarks.map((_, index) => <span key={index} style={{ top: index * 96 * zoom }}>{index}</span>)}
      </div>
    </>
  );
}
