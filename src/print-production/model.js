export const TYPES = {
  book: "Libro", certificate: "Certificado", credential: "Credencial", flyer: "Volante",
  brochure: "Folleto", trifold: "Tríptico", worksheet: "Hoja de actividad",
  teaching: "Material didáctico", advertising: "Material publicitario", form: "Formato interno", other: "Otro documento",
};

export function sourceName(source) {
  return source?.name || source?.filename || "Documento";
}

export function millis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.seconds != null) return value.seconds * 1000;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

export function count(value) {
  return (Number(value) || 0).toLocaleString("es-MX");
}

export function humanSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.ceil((Number(bytes) || 0) / 1024) + " KB";
}

export function kindFor(material) {
  const text = String(material?.type || material?.category || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (TYPES[text]) return text;
  const match = Object.entries(TYPES).find(([, label]) => text.includes(label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
  return match?.[0] || "other";
}

export function errorText(error) {
  return error?.message || "No se pudo completar la operación.";
}

export function mayOperate(isAdmin,settings,user,permission) {
  if(isAdmin)return true;
  const rule=settings?.permissions?.[permission]||{};
  if(rule.denyUids?.includes(user?.uid))return false;
  if(rule.allowUids?.includes(user?.uid))return true;
  return rule.operator ?? !["inventory","supplies"].includes(permission);
}
