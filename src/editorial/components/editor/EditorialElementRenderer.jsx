import { useEffect, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { EDITORIAL_ELEMENT_TYPES } from "../../models/editorialElements";
import { resolveImageUrl } from "../../utils/editorialImageSource";

// Carga imagen para Konva. Intenta primero con crossOrigin="anonymous" (permite
// exportación a canvas si el bucket tiene CORS). Si falla (bucket sin CORS), NO
// falla en silencio: reintenta sin crossOrigin para que la imagen se vea en
// pantalla, y sólo marca error si tampoco carga. Registra el detalle en consola.
function useLoadedImage(url) {
  // El componente se remonta por `key={url}` (ver ImageElement), así que el
  // estado inicial ya refleja la URL actual; el efecto sólo actualiza en los
  // callbacks async de carga (permitido, sin setState síncrono en el efecto).
  const [state, setState] = useState({ image: null, status: url ? "loading" : "idle" });

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;

    const attempt = (useCrossOrigin) => {
      const nextImage = new window.Image();
      if (useCrossOrigin) nextImage.crossOrigin = "anonymous";
      nextImage.onload = () => {
        if (!cancelled) setState({ image: nextImage, status: "loaded" });
      };
      nextImage.onerror = () => {
        if (cancelled) return;
        if (useCrossOrigin) {
          attempt(false); // reintento sin CORS: prioriza mostrar la imagen
          return;
        }
        console.error("Editorial: no se pudo cargar la imagen", url);
        setState({ image: null, status: "error" });
      };
      nextImage.src = url;
      return nextImage;
    };

    const current = attempt(true);
    return () => {
      cancelled = true;
      current.onload = null;
      current.onerror = null;
    };
  }, [url]);

  return state;
}

function getCoverCrop(image, width, height) {
  const imageRatio = image.width / image.height;
  const boxRatio = width / height;
  if (imageRatio > boxRatio) {
    const cropWidth = image.height * boxRatio;
    return { x: (image.width - cropWidth) / 2, y: 0, width: cropWidth, height: image.height };
  }
  const cropHeight = image.width / boxRatio;
  return { x: 0, y: (image.height - cropHeight) / 2, width: image.width, height: cropHeight };
}

function ImageElement({ element }) {
  const imageUrl = resolveImageUrl(element);
  const { image, status } = useLoadedImage(imageUrl);
  if (!image) {
    const isError = status === "error";
    return (
      <>
        <Rect
          width={element.width}
          height={element.height}
          fill={isError ? "#fbeaec" : "#e6ebf1"}
          stroke={isError ? "#c83e4d" : "#a9b5c4"}
          dash={[6, 4]}
        />
        <Text
          width={element.width}
          height={element.height}
          align="center"
          verticalAlign="middle"
          fontSize={12}
          fill={isError ? "#c83e4d" : "#6b7889"}
          text={isError ? "Imagen no disponible" : imageUrl ? "Cargando imagen…" : "Sin imagen"}
        />
      </>
    );
  }

  if (element.style?.fit === "contain") {
    const scale = Math.min(element.width / image.width, element.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    return (
      <>
        <Rect width={element.width} height={element.height} fill="#f7f9fb" />
        <KonvaImage image={image} x={(element.width - width) / 2} y={(element.height - height) / 2} width={width} height={height} />
      </>
    );
  }

  return (
    <KonvaImage
      image={image}
      width={element.width}
      height={element.height}
      crop={getCoverCrop(image, element.width, element.height)}
    />
  );
}

export default function EditorialElementRenderer({ element, selected, interactive = true, onSelect, onChange }) {
  function handleSelect(event) {
    event.cancelBubble = true;
    if (interactive) onSelect(element.id, {
      additive: Boolean(event.evt?.ctrlKey || event.evt?.metaKey || event.evt?.shiftKey),
    });
  }

  function handleTransformEnd(event) {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange(element.id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(10, element.width * scaleX),
      height: Math.max(10, element.height * scaleY),
      rotation: node.rotation(),
    });
  }

  return (
    <Group
      id={`editorial-element-${element.id}`}
      name="editorial-element"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      visible={element.visible}
      draggable={interactive && selected && !element.locked}
      onClick={interactive ? handleSelect : undefined}
      onTap={interactive ? handleSelect : undefined}
      onDragStart={interactive ? handleSelect : undefined}
      onDragEnd={interactive ? (event) => onChange(element.id, { x: event.target.x(), y: event.target.y() }) : undefined}
      onTransformEnd={interactive ? handleTransformEnd : undefined}
    >
      {element.type === EDITORIAL_ELEMENT_TYPES.TEXT && (
        <Text
          width={element.width}
          height={element.height}
          text={element.resolvedContent ?? element.content}
          fontFamily={element.style?.fontFamily || "Arial"}
          fontSize={Number(element.style?.fontSize || 24)}
          fontStyle={element.style?.fontWeight === "bold" ? "bold" : "normal"}
          fill={element.style?.fill || "#142033"}
          align={element.style?.align || "left"}
          lineHeight={Number(element.style?.lineHeight || 1.2)}
          letterSpacing={Number(element.style?.letterSpacing || 0)}
          verticalAlign="top"
          wrap="word"
        />
      )}
      {element.type === EDITORIAL_ELEMENT_TYPES.SHAPE && (
        <Rect
          width={element.width}
          height={element.height}
          fill={element.style?.fill || "#e2f0ff"}
          stroke={element.style?.borderColor || "#1677eb"}
          strokeWidth={Number(element.style?.borderWidth || 0)}
          cornerRadius={Number(element.style?.cornerRadius || 0)}
        />
      )}
      {element.type === EDITORIAL_ELEMENT_TYPES.IMAGE && <ImageElement key={resolveImageUrl(element)} element={element} />}
      {selected && <Rect width={element.width} height={element.height} stroke="#1677eb" strokeWidth={1} dash={[4, 3]} listening={false} />}
    </Group>
  );
}
