import { Group, Line, Rect } from "react-konva";

export default function EditorialPrintGuides({ metrics, settings }) {
  const { bleed, trimWidth, trimHeight, margins, stageWidth, stageHeight } = metrics;
  const safeInset = 12;

  return (
    <Group listening={false}>
      {settings.bleed && (
        <Rect x={0.5} y={0.5} width={stageWidth - 1} height={stageHeight - 1} stroke="#ef4db8" strokeWidth={1} dash={[5, 4]} />
      )}
      {settings.cut && (
        <Rect x={bleed} y={bleed} width={trimWidth} height={trimHeight} stroke="#263442" strokeWidth={1} />
      )}
      {settings.margins && (
        <Rect
          x={bleed + margins.left}
          y={bleed + margins.top}
          width={Math.max(1, trimWidth - margins.left - margins.right)}
          height={Math.max(1, trimHeight - margins.top - margins.bottom)}
          stroke="#35b96c"
          strokeWidth={1}
          dash={[6, 4]}
        />
      )}
      {settings.safe && (
        <Rect
          x={bleed + margins.left + safeInset}
          y={bleed + margins.top + safeInset}
          width={Math.max(1, trimWidth - margins.left - margins.right - safeInset * 2)}
          height={Math.max(1, trimHeight - margins.top - margins.bottom - safeInset * 2)}
          stroke="#31a6d7"
          strokeWidth={1}
          dash={[3, 4]}
        />
      )}
      {settings.gutter && (
        <Line
          points={[bleed + trimWidth / 2, bleed, bleed + trimWidth / 2, bleed + trimHeight]}
          stroke="#2d80e8"
          strokeWidth={1}
          dash={[5, 5]}
        />
      )}
    </Group>
  );
}
