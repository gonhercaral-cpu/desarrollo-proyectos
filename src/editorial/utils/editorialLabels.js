// Estabilización — normalizadores de etiquetas legibles. Nunca IDs, iniciales
// sueltas, [object Object] ni cadenas vacías. Puros y testeables.

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Usuario/responsable. Mismo orden de respaldo que el resto del sistema.
export function userDisplayName(user) {
  if (!user || typeof user !== "object") return "Usuario sin nombre";
  return (
    text(user.displayName) ||
    text(user.name) ||
    text(user.fullName) ||
    text(user.nombre) ||
    text(user.email) ||
    "Usuario sin nombre"
  );
}

// Subtítulo del usuario: rol o departamento.
export function userSubLabel(user) {
  return (
    text(user?.role) ||
    text(user?.departmentName) ||
    text(user?.department) ||
    text(user?.email) ||
    "Sin rol"
  );
}

const EXPORT_TYPE_LABELS = { review: "Revisión", print: "Imprenta", partial: "Parcial", images: "Imágenes" };
const EXPORT_VARIANT_LABELS = { student: "Alumno", teacher: "Maestro", both: "Ambas", review: "Revisión", print: "Imprenta" };

function formatDate(value) {
  const millis = value?.seconds ? value.seconds * 1000 : value?.toMillis ? value.toMillis() : value;
  const date = millis ? new Date(millis) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// Nombre principal de una exportación.
export function exportDisplayName(item) {
  if (!item || typeof item !== "object") return "Exportación sin nombre";
  const fromSettings = text(item.fileName) || text(item.name);
  if (fromSettings) return fromSettings;
  const type = EXPORT_TYPE_LABELS[item.type] || text(item.type);
  const variant = EXPORT_VARIANT_LABELS[item.variant] || text(item.variant);
  const label = [type, variant].filter(Boolean).join(" ");
  return label || "Exportación sin nombre";
}

// Subtítulo: Tipo · Variante · Fecha.
export function exportSubLabel(item) {
  const type = EXPORT_TYPE_LABELS[item?.type] || text(item?.type) || "—";
  const variant = EXPORT_VARIANT_LABELS[item?.variant] || text(item?.variant) || "—";
  const date = formatDate(item?.completedAt || item?.createdAt || item?.updatedAt);
  return [type, variant, date].filter(Boolean).join(" · ");
}

// Carpeta de Nube AES (Drive).
export function driveFolderLabel(folder) {
  if (!folder || typeof folder !== "object") return "Carpeta";
  return (
    text(folder.name) ||
    text(folder.folderName) ||
    text(folder.displayName) ||
    text(folder.title) ||
    text(folder.departmentName) ||
    "Carpeta sin nombre"
  );
}

export function driveFolderSubLabel(folder) {
  return text(folder?.path) || text(folder?.departmentName) || text(folder?.parentName) || "";
}
