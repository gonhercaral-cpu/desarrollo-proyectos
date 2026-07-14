export function normalizeId(value) {
  if (typeof value === "string") return value.trim();

  if (value && typeof value === "object") {
    const candidate =
      value.id ??
      value.value ??
      value.signatureId ??
      value.templateId ??
      value.uid;
    return candidate == null ? "" : String(candidate).trim();
  }

  return "";
}
