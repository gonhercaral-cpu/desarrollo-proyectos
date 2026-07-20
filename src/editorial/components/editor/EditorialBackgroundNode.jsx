import { useEffect, useState } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import { computeBackgroundLayout, normalizeBackgroundImage } from "../../models/editorialBackground";

// Fase 8 — Imagen de fondo de página/maestra. Se dibuja detrás de todo, recortada
// a la caja de contenido, con opacidad y fit. No es seleccionable (listening
// false). Reutiliza la URL del asset (no duplica el archivo).
function useBackgroundImage(url) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const attempt = (useCors) => {
      const node = new window.Image();
      if (useCors) node.crossOrigin = "anonymous";
      node.onload = () => { if (!cancelled) setImage(node); };
      node.onerror = () => {
        if (cancelled) return;
        if (useCors) { attempt(false); return; }
        console.error("Editorial: no se pudo cargar la imagen de fondo", url);
      };
      node.src = url;
      return node;
    };
    const node = attempt(true);
    return () => { cancelled = true; node.onload = null; node.onerror = null; };
  }, [url]);
  return image;
}

export default function EditorialBackgroundNode({ backgroundImage, width, height }) {
  const background = normalizeBackgroundImage(backgroundImage);
  const image = useBackgroundImage(background?.url);
  if (!background || !image) return null;

  const layout = computeBackgroundLayout({
    background,
    box: { width, height },
    natural: { width: image.width, height: image.height },
  });

  return (
    <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height} listening={false} opacity={background.opacity}>
      {layout.mode === "tile" ? (
        <Rect
          width={width}
          height={height}
          fillPatternImage={image}
          fillPatternScaleX={(layout.width / image.width) || 1}
          fillPatternScaleY={(layout.height / image.height) || 1}
          fillPatternOffsetX={-layout.x}
          fillPatternOffsetY={-layout.y}
          fillPatternRepeat="repeat"
        />
      ) : (
        <KonvaImage
          image={image}
          x={layout.x + layout.width / 2}
          y={layout.y + layout.height / 2}
          offsetX={layout.width / 2}
          offsetY={layout.height / 2}
          width={layout.width}
          height={layout.height}
          rotation={background.rotation}
        />
      )}
    </Group>
  );
}
