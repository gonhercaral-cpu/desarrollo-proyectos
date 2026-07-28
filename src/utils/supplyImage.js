export const SUPPLY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPLY_IMAGE_MAX_DIMENSION = 1200;
export const SUPPLY_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function getSupplyImageStoragePath(supplyId) {
  const normalizedId = String(supplyId || "").trim();
  if (!normalizedId) throw new Error("No se pudo identificar el insumo para guardar la fotografía.");
  return `printshop/supplies/${normalizedId}/product-image.webp`;
}

export function validateSupplyImageFile(file) {
  if (!file) return "Selecciona una imagen.";
  if (!SUPPLY_IMAGE_MIME_TYPES.includes(file.type)) {
    return "Usa una imagen JPEG, PNG o WebP.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "La imagen seleccionada está vacía.";
  }
  if (file.size > SUPPLY_IMAGE_MAX_BYTES) {
    return "La imagen debe pesar 5 MB o menos.";
  }
  return "";
}

function canvasToWebp(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo procesar la fotografía."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.84
    );
  });
}

export async function prepareSupplyImageFile(file) {
  const validationMessage = validateSupplyImageFile(file);
  if (validationMessage) throw new Error(validationMessage);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const ratio = Math.min(
    1,
    SUPPLY_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
  );
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    bitmap.close();
    throw new Error("El navegador no pudo procesar la fotografía.");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvasToWebp(canvas);
  if (blob.size > SUPPLY_IMAGE_MAX_BYTES) {
    throw new Error("La fotografía procesada supera 5 MB.");
  }
  return blob;
}

