// Estabilización — resolución de descargas de publicaciones/exportaciones.
// Lógica pura: decidir si hay archivo descargable, qué URL/ruta usar y con qué
// nombre legible. La resolución async de storagePath vive en el servicio.

const VARIANT_LABELS = {
  student: "Alumno",
  teacher: "Maestro",
  review: "Revisión",
  print: "Imprenta",
};

export function variantLabel(variant) {
  return VARIANT_LABELS[variant] || variant || "Documento";
}

// ¿La referencia (export o ref congelada de publicación) es descargable?
export function isDownloadable(ref) {
  return Boolean(ref && (ref.downloadUrl || ref.downloadURL || ref.storagePath));
}

// Normaliza una referencia a un objetivo de descarga uniforme.
export function resolveDownloadTarget(ref, { projectName = "" } = {}) {
  if (!ref) return null;
  const url = ref.downloadUrl || ref.downloadURL || "";
  const storagePath = ref.storagePath || "";
  if (!url && !storagePath) return null;
  return {
    url,
    storagePath,
    needsResolve: !url && Boolean(storagePath),
    name: buildDownloadName(ref, projectName),
    variant: ref.variant || "",
    exportId: ref.exportId || ref.id || "",
  };
}

// Nombre legible del archivo para la descarga.
function slug(value, fallback) {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

export function buildDownloadName(ref, projectName = "") {
  const base = slug(projectName, "material");
  const variant = slug(variantLabel(ref?.variant || ref?.type).toLowerCase(), "documento");
  return `${base}-${variant}.pdf`;
}

// ¿La publicación tiene al menos un archivo descargable?
export function hasDownloadableExports(publication) {
  return Array.isArray(publication?.exports) && publication.exports.some(isDownloadable);
}

// Sólo las referencias descargables de una publicación.
export function downloadableExports(publication) {
  return (Array.isArray(publication?.exports) ? publication.exports : []).filter(isDownloadable);
}
